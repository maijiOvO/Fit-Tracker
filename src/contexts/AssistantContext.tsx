import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { AssistantConversation, ChatMessage } from '../../types';
import { db } from '../../services/db';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { FITLOG_SOLO_USER_ID } from '../../services/fitlogSolo';
import { recordTombstone } from '../../services/fitlogTombstones';

export interface AssistantContextType {
  conversations: AssistantConversation[];
  activeId: string | null;
  active: AssistantConversation | null;
  isLoading: boolean;

  createConversation: (title?: string) => Promise<AssistantConversation>;
  /** 保证有 active 会话（必要时新建并等待落盘） */
  ensureActiveConversation: () => Promise<AssistantConversation>;
  setActiveId: (id: string | null) => void;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  /** 清空当前会话的所有消息（保留会话本身） */
  clearMessages: (id: string) => Promise<void>;

  /** 不直接落盘 setMessages，确保 IDB + 远端同步只在事务完成后触发 */
  appendMessages: (id: string, messages: ChatMessage[]) => Promise<void>;
  replaceMessages: (id: string, messages: ChatMessage[]) => Promise<void>;

  refreshFromDb: () => Promise<void>;
}

const AssistantContext = createContext<AssistantContextType | undefined>(undefined);

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const AssistantProvider: React.FC<{ children: ReactNode; userId?: string }> = ({
  children,
  userId,
}) => {
  const uid = userId || FITLOG_SOLO_USER_ID;
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // 防止并发写覆盖：所有持久化操作单线程串行
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const conversationsRef = useRef<AssistantConversation[]>([]);
  conversationsRef.current = conversations;

  const refreshFromDb = useCallback(async () => {
    const rows = await db.getAll<AssistantConversation>('assistantConversations');
    const filtered =
      uid === FITLOG_SOLO_USER_ID || uid === 'u_guest'
        ? rows
        : rows.filter(r => r.userId === uid);
    const sorted = filtered.sort((a, b) =>
      new Date(b.updatedAt || b.createdAt).getTime()
        - new Date(a.updatedAt || a.createdAt).getTime(),
    );
    setConversations(sorted);
    setIsLoading(false);
  }, [uid]);

  useEffect(() => {
    void refreshFromDb();
  }, [uid, refreshFromDb]);

  const runWrite = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const next = writeQueue.current.then(() => task());
    writeQueue.current = next.then(() => undefined, () => undefined);
    return next;
  }, []);

  const persist = useCallback(async (conv: AssistantConversation) => {
    await db.upsert('assistantConversations', conv);
    setConversations(prev => {
      const others = prev.filter(c => c.id !== conv.id);
      const merged = [conv, ...others].sort((a, b) =>
        new Date(b.updatedAt || b.createdAt).getTime()
          - new Date(a.updatedAt || a.createdAt).getTime(),
      );
      return merged;
    });
    scheduleDebouncedFitlogPush();
  }, []);

  /** IDB 尚未落盘时，用内存里的会话兜底（避免首条消息静默丢失） */
  const resolveConversation = useCallback(async (id: string): Promise<AssistantConversation | null> => {
    const stored = await db.getAll<AssistantConversation>('assistantConversations');
    const fromDb = stored.find(c => c.id === id);
    if (fromDb) return fromDb;
    return conversationsRef.current.find(c => c.id === id) ?? null;
  }, []);

  const createConversation = useCallback(async (title?: string): Promise<AssistantConversation> => {
    const now = new Date().toISOString();
    const conv: AssistantConversation = {
      id: makeId('conv'),
      userId: uid,
      title: title?.trim() || '新对话',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    setConversations(prev => [conv, ...prev]);
    setActiveId(conv.id);
    await runWrite(() => persist(conv));
    return conv;
  }, [uid, persist, runWrite]);

  const renameConversation = useCallback(async (id: string, title: string) => {
    await runWrite(async () => {
      const target = conversations.find(c => c.id === id);
      if (!target) return;
      const next: AssistantConversation = {
        ...target,
        title: title.trim() || target.title,
        updatedAt: new Date().toISOString(),
      };
      await persist(next);
    });
  }, [conversations, persist, runWrite]);

  const deleteConversation = useCallback(async (id: string) => {
    await runWrite(async () => {
      await db.delete('assistantConversations', id);
      recordTombstone('assistantConversations', id);
      setConversations(prev => prev.filter(c => c.id !== id));
      setActiveId(prevId => (prevId === id ? null : prevId));
      scheduleDebouncedFitlogPush();
    });
  }, [runWrite]);

  const clearMessages = useCallback(async (id: string) => {
    await runWrite(async () => {
      const target = conversations.find(c => c.id === id);
      if (!target) return;
      const next: AssistantConversation = {
        ...target,
        messages: [],
        updatedAt: new Date().toISOString(),
      };
      await persist(next);
    });
  }, [conversations, persist, runWrite]);

  const appendMessages = useCallback(async (id: string, messages: ChatMessage[]) => {
    if (messages.length === 0) return;
    const now = new Date().toISOString();
    // 先乐观更新 UI，避免等 IDB 才显示用户消息
    setConversations(prev =>
      prev.map(c =>
        c.id === id
          ? { ...c, messages: [...c.messages, ...messages], updatedAt: now }
          : c,
      ),
    );
    await runWrite(async () => {
      const target = await resolveConversation(id);
      if (!target) return;
      const next: AssistantConversation = {
        ...target,
        messages: [...target.messages, ...messages],
        updatedAt: now,
      };
      await persist(next);
    });
  }, [persist, resolveConversation, runWrite]);

  const replaceMessages = useCallback(async (id: string, messages: ChatMessage[]) => {
    const now = new Date().toISOString();
    setConversations(prev =>
      prev.map(c => (c.id === id ? { ...c, messages, updatedAt: now } : c)),
    );
    await runWrite(async () => {
      const target = await resolveConversation(id);
      if (!target) return;
      const next: AssistantConversation = { ...target, messages, updatedAt: now };
      await persist(next);
    });
  }, [persist, resolveConversation, runWrite]);

  const ensureActiveConversation = useCallback(async (): Promise<AssistantConversation> => {
    if (activeId) {
      const existing = await resolveConversation(activeId);
      if (existing) return existing;
    }
    if (conversationsRef.current.length > 0) {
      const first = conversationsRef.current[0];
      setActiveId(first.id);
      const resolved = await resolveConversation(first.id);
      if (resolved) return resolved;
    }
    return createConversation();
  }, [activeId, createConversation, resolveConversation]);

  const active = useMemo(
    () => conversations.find(c => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  return (
    <AssistantContext.Provider
      value={{
        conversations,
        activeId,
        active,
        isLoading,
        createConversation,
        ensureActiveConversation,
        setActiveId,
        renameConversation,
        deleteConversation,
        clearMessages,
        appendMessages,
        replaceMessages,
        refreshFromDb,
      }}
    >
      {children}
    </AssistantContext.Provider>
  );
};

export const useAssistantContext = (): AssistantContextType => {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error('useAssistantContext must be used within AssistantProvider');
  return ctx;
};

export default AssistantContext;
