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
import { Modal, ModalFooter } from '../components/Modal';

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
  /** 停留时长，喂给底边剩余时间线的 animation-duration（§5.3） */
  durationMs: number;
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
    const durationMs = 3500;
    const expiresAt = Date.now() + durationMs;
    setToasts(prev => [...prev.slice(-4), { id, message, variant, expiresAt, durationMs }]);
    window.setTimeout(() => dismissToast(id), durationMs);
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
          durationMs,
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

  // 旧值是 text-green-100 / text-red-100（浅色主题下几乎看不见的浅字）。
  // 语义色的 soft 底 + 同色实字，深浅两主题都过 AA（success 5.05/6.22，danger 6.43/5.76）。
  const variantStyles: Record<ToastVariant, string> = {
    success: 'border-success/40 bg-success-soft text-success',
    error: 'border-danger/40 bg-danger-soft text-danger',
    info: 'border-divider bg-card text-primary',
  };

  return (
    <UiOverlayContext.Provider value={{ lang, confirm, toast, toastUndo }}>
      {children}

      {/* 确认对话框。§6.6：危险确认是唯一允许出现 danger 实心的地方，
          且只存在于确认弹窗内——列表里的删除入口一律降级为墨色文字项。 */}
      <Modal
        isOpen={!!confirmState}
        onClose={() => closeConfirm(false)}
        title={confirmState?.options.title}
        size="sm"
        layer="confirm"
        showCloseButton={false}
        dismissOnScrim={false}
        footer={
          <ModalFooter
            cancelLabel={confirmState?.options.cancelLabel ?? (isCn ? '取消' : 'Cancel')}
            confirmLabel={confirmState?.options.confirmLabel ?? (isCn ? '确定' : 'OK')}
            onCancel={() => closeConfirm(false)}
            onConfirm={() => closeConfirm(true)}
            danger={confirmState?.options.danger}
          />
        }
      >
        <p className="text-body text-secondary whitespace-pre-line">
          {confirmState?.options.message}
        </p>
      </Modal>

      {/* Toast 栈 */}
      <div
        className="fixed bottom-20 left-0 right-0 z-toast flex flex-col items-center gap-2 px-4 pointer-events-none"
        aria-live="polite"
      >
        {toasts.map(item => (
          <div
            key={item.id}
            data-testid="toast"
            className={`pointer-events-auto relative overflow-hidden w-full max-w-md flex items-center gap-3 px-4 py-3 rounded-card border shadow-lg text-sm font-medium anim-toast ${variantStyles[item.variant]}`}
          >
            {item.variant === 'success' && (
              <Check size={18} className="text-success flex-shrink-0" strokeWidth={2.5} />
            )}
            {item.variant === 'error' && (
              <AlertCircle size={18} className="text-danger flex-shrink-0" strokeWidth={2} />
            )}
            <span className="flex-1">{item.message}</span>
            {item.onUndo && item.undoLabel && (
              <button
                type="button"
                data-testid="toast-undo"
                onClick={() => handleUndo(item)}
                className="flex-shrink-0 px-3 py-1.5 rounded-control bg-accent text-on-accent text-xs font-bold active:scale-press-sm"
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

            {/* §5.3：底边剩余时间线。撤销条尤其需要它 ——
                「还剩多久」此前完全不可见，用户只能赌它还没过期。 */}
            <span
              aria-hidden
              data-testid="toast-countdown"
              className="toast-countdown"
              style={{ animationDuration: `${item.durationMs}ms` }}
            />
          </div>
        ))}
      </div>
    </UiOverlayContext.Provider>
  );
};
