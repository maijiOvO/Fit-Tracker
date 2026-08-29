
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { pushFitlogRemoteSnapshot, pullAndMergeFitlogRemote } from './services/fitlogRemoteSync';
import { fetchRemoteSnapshot } from './services/fitlogRemote';
import { getDataEnv, isEnvLocked, isDemo, dbName, statePath, storagePrefix } from './services/appEnv';
import { installFontGuard } from './src/utils/fontGuard';
import DemoBanner from './src/components/DemoBanner';

// 更新后首次冷启动可能整会话掉回系统字（optional 的语义），探测到就重载一次挽回
installFontGuard();

// 当前数据环境必须一眼可见 —— 「以为自己在开发模式」是最危险的状态
{
  const env = getDataEnv();
  const style = isDemo()
    ? 'background:#2563eb;color:#fff;padding:2px 8px;border-radius:4px;font-weight:bold'
    : env === 'dev'
      ? 'background:#f59e0b;color:#000;padding:2px 8px;border-radius:4px;font-weight:bold'
      : 'background:#dc2626;color:#fff;padding:2px 8px;border-radius:4px;font-weight:bold';
  console.log(
    `%c fitlog · ${isDemo() ? 'DEMO' : env.toUpperCase()} `,
    style,
    isDemo()
      ? `${dbName()} · localStorage 前缀 "${storagePrefix()}" · 远端已禁用，每次启动清空`
      : `${statePath()} · ${dbName()} · localStorage 前缀 "${env === 'dev' ? 'dev:' : '(无)'}"`,
    isEnvLocked() ? '· 已锁定（原生容器 / release 构建 / demo）' : '· 可在「我的 → 数据环境」切换',
  );
}

// e2e 与本机调试用：把强制 push / fetch 暴露出来，跳过防抖。
// demo 构建不挂 —— 那几个入口在演示里全是 no-op，挂上去只会误导人。
if (typeof window !== 'undefined' && !isDemo()) {
  (window as any).__fitlog = {
    env: () => ({ env: getDataEnv(), locked: isEnvLocked(), db: dbName(), path: statePath() }),
    flush: () => pushFitlogRemoteSnapshot(),
    pull: () => pullAndMergeFitlogRemote(),
    fetchRemote: () => fetchRemoteSnapshot(),
  };
}

/**
 * 演示构建的开局清场：删掉演示库、清掉 demo: 前缀的 localStorage。
 *
 * 必须在 React 挂载前跑完 —— services/db.ts 是懒开库的，
 * 此刻还没有任何连接占着它，deleteDatabase 才不会被 blocked。
 *
 * 只碰 dbName() 与 storagePrefix() 派生出的演示命名空间：
 * 真实库 FitLogDB 和 dev 库都在另外的名字下，物理上够不着。
 */
async function resetDemoState(): Promise<void> {
  try {
    const prefix = storagePrefix();
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* 隐私模式 / 配额异常：清不掉就算了，不能因此卡住启动 */
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    // 任何原因卡住都不能让访客对着白屏 —— 宁可带着上次的数据进去
    const bail = setTimeout(finish, 3000);
    try {
      const req = indexedDB.deleteDatabase(dbName());
      req.onsuccess = () => { clearTimeout(bail); finish(); };
      req.onerror = () => { clearTimeout(bail); finish(); };
      req.onblocked = () => { clearTimeout(bail); finish(); }; // 另一个标签页占着，别干等
    } catch {
      clearTimeout(bail);
      finish();
    }
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

function mount(): void {
  const root = ReactDOM.createRoot(rootElement!);
  root.render(
    <React.StrictMode>
      {isDemo() && <DemoBanner />}
      <App />
    </React.StrictMode>
  );
}

if (isDemo()) {
  void resetDemoState().then(mount);
} else {
  mount();
}
