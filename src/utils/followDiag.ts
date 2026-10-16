/**
 * 临时诊断（2026-10-15，问题 3.1「新动作改第 1 组，第 4 组偶尔不跟」）：定案后整个文件连同调用点删掉。
 *
 * 跟随规则本身是确定的，第 4 组不跟只能是它事先已经不满足条件（做完 / 跳过 / 改过 / 原值不同）。
 * 这里把「改值」「加组」「被扫成跳过」和每次跟随的逐组判定都记下来，复现后接 CDP 读：
 *   JSON.parse(localStorage.getItem('fitlog.diag.follow'))
 * 存 localStorage 是为了 App 被系统回收后还在；只留最近 300 条。
 */
const KEY = 'fitlog.diag.follow';
const MAX = 300;

export function followDiag(event: string, data: Record<string, unknown>): void {
  const entry = { t: new Date().toISOString(), event, ...data };
  console.debug('[follow]', event, data);
  try {
    const raw = localStorage.getItem(KEY);
    const list: unknown[] = raw ? JSON.parse(raw) : [];
    list.push(entry);
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* 诊断写不进去不影响训练 */
  }
}
