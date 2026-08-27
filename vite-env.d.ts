/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** 生产端点（/api/fitlog/state）的凭据 */
  readonly VITE_API_KEY?: string;
  /** 开发端点（/api/fitlog/state-dev）的凭据；未设置时回落到 VITE_API_KEY */
  readonly VITE_API_KEY_DEV?: string;
  /**
   * 构建时数据环境烙印。只有 'prod' 有意义：把产物锁死在生产数据上。
   * 未设置 = 可切换、默认 dev（失效方向安全，见 services/appEnv.ts）。
   * 由 `npm run build:release` 通过 .env.release 注入。
   */
  readonly VITE_FITLOG_ENV?: 'dev' | 'prod';
  /** 浏览器未做过显式选择时的默认环境；只有显式 'false' 才默认 prod */
  readonly VITE_FITLOG_DEV_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
