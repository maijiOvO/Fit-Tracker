/**
 * 数据环境（dev / prod）的唯一判定源。
 *
 * 设计原则 —— **失效方向必须安全**：
 *   误判成 prod = 开发机把测试数据写进真实用户数据 → 不可逆、灾难性
 *   误判成 dev  = 手机读写 state-dev → 真实数据原封不动，只是暂时看不到 → 可恢复
 * 因此所有"拿不准"的情况一律落到 dev。
 *
 * 判定顺序（前面的优先级高，且不可被后面覆盖）：
 *   1. 运行在 Capacitor 原生容器里（= 手机 APK）→ 强制 prod，开关不可见
 *   2. 构建时烙印 VITE_FITLOG_ENV=prod → 强制 prod，开关不可见
 *   3. 其余（dev server / vite preview / 任意浏览器）→ 可切换，默认 dev
 *
 * 1 和 2 互为保险：APK 忘了烙印由 1 兜底，Capacitor 注入失败由 2 兜底。
 */

export type DataEnv = 'dev' | 'prod';

/**
 * 演示构建（VITE_FITLOG_DEMO=true，仅由 `npm run build:demo` 经 .env.demo 注入）。
 *
 * 与 dev/prod **正交**：它不是第三种数据环境，而是"断网 + 一次性"的开关。
 * 不做成 DataEnv 的第三个取值，是为了让上面那条失效方向约定原样成立 ——
 * 演示模式仍然落在 dev 一侧，只是额外禁掉了全部远端调用。
 */
export function isDemo(): boolean {
  return import.meta.env.VITE_FITLOG_DEMO === 'true';
}

/**
 * 单机发行版（VITE_FITLOG_SOLO=true，仅由 `npm run build:solo` 经 .env.solo 注入）。
 *
 * 与 demo 的区别只有一条，但这条是全部意义所在：
 *   demo = 断网 + **每次启动清空**（展示用，访客数据是一次性的）
 *   solo = 断网 + **持久保存**（发行版，用户的训练记录只有本地这一份）
 * 这两个语义原先绑死在 isDemo() 里，拆开是整个发布改造的起点。
 */
export function isSolo(): boolean {
  return import.meta.env.VITE_FITLOG_SOLO === 'true';
}

/**
 * 断网构建 = demo ∪ solo。
 *
 * **所有远端守卫该查的是这个谓词，不是 isDemo()。**
 * 新增任何 fetch 路径时也查它 —— 查错了的后果是单机版偷偷联网，
 * 而这件事从界面上完全看不出来（同步是静默的）。
 */
export function isOffline(): boolean {
  return isDemo() || isSolo();
}

/** 开关本身永远存在**未加前缀**的 localStorage 里，否则会鸡生蛋 */
const DEV_MODE_LS_KEY = 'fitlog_dev_mode';

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Capacitor 原生容器检测：@capacitor/core 会在 WebView 里注入 window.Capacitor */
function isNativeApp(): boolean {
  try {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; isNative?: boolean } })
      .Capacitor;
    if (!cap) return false;
    if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform() === true;
    return cap.isNative === true;
  } catch {
    return false;
  }
}

/** 构建时烙印为 prod 的产物（npm run build:release） */
function isStampedProd(): boolean {
  return import.meta.env.VITE_FITLOG_ENV === 'prod';
}

/**
 * 环境是否被锁死（不可通过 UI 切换）。
 * 手机 APK 与正式发布构建都锁死在 prod。
 */
export function isEnvLocked(): boolean {
  return isNativeApp() || isStampedProd() || isOffline();
}

/**
 * 缓存当前环境。
 * 缓存不只是为了性能 —— 它保证一次会话内所有 storage / DB / 网络调用
 * 看到的是**同一个**环境值，不会因为 localStorage 被外部改动而在半路切换。
 * 只有 setDataEnv() 能让它失效。
 */
let cached: DataEnv | null = null;

export function getDataEnv(): DataEnv {
  if (cached) return cached;

  // 必须排在 isEnvLocked() 之前：demo 也算"锁定"，但落点是 dev 而非 prod。
  // 演示构建本就一个请求都不发，这条只是万一有路径漏网时的失效方向兜底。
  if (isDemo()) {
    cached = 'dev';
    return cached;
  }

  // 单机版没有任何端点，dev/prod 这条轴对它本就无意义。
  // 仍标成 prod：它装的是用户的真实数据，不是玩具数据。
  // 命名空间不跟自用版共用，另由 dbName() / storagePrefix() 单独给 —— 理由见那里。
  if (isSolo()) {
    cached = 'prod';
    return cached;
  }

  if (isEnvLocked()) {
    cached = 'prod';
    return cached;
  }

  const stored = readRaw(DEV_MODE_LS_KEY);
  if (stored !== null) {
    cached = stored === 'true' ? 'dev' : 'prod';
    return cached;
  }

  // 无显式选择 → 默认 dev（失效方向安全）。只有显式写 false 才是 prod。
  cached = import.meta.env.VITE_FITLOG_DEV_MODE === 'false' ? 'prod' : 'dev';
  return cached;
}

export function isDevMode(): boolean {
  return getDataEnv() === 'dev';
}

/**
 * 切换环境。调用方负责在切换后重开 IndexedDB 并重新加载数据。
 * @throws 环境被锁死时抛错 —— 手机上不应该有任何代码路径走到这里
 */
export function setDataEnv(env: DataEnv): void {
  if (isEnvLocked()) {
    throw new Error('[fitlog] 当前构建环境已锁定，禁止切换数据环境');
  }
  try {
    localStorage.setItem(DEV_MODE_LS_KEY, String(env === 'dev'));
  } catch {
    /* 隐私模式等场景下写入失败，忽略；cached 仍然生效 */
  }
  cached = env;
}

/** 兼容旧调用点 */
export function setDevMode(on: boolean): void {
  setDataEnv(on ? 'dev' : 'prod');
}

// ============ 各子系统的命名空间派生 ============

/** localStorage key 前缀：prod 无前缀，保证既有真实数据零迁移 */
export function storagePrefix(): string {
  if (isDemo()) return 'demo:';
  if (isSolo()) return 'solo:';
  return getDataEnv() === 'dev' ? 'dev:' : '';
}

/** IndexedDB 库名：dev 用完全独立的库，物理隔离 */
/**
 * IndexedDB 库名：dev 用完全独立的库，物理隔离。
 *
 * 单机版单独一个库名，理由不是隔离用户数据（发行版用户只会装一个构建），
 * 而是**让自己能诚实地测发行版**：两个变体共用 applicationId，
 * 把发行版装到本机手机上会继承同一个数据目录 —— 若共用库名，
 * 它一打开就满屏你自己的训练记录、一切正常，而新用户看到的根本不是这个。
 * 分开之后：发行版开局是空的（= 真实新用户），你的 FitLogDB 原封不动。
 */
export function dbName(): string {
  if (isDemo()) return 'FitLogDB-demo';
  if (isSolo()) return 'FitLogDB-solo';
  return getDataEnv() === 'dev' ? 'FitLogDB-dev' : 'FitLogDB';
}

/** 服务端状态端点 */
export function statePath(): string {
  return getDataEnv() === 'dev' ? '/api/fitlog/state-dev' : '/api/fitlog/state';
}

/** 人类可读标签，用于日志与 UI */
export function envLabel(): string {
  if (isDemo()) return 'demo';
  if (isSolo()) return 'solo';
  return getDataEnv() === 'dev' ? 'dev' : 'prod';
}
