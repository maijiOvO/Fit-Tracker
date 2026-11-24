/**
 * 生成全套图标 / 启动屏。图形直接在这里用矢量画，没有源图。
 *
 *   node scripts/build-icons.mjs        （或 npm run icons）
 *
 * 图标是一根对称的杠铃：蓝黑底，每侧一大一小两片，大片是降了饱和的 25 kg 红，小片是 5 kg 白。
 * 刻意只有这几块：手机桌面上图标只有 48dp，印字和多片都看不清（2026-11-24 用户否掉了
 * 「五片 + 片上印公斤数」那版：太饱和、太密、数字读不出）。
 *
 * 尺寸约束（都以 1024 画布、图形中心为原点算，缩放前杆端在 ±414、大片外角离中心 375）：
 * - Android 自适应图标的圆形遮罩半径 1024×(72/108)/2 = 341px → 前景缩到 FG_SCALE_ADAPTIVE：
 *   杆端落在 232px，只占半径的 68%。占到 87% 时圆形里显得挤（2026-11-24 用户定）。
 *   FULL_SCALE = 它的 1.5 倍，legacy 圆形图标（直接裁满幅版）和自适应图标看起来一样大。
 * - PWA maskable 的安全圈半径 410px，满幅版（FULL_SCALE）杆端 348px，在圈内，不另画。
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const S = 1024;
const FULL_SCALE = 0.84;
const FG_SCALE_ADAPTIVE = 0.56;

const BG = '#0D1216'; // 深色主题的 --bg-base（蓝黑）
const ROD = '#B4B9C1';
/** 片子色比 App 里的 --plate-red 降了饱和：图标是大色块，原色在桌面上太跳。 */
const PLATE_BIG = '#C7574F';
const PLATE_SMALL = '#E9E9E4';
/** 启动屏底色：对齐 capacitor.config.ts 的 backgroundColor 与 manifest.background_color，冷启动不闪。 */
const SPLASH_BG = '#FFFFFF';

/** 每侧从里到外：[颜色, 厚, 直径]。 */
const PLATES = [
  [PLATE_BIG, 130, 520],
  [PLATE_SMALL, 84, 310],
];
const GAP = 14;
/** 中线到第一片内沿。 */
const HALF_GRIP = 140;
/** 最外一片之外露出的杆头。 */
const TIP = 46;

const write = async (path, buf) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  console.log('  ' + path);
};

// ── 1. 画图形 ──────────────────────────────────────────────────────────────
/** 透明底的图形层，scale 是相对 1024 画布的缩放。 */
const drawMark = (scale) => {
  let side = '';
  let x = HALF_GRIP;
  for (const [color, w, h] of PLATES) {
    side += `<rect x="${x}" y="${-h / 2}" width="${w}" height="${h}" rx="22" fill="${color}"/>`;
    x += w + GAP;
  }
  const end = x - GAP + TIP;
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">` +
      `<g transform="translate(${S / 2} ${S / 2}) scale(${scale})">` +
      `<rect x="${-end}" y="-26" width="${end * 2}" height="52" rx="13" fill="${ROD}"/>` +
      `${side}<g transform="scale(-1 1)">${side}</g></g></svg>`
  );
  return sharp(svg).png().toBuffer();
};

const bgPng = await sharp({ create: { width: S, height: S, channels: 3, background: BG } }).png().toBuffer();
const FULL = await sharp(bgPng).composite([{ input: await drawMark(FULL_SCALE) }]).png().toBuffer();
const FG_ADAPTIVE = await drawMark(FG_SCALE_ADAPTIVE);

const resize = (buf, px) => sharp(buf).resize(px, px).png().toBuffer();

/** 按 SVG 蒙版裁切。 */
const masked = async (buf, px, shape) =>
  sharp(await resize(buf, px))
    .composite([{
      input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}">${shape}</svg>`),
      blend: 'dest-in',
    }])
    .png()
    .toBuffer();
/** 圆形裁切 —— legacy 的 ic_launcher_round 用。 */
const circle = (buf, px) => masked(buf, px, `<circle cx="${px / 2}" cy="${px / 2}" r="${px / 2}" fill="#fff"/>`);

// ── 2. 源图与 PWA ──────────────────────────────────────────────────────────
console.log('\n源图与 PWA:');
await write('assets/icon.png', FULL);
await write('android/icon.png', FULL);
for (const px of [96, 192, 512]) await write(`public/icons/icon-${px}.png`, await resize(FULL, px));
await write('public/icons/icon-512-maskable.png', await resize(FULL, 512));

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
/** 白底 + 居中一枚圆角图标。圆角取边长的 22%，接近启动器里的样子。 */
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
  const tile = Math.round(Math.min(w, h) * 0.34);
  const r = Math.round(tile * 0.22);
  const mark = await masked(FULL, tile, `<rect width="${tile}" height="${tile}" rx="${r}" ry="${r}" fill="#fff"/>`);
  const png = await sharp({ create: { width: w, height: h, channels: 3, background: SPLASH_BG } })
    .composite([{ input: mark, left: Math.round((w - tile) / 2), top: Math.round((h - tile) / 2) }])
    .png()
    .toBuffer();
  await write(`android/app/src/main/res/${dir}/splash.png`, png);
}

// ── 5. 跟着图标走的配置 ────────────────────────────────────────────────────
console.log('\n配置:');

await write(
  'android/app/src/main/res/values/ic_launcher_background.xml',
  Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n` +
      `    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`
  )
);

const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
manifest.icons = [
  { src: '/icons/icon-96.png', sizes: '96x96', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];
await write('public/manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));

console.log('\n完成。底色 ' + BG + '，自适应前景缩放 ' + FG_SCALE_ADAPTIVE + '。');
