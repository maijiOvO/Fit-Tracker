/** @type {import('tailwindcss').Config} */

/**
 * 令牌颜色包装器 —— 让 `bg-accent/20` 这类带透明度的类真正生成 CSS。
 *
 * Tailwind 3 遇到纯字符串颜色（`'var(--accent)'`）时会**静默丢弃** `/透明度` 修饰符：
 * 全库 82 处 `bg-base/95` / `bg-danger/10` / `ring-accent/25` 一条 CSS 都没生成过，
 * 性质和从未安装的 `animate-in` 完全一样（顶栏底栏因此实测 0% 不透明，
 * 可读性全靠 backdrop-blur 撑着）。
 *
 * ⚠️ 裸类（`bg-accent`）上 Tailwind 传进来的 opacityValue 是字符串
 * `'var(--tw-bg-opacity)'`，只有 `bg-accent/20` 这种才是数字。
 * 必须用 Number.isFinite 判断——否则裸类会编译成 `color-mix(… NaN% …)`，
 * 把本来正常的那 100% 的类一起搞死。
 *
 * color-mix 要 Chrome 111+，低于 §7.1 定的 WebView 115 门槛。
 */
const tok = (v) => ({ opacityValue }) => {
  const a = Number(opacityValue);
  return Number.isFinite(a) && a < 1
    ? `color-mix(in srgb, var(${v}) ${+(a * 100).toFixed(4)}%, transparent)`
    : `var(${v})`;
};

export default {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './src/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 纸
        base: tok('--bg-base'),
        card: {
          DEFAULT: tok('--bg-card'),
          hover: tok('--bg-card-hover'),
        },
        inset: tok('--bg-inset'),
        divider: tok('--divider'),
        rule: tok('--rule-strong'),

        // 墨
        primary: tok('--text-primary'),
        secondary: tok('--text-secondary'),
        tertiary: tok('--text-tertiary'),

        // 朱砂
        accent: {
          DEFAULT: tok('--accent'),
          soft: tok('--accent-soft'),
          ink: tok('--accent-ink'),
        },
        // → `text-on-accent`，用来替代 72 处硬编码 text-white
        'on-accent': tok('--text-on-accent'),

        // 荧光笔黄。⚠️ 只作底色，作文字对 card 仅 2.00:1
        highlight: {
          DEFAULT: tok('--highlight'),
          soft: tok('--highlight-soft'),
        },
        // → `text-on-highlight`。荧光底深浅两主题都是亮底，压不住 text-primary
        'on-highlight': tok('--text-on-highlight'),

        // 语义（第二层 soft 底用来替代 bg-danger/10 这类透明度写法）
        success: {
          DEFAULT: tok('--success'),
          soft: tok('--success-soft'),
        },
        danger: {
          DEFAULT: tok('--danger'),
          soft: tok('--danger-soft'),
        },
        warning: {
          DEFAULT: tok('--warning'),
          soft: tok('--warning-soft'),
        },

        // 统一 black/45 与 black/50
        scrim: tok('--scrim'),

        // 图表序列色
        chart: {
          1: tok('--chart-1'),
          2: tok('--chart-2'),
          3: tok('--chart-3'),
          4: tok('--chart-4'),
          5: tok('--chart-5'),
        },
      },
      fontFamily: {
        // 中文与拉丁共用同一族——latin 也走 SC 族，混排不再是两种气质
        sans: ['"Noto Sans SC"', '"CJK Fallback"', 'system-ui', 'sans-serif'],
        // font-display 沿用旧类名（12 处在用），指向新的衬线刊头族
        display: ['"Noto Serif SC"', '"Songti SC"', 'SimSun', 'serif'],
        serif: ['"Noto Serif SC"', '"Songti SC"', 'SimSun', 'serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        seal: ['"Ma Shan Zheng"', 'cursive'],
      },
      // 只改令牌值指向，不动 className —— 存量 100 处 rounded-card/control/chip
      // 自动跟随；169 处裸 rounded-xl/2xl/lg/full 留给第二步分批清理。
      borderRadius: {
        card: 'var(--radius-card)',
        control: 'var(--radius-control)',
        chip: 'var(--radius-chip)',
        sheet: 'var(--radius-sheet)',
        stamp: 'var(--radius-stamp)',
      },
      boxShadow: {
        page: 'var(--shadow-page)',
        overlay: 'var(--shadow-overlay)',
        // 兼容别名：25 处存量 shadow-elevated 先跟随接触阴影，
        // 「阴影兼做选中态」的语义解耦留给 P2/P3。
        elevated: 'var(--shadow-elevated)',
      },
      // 六时长 / 四缓动上真类，§8 的验收口径（搜到的每个时长都是六个令牌之一）
      // 才有东西可搜。
      transitionDuration: {
        tap: 'var(--dur-tap)',
        base: 'var(--dur-base)',
        exit: 'var(--dur-exit)',
        page: 'var(--dur-page)',
        stamp: 'var(--dur-stamp)',
        reveal: 'var(--dur-reveal)',
      },
      // §4 z-index 收敛：原先 30/40/50/70/80/100/110/120/190/200 十个随手值，
      // 收敛成一条有名字的梯子。modal-2 / modal-3 是「从弹层或弹窗里再开出来的弹窗」，
      // 命名如实反映它就是一级级往上叠，不装成语义分类。
      zIndex: {
        sticky: '30',   // 页内吸顶栏
        bar: '40',      // 常驻顶栏 / 底部添加栏
        nav: '50',      // 底部 tab
        sheet: '80',    // 底部弹层
        modal: '100',
        'modal-2': '110',
        'modal-3': '120',
        toast: '190',
        confirm: '200', // 确认框永远在最上
      },
      transitionTimingFunction: {
        paper: 'var(--ease-paper)',
        stamp: 'var(--ease-stamp)',
        ink: 'var(--ease-ink)',
        leave: 'var(--ease-leave)',
      },
      // §3 字号阶梯 —— 终结「display 在 Tailwind、data 在 CSS、正文缺失」的三处断裂。
      // 下限 11px，旧的 9/10px 一律作废。
      fontSize: {
        'data-xl': ['40px', { lineHeight: '1', fontWeight: '600' }],   // PR、结束训练总结
        'data-lg': ['26px', { lineHeight: '1', fontWeight: '600' }],   // 组行重量与次数
        'data-md': ['22px', { lineHeight: '1.1', fontWeight: '600' }], // 卡片汇总、体重
        headline: ['28px', { lineHeight: '1.2', fontWeight: '700' }],  // 训练标题（Serif）
        h2: ['17px', { lineHeight: '1.35', fontWeight: '600' }],       // 动作名（Serif）
        body: ['15px', { lineHeight: '1.7', fontWeight: '400' }],
        label: ['12px', { lineHeight: '1.4', fontWeight: '500' }],
        micro: ['11px', { lineHeight: '1.4', fontWeight: '500' }],
        // 旧名保留，指向新阶梯上的等价档位（4 处 text-display-sm 在用）
        display: ['28px', { lineHeight: '1.2', fontWeight: '700' }],
        'display-sm': ['22px', { lineHeight: '1.1', fontWeight: '600' }],
      },
      keyframes: {
        'sync-pulse': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.5', transform: 'scale(0.9)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        sync: 'sync-pulse 2s infinite ease-in-out',
        'fade-in': 'fade-in 150ms ease-out',
      },
    },
  },
  plugins: [],
};
