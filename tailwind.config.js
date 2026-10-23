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
      // `text-accent` 走压深一档的 --accent-text：浅色的青 / 玫红填充色直接当字在白底上不过 4.5:1。
      // 整组覆盖，所以 soft / ink 要一起写上。
      textColor: {
        accent: {
          DEFAULT: tok('--accent-text'),
          soft: tok('--accent-soft'),
          ink: tok('--accent-ink'),
        },
      },
      colors: {
        // 纸
        base: tok('--bg-base'),
        card: {
          DEFAULT: tok('--bg-card'),
          hover: tok('--bg-card-hover'),
        },
        inset: tok('--bg-inset'),
        btn: tok('--bg-btn'), // 次要按钮底：浅色比 card 深、深色比 card 亮（见 index.css）
        divider: tok('--divider'),
        rule: tok('--rule-strong'),

        // 墨
        primary: tok('--text-primary'),
        secondary: tok('--text-secondary'),
        tertiary: tok('--text-tertiary'),

        // 强调色（青 / 玫红，见 index.css）
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

        // 语义（第二层 soft 底用来替代 bg-danger/10 这类透明度写法）
        success: {
          DEFAULT: tok('--success'),
          soft: tok('--success-soft'),
        },
        danger: {
          DEFAULT: tok('--danger'),
          soft: tok('--danger-soft'),
        },
        warning: tok('--warning'),

        // 统一 black/45 与 black/50
        scrim: tok('--scrim'),

        // 镁粉（纪录）
        chalk: tok('--chalk'),
        'on-chalk': tok('--text-on-chalk'),
      },
      fontFamily: {
        // 「杠铃片」§2：正文 Noto Sans SC；标题得意黑（只用于 ≥20px）；数字 Barlow Condensed
        sans: ['"Noto Sans SC"', '"CJK Fallback"', 'system-ui', 'sans-serif'],
        // font-display 沿用旧类名（23 处在用），宋体退役后指向正文族，靠字重出层级
        display: ['"Noto Sans SC"', '"CJK Fallback"', 'system-ui', 'sans-serif'],
        // font-mono 沿用旧类名（40 处在用），指向窄体数字族。比例字体 + tabular-nums，不再用等宽
        mono: ['"Barlow Condensed"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
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
        overlay: 'var(--shadow-overlay)',
        // 兼容别名：25 处存量 shadow-elevated 先跟随接触阴影，
        // 「阴影兼做选中态」的语义解耦留给 P2/P3。
        elevated: 'var(--shadow-elevated)',
      },
      // 时长 / 缓动只给 className 里真在用的几档开类；其余令牌（--dur-exit、--ease-ink 等）
      // 由 index.css 直接 var() 读。§8 的验收口径不变：搜到的每个时长都是令牌之一。
      // 显式属性列表，取代 transition-all（§5.1）。
      // transition-all 会连带过渡 clip-path 与 grid-template-rows，
      // 和揭示动画直接打架，必须清干净。
      transitionProperty: {
        ui: 'color, background-color, border-color, fill, stroke, opacity, transform, box-shadow',
      },
      // 按压只有两档（§5.1）：大面 0.985，≤44px 的图标按钮 0.94。
      // 收敛掉原先 .90/.95/.97/.98/.99 五种随手值。
      scale: {
        press: 'var(--press)',
        'press-sm': 'var(--press-sm)',
      },
      transitionDuration: {
        // 默认值也走令牌：这样连没写 duration 的 transition-* 也落在令牌上，
        // 不用为此扫一遍 className（§8 验收口径）。
        DEFAULT: 'var(--dur-tap)',
        tap: 'var(--dur-tap)',
        base: 'var(--dur-base)',
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
        DEFAULT: 'var(--ease-paper)',
        paper: 'var(--ease-paper)',
      },
    },
    // §3 字号阶梯：九档，值在 index.css 的 --fs-*（CSS 里的 font-size 也读那里）。
    // 写在 theme 而不是 extend：整组替换 Tailwind 默认字号，阶梯外的 text-5xl 之类根本不生成。
    // 手写 text-[Npx] 一律不用（npm run check 会拦）。
    fontSize: {
      'data-xl': ['var(--fs-data-xl)', { lineHeight: '1', fontWeight: '600' }],   // PR、结束训练总结
      'data-lg': ['var(--fs-data-lg)', { lineHeight: '1', fontWeight: '600' }],   // 组行重量与次数
      'data-md': ['var(--fs-data-md)', { lineHeight: '1.1', fontWeight: '600' }], // 卡片汇总、体重
      headline: ['var(--fs-headline)', { lineHeight: '1.2', fontWeight: '700' }],  // 训练标题
      h2: ['var(--fs-h2)', { lineHeight: '1.35', fontWeight: '600' }],             // 动作名
      body: ['var(--fs-body)', { lineHeight: '1.7', fontWeight: '400' }],
      small: ['var(--fs-small)', { lineHeight: '20px' }],
      label: ['var(--fs-label)', { lineHeight: '1.4', fontWeight: '500' }],
      micro: ['var(--fs-micro)', { lineHeight: '1.4', fontWeight: '500' }],
      'display-sm': ['var(--fs-data-md)', { lineHeight: '1.1', fontWeight: '600' }],
      // Tailwind 的旧名（两百多处在用）只保留名字，值落到阶梯上；不带字重，和原来一样。
      xs: ['var(--fs-label)', { lineHeight: '16px' }],      // 12
      sm: ['var(--fs-small)', { lineHeight: '20px' }],      // 14
      base: ['var(--fs-body)', { lineHeight: '22px' }],     // 16 → 15
      lg: ['var(--fs-h2)', { lineHeight: '24px' }],         // 18 → 17
      xl: ['var(--fs-data-md)', { lineHeight: '28px' }],    // 20 → 22
      '2xl': ['var(--fs-data-lg)', { lineHeight: '32px' }], // 24 → 26
      '3xl': ['var(--fs-headline)', { lineHeight: '32px' }],// 30 → 28
      '4xl': ['var(--fs-data-xl)', { lineHeight: '44px' }], // 36 → 40
    },
  },
  plugins: [],
};
