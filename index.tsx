
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { pushFitlogRemoteSnapshot, pullAndMergeFitlogRemote } from './services/fitlogRemoteSync';
import { fetchRemoteSnapshot } from './services/fitlogRemote';
import { getDataEnv, isEnvLocked, dbName, statePath } from './services/appEnv';

// 当前数据环境必须一眼可见 —— 「以为自己在开发模式」是最危险的状态
{
  const env = getDataEnv();
  const style = env === 'dev'
    ? 'background:#f59e0b;color:#000;padding:2px 8px;border-radius:4px;font-weight:bold'
    : 'background:#dc2626;color:#fff;padding:2px 8px;border-radius:4px;font-weight:bold';
  console.log(
    `%c fitlog · ${env.toUpperCase()} `,
    style,
    `${statePath()} · ${dbName()} · localStorage 前缀 "${env === 'dev' ? 'dev:' : '(无)'}"`,
    isEnvLocked() ? '· 已锁定（原生容器 / release 构建）' : '· 可在「我的 → 数据环境」切换',
  );
}

// e2e 与本机调试用：把强制 push / fetch 暴露出来，跳过防抖
if (typeof window !== 'undefined') {
  (window as any).__fitlog = {
    env: () => ({ env: getDataEnv(), locked: isEnvLocked(), db: dbName(), path: statePath() }),
    flush: () => pushFitlogRemoteSnapshot(),
    pull: () => pullAndMergeFitlogRemote(),
    fetchRemote: () => fetchRemoteSnapshot(),
  };
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
