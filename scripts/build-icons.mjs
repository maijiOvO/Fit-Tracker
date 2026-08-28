/**
 * 从单张 1024 源图生成全套图标 / 启动屏。
 *
 *   node scripts/build-icons.mjs        （或 npm run icons）
 *
 * 源图是「朱砂方印」：满幅朱砂底 + 纸色印面（方框 + 三行，中间那行是杠铃）。
 *
 * 为什么要拆层而不是直接缩放：
 *
 * 1. 源图是 JPEG，只有 RGB 没有 alpha，而 Android 自适应图标的前景层必须透明。
 *    这里按「红→纸」的色轴把每个像素投影成一个 t，t 即前景 alpha ——
 *    顺带把 JPEG 在硬边上的振铃压成平滑的 alpha 过渡，比阈值抠图干净得多。
 *
 * 2. 源图的红实测是 #A73825，不是令牌里的朱砂 #B23A28（--accent / manifest.theme_color）。
 *    图标和 App 用两个红，冷启动时启动屏与图标挨在一起看得出来。
 *    背景层按通道增益归一到 #B23A28，纸纤维的明暗起伏按比例保留。
 *
 * 3. 方框外沿占画布 64.6%，四角距中心 467px；而自适应图标的圆形遮罩半径只有
 *    1024×(72/108)/2 = 341px —— 直接用原图，圆形启动器会把方框四角切断，
 *    方框会碎成四段。所以前景层要缩到 FG_SCALE_ADAPTIVE 再放进去。
 *    未被遮罩的 legacy 图标与 PWA 图标不受此限，仍用满幅版。
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const SRC = 'assets/icon-source.jpg';
const S = 1024;

/** 源图实测锚点（scripts 注释里的数字由本文件的 --measure 打印）。 */
const RED_SRC = [167, 56, 37];
const CREAM_SRC = [247, 245, 233];

/** 令牌目标色。 */
const RED = [178, 58, 40]; // --accent      #B23A28
const CREAM = [251, 248, 241]; // 纸          #FBF8F1
const PAPER = [239, 233, 220]; // --bg-base   #EFE9DC

/**
 * 前景缩放。0.70 → 方框四角落到距中心 329px，在 341px 的圆形遮罩内还剩 12px 余量，
 * 也贴近 Google 建议的 66dp 关键内容圈（313px）。要更满就往 0.73 调，那是圆形遮罩的硬上限。
 */
const FG_SCALE_ADAPTIVE = 0.70;
/** PWA maskable 的安全圈是 80% 直径（半径 410px），四角 467px → 上限 0.877。 */
const FG_SCALE_MASKABLE = 0.86;

const write = async (path, buf) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  console.log('  ' + path);
};

// ── 1. 拆层 ────────────────────────────────────────────────────────────────
const { data } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
const N = S * S;
const bgRaw = Buffer.alloc(N * 3);
const fgRaw = Buffer.alloc(N * 4);

const axis = [0, 1, 2].map((c) => CREAM_SRC[c] - RED_SRC[c]);
const axisLen2 = axis.reduce((s, v) => s + v * v, 0);
const gain = [0, 1, 2].map((c) => RED[c] / RED_SRC[c]);
/** smoothstep，把 0.30..0.70 这段投影值拉成完整的 0..1，边缘之外全部吸到纯 0 / 纯 1。 */
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

const tMap = Buffer.alloc(N);
for (let i = 0; i < N; i++) {
  const p = [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
  const proj = [0, 1, 2].reduce((s, c) => s + (p[c] - RED_SRC[c]) * axis[c], 0) / axisLen2;
  const t = smooth((proj - 0.3) / 0.4);

  fgRaw[i * 4] = CREAM[0];
  fgRaw[i * 4 + 1] = CREAM[1];
  fgRaw[i * 4 + 2] = CREAM[2];
  fgRaw[i * 4 + 3] = Math.round(t * 255);
  tMap[i] = Math.round(t * 255);
}

/**
 * 背景层不能简单地「把纸色处填平色」：JPEG 在硬边上有一圈过渡像素，
 * 被通道增益放大后是浅粉色，会在背景里留下一道印面的亮边鬼影 ——
 * 满幅版被前景盖住看不见，但自适应图标的前景缩到 70% 之后，
 * 鬼影就和前景错位露出来了。
 *
 * 改成：只在「离印面足够远」的地方保留纸纤维起伏，其余一律纯朱砂。
 * 模糊 t 当作把印面向外膨胀一圈，据此硬切 —— 不做羽化过渡：
 * 羽化会让污染像素以渐变权重渗出去，糊成一圈更宽的光晕（实测比不修还难看）。
 * 纸纤维是零均值噪声，硬切不产生亮度台阶，切口本身看不出来。
 * 残差再钳到 ±14，任何漏网的亮像素都不可能攒成光晕。
 */
const tBlur = await sharp(tMap, { raw: { width: S, height: S, channels: 1 } })
  .blur(4)
  .raw()
  .toBuffer();

const CLAMP = 14;
for (let i = 0; i < N; i++) {
  const near = tBlur[i] > 2 || tMap[i] > 2;
  for (let c = 0; c < 3; c++) {
    const textured = Math.min(255, data[i * 3 + c] * gain[c]);
    const residual = near ? 0 : Math.max(-CLAMP, Math.min(CLAMP, textured - RED[c]));
    bgRaw[i * 3 + c] = RED[c] + residual;
  }
}

const bgPng = await sharp(bgRaw, { raw: { width: S, height: S, channels: 3 } }).png().toBuffer();
const fgPng = await sharp(fgRaw, { raw: { width: S, height: S, channels: 4 } }).png().toBuffer();

/** 前景按比例缩小后重新居中到 S×S 透明画布。 */
const fgScaled = async (scale) => {
  const w = Math.round(S * scale);
  const inner = await sharp(fgPng).resize(w, w).png().toBuffer();
  const pad = Math.round((S - w) / 2);
  return sharp(inner)
    .extend({ top: pad, bottom: S - w - pad, left: pad, right: S - w - pad,
              background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
};

const compose = async (fg) =>
  sharp(bgPng).composite([{ input: fg }]).png().toBuffer();

const FULL = await compose(fgPng);
const FG_ADAPTIVE = await fgScaled(FG_SCALE_ADAPTIVE);
const MASKABLE = await compose(await fgScaled(FG_SCALE_MASKABLE));

const resize = (buf, px) => sharp(buf).resize(px, px).png().toBuffer();

/** 圆形裁切 —— legacy 的 ic_launcher_round 用。 */
const circle = async (buf, px) => {
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}">` +
      `<circle cx="${px / 2}" cy="${px / 2}" r="${px / 2}" fill="#fff"/></svg>`
  );
  return sharp(await resize(buf, px))
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
};

// ── 2. 源图与 PWA ──────────────────────────────────────────────────────────
console.log('\n源图与 PWA:');
await write('assets/icon.png', FULL);
await write('android/icon.png', FULL);
for (const px of [96, 192, 512]) await write(`public/icons/icon-${px}.png`, await resize(FULL, px));
await write('public/icons/icon-512-maskable.png', await resize(MASKABLE, 512));

// ── 3. Android mipmap ─────────────────────────────────────────────────────
/** [目录, legacy 边长, 自适应层边长(=108dp)] */
const DENSITIES = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];
console.log('\nAndroid mipmap:');
for (const [d, legacy, adaptive] of DENSITIES) {
  const dir = `android/app/src/main/res/mipmap-${d}`;
  await write(`${dir}/ic_launcher.png`, await resize(FULL, legacy));
  await write(`${dir}/ic_launcher_round.png`, await circle(FULL, legacy));
  await write(`${dir}/ic_launcher_foreground.png`, await resize(FG_ADAPTIVE, adaptive));
  await write(`${dir}/ic_launcher_background.png`, await resize(bgPng, adaptive));
}

// ── 4. 启动屏 ─────────────────────────────────────────────────────────────
/**
 * 纸底 + 居中一枚朱砂方印。底色对齐 capacitor.config.ts 的 backgroundColor
 * 与 manifest.background_color，冷启动时原生底 → 启动屏 → WebView 三段同色，不闪。
 * 印章圆角取短边的 1.7%，约等于 App 里 --radius-stamp 在这个尺寸下的比例。
 */
const SPLASHES = [
  ['drawable', 480, 320],
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280],
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
];
console.log('\n启动屏:');
for (const [dir, w, h] of SPLASHES) {
  const stamp = Math.round(Math.min(w, h) * 0.34);
  const r = Math.max(2, Math.round(stamp * 0.058));
  const rounded = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${stamp}" height="${stamp}">` +
      `<rect width="${stamp}" height="${stamp}" rx="${r}" ry="${r}" fill="#fff"/></svg>`
  );
  const mark = await sharp(await resize(FULL, stamp))
    .composite([{ input: rounded, blend: 'dest-in' }])
    .png()
    .toBuffer();
  const png = await sharp({
    create: { width: w, height: h, channels: 3,
              background: { r: PAPER[0], g: PAPER[1], b: PAPER[2] } },
  })
    .composite([{ input: mark, left: Math.round((w - stamp) / 2), top: Math.round((h - stamp) / 2) }])
    .png()
    .toBuffer();
  await write(`android/app/src/main/res/${dir}/splash.png`, png);
}

// ── 5. 跟着图标走的配置 ────────────────────────────────────────────────────
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
console.log('\n配置:');

await write(
  'android/app/src/main/res/values/ic_launcher_background.xml',
  Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n` +
      `    <color name="ic_launcher_background">${hex(RED)}</color>\n</resources>\n`
  )
);

// 背景改用 mipmap 而不是纯色：纸纤维在 192px 的 legacy 图标上还看得见，
// 自适应图标不该比 legacy 更平。
await write(
  'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
  Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n` +
      `    <background android:drawable="@mipmap/ic_launcher_background"/>\n` +
      `    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n` +
      `</adaptive-icon>\n`
  )
);
await write(
  'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml',
  Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n` +
      `    <background android:drawable="@mipmap/ic_launcher_background"/>\n` +
      `    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n` +
      `</adaptive-icon>\n`
  )
);

// maskable 单独出一张：满幅版四角超出 80% 安全圈，直接标 maskable 会被切。
const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
manifest.icons = [
  { src: '/icons/icon-96.png', sizes: '96x96', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];
await write('public/manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));

console.log('\n完成。朱砂归一到 ' + hex(RED) + '，自适应前景缩放 ' + FG_SCALE_ADAPTIVE + '。');
