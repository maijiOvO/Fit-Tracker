
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { pushFitlogRemoteSnapshot, pullAndMergeFitlogRemote } from './services/fitlogRemoteSync';
import { fetchRemoteSnapshot } from './services/fitlogRemote';

// e2e 与本机调试用：把强制 push / fetch 暴露出来，跳过防抖
if (typeof window !== 'undefined') {
  (window as any).__fitlog = {
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
