import React, { useEffect, useState } from 'react';

/**
 * 演示模式提示。
 *
 * 只在 demo 构建里挂载（见 index.tsx），真实构建的组件树完全不受影响。
 *
 * 做成会自动消失的浮层而不是常驻横幅，是因为 App 的顶栏和底部标签栏
 * 都已占满 —— 常驻条会挤掉真实布局，让访客看到的不再是应用本来的样子。
 */
export default function DemoBanner(): React.ReactElement | null {
  const [show, setShow] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setShow(false), 8000);
    return () => clearTimeout(t);
  }, []);

  if (!show) return null;

  return (
    <div
      role="status"
      onClick={() => setShow(false)}
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        maxWidth: 'min(92vw, 420px)',
        padding: '10px 16px',
        borderRadius: 999,
        background: 'rgba(20,20,19,.92)',
        color: '#f5f5f3',
        font: '13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif',
        textAlign: 'center',
        boxShadow: '0 6px 24px rgba(0,0,0,.28)',
        backdropFilter: 'blur(8px)',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      演示模式 · 数据只留在你自己的浏览器里，刷新即清空
      <br />
      <span style={{ opacity: 0.6, fontSize: 12 }}>
        Demo — nothing is uploaded; reloading starts over
      </span>
    </div>
  );
}
