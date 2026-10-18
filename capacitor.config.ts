import type { CapacitorConfig } from '@capacitor/cli';

/**
 * USB live reload —— 只在 `npm run android:live` 里打开。
 *
 * 门控不是洁癖：server.url 一旦漏进正式包，App 离开数据线就是纯白屏 ——
 * WebView 死等一个永远连不上的 localhost:3000，不报错、不回落到本地资源，
 * 从界面上完全看不出发生了什么。deploy-android.ps1 里有一道闸门复查这件事。
 *
 * 用 localhost 而不是局域网 IP：配套的 `adb reverse tcp:3000 tcp:3000`
 * 把手机的 localhost:3000 反向隧道到本机，因此
 *   - 只依赖数据线，不要求手机和电脑同一个 WiFi
 *   - 换网络、换 IP 都不用改这里
 *   - HMR 的 websocket 走同一条隧道，不用另外开端口
 */
const liveReload = process.env.CAP_LIVE_RELOAD === '1';

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
  ...(liveReload
    ? {
        server: {
          url: 'http://localhost:3000',
          /** dev server 是明文 http，不开这个 Android 直接拒连。 */
          cleartext: true,
        },
      }
    : {}),
};

export default config;
