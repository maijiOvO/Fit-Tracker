/**
 * 本机数据读写的健康状态（上架审查 C12 / C13 / C14）：读失败、写失败、本机数据不见了。
 * 状态在 services 的模块里（db.ts / localCensus.ts），这里订阅它们翻转时派发的事件；
 * 订阅时先按 getter 读一遍当前值 —— 首页是懒加载的，会错过挂载之前派发的事件。
 */
import { useSyncExternalStore } from 'react';
import { dbReadFailing, dbWriteFailing } from '../../services/db';
import { LOCAL_LOSS_EVENT, readLocalLoss, type LocalLoss } from '../../services/localCensus';

export interface LocalDataHealth {
  readFailing: boolean;
  writeFailing: boolean;
  loss: LocalLoss | null;
}

const EVENTS = ['fitlog:db-read-failed', 'fitlog:db-read-ok', 'fitlog:db-write-failed', 'fitlog:db-write-ok', LOCAL_LOSS_EVENT];

const compute = (): LocalDataHealth => ({ readFailing: dbReadFailing(), writeFailing: dbWriteFailing(), loss: readLocalLoss() });
const same = (a: LocalDataHealth, b: LocalDataHealth) =>
  a.readFailing === b.readFailing && a.writeFailing === b.writeFailing && JSON.stringify(a.loss) === JSON.stringify(b.loss);

let snap = compute();
const refresh = () => {
  const next = compute();
  if (!same(next, snap)) snap = next;
};

function subscribe(cb: () => void): () => void {
  refresh();
  const on = () => {
    refresh();
    cb();
  };
  for (const e of EVENTS) window.addEventListener(e, on);
  return () => {
    for (const e of EVENTS) window.removeEventListener(e, on);
  };
}

export function useLocalDataHealth(): LocalDataHealth {
  return useSyncExternalStore(subscribe, () => snap);
}
