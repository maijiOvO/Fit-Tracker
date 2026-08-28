#!/usr/bin/env node
/**
 * 中文字体子集化 —— 把 fonts/ 下的第三方 TTF 切成「只含本 App 实际用字」的 woff2，
 * 输出到 public/fonts/，Vite 再把它拷进 dist/fonts/。
 *
 * 为什么必须自托管子集（规格 §3「字体工程」）：
 *   1. 走 fonts.googleapis.com = 国内被墙 + 健身房地下室没信号，
 *      而那正是这个 App 的核心场景。sw.js 明确跳过跨域请求，Service Worker 帮不上忙。
 *   2. 完整中文字重 8–24MB，打进 APK 不现实；实际用字约 1–2 千，子集后两位数 KB。
 *
 * 字符集从源码扫出来（over-include 是安全方向：多切几个字只多几 KB，
 * 少切一个字就是线上一个豆腐块 □）。新加中文文案后重跑本脚本即可。
 *
 * 幂等：字符集没变就跳过。fonts/ 被 .gitignore 挡着，
 * 新克隆的仓库里源文件不在——此时脚本静默跳过，用仓库里已提交的 woff2 产物。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'fonts');
const OUT_DIR = join(ROOT, 'public', 'fonts');
const STAMP = join(OUT_DIR, '.charset-hash');

/* ── 1. 收集字符集 ───────────────────────────────────────────── */

/** 无论源码里有没有出现，都必须切进去的底座。 */
const BASE =
  // 可打印 ASCII
  Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join('') +
  // 常用符号与箭头
  '°×÷±−–—…·•→←↑↓✓✗≈≥≤™©®' +
  // 中文标点（全角）
  '　。，、；：？！“”‘’（）《》〈〉【】「」『』…—～·﹒／＋－＝％＃＠＆＊' +
  // 全角数字与字母偶尔会从旧数据里漏进来
  '０１２３４５６７８９';

/**
 * 印章 / 手写批注专用。Ma Shan Zheng 只切这几个字，别把全站文案喂给它。
 *
 * 两组：
 *   PR 与刊末页的落章 —— 记破新纪录今天多住了一点
 *   训练部位的朱文印   —— 胸肩背腿臂他（BodyPartPicker）
 *
 * ⚠️ 加中文字到印章里必须同时改这里并重跑 npm run build:fonts。
 *    dev server 不会自动重建子集，漏了这步字会静默掉回系统字体。
 */
const SEAL_CHARS = '记破新纪录今天多住了一点' + '胸肩背腿臂他';

const SCAN_EXT = new Set(['.ts', '.tsx', '.html']);
const SCAN_DIRS = ['src', 'services'];
const SCAN_FILES = ['translations.ts', 'types.ts', 'App.tsx', 'index.tsx', 'index.html'];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (SCAN_EXT.has(name.slice(name.lastIndexOf('.')))) acc.push(p);
  }
  return acc;
}

function collectCharset() {
  const files = [
    ...SCAN_FILES.map((f) => join(ROOT, f)).filter(existsSync),
    ...SCAN_DIRS.flatMap((d) => (existsSync(join(ROOT, d)) ? walk(join(ROOT, d)) : [])),
  ];
  const chars = new Set(BASE);
  for (const f of files) {
    for (const ch of readFileSync(f, 'utf8')) {
      const cp = ch.codePointAt(0);
      // 只挑 CJK 与中文标点；ASCII 已由 BASE 兜底，代码里的标识符不用管
      if (
        (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 统一表意
        (cp >= 0x3400 && cp <= 0x4dbf) || // 扩展 A
        (cp >= 0x3000 && cp <= 0x303f) || // CJK 标点
        (cp >= 0xff00 && cp <= 0xffef) || // 全角
        (cp >= 0x2000 && cp <= 0x206f) // 通用标点（… — ' " 等）
      ) {
        chars.add(ch);
      }
    }
  }
  return [...chars].sort().join('');
}

/* ── 2. 字体清单 ─────────────────────────────────────────────── */

const FONTS = [
  {
    file: 'Noto_Sans_SC/NotoSansSC-VariableFont_wght.ttf',
    out: 'noto-sans-sc.woff2',
    // 400/500/600/700 全走同一个可变文件；把轴夹到实际用得到的范围以省体积
    variationAxes: { wght: { min: 400, max: 700, default: 400 } },
    expectAxis: { tag: 'wght', min: 400, max: 700 },
    full: true,
  },
  {
    file: 'Noto_Serif_SC/NotoSerifSC-VariableFont_wght.ttf',
    out: 'noto-serif-sc.woff2',
    // §3 的字重表写了 500/600/700，但同一节的排印铁律「衬线只用于 ≥17px 且字重 ≥600」
    // 已经排除了 500，全文也没有任何一处具体用到它。
    // 夹到 600–700 省 105KB（420.9 → 316.2KB），且 600/700 都是真字重不是伪加粗。
    variationAxes: { wght: { min: 600, max: 700, default: 600 } },
    expectAxis: { tag: 'wght', min: 600, max: 700 },
    full: true,
  },
  { file: 'IBM_Plex_Mono/IBMPlexMono-Medium.ttf', out: 'plex-mono-500.woff2', latinOnly: true },
  { file: 'IBM_Plex_Mono/IBMPlexMono-SemiBold.ttf', out: 'plex-mono-600.woff2', latinOnly: true },
  { file: 'Ma_Shan_Zheng/MaShanZheng-Regular.ttf', out: 'ma-shan-zheng.woff2', sealOnly: true },
];

/* ── 3. 校验：轴有没有活下来 ─────────────────────────────────── */

/**
 * 可变字体的默认实例是最细的一档（Sans 默认 wght=100，Serif 默认 200）。
 * 轴一旦在子集化中丢了，全站中文会变成发丝体——现象很像「字体没加载」，
 * 极易误判。所以这里直接读产物的 fvar 表断言。
 */
function readAxes(buf) {
  // woff2 不能直接读表；这里只对 sfnt 用。校验走单独一次 targetFormat:'sfnt'。
  const numTables = buf.readUInt16BE(4);
  let fvar = null;
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    if (buf.toString('latin1', o, o + 4) === 'fvar') fvar = buf.readUInt32BE(o + 8);
  }
  if (fvar === null) return null;
  const axOff = fvar + buf.readUInt16BE(fvar + 4);
  const count = buf.readUInt16BE(fvar + 8);
  const size = buf.readUInt16BE(fvar + 10);
  return Array.from({ length: count }, (_, i) => {
    const o = axOff + i * size;
    return {
      tag: buf.toString('latin1', o, o + 4),
      min: buf.readInt32BE(o + 4) / 65536,
      def: buf.readInt32BE(o + 8) / 65536,
      max: buf.readInt32BE(o + 12) / 65536,
    };
  });
}

/** 读 head.unitsPerEm 与 hhea 的升降部，用来给兜底字体写度量覆写。 */
function readMetrics(buf) {
  const numTables = buf.readUInt16BE(4);
  const t = {};
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    t[buf.toString('latin1', o, o + 4)] = buf.readUInt32BE(o + 8);
  }
  const upem = buf.readUInt16BE(t.head + 18);
  return {
    upem,
    ascent: buf.readInt16BE(t.hhea + 4) / upem,
    descent: Math.abs(buf.readInt16BE(t.hhea + 6)) / upem,
    lineGap: buf.readInt16BE(t.hhea + 8) / upem,
  };
}

/* ── 4. 跑 ───────────────────────────────────────────────────── */

const kb = (n) => `${(n / 1024).toFixed(1)}KB`;

async function main() {
  if (!existsSync(SRC_DIR)) {
    console.log('[fonts] 未找到 fonts/ 源目录，跳过子集化（沿用已提交的 public/fonts/*.woff2）');
    return;
  }
  const missing = FONTS.filter((f) => !existsSync(join(SRC_DIR, f.file)));
  if (missing.length) {
    console.log(`[fonts] 缺少源文件，跳过：${missing.map((m) => m.file).join(', ')}`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const charset = collectCharset();
  const hash = createHash('sha256').update(charset).update(JSON.stringify(FONTS)).digest('hex');
  const allOutputsExist = FONTS.every((f) => existsSync(join(OUT_DIR, f.out)));

  if (allOutputsExist && existsSync(STAMP) && readFileSync(STAMP, 'utf8').trim() === hash) {
    console.log(`[fonts] 字符集未变（${[...charset].length} 字），跳过`);
    return;
  }

  console.log(`[fonts] 字符集 ${[...charset].length} 字，开始子集化…`);
  const metrics = {};

  for (const f of FONTS) {
    const src = readFileSync(join(SRC_DIR, f.file));
    const text = f.latinOnly ? BASE : f.sealOnly ? BASE.slice(0, 95) + SEAL_CHARS : charset;
    const opts = f.variationAxes ? { variationAxes: f.variationAxes } : {};

    if (f.expectAxis) {
      // 先切一份 sfnt 只为读 fvar 断言轴还在
      const probe = await subsetFont(src, text, { ...opts, targetFormat: 'sfnt' });
      const axes = readAxes(probe);
      const ax = axes?.find((a) => a.tag === f.expectAxis.tag);
      if (!ax) {
        throw new Error(
          `[fonts] ${f.out}: 子集化把 ${f.expectAxis.tag} 轴切没了。` +
            `可变字体的默认实例是最细一档，轴丢了会让全站中文变成发丝体。`,
        );
      }
      if (ax.min > f.expectAxis.min || ax.max < f.expectAxis.max) {
        throw new Error(
          `[fonts] ${f.out}: ${ax.tag} 轴范围 ${ax.min}–${ax.max}，` +
            `覆盖不了需要的 ${f.expectAxis.min}–${f.expectAxis.max}`,
        );
      }
      metrics[f.out] = readMetrics(probe);
      console.log(`  ✓ ${f.out} 轴校验 ${ax.tag} ${ax.min}–${ax.max}（默认 ${ax.def}）`);
    }

    const woff2 = await subsetFont(src, text, { ...opts, targetFormat: 'woff2' });
    writeFileSync(join(OUT_DIR, f.out), woff2);
    console.log(`  ${f.out.padEnd(24)} ${kb(src.length).padStart(9)} → ${kb(woff2.length)}`);
  }

  writeFileSync(STAMP, hash + '\n');

  const m = metrics['noto-sans-sc.woff2'];
  if (m) {
    console.log(
      `[fonts] Noto Sans SC 度量：ascent ${(m.ascent * 100).toFixed(1)}% ` +
        `descent ${(m.descent * 100).toFixed(1)}% lineGap ${(m.lineGap * 100).toFixed(1)}%` +
        `（index.css 的兜底 @font-face 覆写值取自这里）`,
    );
  }
  console.log('[fonts] 完成');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
