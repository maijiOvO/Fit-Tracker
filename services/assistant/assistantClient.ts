/**
 * OpenAI 兼容的 chat completions 客户端，挂在 fitlog server 上
 * 路径：/api/fitlog/assistant/chat
 * 认证：Bearer VITE_API_KEY
 * 支持流式（SSE）与非流式两种调用方式
 */
import { normalizeApiBaseUrl } from '../fitlogRemote';
import { ALL_TOOL_SPECS, ToolSpec } from './assistantTools';

const RAW_API_URL = import.meta.env.VITE_API_URL || '';
const API_KEY = import.meta.env.VITE_API_KEY || '';
const ASSISTANT_PATH = import.meta.env.VITE_ASSISTANT_PATH || '/api/chat';
const DEFAULT_MODEL = import.meta.env.VITE_ASSISTANT_MODEL || 'deepseek-chat';

const API_BASE_URL = normalizeApiBaseUrl(RAW_API_URL);

export function isAssistantConfigured(): boolean {
  return Boolean(API_BASE_URL && API_KEY.trim());
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAIChatMessage {
  role: ChatRole;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: OpenAIChatMessage[];
  tools?: ToolSpec[];
  tool_choice?: 'auto' | 'none';
  temperature?: number;
  stream?: boolean;
}

export interface ChatCompletionMessageDelta {
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: { name?: string; arguments?: string };
  }>;
}

export interface ChatCompletionChunk {
  id?: string;
  choices: Array<{
    index: number;
    delta: ChatCompletionMessageDelta;
    finish_reason: 'stop' | 'tool_calls' | 'length' | null;
  }>;
}

export interface ChatCompletionResponse {
  id?: string;
  choices: Array<{
    index: number;
    message: OpenAIChatMessage;
    finish_reason: 'stop' | 'tool_calls' | 'length';
  }>;
}

// 流式回调
export interface StreamHandlers {
  onContentDelta?: (delta: string) => void;
  onToolCallDelta?: (idx: number, patch: { id?: string; name?: string; argumentsDelta?: string }) => void;
  onFinish?: (finishReason: string | null) => void;
  signal?: AbortSignal;
}

function headers(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_KEY}`,
  };
}

function endpoint(): string {
  return `${API_BASE_URL.replace(/\/$/, '')}${ASSISTANT_PATH}`;
}

/** 非流式：等完整响应 */
export async function postChatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
  if (!isAssistantConfigured()) throw new Error('assistant API not configured');
  const body: ChatCompletionRequest = {
    model: req.model || DEFAULT_MODEL,
    tools: req.tools ?? ALL_TOOL_SPECS,
    tool_choice: 'auto',
    temperature: req.temperature ?? 0.4,
    ...req,
    stream: false,
  };
  const resp = await fetch(endpoint(), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`assistant API ${resp.status}: ${txt.slice(0, 300)}`);
  }
  return (await resp.json()) as ChatCompletionResponse;
}

/**
 * 流式：解析 SSE，将每个 chunk 的 delta 通过 handlers 暴露给调用方。
 * 返回的 Promise 解析为该轮组装好的最终 message（content + tool_calls）。
 */
export async function streamChatCompletion(
  req: ChatCompletionRequest,
  handlers: StreamHandlers,
): Promise<OpenAIChatMessage> {
  if (!isAssistantConfigured()) throw new Error('assistant API not configured');
  const body: ChatCompletionRequest = {
    model: req.model || DEFAULT_MODEL,
    tools: req.tools ?? ALL_TOOL_SPECS,
    tool_choice: 'auto',
    temperature: req.temperature ?? 0.4,
    ...req,
    stream: true,
  };

  const resp = await fetch(endpoint(), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal: handlers.signal,
  });
  if (!resp.ok || !resp.body) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`assistant API ${resp.status}: ${txt.slice(0, 300)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let assistantContent = '';
  const toolCallsAcc: Array<{ id: string; name: string; arguments: string }> = [];
  let finishReason: string | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    // 按 SSE 格式拆 event
    const events = buffered.split('\n\n');
    buffered = events.pop() ?? '';
    for (const ev of events) {
      // 每个事件可能含多行 `data: <json>` —— 取最后一行 data
      const lines = ev.split('\n');
      const dataLines = lines
        .filter(l => l.startsWith('data:'))
        .map(l => l.slice(5).trim());
      if (dataLines.length === 0) continue;
      const payload = dataLines.join('');
      if (payload === '[DONE]') {
        finishReason = finishReason ?? 'stop';
        continue;
      }
      let chunk: ChatCompletionChunk;
      try {
        chunk = JSON.parse(payload) as ChatCompletionChunk;
      } catch {
        continue;
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        assistantContent += delta.content;
        handlers.onContentDelta?.(delta.content);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          while (toolCallsAcc.length <= idx) {
            toolCallsAcc.push({ id: '', name: '', arguments: '' });
          }
          const slot = toolCallsAcc[idx];
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name = tc.function.name;
          if (typeof tc.function?.arguments === 'string') {
            slot.arguments += tc.function.arguments;
          }
          handlers.onToolCallDelta?.(idx, {
            id: tc.id,
            name: tc.function?.name,
            argumentsDelta: tc.function?.arguments,
          });
        }
      }
      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
    }
  }

  handlers.onFinish?.(finishReason);

  const finalMessage: OpenAIChatMessage = { role: 'assistant', content: assistantContent || '' };
  if (toolCallsAcc.length > 0 && toolCallsAcc.some(t => t.id || t.name || t.arguments)) {
    finalMessage.tool_calls = toolCallsAcc
      .filter(t => t.id || t.name)
      .map(t => ({
        id: t.id || `call_${Math.random().toString(36).slice(2)}`,
        type: 'function',
        function: { name: t.name, arguments: t.arguments },
      }));
  }
  return finalMessage;
}
