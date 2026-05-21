/**
 * 智能助手运行时：消息发送、工具调用执行、写操作确认、自动取名
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  AssistantConversation,
  AssistantToolCall,
  AssistantToolName,
  ChatMessage,
  Language,
} from '../../types';
import { db } from '../../services/db';
import AssistantTab from './AssistantTab';
import type { AssistantContextType } from '../contexts/AssistantContext';
import { buildContextSnapshot } from '../../services/assistant/assistantContextSnapshot';
import {
  executeAssistantTool,
  isWriteTool,
  requiresConfirmation,
} from '../../services/assistant/assistantTools';
import {
  OpenAIChatMessage,
  streamChatCompletion,
  isAssistantConfigured,
} from '../../services/assistant/assistantClient';
import { useScheduleContext } from '../contexts';

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function trimToolResult(data: unknown): unknown {
  const s = JSON.stringify(data);
  if (s.length <= 4000) return data;
  return { truncated: true, preview: s.slice(0, 4000) };
}

function toOpenAIMessages(messages: ChatMessage[]): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const msg: OpenAIChatMessage = { role: 'assistant', content: m.content || '' };
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));
      }
      out.push(msg);
    } else if (m.role === 'tool' && m.toolCallId) {
      out.push({
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: m.content,
      });
    }
  }
  return out;
}

function deriveTitle(firstUserText: string, lang: Language): string {
  const t = firstUserText.trim().replace(/\s+/g, ' ');
  if (!t) return lang === Language.CN ? '新对话' : 'New chat';
  return t.length > 24 ? `${t.slice(0, 24)}…` : t;
}

interface Props {
  lang: Language;
  assistantCtx: AssistantContextType;
}

const AssistantRuntime: React.FC<Props> = ({ lang, assistantCtx }) => {
  const {
    active,
    activeId,
    appendMessages,
    replaceMessages,
    renameConversation,
    ensureActiveConversation,
  } = assistantCtx;
  const scheduleCtx = useScheduleContext();
  const [isSending, setIsSending] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const toolRoundRef = useRef(0);
  const MAX_TOOL_ROUNDS = 8;

  const loadConversation = useCallback(async (convId: string): Promise<AssistantConversation | null> => {
    const rows = await db.getAll<AssistantConversation>('assistantConversations');
    return rows.find(c => c.id === convId) ?? null;
  }, []);

  const patchAssistantMessage = useCallback(async (
    convId: string,
    msgId: string,
    patch: Partial<ChatMessage>,
  ) => {
    const stored = await loadConversation(convId);
    if (!stored) return;
    const next = stored.messages.map(m => (m.id === msgId ? { ...m, ...patch } : m));
    await replaceMessages(convId, next);
  }, [loadConversation, replaceMessages]);

  const runToolCalls = useCallback(async (
    convId: string,
    assistantMsgId: string,
    toolCalls: AssistantToolCall[],
  ): Promise<boolean> => {
    const toolResultMessages: ChatMessage[] = [];
    let needsFollowUp = false;

    for (const tc of toolCalls) {
      const name = tc.name as AssistantToolName;
      let status = tc.status;
      let result: unknown;
      let error: string | undefined;

      if (requiresConfirmation(name)) {
        status = 'awaiting_user';
      } else {
        const exec = await executeAssistantTool(name, tc.arguments);
        if (exec.ok) {
          status = 'executed';
          result = trimToolResult(exec.data);
          if (name === 'create_schedule') {
            await scheduleCtx.refreshFromDb();
          }
        } else {
          status = 'failed';
          error = exec.error;
        }
        needsFollowUp = true;
        toolResultMessages.push({
          id: makeId('msg'),
          role: 'tool',
          toolCallId: tc.id,
          content: JSON.stringify(exec.ok ? { ok: true, data: result } : { ok: false, error }),
          createdAt: new Date().toISOString(),
        });
      }

      const updatedCalls = toolCalls.map(t =>
        t.id === tc.id ? { ...t, status, result, error } : t,
      );
      await patchAssistantMessage(convId, assistantMsgId, { toolCalls: updatedCalls });
    }

    if (toolResultMessages.length > 0) {
      await appendMessages(convId, toolResultMessages);
    }
    return needsFollowUp;
  }, [appendMessages, patchAssistantMessage, scheduleCtx]);

  const callModel = useCallback(async (convId: string, isFollowUp = false) => {
    if (!isAssistantConfigured()) {
      setLastError(lang === Language.CN ? 'API 未配置' : 'API not configured');
      return;
    }
    if (!isFollowUp) toolRoundRef.current = 0;
    if (toolRoundRef.current >= MAX_TOOL_ROUNDS) return;
    toolRoundRef.current += 1;
    const conv = await loadConversation(convId);
    if (!conv) return;

    const systemSnapshot = await buildContextSnapshot();
    const openaiMsgs: OpenAIChatMessage[] = [
      { role: 'system', content: systemSnapshot },
      ...toOpenAIMessages(conv.messages),
    ];

    const assistantMsgId = makeId('msg');
    streamingMsgIdRef.current = assistantMsgId;
    const placeholder: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    };
    await appendMessages(convId, [placeholder]);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const final = await streamChatCompletion(
        { messages: openaiMsgs },
        {
          signal: abortRef.current.signal,
          onContentDelta: (delta) => {
            void (async () => {
              const current = await loadConversation(convId);
              const msg = current?.messages.find(m => m.id === assistantMsgId);
              if (!msg) return;
              await patchAssistantMessage(convId, assistantMsgId, {
                content: (msg.content || '') + delta,
              });
            })();
          },
        },
      );

      const parsedCalls: AssistantToolCall[] = (final.tool_calls || []).map(tc => ({
        id: tc.id,
        name: tc.function.name as AssistantToolName,
        arguments: safeParseArgs(tc.function.arguments),
        status: 'pending' as const,
      }));

      await patchAssistantMessage(convId, assistantMsgId, {
        content: final.content || '',
        toolCalls: parsedCalls.length > 0 ? parsedCalls : undefined,
      });

      if (parsedCalls.length > 0) {
        const needsFollowUp = await runToolCalls(convId, assistantMsgId, parsedCalls);
        if (needsFollowUp) {
          await callModel(convId, true);
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return;
      const msg = e instanceof Error ? e.message : String(e);
      setLastError(msg);
      await patchAssistantMessage(convId, assistantMsgId, {
        content: lang === Language.CN ? `出错了：${msg}` : `Error: ${msg}`,
      });
    }
  }, [appendMessages, lang, loadConversation, patchAssistantMessage, runToolCalls]);

  const handleSend = useCallback(async (text: string) => {
    setLastError(null);
    setIsSending(true);
    toolRoundRef.current = 0;
    try {
      const activeConv = await ensureActiveConversation();
      const convId = activeConv.id;
      const conv = await loadConversation(convId);
      const userMsg: ChatMessage = {
        id: makeId('msg'),
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
      };
      await appendMessages(convId, [userMsg]);

      if (conv && conv.messages.length === 0 && (conv.title === '新对话' || conv.title === 'New chat')) {
        await renameConversation(convId, deriveTitle(text, lang));
      }

      await callModel(convId);
    } finally {
      setIsSending(false);
      streamingMsgIdRef.current = null;
    }
  }, [appendMessages, callModel, ensureActiveConversation, lang, loadConversation, renameConversation]);

  const handleApproveToolCall = useCallback(async (toolCallId: string) => {
    const convId = activeId;
    if (!convId) return;
    setIsSending(true);
    setLastError(null);
    try {
      const conv = await loadConversation(convId);
    const assistantMsg = [...(conv?.messages || [])].reverse().find(
      m => m.role === 'assistant' && m.toolCalls?.some(tc => tc.id === toolCallId),
    );
    if (!assistantMsg?.toolCalls) return;
    const tc = assistantMsg.toolCalls.find(t => t.id === toolCallId);
    if (!tc || tc.status !== 'awaiting_user') return;

      const exec = await executeAssistantTool(tc.name, tc.arguments);
      const status = exec.ok ? 'executed' : 'failed';
      const updated = assistantMsg.toolCalls.map(t =>
        t.id === toolCallId
          ? { ...t, status, result: exec.ok ? trimToolResult(exec.data) : undefined, error: exec.error }
          : t,
      );
      await patchAssistantMessage(convId, assistantMsg.id, { toolCalls: updated });
      await appendMessages(convId, [{
        id: makeId('msg'),
        role: 'tool',
        toolCallId: tc.id,
        content: JSON.stringify(exec.ok ? { ok: true, data: exec.data } : { ok: false, error: exec.error }),
        createdAt: new Date().toISOString(),
      }]);
      if (exec.ok && isWriteTool(tc.name)) {
        await scheduleCtx.refreshFromDb();
      }
      await callModel(convId);
    } finally {
      setIsSending(false);
    }
  }, [activeId, appendMessages, callModel, loadConversation, patchAssistantMessage, scheduleCtx]);

  const handleRejectToolCall = useCallback(async (toolCallId: string) => {
    const convId = activeId;
    if (!convId) return;
    const conv = await loadConversation(convId);
    const assistantMsg = [...(conv?.messages || [])].reverse().find(
      m => m.role === 'assistant' && m.toolCalls?.some(tc => tc.id === toolCallId),
    );
    if (!assistantMsg?.toolCalls) return;
    const tc = assistantMsg.toolCalls.find(t => t.id === toolCallId);
    if (!tc) return;
    const updated = assistantMsg.toolCalls.map(t =>
      t.id === toolCallId ? { ...t, status: 'rejected' as const } : t,
    );
    await patchAssistantMessage(convId, assistantMsg.id, { toolCalls: updated });
    await appendMessages(convId, [{
      id: makeId('msg'),
      role: 'tool',
      toolCallId: tc.id,
      content: JSON.stringify({ ok: false, rejected: true }),
      createdAt: new Date().toISOString(),
    }]);
    await callModel(convId);
  }, [activeId, appendMessages, callModel, loadConversation, patchAssistantMessage]);

  return (
    <AssistantTab
      lang={lang}
      onSend={handleSend}
      onApproveToolCall={handleApproveToolCall}
      onRejectToolCall={handleRejectToolCall}
      isSending={isSending}
      lastError={lastError}
    />
  );
};

export default AssistantRuntime;
