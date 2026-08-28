/**
 * 统一弹窗原语 —— 规格 §6.6
 *
 * 迁移前：15 个弹窗只有 1 个复用共享 Modal，其余 14 个各自手搓，
 * 底色、模糊、内边距、标题字号（三档）、圆角（12/24/48px）、
 * 确认按钮阴影（四种写法）全不一致。
 *
 * 两个 variant：
 *   center —— 入场是 paper-drop（一张纸轻轻落下并摆正）；
 *             退场只用 opacity，不反向播 clip（那看起来像倒带）。
 *   sheet  —— 底部弹层，从下缘推上来。手势骨架沿用 ExercisePickerSheet 已跑通的那套。
 *   full   —— 整屏（动作库）。不透明底、无遮罩，内容区自己滚。
 *
 * 遮罩统一用 --scrim（墨色 45%），取代原先 bg-base/80 与 bg-black/45、/50 三种写法。
 * 遮罩上的模糊留着（背景静止，只付一次成本），但**模糊层与淡入层分离**——
 * 否则淡入期间每帧都在重新模糊。
 *
 * ⚠️ 必须 portal 到 body。
 * z-index 只在同一个层叠上下文里比较，而页面里到处是会建层叠上下文的东西
 * （opacity 动画、transform、backdrop-filter）。就地渲染时，
 * PlanTab 根节点的 animate-fade-in 把 z-100 的弹窗关进了局部上下文，
 * 底部导航（z-50，但在全局层）直接盖在保存按钮上——e2e 点不到，实测过。
 * portal 之后弹窗与导航在同一层比较，100 > 50 才真的成立。
 */
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDismissAnimation } from '../hooks/useDismissAnimation';

export type ModalVariant = 'center' | 'sheet' | 'full';
/** z 轴层级。语义常量见 tailwind.config.js 的 zIndex。 */
export type ModalLayer = 'modal' | 'modal-2' | 'modal-3' | 'confirm';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  /** 底部操作区。用 <ModalFooter> 包一层以获得统一的取消/确认比例。 */
  footer?: React.ReactNode;
  variant?: ModalVariant;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  layer?: ModalLayer;
  showCloseButton?: boolean;
  /** 点遮罩是否关闭。表单类弹窗填到一半被误关很恼人，可关掉。 */
  dismissOnScrim?: boolean;
  className?: string;
  /** 面板内容区的额外类（例如需要自己控制滚动时） */
  bodyClassName?: string;
  /** 落在遮罩根节点上，供 e2e 定位 */
  testId?: string;
}

const sizeStyles = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-2xl',
};

const layerClass: Record<ModalLayer, string> = {
  modal: 'z-modal',
  'modal-2': 'z-modal-2',
  'modal-3': 'z-modal-3',
  // 确认框永远在最上：它可能是任何一层弹窗弹出来的
  confirm: 'z-confirm',
};

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  variant = 'center',
  size = 'md',
  layer = 'modal',
  showCloseButton = true,
  dismissOnScrim = true,
  className = '',
  bodyClassName = '',
  testId,
}) => {
  const { mounted, leaving } = useDismissAnimation(isOpen);

  // Esc 关闭。移动端用不上，但桌面调试时省事，且是无障碍基本盘。
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!mounted) return null;

  const isSheet = variant === 'sheet';
  const isFull = variant === 'full';

  const panelShell = isFull
    ? 'relative w-full h-full bg-base flex flex-col'
    : `relative w-full ${sizeStyles[size]} bg-card border border-divider shadow-overlay ${
        isSheet ? 'rounded-t-sheet border-b-0' : 'rounded-card'
      }`;
  const panelAnim = leaving
    ? isFull
      ? 'anim-scrim-out'
      : 'anim-panel-out'
    : isFull
      ? 'anim-fade'
      : isSheet
        ? 'anim-sheet-in'
        : 'anim-paper-drop';

  return createPortal(
    <div
      className={`fixed inset-0 ${layerClass[layer]} flex justify-center ${
        isSheet ? 'items-end' : isFull ? '' : 'items-center p-6'
      }`}
      onClick={dismissOnScrim && !isFull ? onClose : undefined}
      role="presentation"
      data-testid={testId}
    >
      {/* 整屏变体自己就是不透明底，不需要遮罩，也就不必为它付模糊的代价 */}
      {!isFull && (
        <>
          {/* 模糊层独立：与淡入层分开，避免淡入期间每帧重新模糊（§7.1） */}
          <div className="absolute inset-0 backdrop-blur-md" aria-hidden />
          <div
            className={`absolute inset-0 bg-scrim ${leaving ? 'anim-scrim-out' : 'anim-fade'}`}
            aria-hidden
          />
        </>
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`${panelShell} ${panelAnim} ${className}`}
        onClick={e => e.stopPropagation()}
        style={isSheet ? { paddingBottom: 'env(safe-area-inset-bottom)' } : undefined}
      >
        {isSheet && (
          <div className="pt-2.5 pb-1 flex justify-center" aria-hidden>
            <span className="w-9 h-1 rounded-chip bg-divider" />
          </div>
        )}

        {(title || showCloseButton) && (
          <div
            className={`flex justify-between gap-3 px-5 ${
              isSheet
                ? 'items-start pt-1'
                : isFull
                  ? 'items-center py-3 border-b border-divider flex-shrink-0'
                  : 'items-start pt-5'
            }`}
          >
            <div className="min-w-0">
              {title && (
                <h2 className="font-display text-h2 text-primary leading-snug break-words">{title}</h2>
              )}
              {subtitle && <p className="text-label text-secondary mt-1">{subtitle}</p>}
            </div>
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="-mr-2 -mt-1 w-11 h-11 flex-shrink-0 flex items-center justify-center text-tertiary"
                aria-label="关闭"
              >
                <X size={20} strokeWidth={1.75} />
              </button>
            )}
          </div>
        )}

        <div
          className={
            isFull
              ? `flex-1 overflow-y-auto custom-scrollbar px-4 pt-4 pb-10 ${bodyClassName}`
              : `px-5 ${title || showCloseButton ? 'pt-4' : 'pt-5'} ${footer ? '' : 'pb-5'} ${bodyClassName}`
          }
        >
          {children}
        </div>

        {footer && <div className="px-5 pt-4 pb-5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

/**
 * 统一的底部操作区 —— §6.6
 *
 * 取消 flex:1 描边 / 确认 flex:2 实心，min-height 52px。
 * 全部彩色阴影已删（本方向确认按钮不发光）。
 *
 * ⚠️ 危险操作不靠颜色区分（朱砂既是品牌色又是危险色，这是本方向最大的结构性风险）：
 * danger 只以「全宽实心 + 明确文案」出现，且仅存在于确认弹窗内。
 */
export const ModalFooter: React.FC<{
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  /** 真·危险确认。仅用于「删号/清空」这类不可逆动作。 */
  danger?: boolean;
  confirmIcon?: React.ReactNode;
}> = ({ cancelLabel, confirmLabel, onCancel, onConfirm, confirmDisabled, danger, confirmIcon }) => (
  <div className="flex gap-3">
    <button
      type="button"
      onClick={onCancel}
      className="flex-1 min-h-[52px] rounded-control border border-divider text-secondary font-medium transition-colors duration-tap ease-paper active:bg-card-hover"
    >
      {cancelLabel}
    </button>
    <button
      type="button"
      onClick={onConfirm}
      disabled={confirmDisabled}
      className={`flex-[2] min-h-[52px] rounded-control font-semibold flex items-center justify-center gap-2 transition-opacity duration-tap ease-paper disabled:opacity-40 ${
        danger ? 'bg-danger text-on-accent' : 'bg-accent text-on-accent'
      }`}
    >
      {confirmIcon}
      {confirmLabel}
    </button>
  </div>
);

export default Modal;
