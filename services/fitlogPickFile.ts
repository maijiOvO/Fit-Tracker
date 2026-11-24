/**
 * 「让用户选一个文件」的唯一入口，和 fitlogSaveFile（把文件交给用户）成对。
 *
 * 结果只认 input 自己的两个事件：change 给出文件，cancel 给出 null（Chromium 113 起有 cancel，
 * 本项目 minWebViewVersion 是 115）。原来靠「window 拿回焦点后 400ms 内没等到 change 就算取消」去猜：
 * 慢机器上 change 晚到一拍，选中的文件就被当成取消丢了（上架审查 C63）。
 *
 * 万一 cancel 没派发，这一次就一直没有结论：下一次 pickFile 开始前先把它按取消收掉、移除它的 input，
 * 所以再点一次入口照样能弹出选择器（DataSafetyHost 给弹窗带自增 key，同一个流程再点也会重新挂载）。
 */

let pending: ((f: File | null) => void) | null = null;

export function pickFile(accept: string): Promise<File | null> {
  pending?.(null);
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    const finish = (f: File | null): void => {
      if (pending !== finish) return;
      pending = null;
      input.remove();
      resolve(f);
    };
    pending = finish;
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}
