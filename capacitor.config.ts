import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.myron.fittracker',
  appName: 'Fit Tracker',
  webDir: 'dist',
  /**
   * 消除冷启动白闪：WebView 起来之前那一帧由原生底色顶着，
   * 取 --bg-base 的浅色值（html / body / #root 三处都画它）。
   * 规格 §7.1 写的是 #FBF8F1，那是 --bg-card；闪屏该对齐的是 base。
   */
  backgroundColor: '#EFE9DC',
  android: {
    /** 「墨与纸」全部技术里的最高门槛（scroll-driven animations 要 Chrome 115+）。 */
    minWebViewVersion: 115,
  },
};

export default config;
