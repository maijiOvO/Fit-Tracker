/**
 * 智能助手 Tab：左侧会话列表（手机为抽屉），右侧聊天面板
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Edit2,
  History,
  Menu,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { AssistantConversation, AssistantToolCall, ChatMessage, Language } from '../../types';
import { translations } from '../../translations';
import { useAssistantContext } from '../contexts';
import { isAssistantConfigured } from '../../services/assistant/assistantClient';
import { isWriteTool, requiresConfirmation } from '../../services/assistant/assistantTools';

export interface AssistantTabProps {
  lang: Language;
  /** 发送一条用户消息（由 App 注入：组装上下文、发起 LLM 调用、执行工具、写消息）。 */
  onSend: (text: string) => Promise<void>;
  /** 用户点了「应用」执行某个待确认的工具调用 */
  onApproveToolCall: (toolCallId: string) => Promise<void>;
  /** 用户点了「拒绝」某个待确认的工具调用 */
  onRejectToolCall: (toolCallId: string) => Promise<void>;
  /** 当前是否正在等待 LLM 响应 */
  isSending: boolean;
  /** 上一次错误（用于显示） */
  lastError: string | null;
}

const SUGGESTIONS_KEYS: Array<keyof typeof translations> = [
  'assistantSuggestPlan',
  'assistantSuggestReview',
  'assistantSuggestAdjust',
];

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

const AssistantTab: React.FC<AssistantTabProps> = ({
  lang,
  onSend,
  onApproveToolCall,
  onRejectToolCall,
  isSending,
  lastError,
}) => {
  const {
    conversations,
    activeId,
    active,
    isLoading,
    setActiveId,
    createConversation,
    ensureActiveConversation,
    renameConversation,
    deleteConversation,
    clearMessages,
  } = useAssistantContext();

  const [draft, setDraft] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 没有任何对话时自动开一条（等 IDB 加载完再建，避免和远端合并竞态）
  useEffect(() => {
    if (isLoading) return;
    if (conversations.length === 0) {
      void createConversation();
    } else if (!activeId) {
      setActiveId(conversations[0].id);
    }
  }, [conversations, activeId, createConversation, setActiveId, isLoading]);

  // 新消息进来时自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.messages?.length, isSending]);

  const apiConfigured = isAssistantConfigured();
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || isSending) return;
    if (!apiConfigured) {
      setLocalError(translations.assistantApiNotConfigured[lang]);
      return;
    }
    setLocalError(null);
    setDraft('');
    try {
      await ensureActiveConversation();
      await onSend(text);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocalError(msg);
      setDraft(text);
    }
  };

  const submitRename = async () => {
    if (!renamingId) return;
    await renameConversation(renamingId, renameDraft);
    setRenamingId(null);
    setRenameDraft('');
  };

  return (
    <div className="flex h-[calc(100vh-9rem)] max-h-[760px] gap-3 -mx-2 sm:mx-0">
      {/* 侧边栏 */}
      <aside
        className={`${
          sidebarOpen ? 'fixed inset-0 z-[65] bg-base/95 backdrop-blur-md p-4 sm:relative sm:bg-transparent sm:p-0' : 'hidden sm:block'
        } sm:w-64 sm:flex sm:flex-col`}
      >
        <div className="ui-card p-3 h-full flex flex-col" data-testid="assistant-sidebar">
          <div className="flex items-center justify-between mb-3">
            <h3 className="ui-section-label text-xs flex items-center gap-1.5">
              <History size={14} strokeWidth={1.75} /> {translations.assistantConversations[lang]}
            </h3>
            <button
              className="sm:hidden p-1.5 text-tertiary hover:text-primary"
              onClick={() => setSidebarOpen(false)}
              aria-label="close-sidebar"
            >
              <X size={16} />
            </button>
          </div>
          <button
            data-testid="assistant-new-conv"
            onClick={() => {
              void createConversation().then(conv => {
                setSidebarOpen(false);
                setActiveId(conv.id);
              });
            }}
            className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 mb-2 rounded-control bg-accent text-white text-sm font-medium hover:opacity-90 active:scale-95 transition"
          >
            <Plus size={16} strokeWidth={2} />
            {translations.assistantNewConversation[lang]}
          </button>
          <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1 pr-1">
            {conversations.map(c => (
              <ConversationRow
                key={c.id}
                conv={c}
                active={c.id === activeId}
                lang={lang}
                isRenaming={renamingId === c.id}
                renameDraft={renameDraft}
                onSelect={() => {
                  setActiveId(c.id);
                  setSidebarOpen(false);
                }}
                onStartRename={() => {
                  setRenamingId(c.id);
                  setRenameDraft(c.title);
                }}
                onRenameChange={setRenameDraft}
                onSubmitRename={submitRename}
                onCancelRename={() => {
                  setRenamingId(null);
                  setRenameDraft('');
                }}
                onDelete={() => deleteConversation(c.id)}
                onClear={() => clearMessages(c.id)}
              />
            ))}
            {conversations.length === 0 && (
              <p className="text-xs text-tertiary text-center py-4">
                {translations.assistantNewConversation[lang]}
              </p>
            )}
          </div>
        </div>
      </aside>

      {/* 聊天面板 */}
      <main className="flex-1 ui-card flex flex-col min-w-0" data-testid="assistant-chat-panel">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-divider">
          <button
            onClick={() => setSidebarOpen(true)}
            className="sm:hidden p-1.5 rounded-chip text-tertiary hover:text-primary hover:bg-card-hover"
            aria-label="open-sidebar"
          >
            <Menu size={18} strokeWidth={1.75} />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={16} strokeWidth={1.75} className="text-accent shrink-0" />
            <h3 className="font-display text-sm font-semibold text-primary truncate" data-testid="assistant-active-title">
              {active?.title || translations.assistantTab[lang]}
            </h3>
          </div>
        </div>

        {!apiConfigured && (
          <div className="m-3 p-3 rounded-control bg-warning/10 border border-warning/30 text-warning text-xs flex items-start gap-2">
            <AlertCircle size={14} strokeWidth={1.75} className="shrink-0 mt-0.5" />
            <span>{translations.assistantApiNotConfigured[lang]}</span>
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3" data-testid="assistant-messages">
          {(!active || active.messages.length === 0) && (
            <EmptyState
              lang={lang}
              onPick={(text) => { setDraft(text); }}
            />
          )}
          {active?.messages.map(m => (
            <MessageBubble
              key={m.id}
              message={m}
              lang={lang}
              onApprove={onApproveToolCall}
              onReject={onRejectToolCall}
            />
          ))}
          {isSending && (
            <div className="flex items-center gap-2 text-tertiary text-xs px-2" data-testid="assistant-thinking">
              <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
              {translations.assistantThinking[lang]}
            </div>
          )}
          {(lastError || localError) && (
            <div className="text-danger text-xs px-2" data-testid="assistant-error">
              <AlertCircle size={12} className="inline mr-1" />
              {lastError || localError}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-divider">
          <div className="flex items-end gap-2">
            <textarea
              data-testid="assistant-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={translations.assistantInputPlaceholder[lang]}
              rows={1}
              className="flex-1 resize-none min-h-[40px] max-h-32 px-3 py-2 rounded-control bg-inset border border-divider text-primary text-sm focus:outline-none focus:border-accent"
            />
            <button
              data-testid="assistant-send"
              onClick={() => void handleSend()}
              disabled={!draft.trim() || isSending || !apiConfigured}
              className="px-3 h-10 rounded-control bg-accent text-white text-sm font-medium hover:opacity-90 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
            >
              <Send size={16} strokeWidth={2} />
              <span className="hidden sm:inline">{translations.assistantSend[lang]}</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

interface EmptyStateProps {
  lang: Language;
  onPick: (text: string) => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ lang, onPick }) => (
  <div className="flex flex-col items-center justify-center py-10 px-4 text-center space-y-4">
    <div className="p-3 rounded-control bg-accent-soft text-accent">
      <Sparkles size={24} strokeWidth={1.5} />
    </div>
    <div>
      <h4 className="font-display text-base font-semibold text-primary">
        {translations.assistantEmptyTitle[lang]}
      </h4>
      <p className="text-xs text-secondary mt-2 max-w-md">
        {translations.assistantEmptySubtitle[lang]}
      </p>
    </div>
    <div className="flex flex-wrap gap-2 justify-center">
      {SUGGESTIONS_KEYS.map(k => (
        <button
          key={k}
          onClick={() => onPick(translations[k][lang])}
          className="text-xs px-3 py-1.5 rounded-chip bg-inset border border-divider text-secondary hover:text-primary hover:bg-card-hover transition"
        >
          {translations[k][lang]}
        </button>
      ))}
    </div>
  </div>
);

interface ConversationRowProps {
  conv: AssistantConversation;
  active: boolean;
  lang: Language;
  isRenaming: boolean;
  renameDraft: string;
  onSelect: () => void;
  onStartRename: () => void;
  onRenameChange: (v: string) => void;
  onSubmitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onClear: () => void;
}

const ConversationRow: React.FC<ConversationRowProps> = ({
  conv,
  active,
  lang,
  isRenaming,
  renameDraft,
  onSelect,
  onStartRename,
  onRenameChange,
  onSubmitRename,
  onCancelRename,
  onDelete,
  onClear,
}) => {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className={`group rounded-chip px-2 py-2 cursor-pointer transition-colors ${
        active ? 'bg-accent-soft text-accent' : 'text-secondary hover:bg-card-hover'
      }`}
      onClick={() => !isRenaming && onSelect()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-testid="assistant-conv-row"
      data-conv-id={conv.id}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <MessageSquare size={12} strokeWidth={1.75} className="shrink-0" />
        {isRenaming ? (
          <input
            value={renameDraft}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmitRename();
              if (e.key === 'Escape') onCancelRename();
            }}
            data-testid="assistant-rename-input"
            className="flex-1 text-xs px-1.5 py-0.5 rounded bg-inset border border-divider text-primary focus:outline-none focus:border-accent"
            autoFocus
          />
        ) : (
          <span className="text-xs font-medium truncate flex-1">{conv.title}</span>
        )}
        {isRenaming ? (
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); onSubmitRename(); }}
              className="p-1 text-success hover:bg-success/10 rounded"
              aria-label="rename-confirm"
            >
              <Check size={12} strokeWidth={2.25} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onCancelRename(); }}
              className="p-1 text-tertiary hover:bg-card-hover rounded"
              aria-label="rename-cancel"
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>
        ) : (
          (hovered || active) && (
            <div className="flex items-center gap-0.5">
              <button
                onClick={(e) => { e.stopPropagation(); onStartRename(); }}
                title={translations.assistantRename[lang]}
                data-testid="assistant-rename-btn"
                className="p-1 text-tertiary hover:text-accent hover:bg-card-hover rounded"
              >
                <Edit2 size={12} strokeWidth={1.75} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(lang === Language.CN ? '清空当前对话的所有消息？' : 'Clear all messages?')) {
                    onClear();
                  }
                }}
                title={translations.assistantClear[lang]}
                className="p-1 text-tertiary hover:text-warning hover:bg-card-hover rounded"
              >
                <span className="text-[10px] font-mono">∅</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(lang === Language.CN ? '删除该对话？' : 'Delete this conversation?')) {
                    onDelete();
                  }
                }}
                title={translations.assistantDelete[lang]}
                data-testid="assistant-delete-btn"
                className="p-1 text-tertiary hover:text-danger hover:bg-card-hover rounded"
              >
                <Trash2 size={12} strokeWidth={1.75} />
              </button>
            </div>
          )
        )}
      </div>
      <div className="text-[10px] text-tertiary mt-0.5 pl-4">
        {fmtTime(conv.updatedAt || conv.createdAt)}
      </div>
    </div>
  );
};

interface MessageBubbleProps {
  message: ChatMessage;
  lang: Language;
  onApprove: (toolCallId: string) => Promise<void>;
  onReject: (toolCallId: string) => Promise<void>;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, lang, onApprove, onReject }) => {
  if (message.role === 'tool' || message.role === 'system') {
    // 系统/工具结果消息：折叠的小卡片
    return null;
  }
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-card px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
          isUser ? 'bg-accent text-white' : 'bg-inset text-primary border border-divider'
        }`}
        data-testid={`assistant-msg-${message.role}`}
      >
        {message.content && <div>{message.content}</div>}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className={`mt-2 space-y-1.5 ${isUser ? 'text-white/90' : ''}`}>
            {message.toolCalls.map(tc => (
              <ToolCallCard key={tc.id} tc={tc} lang={lang} onApprove={onApprove} onReject={onReject} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface ToolCallCardProps {
  tc: AssistantToolCall;
  lang: Language;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}

const ToolCallCard: React.FC<ToolCallCardProps> = ({ tc, lang, onApprove, onReject }) => {
  const writeOp = isWriteTool(tc.name);
  const needsConfirm = requiresConfirmation(tc.name);
  const statusText = (() => {
    switch (tc.status) {
      case 'pending': return writeOp ? translations.assistantToolWriting[lang] : translations.assistantToolReading[lang];
      case 'awaiting_user': return lang === Language.CN ? '等待你确认' : 'Awaiting approval';
      case 'executed': return translations.assistantApproveCreate[lang];
      case 'rejected': return lang === Language.CN ? '已拒绝' : 'Rejected';
      case 'failed': return tc.error || (lang === Language.CN ? '执行失败' : 'Failed');
    }
  })();
  const statusCls = (() => {
    switch (tc.status) {
      case 'executed': return 'text-success';
      case 'failed':
      case 'rejected': return 'text-danger';
      case 'awaiting_user': return 'text-warning';
      default: return 'text-secondary';
    }
  })();
  return (
    <div
      data-testid={`assistant-toolcall-${tc.name}`}
      data-toolcall-id={tc.id}
      data-toolcall-status={tc.status}
      className="rounded-chip border border-divider bg-card/70 px-2.5 py-1.5 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-tertiary">{tc.name}</span>
        <span className={`font-medium ${statusCls}`}>{statusText}</span>
      </div>
      {tc.status === 'awaiting_user' && needsConfirm && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            onClick={() => onApprove(tc.id)}
            data-testid="assistant-tool-approve"
            className="px-2 py-1 rounded bg-accent text-white text-[11px] font-medium hover:opacity-90 active:scale-95"
          >
            {translations.assistantApprove[lang]}
          </button>
          <button
            onClick={() => onReject(tc.id)}
            data-testid="assistant-tool-reject"
            className="px-2 py-1 rounded border border-divider text-secondary text-[11px] hover:text-primary hover:bg-card-hover"
          >
            {translations.assistantReject[lang]}
          </button>
        </div>
      )}
    </div>
  );
};

export default AssistantTab;
