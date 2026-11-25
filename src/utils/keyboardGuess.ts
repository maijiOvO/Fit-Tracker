/**
 * 软键盘在不在（审查 A9 / navigation-overlays#4）。键盘本身只看高度：可见视口比见过的最高矮了 150px 以上。
 * 焦点只用来判断「这次变矮能不能算键盘」：宽度变了（转屏）或此刻没人在打字（分屏、拉矮窗口），
 * 就当成窗口尺寸变了，从当前高度重新记。打字时系统收起键盘、焦点还在输入框，照旧靠高度回升判收起（A9）。
 */
export interface KeyboardBaseline {
  tallest: number;
  width: number;
}

export function nextKeyboardGuess(
  prev: KeyboardBaseline,
  vv: { width: number; height: number },
  typing: boolean,
): { next: KeyboardBaseline; up: boolean } {
  const tallest = vv.width !== prev.width || !typing ? vv.height : Math.max(prev.tallest, vv.height);
  return { next: { tallest, width: vv.width }, up: tallest - vv.height > 150 };
}

/** 焦点在能打字的元素上：非只读的文本类 input / textarea，或 contentEditable */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'file', 'color', 'image'].includes(el.type);
  }
  return el instanceof HTMLElement && el.isContentEditable;
}
