#!/usr/bin/env node
/**
 * 生成本地 PWA / APK 图标，取代 manifest.json 里指向 img.icons8.com 的远程 URL
 * （规格 §7.4：离线拿不到，而离线正是本 App 的核心场景）。
 *
 * 图形＝「墨与纸」的那枚印章：满幅纸底 + 居中朱砂方印 + 印面上留白的杠铃。
 * maskable 图标会被启动器裁成圆/方圆，安全区是中心 80%，所以印面压在 ~56% 以内。
 *
 * 手写 PNG 编码器，不引第三方图像库：本仓库依赖已经够多了，
 * 而这里只需要「纯色矩形」这一种绘图能力。
 *
 * 跑：node scripts/build-icons.mjs（图标定稿后基本不用再跑，产物已提交）
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

/* ── 调色（与 index.css 令牌同值） ── */
const PAPER = [0xef, 0xe9, 0xdc]; // --bg-base
const CINNABAR = [0xb2, 0x3a, 0x28]; // --accent
const INK_ON_ACCENT = [0xfd, 0xfb, 0xf6]; // --text-on-accent

/* ── 最小 PNG 编码器（truecolor 8-bit，无 alpha） ── */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  // 10,11,12 = compression / filter / interlace，全 0
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const p = pixels[y * size + x];
      raw[rowStart + 1 + x * 3] = p[0];
      raw[rowStart + 2 + x * 3] = p[1];
      raw[rowStart + 3 + x * 3] = p[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── 画图 ──
   坐标一律用 0–1 归一化，乘 size，这样一套形状同时出 512 / 192 / 96。 */
function draw(size) {
  const px = new Array(size * size).fill(PAPER);
  const S = (v) => Math.round(v * size);
  const rect = (x0, y0, x1, y1, color) => {
    for (let y = Math.max(0, S(y0)); y < Math.min(size, S(y1)); y++)
      for (let x = Math.max(0, S(x0)); x < Math.min(size, S(x1)); x++) px[y * size + x] = color;
  };

  // 朱砂方印：居中 56%，四角切掉 radius-stamp 的比例（近直角，只切一点点）
  const a = 0.22;
  const b = 0.78;
  const r = 0.012; // 4px @ 340px 印面 ≈ 1.2%
  rect(a, b - (b - a), b, b, CINNABAR);
  const corner = S(r);
  for (let i = 0; i < corner; i++) {
    const cut = corner - i;
    for (let j = 0; j < cut; j++) {
      const yTop = S(a) + i;
      const yBot = S(b) - 1 - i;
      const xL = S(a) + j;
      const xR = S(b) - 1 - j;
      px[yTop * size + xL] = PAPER;
      px[yTop * size + xR] = PAPER;
      px[yBot * size + xL] = PAPER;
      px[yBot * size + xR] = PAPER;
    }
  }

  // 印面上留白的杠铃：横杠 + 左右各两片
  const midY = 0.5;
  const barH = 0.035;
  rect(0.315, midY - barH / 2, 0.685, midY + barH / 2, INK_ON_ACCENT); // 横杠
  const plate = (x0, x1, h) => rect(x0, midY - h / 2, x1, midY + h / 2, INK_ON_ACCENT);
  plate(0.3, 0.355, 0.2); // 内片 左
  plate(0.645, 0.7, 0.2); // 内片 右
  plate(0.262, 0.3, 0.13); // 外片 左
  plate(0.7, 0.738, 0.13); // 外片 右

  return px;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [512, 192, 96]) {
  const buf = encodePng(size, draw(size));
  writeFileSync(join(OUT_DIR, `icon-${size}.png`), buf);
  console.log(`  icon-${size}.png  ${(buf.length / 1024).toFixed(1)}KB`);
}
console.log('[icons] 完成');
