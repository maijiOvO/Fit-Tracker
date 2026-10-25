/**
 * 撤销日志的分步（services/undoJournal.ts）：用户动作的边界在这里认。
 *
 *   - 手指按下开新的一步。推到下一拍（setTimeout 0）再开：按下另一处时，原来那个输入框先失焦、
 *     把打完的数结算掉（重量的「打完按总差值带后面」），那一笔属于上一步，不能算进这一下点击。
 *   - 焦点换到另一个输入框：开新的一步（回车跳到下一格也是一步），同样推到下一拍。同一个框里连着打字是同一步。
 *   - 键盘输入时没有打开的步（刚撤销完、刚启动）：开一步。
 * 撤销 / 重做按钮本身挂 data-undo-ignore，不开步。
 */
import { useEffect } from 'react';
import { undoJournal } from '../../services/undoJournal';

const TARGETS = 'button,[role="button"],[role="menuitem"],[role="tab"],a,input,textarea,select,label,[data-undo-label]';

/** 这一步叫什么：按下的那个控件的字（「添加组」「+5 kg」），输入框取它的 aria-label / placeholder */
export function undoLabelOf(el: Element | null): string {
  const t = el?.closest(TARGETS) as HTMLElement | null;
  if (!t) return '';
  const raw =
    t.dataset.undoLabel ||
    t.getAttribute('aria-label') ||
    t.getAttribute('title') ||
    (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement ? t.placeholder : '') ||
    t.innerText ||
    '';
  const line = raw.split('\n').map(x => x.trim()).find(Boolean) ?? '';
  return line.length > 14 ? `${line.slice(0, 13)}…` : line;
}

const isEditable = (el: EventTarget | null): el is HTMLElement =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ||
  (el instanceof HTMLElement && el.isContentEditable);

export function useUndoGestures(): void {
  useEffect(() => {
    let focusedStepEl: Element | null = null;
    /** 按下时排好的「开新步」：最晚在抬起时开（快速点击时 click 可能抢在 setTimeout 前面） */
    let pendingBegin: { timer: number; label: string } | null = null;
    const flushBegin = () => {
      if (!pendingBegin) return;
      window.clearTimeout(pendingBegin.timer);
      const { label } = pendingBegin;
      pendingBegin = null;
      undoJournal.beginStep(label);
    };
    const schedule = (label: string) => {
      flushBegin();
      pendingBegin = { label, timer: window.setTimeout(flushBegin, 0) };
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.('[data-undo-ignore]')) return;
      schedule(undoLabelOf(target));
    };
    // 也推到下一拍：回车跳到下一格时焦点是在 keydown 里挪的，那一下的结算（React 渲染、落盘）还没落下
    const onFocusIn = (e: FocusEvent) => {
      if (!isEditable(e.target) || e.target === focusedStepEl) return;
      focusedStepEl = e.target;
      schedule(undoLabelOf(e.target));
    };
    const onFocusOut = (e: FocusEvent) => {
      if (e.target === focusedStepEl) focusedStepEl = null;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      flushBegin();
      if (!undoJournal.hasOpenStep()) undoJournal.beginStep(undoLabelOf(e.target as Element | null));
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', flushBegin, true);
    document.addEventListener('click', flushBegin, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', flushBegin, true);
      document.removeEventListener('click', flushBegin, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);
}
