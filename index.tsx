
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './plates.css';
import { pushFitlogRemoteSnapshot, pullAndMergeFitlogRemote } from './services/fitlogRemoteSync';
import { fetchRemoteSnapshot } from './services/fitlogRemote';
import { cancelPendingFitlogPush } from './services/fitlogSyncScheduler';
import { getDataEnv, isEnvLocked, isDemo, isSolo, isOffline, dbName, statePath, storagePrefix } from './services/appEnv';
import {
  applyBackup,
  buildBackupFile,
  finishPendingOverwrite,
  parseBackupFile,
  readRollback,
  rollbackImport,
} from './services/fitlogBackup';
import { installFontGuard } from './src/utils/fontGuard';
import DemoBanner from './src/components/DemoBanner';
import { ErrorBoundary } from './src/components/ErrorBoundary';

/**
 * index.html 的 #webview-gate 判出系统 WebView 太旧：留住那段提示，不装字体守卫（它可能 reload）、不挂 React（会把提示盖掉）。
 * 80–110 档的 WebView 能解析并跑这个模块，所以这里必须判；低于 80 的根本解析不了，靠 html 里那段。
 */
const webviewBlocked = document.documentElement.hasAttribute('data-webview-gate');

// 更新后首次冷启动可能整会话掉回系统字（optional 的语义），探测到就重载一次挽回
if (!webviewBlocked) installFontGuard();

// 当前数据环境必须一眼可见 —— 「以为自己在开发模式」是最危险的状态
{
  const env = getDataEnv();
  const style = isDemo()
    ? 'background:#2563eb;color:#fff;padding:2px 8px;border-radius:4px;font-weight:bold'
    : isSolo()
      ? 'background:#0f766e;color:#fff;padding:2px 8px;border-radius:4px;font-weight:bold'
      : env === 'dev'
        ? 'background:#f59e0b;color:#000;padding:2px 8px;border-radius:4px;font-weight:bold'
        : 'background:#dc2626;color:#fff;padding:2px 8px;border-radius:4px;font-weight:bold';
  console.log(
    `%c fitlog · ${isDemo() ? 'DEMO' : isSolo() ? 'SOLO' : env.toUpperCase()} `,
    style,
    isDemo()
      ? `${dbName()} · localStorage 前缀 "${storagePrefix()}" · 远端已禁用，每次启动清空`
      : isSolo()
        ? `${dbName()} · localStorage 前缀 "${storagePrefix()}" · 远端已禁用，数据持久保存在本机`
        : `${statePath()} · ${dbName()} · localStorage 前缀 "${env === 'dev' ? 'dev:' : '(无)'}"`,
    isEnvLocked() ? '· 已锁定（原生容器 / release 构建 / demo / solo）' : '· 可在「我的 → 数据环境」切换',
  );
}

// e2e 与本机调试用：把强制 push / fetch 暴露出来，跳过防抖。
// 断网构建（demo / solo）不挂 —— 那几个入口在断网下全是 no-op，挂上去只会误导人。
if (typeof window !== 'undefined' && !isOffline()) {
  (window as any).__fitlog = {
    env: () => ({ env: getDataEnv(), locked: isEnvLocked(), db: dbName(), path: statePath() }),
    flush: () => pushFitlogRemoteSnapshot(),
    // 作废排队中的防抖推送：e2e 往 mock 远端塞夹具前先调它 + flush，免得晚到的 PUT 把夹具盖掉
    cancelPendingPush: () => cancelPendingFitlogPush(),
    pull: () => pullAndMergeFitlogRemote(),
    fetchRemote: () => fetchRemoteSnapshot(),
    // 备份链路的探针。导出/导入/回滚都绕不开文件选择器与下载，
    // e2e 摸不到 —— 只能从这里直接调服务层做真实往返验证。
    backup: {
      build: () => buildBackupFile(),
      parse: (raw: string) => parseBackupFile(raw),
      apply: (raw: string) => applyBackup(parseBackupFile(raw)),
      rollback: () => rollbackImport(),
      peek: () => readRollback(),
    },
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
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}

/**
 * 上一次整份改写（恢复 / 导入 / 撤销 / 重置 / 同步拉取）在「库已提交、首选项还没写」之间被杀的话，先补齐再挂 React
 * （finishPendingOverwrite，上架审查 C60）：各个 context 挂载时就从存储水化，晚了读到的是新库配旧设置。
 * 3 秒兜底、出错照样挂：绝不能因为它卡住或白屏，最坏是这一次带着旧设置进去，下次启动再补。
 */
function finishPendingThenMount(): void {
  let done = false;
  const go = (): void => {
    if (done) return;
    done = true;
    mount();
  };
  const bail = setTimeout(go, 3000);
  finishPendingOverwrite()
    .catch(err => console.error('[fitlog] 收尾上次没写完的恢复失败:', err))
    .finally(() => {
      clearTimeout(bail);
      go();
    });
}

if (webviewBlocked) {
  // 什么都不做：提示已经在 #root 里
} else if (isDemo()) {
  void resetDemoState().then(mount);
} else {
  finishPendingThenMount();
}
