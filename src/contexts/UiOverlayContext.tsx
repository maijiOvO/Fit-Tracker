/**
 * 全局 UI 覆盖层：确认对话框、Toast、带撤销的 Toast
 * 替代 window.confirm / alert，移动端体验一致。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import { X, Check, AlertCircle } from 'lucide-react';
import { Language } from '../../types';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  undoLabel?: string;
  onUndo?: () => void | Promise<void>;
  expiresAt: number;
}

interface UiOverlayContextValue {
  lang: Language;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  toast: (message: string, variant?: ToastVariant) => void;
  /** 显示带「撤销」的 toast，默认 5 秒 */
  toastUndo: (
    message: string,
    onUndo: () => void | Promise<void>,
    options?: { durationMs?: number; undoLabel?: string },
  ) => void;
}

const UiOverlayContext = createContext<UiOverlayContextValue | null>(null);

export function useUiOverlay(): UiOverlayContextValue {
  const ctx = useContext(UiOverlayContext);
  if (!ctx) {
    throw new Error('useUiOverlay must be used within UiOverlayProvider');
  }
  return ctx;
}

/** 组件树外使用时的安全降级（测试 / 边缘情况） */
export function useUiOverlayOptional(): UiOverlayContextValue | null {
  return useContext(UiOverlayContext);
}

interface UiOverlayProviderProps {
  lang: Language;
  children: React.ReactNode;
}

export const UiOverlayProvider: React.FC<UiOverlayProviderProps> = ({
  lang,
  children,
}) => {
  const isCn = lang === Language.CN;
  const [confirmState, setConfirmState] = useState<{
    options: ConfirmOptions;
    resolve: (v: boolean) => void;
  } | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = `toast-${++toastIdRef.current}`;
    const expiresAt = Date.now() + 3500;
    setToasts(prev => [...prev.slice(-4), { id, message, variant, expiresAt }]);
    window.setTimeout(() => dismissToast(id), 3500);
  }, [dismissToast]);

  const toastUndo = useCallback(
    (
      message: string,
      onUndo: () => void | Promise<void>,
      options?: { durationMs?: number; undoLabel?: string },
    ) => {
      const id = `toast-${++toastIdRef.current}`;
      const durationMs = options?.durationMs ?? 5000;
      const expiresAt = Date.now() + durationMs;
      setToasts(prev => [
        ...prev.slice(-4),
        {
          id,
          message,
          variant: 'info',
          undoLabel: options?.undoLabel ?? (isCn ? '撤销' : 'Undo'),
          onUndo,
          expiresAt,
        },
      ]);
      window.setTimeout(() => dismissToast(id), durationMs);
    },
    [dismissToast, isCn],
  );

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise(resolve => {
      setConfirmState({ options, resolve });
    });
  }, []);

  const closeConfirm = useCallback((result: boolean) => {
    setConfirmState(prev => {
      prev?.resolve(result);
      return null;
    });
  }, []);

  const handleUndo = async (item: ToastItem) => {
    dismissToast(item.id);
    if (item.onUndo) {
      try {
        await item.onUndo();
        toast(isCn ? '已撤销' : 'Undone', 'success');
      } catch (e) {
        console.error('Undo failed:', e);
        toast(isCn ? '撤销失败' : 'Undo failed', 'error');
      }
    }
  };

  const variantStyles: Record<ToastVariant, string> = {
    success: 'border-green-500/40 bg-green-500/10 text-green-100',
    error: 'border-red-500/40 bg-red-500/10 text-red-100',
    info: 'border-divider bg-card text-primary',
  };

  return (
    <UiOverlayContext.Provider value={{ lang, confirm, toast, toastUndo }}>
      {children}

      {/* 确认对话框 */}
      {confirmState && (
        <div
          className="fixed inset-0 z-[200] bg-base/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 sm:p-6 animate-in fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-inset border border-divider w-full sm:max-w-sm rounded-t-3xl sm:rounded-card p-6 shadow-2xl space-y-4">
            {confirmState.options.title && (
              <h3 className="text-lg font-bold text-primary">
                {confirmState.options.title}
              </h3>
            )}
            <p className="text-sm text-secondary whitespace-pre-line leading-relaxed">
              {confirmState.options.message}
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => closeConfirm(false)}
                className="flex-1 min-h-[48px] rounded-2xl bg-card text-secondary font-bold hover:bg-card-hover transition-colors"
              >
                {confirmState.options.cancelLabel ?? (isCn ? '取消' : 'Cancel')}
              </button>
              <button
                type="button"
                onClick={() => closeConfirm(true)}
                className={`flex-1 min-h-[48px] rounded-2xl font-bold text-white transition-all active:scale-95 ${
                  confirmState.options.danger
                    ? 'bg-danger hover:opacity-90'
                    : 'bg-accent hover:opacity-90 shadow-md shadow-blue-600/20'
                }`}
              >
                {confirmState.options.confirmLabel ?? (isCn ? '确定' : 'OK')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast 栈 */}
      <div
        className="fixed bottom-20 left-0 right-0 z-[190] flex flex-col items-center gap-2 px-4 pointer-events-none"
        aria-live="polite"
      >
        {toasts.map(item => (
          <div
            key={item.id}
            className={`pointer-events-auto w-full max-w-md flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-lg text-sm font-medium animate-in slide-in-from-bottom-2 ${variantStyles[item.variant]}`}
          >
            {item.variant === 'success' && (
              <Check size={18} className="text-green-400 flex-shrink-0" strokeWidth={2.5} />
            )}
            {item.variant === 'error' && (
              <AlertCircle size={18} className="text-red-400 flex-shrink-0" strokeWidth={2} />
            )}
            <span className="flex-1">{item.message}</span>
            {item.onUndo && item.undoLabel && (
              <button
                type="button"
                onClick={() => handleUndo(item)}
                className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-accent text-white text-xs font-bold active:scale-95"
              >
                {item.undoLabel}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismissToast(item.id)}
              className="p-1 text-tertiary hover:text-primary flex-shrink-0"
              aria-label="dismiss"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </UiOverlayContext.Provider>
  );
};
