/**
 * 安卓返回键（审查 B11）：先关最上面那一层（弹窗 / 弹层 / 确认框），没有了再退出编辑，再退回首页，
 * 最后才把 App 收到后台（minimizeApp，不是退出：进行中的训练原样留着）。恢复 / 导入正在写数据时不理返回键。
 *
 * 开着的层各自用 useBackClose 登记「返回键＝怎么关我」，后开的在上面；App.tsx 挂监听，按这张表一层层往下。
 * 浏览器 / e2e 里没有返回键，这张表只是没人读，不影响任何东西。
 */
import { useEffect, useRef } from 'react';

type Closer = { close: () => void };
const stack: Closer[] = [];
let blocked = 0;

/** 关最上面那一层；有可关的返回 true */
export function closeTopLayer(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

/** 正在写数据（恢复备份 / 导入）：返回键先不理，免得写到一半把页面关了 */
export function blockBack(on: boolean): void {
  blocked = Math.max(0, blocked + (on ? 1 : -1));
}

export function isBackBlocked(): boolean {
  return blocked > 0;
}

/** open 时登记一层，返回键调 onClose；关了 / 卸载时摘掉 */
export function useBackClose(open: boolean, onClose: (() => void) | undefined): void {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!open || !ref.current) return;
    const entry: Closer = { close: () => ref.current?.() };
    stack.push(entry);
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open]);
}
