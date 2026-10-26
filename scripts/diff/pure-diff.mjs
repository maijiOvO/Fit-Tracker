// 纯函数对照：两棵树各用 esbuild 打成一个包（照 logic-check / data-check 的桩），
// 同一批输入（固定种子生成）喂两边，深比较输出。
// 用法：node scripts/diff/pure-diff.mjs <treeA> <treeB> [--seed N] [--per 8] [--out dir]
//
// 两类探针：
//  1. 签名启发式 fuzz：对每个导出函数读 fn.toString() 的形参名，按名字挑输入池，采样若干组实参调用；
//     结果（含抛错信息）两边必须相同。
//  2. 定向探针：取整器 / 工作台改值 / 合并 / PR / 力量史 / 导入导出 / 名字索引等，用构造好的真实形状输入。
// 时间与随机数都钉死，localStorage / IndexedDB 用内存桩并在每个探针前重置、探针后把内容也当输出比。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireFromRoot, parseArgs, tree, outDir } from './_paths.mjs';

const { pos: [treeA, treeB], opts } = parseArgs(process.argv.slice(2), {
  positional: 2, usage: 'usage: node scripts/diff/pure-diff.mjs <treeA> <treeB> [--seed N] [--per 8] [--out dir]',
  flags: { seed: '20261026', per: '8', out: '' },
});
const SEED = Number(opts.seed);
const PER = Number(opts.per);
const OUT = outDir('pure', opts.out);
fs.mkdirSync(OUT, { recursive: true });

// ───────────────────────── 1. 打包 ─────────────────────────
const ENTRY = `
export * as W from './src/utils/workbench.ts';
export * as L from './src/utils/loadable.ts';
export * as P from './src/utils/plates.ts';
export * as LD from './src/utils/liftDisplay.ts';
export * as LH from './src/utils/liftHistory.ts';
export * as F from './src/utils/format.ts';
export * as D from './src/utils/dateUtils.ts';
export * as EC from './src/utils/exerciseConfig.ts';
export * as LO from './src/utils/load.ts';
export * as G from './src/utils/gyms.ts';
export * as HM from './src/utils/heatmapDays.ts';
export * as NI from './src/utils/nameIndex.ts';
export * as NS from './src/utils/nameSegments.ts';
export * as PR from './src/utils/prRecords.ts';
export * as PD from './src/utils/prDetect.ts';
export * as PF from './src/utils/prefillSource.ts';
export * as EA from './src/utils/exerciseAttrs.ts';
export * as EO from './src/utils/exerciseOverride.ts';
export * as ES from './src/utils/exerciseSearch.ts';
export * as SF from './src/utils/scrubFeel.ts';
export * as WS from './src/utils/weightSummary.ts';
export * as CT from './src/utils/cableTagMigration.ts';
export * as AP from './services/appPrefs.ts';
export * as FR from './services/fitlogRemote.ts';
export * as FT from './services/fitlogTombstones.ts';
export * as FB from './services/fitlogBackup.ts';
export * as AB from './services/fitlogAutoBackup.ts';
export * as CE from './services/fitlogCsvExport.ts';
export * as CI from './services/fitlogCsvImport.ts';
export * as LR from './src/hooks/useLoadRounder.ts';
export * as LK from './src/hooks/useLoadKind.ts';
export * as CX from './src/constants/exercises.ts';
export { translations as TR } from './translations.ts';
export { db as DB } from './services/db';
`;

async function bundle(treeDir, tag) {
  const { build } = requireFromRoot('esbuild'); // vite 自带的那份
  const out = path.join(OUT, `bundle-${tag}.mjs`);
  const stubs = {
    name: 'stubs',
    setup(b) {
      b.onResolve({ filter: /contexts\// }, () => ({ path: 'ctx', namespace: 'stub' }));
      b.onResolve({ filter: /^\.(\/services)?\/db$/ }, () => ({ path: 'db', namespace: 'stub' }));
      b.onResolve({ filter: /^@capacitor\// }, () => ({ path: 'cap', namespace: 'stub' }));
      b.onLoad({ filter: /^ctx$/, namespace: 'stub' }, () => ({
        contents: 'const no = () => { throw new Error("context used"); }; export const useExercisePrefs = no; export const useUserSettingsContext = no; export const useAuthContext = no; export const useWorkoutContext = no; export const UserSettingsContext = null;',
        loader: 'js',
      }));
      b.onLoad({ filter: /^cap$/, namespace: 'stub' }, () => ({
        contents: `export const Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web' };
          export const registerPlugin = () => new Proxy({}, { get: () => () => { throw new Error('native plugin used'); } });
          export const Filesystem = {}; export const Share = {}; export const App = {}; export const Directory = {}; export const Encoding = {};`,
        loader: 'js',
      }));
      b.onLoad({ filter: /^db$/, namespace: 'stub' }, () => ({
        contents: `const stores = new Map();
          const s = n => { if (!stores.has(n)) stores.set(n, new Map()); return stores.get(n); };
          export const db = {
            async init() {}, async reopen() {},
            async getAll(n) { return [...s(n).values()].map(x => structuredClone(x)); },
            async save(n, x) { s(n).set(x.id, structuredClone(x)); },
            async upsert(n, x) { s(n).set(x.id, structuredClone(x)); },
            async delete(n, id) { s(n).delete(id); },
            async clear(n) { s(n).clear(); },
            async replaceAll(n, rows) { s(n).clear(); for (const x of rows) s(n).set(x.id, structuredClone(x)); },
            async rawReplaceAll(n, rows) { s(n).clear(); for (const x of rows) s(n).set(x.id, structuredClone(x)); },
            __dump() { const o = {}; for (const [n, m] of stores) o[n] = [...m.values()]; return o; },
            __reset() { stores.clear(); },
          };`,
        loader: 'js',
      }));
    },
  };
  await build({
    stdin: { contents: ENTRY, resolveDir: treeDir, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
    plugins: [stubs], define: { 'import.meta.env': '{}' },
  });
  return out;
}

// ───────────────────────── 2. 钉死环境 ─────────────────────────
const FIXED_NOW = Date.UTC(2026, 9, 26, 15, 30, 0); // 2026-10-26 15:30:00Z
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(FIXED_NOW); else super(...a); }
  static now() { return FIXED_NOW; }
}
globalThis.Date = FixedDate;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let rnd = mulberry32(SEED);
Math.random = () => rnd();

const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  clear: () => mem.clear(),
  key: i => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
globalThis.window = globalThis; // appStorage 失败时 dispatchEvent；这里永不失败
globalThis.dispatchEvent = () => true;
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
Object.defineProperty(globalThis, 'navigator', { value: { vibrate: () => true, language: 'zh-CN' }, configurable: true });
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
globalThis.structuredClone ??= v => JSON.parse(JSON.stringify(v));

// ───────────────────────── 3. 夹具（纯数据，两边同一份） ─────────────────────────
const CN_NAMES = ['杠铃平板卧推', '哑铃平板卧推', '杠铃深蹲', '硬拉', '引体向上', '绳索下拉', '坐姿推胸', '壶铃摇摆', 'E2E自建甲', '悍马卧推'];
const GYMS = [undefined, 'A馆', 'B馆', ' a馆 '];
const UNITS = ['kg', 'lbs'];
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const maybe = (p, v) => (rnd() < p ? v : undefined);
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const iso = (daysAgo, h = 18, m = 5) => new RealDate(FIXED_NOW - daysAgo * 86400000 + ((h - 15) * 60 + m) * 60000).toISOString();

function genSet(i, opts = {}) {
  const w = pick([0, 2.5, 20, 40, 60, 62.5, 80, 100, 102.06, 135 / 2.20462, 185 / 2.20462, 225 / 2.20462, -20, -30, 12.5]);
  return strip({
    id: `s${i}`, weight: w, reps: pick([0, 1, 3, 5, 8, 10, 12, 20]),
    plateUnit: maybe(0.5, pick(UNITS)), ghost: maybe(opts.ghostP ?? 0.2, true), seq: maybe(0.3, FIXED_NOW - i * 1000),
    bodyweightMode: maybe(0.2, pick(['normal', 'weighted', 'assisted'])), duration: maybe(0.15, pick([30, 60, 90])),
    prefillRef: maybe(0.2, { kg: w, unit: pick(UNITS), plan: maybe(0.3, true) }), draftAuto: maybe(0.2, true),
    toFailure: maybe(0.1, true), touched: maybe(0.2, { weight: true }),
    subSets: maybe(0.2, [strip({ id: `s${i}_d1`, weight: Math.max(0, w - 10), reps: 8, ghost: maybe(0.3, true) })]),
  });
}
function genExercise(i, opts = {}) {
  const n = opts.nSets ?? 1 + Math.floor(rnd() * 4);
  return strip({
    id: `ex${i}`, name: opts.name ?? pick(CN_NAMES), category: 'STRENGTH',
    sets: Array.from({ length: n }, (_, k) => genSet(i * 10 + k, opts)),
    variantId: maybe(0.2, 'v1'), altGroup: maybe(0.2, 'alt_x'), exerciseTime: maybe(0.5, iso(opts.daysAgo ?? 1)),
    tags: maybe(0.3, [pick(['tagBarbell', 'tagDumbbell', 'tagMachine', 'tagCable', 'tagBodyweight'])]),
  });
}
function genWorkout(i, opts = {}) {
  const d = opts.daysAgo ?? i * 2;
  const t = iso(d);
  return strip({
    id: `w${i}`, userId: pick(['u_solo', 'u_solo', 'u_guest']), date: t, title: `训练 ${i}`,
    status: opts.status ?? pick(['completed', 'completed', 'completed', 'draft']), finishedAt: maybe(0.9, t), updatedAt: t,
    gym: maybe(0.6, pick(GYMS.filter(Boolean))),
    exercises: Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, k) => genExercise(i * 10 + k, { daysAgo: d })),
  });
}
const WORKOUTS = Array.from({ length: 24 }, (_, i) => genWorkout(i));
const SESSION = genWorkout(99, { daysAgo: 0, status: 'completed' });
const EXS = Array.from({ length: 5 }, (_, i) => genExercise(i, { ghostP: 0.4 }));
const EXS_ALT = EXS.map((e, i) => (i < 2 ? { ...e, altGroup: 'alt_q' } : e));
const SETS = EXS.flatMap(e => e.sets);
const ROWS = EXS.flatMap(e => e.sets.map(s => ({ exId: e.id, setId: s.id })));
const DEF_C = { id: '1779000000000', name: { cn: 'E2E自建甲', en: 'E2E自建甲' }, bodyPart: 'subChest', tags: [], category: 'STRENGTH' };
const DEF_D = { id: '1779000000001', name: { cn: '悍马卧推', en: 'Hammer Press' }, bodyPart: 'subChest', tags: ['tagMachine'], category: 'STRENGTH', regions: ['subChest'] };
const GYM_KG = { plateUnit: 'kg', plates: [25, 20, 15, 10, 5, 2.5, 1.25], cable: { v: 5, u: 'kg' }, machine: { v: 5, u: 'kg', s: 7.5 }, dumbbell: { v: 2.5, u: 'kg' } };
const GYM_LB = { plateUnit: 'lbs', plates: [45, 35, 25, 10, 5, 2.5], cable: { v: 10, u: 'lbs', s: 12.5 }, machine: { v: 10, u: 'lbs' }, dumbbell: { v: 5, u: 'lbs' }, kettlebell: { v: 8, u: 'lbs' } };
const APP_PREFS = { gyms: { 'A馆': GYM_KG, 'B馆': GYM_LB }, gymKinds: { 'A馆|hammer': 'pin' }, gymNotes: {}, gymTares: {}, weekStart: 'mon', featured: ['sq_barbell|'] };
const PREFS = (ts) => ({
  customTags: [{ id: 'ct1', name: '器械甲', category: 'equipment' }], customExercises: [DEF_C, DEF_D],
  exerciseNotes: { 杠铃深蹲: '注意呼吸' }, starredExercises: { 杠铃深蹲: ts, 硬拉: ts - 1 },
  exerciseMetricConfigs: { 杠铃深蹲: ['weight', 'reps'] }, tagRenameOverrides: {}, exerciseOverrides: { sq_barbell: { name: { cn: '深蹲', en: 'Squat' } } },
  starredLastUpdateMs: ts, metricsLastUpdateMs: ts, prefsLastUpdateMs: ts, lang: 'cn', unit: 'kg', appPrefs: APP_PREFS, appPrefsUpdatedMs: ts,
});
const SNAP = (ts, ws, extra = {}) => ({ schemaVersion: 2, clientExportedAt: new RealDate(ts).toISOString(), workouts: ws, goals: [], weightLogs: [{ id: 'wl1', date: iso(3), weight: 70 }], customMetrics: [], prs: [], scheduledWorkouts: [], prefs: PREFS(ts), ...extra });
const LOCAL = SNAP(FIXED_NOW - 1000, WORKOUTS.slice(0, 16), { tombstones: { workouts: ['w20'] } });
const REMOTE = SNAP(FIXED_NOW - 5000, WORKOUTS.slice(8).map(w => (w.id === 'w10' ? { ...w, title: '远端改过', updatedAt: iso(0) } : w)), { tombstones: { workouts: ['w3'], goals: ['g1'] } });
const STRONG = `Date;Workout Name;Duration;Exercise Name;Set Order;Weight;Reps;Distance;Seconds;Notes;Workout Notes;RPE
2024-03-14 18:05:12;Push;1h 5m;Bench Press (Barbell);W;135;10;0;0;;;
2024-03-14 18:05:12;Push;1h 5m;Bench Press (Barbell);1;225;5;0;0;;;8
2024-03-14 18:05:12;Push;1h 5m;Bench Press (Barbell);D;185;8;0;0;;;
2024-03-14 18:05:12;Push;1h 5m;Bench Press (Barbell);Rest Timer;0;0;0;90;;;
2024-03-16 09:00:00;Legs;45m;Squat (Barbell);1;315;3;0;0;;;
2024-03-16 09:00:00;Legs;45m;Strong Only Machine;F;50;12;0;0;;;
`;
const HEVY = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_lbs","reps","distance_miles","duration_seconds","rpe"
"Upper","18 Oct 2025, 08:47","18 Oct 2025, 09:50","","Bench Press (Barbell)","","",0,"normal",185,5,,,
"Upper","18 Oct 2025, 08:47","18 Oct 2025, 09:50","","Squat (Barbell)","","",0,"warmup",135,8,,,
`;
const BACKUP_V2 = JSON.stringify({ app: 'fitlog', formatVersion: 2, exportedAt: iso(1), snapshot: LOCAL });
const BACKUP_LEGACY = JSON.stringify({ app: 'fitlog', exportDate: iso(10), data: { workouts: WORKOUTS.slice(0, 3), weightLogs: [] }, settings: { unit: 'lbs' } });
const KINDS = ['plates', 'loaded', 'pin', 'pair', 'bell', 'fixed', 'signed', 'plain'];
const INFO = (kind, extra = {}) => ({ kind, stack: pick(['cable', 'machine']), libKind: kind, defId: 'hammer', variantId: maybe(0.3, 'v1'), ...extra });
const CTX_KG = { unit: 'kg', plates: GYM_KG.plates, bar: 20, inc: 2.5 };
const CTX_LB = { unit: 'lbs', plates: GYM_LB.plates, bar: 45, inc: 5, start: 12.5 };
const CTX_ONE = { ...CTX_KG, oneSide: true };
const NUMS = [0, 1, 2.5, 7.5, 12.5, 20, 22.68, 40, 61.23, 62.5, 100, 102.06, 135, 185, 1000, -20, -2.5, 0.4, 1e6, NaN];
const SMALL = [0, 1, 2, 3, 5, 8, 10, 12, 15, 30, 60, 3599, 3600, 7261];
const STRS = ['', '卧推', 'wotui', 'wt', 'bench', 'Bench Press (Barbell)', '杠铃平板卧推', 'E2E自建甲', '  深蹲 ', 'pull up', 'rdl', '悍马卧推'];
const METRICS = ['weight', 'reps', 'duration', 'distance', 'speed', 'score', 'time', 'e1rm', 'volume'];
const TOKENS = STRS.map(s => s.toLowerCase().split(/\s+/).filter(Boolean));

// 形参名 → 输入池
const POOLS = {
  exs: [EXS, EXS_ALT, [], SESSION.exercises], exercises: [EXS, []], members: [EXS_ALT.slice(0, 2)],
  ex: [...EXS, SESSION.exercises[0]], exercise: [...EXS], e: [...EXS],
  sets: [SETS, [], EXS[0].sets], history: [WORKOUTS, [], SETS], current: [SETS.slice(0, 3)], s: [...SETS, ...STRS], set: [...SETS], parent: [undefined, ...SETS.slice(0, 2)],
  workouts: [WORKOUTS, [], WORKOUTS.slice(0, 3)], session: [SESSION, ...WORKOUTS.slice(0, 2)], w: [...WORKOUTS.slice(0, 4), ...NUMS], workout: [...WORKOUTS.slice(0, 3)],
  unit: UNITS, u: UNITS, du: UNITS, plateUnit: UNITS, display: UNITS, from: UNITS, to: UNITS, targetUnit: UNITS, sourceUnit: UNITS, fallback: UNITS, fallbackUnit: UNITS,
  kg: NUMS, kgSigned: NUMS, v: NUMS, val: NUMS, side: NUMS, total: NUMS, cur: NUMS, d: [...NUMS, new RealDate(FIXED_NOW), new RealDate(iso(40))], n: SMALL, reps: SMALL, weight: NUMS, bar: [20, 45, 0, 10, 15],
  seconds: SMALL, totalSeconds: SMALL, sec: SMALL, h: SMALL, m: SMALL, mult: [1, 2, 5], dir: [1, -1], inc: [2.5, 5, 1, 0.5], start: [0, 7.5, 12.5, undefined], step: [2.5, 5], tol: [0.01, 0.5],
  gym: GYMS, raw: [...GYMS, ...STRS, BACKUP_V2, BACKUP_LEGACY, '{"a":1}', 'nope'], lang: ['cn', 'en'], isCn: [true, false], signed: [true, false], signedByDef: [true, false], bool: [true, false], scoped: [true, false],
  r: ROWS, rule: ['weight', 'e1rm', 'reps', 'volume'], kind: KINDS, metric: METRICS, metricName: METRICS, metricCount: [1, 2, 3, 4], firstCol: [36, 48],
  ctx: [CTX_KG, CTX_LB, CTX_ONE], info: KINDS.map(k => INFO(k)), tokens: TOKENS, query: STRS, text: [...STRS, STRONG, HEVY], name: STRS, needle: STRS, hay: STRS, nameCn: STRS, nameEn: STRS, tagNames: [[], ['杠铃', '胸']],
  stored: STRS, id: STRS, tid: STRS, tag: ['tagBarbell', 'tagOutdoor', 'ct1', 'subChest', 'x'], equipment: ['tagBarbell', 'tagDumbbell', 'tagMachine', 'tagCable', 'tagBodyweight', 'tagBand', 'ct1', ''], tags: [[], ['tagBarbell'], ['tagMachine', 'tagCable'], undefined], defId: ['sq_barbell', 'hammer', undefined],
  date: [new RealDate(FIXED_NOW), new RealDate(iso(40)), new RealDate(iso(0, 3))], date1: [new RealDate(FIXED_NOW)], date2: [new RealDate(FIXED_NOW), new RealDate(iso(1))], time: [iso(1), '', 'garbage'], ts: [FIXED_NOW, FIXED_NOW - 86400000 * 40, 0], now: [FIXED_NOW], month: [0, 1, 9, 11], year: [2024, 2026],
  range: ['3m', '6m', '1y', 'all'], list: [[], ['subChest'], ['subChest', 'subBack']], own: [undefined, ['subChest']], target: ['subChest', 'subBack'], layer: [undefined, { equipment: 'tagMachine' }], defs: [{ cable: 'stack', machine: 'stack' }],
  p: [PREFS(FIXED_NOW), {}, ...NUMS.slice(0, 4)], localLs: [PREFS(FIXED_NOW), PREFS(FIXED_NOW - 9e5)], remote: [PREFS(FIXED_NOW - 5000), PREFS(FIXED_NOW + 5000), REMOTE], local: [LOCAL], next: [LOCAL], before: [REMOTE, iso(2), undefined],
  profile: [GYM_KG, GYM_LB], c: [GYM_KG.cable, GYM_LB.machine, ...NUMS.slice(0, 6)], plates: [GYM_KG.plates, GYM_LB.plates, []], disabled: [[], [25]], over: [undefined, { name: { cn: '深蹲', en: 'Squat' } }, { variants: [{ id: 'v1', name: { cn: '宽握', en: 'Wide' } }] }],
  builtins: [[DEF_D]], customExercises: [[DEF_C, DEF_D], []], exerciseOverrides: [{}, { [DEF_C.id]: { mergedInto: DEF_D.id } }], names: [['杠铃深蹲', '哑铃卧推', '引体向上'], []], stamps: [[]], kgToLbs: [2.20462],
  parsed: [], t: [{ x0: 0, c0: 0, x: 0, acc: 0, engaged: false }, { x0: 0, c0: 0, x: 30, acc: 3, engaged: true }], px: [10, 14, 7], engagePx: [20], along: NUMS.slice(0, 8), across: NUMS.slice(0, 8),
  files: [[{ name: 'fitlog-auto-2026-10-20-prod.json', uri: 'u1', mtime: FIXED_NOW - 6 * 864e5 }, { name: 'fitlog-auto-2026-10-25-prod.json', uri: 'u2', mtime: FIXED_NOW - 864e5 }, { name: 'fitlog-auto-2025-01-05-prod.json', uri: 'u3', mtime: 0 }, { name: 'mine.json', uri: 'u4' }], []],
  file: [{ name: 'fitlog-auto-2026-10-20-prod.json', uri: 'u1' }, { name: 'x.json', uri: 'u' }, LOCAL], expected: [LOCAL], env: ['dev', 'prod'], when: [new RealDate(FIXED_NOW)], f: [{ kind: 'mock', path: 'Documents/fitlog' }], store: ['workouts', 'goals'], items: [[]],
  pattern: [10, [10, 20]], delimiter: [';', ','], header: [], rows: [], o: [], a: NUMS, b: NUMS, x: NUMS, y: NUMS, value: NUMS, lo: NUMS, hi: NUMS, idx: SMALL, i: SMALL, k: SMALL, str: STRS, lift: [], liftKey: [], acc: NUMS,
};
const GENERIC = [EXS, SETS[0], EXS[0], WORKOUTS, SESSION, 'kg', 60, '卧推', true, undefined, null, {}, [], ROWS[0]];
function poolFor(param) {
  const name = param.replace(/^\.\.\./, '').replace(/=.*$/, '').trim();
  if (name.startsWith('{') || name.startsWith('[')) return [undefined];
  return POOLS[name] ?? POOLS[name.replace(/^_/, '')] ?? GENERIC;
}
function paramsOf(fn) {
  const src = fn.toString();
  const m = src.match(/^(?:async\s*)?(?:function\s*[\w$]*)?\s*\(([^)]*)\)/) ?? src.match(/^(?:async\s*)?([\w$]+)\s*=>/);
  if (!m) return [];
  const inner = m[1];
  if (!inner.trim()) return [];
  const out = []; let depth = 0, cur = '';
  for (const ch of inner) { if ('([{'.includes(ch)) depth++; if (')]}'.includes(ch)) depth--; if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}

// ───────────────────────── 4. 结果归一化 ─────────────────────────
function tryCall(f, ...a) { try { const v = f(...a); return norm(v, 0, true); } catch (e) { return { __err: String(e?.message ?? e) }; } }
function norm(v, depth = 0, noFn = false) {
  if (depth > 6) return '[deep]';
  if (typeof v === 'function') return noFn ? '[fn]' : { __fn: [tryCall(v, 60), tryCall(v, 102.06), tryCall(v, -20), tryCall(v, 60, 1), tryCall(v, 60, -1, 2), tryCall(v, 0), tryCall(v, SETS[0]), tryCall(v, EXS[0]), tryCall(v, '杠铃深蹲')] };
  if (typeof v === 'number') return Number.isNaN(v) ? 'NaN' : Object.is(v, -0) ? 0 : v;
  if (v === undefined) return '__undef';
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Promise) return '[promise]';
  if (v instanceof RealDate) return `Date(${v.toISOString()})`;
  if (v instanceof Map) return { __map: [...v.entries()].map(([k, x]) => [norm(k, depth + 1, noFn), norm(x, depth + 1, noFn)]) };
  if (v instanceof Set) return { __set: [...v].map(x => norm(x, depth + 1, noFn)) };
  if (Array.isArray(v)) return v.map(x => norm(x, depth + 1, noFn));
  const o = {};
  for (const k of Object.keys(v).sort()) o[k] = norm(v[k], depth + 1, noFn);
  return o;
}
function resetState() {
  mem.clear();
  mem.set('dev:fitlog_app_prefs', JSON.stringify({ appPrefs: APP_PREFS, appPrefsUpdatedMs: FIXED_NOW - 100 }));
  mem.set('dev:fitlog_tombstones', JSON.stringify({ workouts: ['w20'] }));
  mem.set('dev:fitlog_starred_exercises', JSON.stringify({ 杠铃深蹲: FIXED_NOW - 10 }));
}
async function settle(v) { try { return norm(await v); } catch (e) { return { __err: String(e?.message ?? e) }; } }
function dumpState(M) { return { ls: Object.fromEntries([...mem.entries()].sort()), db: M.DB.__dump ? norm(M.DB.__dump()) : null }; }

// ───────────────────────── 5. 探针 ─────────────────────────
async function runProbes(M) {
  const out = {};
  const record = async (name, fn) => {
    resetState(); M.DB.__reset?.(); rnd = mulberry32(SEED ^ hash(name)); M.AP.invalidateAppPrefsCache?.();
    let res;
    try { res = await settle(fn()); } catch (e) { res = { __err: String(e?.message ?? e) }; }
    out[name] = { res, state: dumpState(M) };
  };

  // 5a. 签名启发式 fuzz
  for (const ns of Object.keys(M)) {
    if (ns === 'DB' || ns === 'TR') continue;
    const mod = M[ns];
    for (const fname of Object.keys(mod).sort()) {
      const f = mod[fname];
      if (typeof f !== 'function') { await record(`${ns}.${fname}:const`, () => f); continue; }
      if (/^use[A-Z]/.test(fname) || /^(installFontGuard|haptic|tick|backupNow|scheduleAutoBackup|maybeDailyBackup|fetchRemote|putRemote|pull|push|switchDataEnv|migrateRecords|applySnapshot|overwriteLocal|rollbackImport|readRollback|applyBackup|mergeBackup|addImportedRecords|pickFolder|hasAccess|listFiles|writeText|readText|deleteFile|saveTextFile|shrinkAvatar|buildBackupFile|collectLocalSnapshot|scheduleDebounced|cancelPending)/.test(fname)) continue;
      const params = paramsOf(f);
      const pools = params.map(poolFor);
      const seen = new Set();
      rnd = mulberry32(SEED ^ hash(`${ns}.${fname}`)); // 每个函数独立采样，删掉别的导出不会改它拿到的实参
      for (let i = 0; i < PER; i++) {
        const args = pools.map(p => pick(p));
        const key = JSON.stringify(norm(args, 0, true)).slice(0, 400);
        if (seen.has(key)) continue; seen.add(key);
        await record(`${ns}.${fname}#${i}(${params.join(',')})`, () => f(...args));
        if (params.length === 0) break;
      }
    }
  }

  // 5b. 定向探针
  const resolveName = n => n.trim();
  for (const [ki, kind] of KINDS.entries()) for (const [ci, ctx] of [CTX_KG, CTX_LB, CTX_ONE].entries()) for (const signed of [false, true]) for (const du of UNITS) {
    await record(`LR.makeRounder[${kind},${ci},${signed},${du}]`, () => {
      const r = M.LR.makeRounder(INFO(kind), ctx.unit, ctx, signed, du);
      const sample = [0, 1, 2.5, 7.5, 12.5, 20, 22.68, 40, 61.23, 62.5, 100, 102.06, 135, 185, -20, -2.5, 0.4];
      return {
        toD: sample.map(v => r.toD(v)), fromD: sample.map(v => r.fromD(v)), kgOfD: sample.map(v => r.kgOfD(v)), snapD: sample.map(v => r.snapD(v)),
        loadableD: sample.map(v => r.loadableD(v)), stepD: sample.map(v => r.stepD(v)), bracketD: sample.map(v => r.bracketD(v)), snapKg: sample.map(v => r.snapKg(v)),
        stepTo: sample.flatMap(v => [r.stepToD(v, 1), r.stepToD(v, -1), r.stepToD(v, 1, 3), r.stepToD(v, -1, 2)]),
        withInc: sample.map(v => M.LR.withInc(r, 1.25).snapD(v)), withStack: sample.map(v => M.LR.withStack(r, 5, 7.5).stepD(v)), withOne: sample.map(v => M.LR.withOneSide(r, true).snapD(v)),
      };
    });
  }
  for (const [i, exs] of [EXS, EXS_ALT, SESSION.exercises].entries()) {
    await record(`W.flow[${i}]`, () => {
      const cards = M.W.buildCards(exs);
      const rows = cards.map(c => M.W.cardRows(c, exs));
      const flat = M.W.flatRows(exs);
      const seq = [];
      let cur = exs;
      for (const r of flat.slice(0, 6)) {
        cur = M.W.applySetUpdate(cur, r, { weight: 55 }, () => kg => Math.round(kg / 2.5) * 2.5);
        seq.push(M.W.tapSetNum(cur, r), M.W.isJustDone(cur, r), M.W.pointerIndex(cur), M.W.pointerSeam(cur), M.W.nextPendingRow(cur));
        cur = M.W.applySetUpdate(cur, r, { reps: 9, holdFollow: true });
        cur = M.W.revertSet(cur, r);
      }
      const moved = flat.length > 1 ? M.W.moveSetToExercise(cur, flat[0], exs[exs.length - 1].id, () => true) : null;
      const grouped = M.W.groupExercises(cur, exs.slice(0, 2).map(e => e.id));
      return { cards, rows, flat, seq, final: cur, moved, grouped, split: M.W.splitGroup(grouped, grouped[0]?.altGroup), normalized: M.W.normalizeGroups(cur), abbrs: M.W.memberAbbrs(exs.map(e => e.name)), stripped: cur.flatMap(e => e.sets.map(M.W.stripWorkbenchSet)) };
    });
  }
  await record('FR.mergeLocalWithRemote', () => M.FR.mergeLocalWithRemote(LOCAL, REMOTE));
  await record('FR.mergeLocalWithRemote.rev', () => M.FR.mergeLocalWithRemote(REMOTE, LOCAL));
  await record('FR.mergeFitlogPrefs.newerRemote', () => M.FR.mergeFitlogPrefs(PREFS(FIXED_NOW - 9e5), PREFS(FIXED_NOW)));
  await record('FR.mergeFitlogPrefs.empty', () => M.FR.mergeFitlogPrefs({ customTags: [], customExercises: [], exerciseNotes: {}, starredExercises: {}, exerciseMetricConfigs: {}, tagRenameOverrides: {}, exerciseOverrides: {}, starredLastUpdateMs: 0, metricsLastUpdateMs: 0 }, PREFS(FIXED_NOW)));
  await record('FR.prefsRoundTrip', () => { M.FR.writePrefsToLocalStorage(PREFS(FIXED_NOW)); return M.FR.readPrefsFromLocalStorage(); });
  await record('FR.mergeByIdPreferNewer', () => M.FR.mergeByIdPreferNewer(LOCAL.workouts, REMOTE.workouts, w => new RealDate(w.updatedAt ?? w.date).getTime()));
  await record('FT.flow', () => { M.FT.recordTombstone('workouts', 'w1'); M.FT.recordTombstone('goals', 'g9'); const t = M.FT.readTombstones(); return { t, merged: M.FT.mergeTombstoneSets(t, REMOTE.tombstones), filtered: M.FT.filterByTombstones(WORKOUTS, M.FT.tombstoneIdSet(t, 'workouts')) }; });
  await record('AP.flow', () => { M.AP.recordAppPrefs(M.AP.gymSavePatch('C馆', GYM_LB)); M.AP.recordAppPrefs(M.AP.keyedPatch('gymKinds', 'C馆|hammer', 'loaded')); M.AP.recordAppPrefs(M.AP.renameGymIn(M.AP.appPrefsNow(), 'C馆', 'D馆')); return { now: M.AP.appPrefsNow(), read: M.AP.readAppPrefs(), resolved: M.AP.resolveAppPrefs(undefined), merged: M.AP.mergeAppPrefs(APP_PREFS, FIXED_NOW, { gyms: { 'E馆': GYM_KG } }, FIXED_NOW + 1) }; });
  await record('NI.buildNameIndex', () => M.NI.buildNameIndex(M.CX.DEFAULT_EXERCISES, [DEF_C, DEF_D, { ...DEF_C, id: '1779000000002' }], { '1779000000002': { name: { cn: '曲肘蝴蝶机', en: 'Pec Deck' } } }));
  await record('PD.detectPRs', () => M.PD.detectPRs({ session: SESSION, history: WORKOUTS, editingWorkoutId: null, resolveName, getActiveMetrics: () => ['weight', 'reps'], unitLabel: 'kg', isSigned: ex => /引体/.test(ex.name), gymScoped: ex => /悍马|坐姿/.test(ex.name) }));
  await record('PD.detectPRs.lbs', () => M.PD.detectPRs({ session: SESSION, history: WORKOUTS, editingWorkoutId: null, resolveName, getActiveMetrics: () => ['weight'], unitLabel: 'lbs' }));
  await record('PR.findRecords', () => { const hist = WORKOUTS.flatMap(w => w.exercises.filter(e => e.name === '杠铃深蹲').flatMap(e => M.PR.prSetsOf(e, w.gym, false))); const cur = SESSION.exercises.flatMap(e => M.PR.prSetsOf(e, 'A馆', false)); return ['weight', 'e1rm', 'reps', 'volume'].map(rule => M.PR.findRecords(rule, hist, cur, 'A馆')); });
  await record('LH.flow', () => {
    const lifts = M.LH.buildLiftSummaries({ workouts: WORKOUTS, stableIdOf: ex => ex.name, liftKey: ex => `${ex.name}|${ex.variantId ?? ''}`, resolveName, signedLoadOf: ex => /引体/.test(ex.name), getActiveMetrics: () => ['weight', 'reps', 'duration'], gymScoped: ex => /悍马/.test(ex.name) });
    return lifts.map(l => ({ l, metrics: M.LH.chartMetricsFor(l, ['weight', 'reps']), trend: M.LH.trendPoints(l.sessions, 'weight'), e1: M.LH.trendPoints(l.sessions, 'e1rm'), pr: M.LH.prSessionIds(l.sessions, 'weight'), best: M.LH.bestAsOf(l, 'weight', FIXED_NOW - 864e5 * 5), feat: M.LH.featuredStats(l, 'weight'), featE: M.LH.featuredStats(l, 'e1rm') }));
  });
  await record('PF.findLastIn', () => CN_NAMES.map(n => M.PF.findLastIn(WORKOUTS, resolveName, ex => ex.variantId, n, null, 'w0', 'A馆', iso(3))));
  await record('HM.buildHeatmapDays', () => M.HM.buildHeatmapDays([...WORKOUTS, SESSION, { id: 'bad', date: 'garbage', exercises: null }], SESSION.id));
  await record('CI.strong', () => { const plan = M.CI.parseImportCsv(STRONG); const idx = M.NI.buildNameIndex(M.CX.DEFAULT_EXERCISES, [], {}); return { plan, r: M.CI.materialize(plan, { unitByExercise: Object.fromEntries(plan.exercises.filter(e => e.needsUnit).map(e => [e.srcName, 'lbs'])), includeWarmups: false, isCn: true, userId: 'u_solo', defs: M.CX.DEFAULT_EXERCISES, findByName: n => idx.get(n.trim()) }), prev: M.CI.previewMatches(plan, M.CX.DEFAULT_EXERCISES, n => idx.get(n.trim())) }; });
  await record('CI.hevy', () => { const plan = M.CI.parseImportCsv(HEVY); const idx = M.NI.buildNameIndex(M.CX.DEFAULT_EXERCISES, [], {}); return { plan, r: M.CI.materialize(plan, { unitByExercise: {}, includeWarmups: true, isCn: false, userId: 'u_solo', defs: M.CX.DEFAULT_EXERCISES, findByName: n => idx.get(n.trim()) }) }; });
  await record('CE.buildWorkoutsCsv', () => M.CE.buildWorkoutsCsv(WORKOUTS, { isCn: true, resolveName, bodyPartOf: () => '胸', regionsOf: n => (n.includes('卧推') ? '上胸 / 中胸' : ''), fallbackUnit: 'kg' }));
  await record('CE.buildWorkoutsCsv.en', () => M.CE.buildWorkoutsCsv(WORKOUTS.slice(0, 5), { isCn: false, resolveName, bodyPartOf: () => '', regionsOf: () => '', fallbackUnit: 'lbs' }));
  await record('FB.parse', () => [BACKUP_V2, BACKUP_LEGACY, '{}', 'x', '{"snapshot":{}}'].map(t => { try { const p = M.FB.parseBackupFile(t); return { p, last: M.FB.lastWorkoutDate(p) }; } catch (e) { return { err: String(e?.message ?? e), code: e?.code }; } }));
  await record('FB.asAuthoritative', () => M.FB.asAuthoritative(REMOTE, LOCAL));
  await record('AB.names', () => { const n = M.AB.autoBackupName(new RealDate(FIXED_NOW), 'prod'); return { n, parsed: M.AB.parseAutoBackupName({ name: n, uri: 'u' }), sel: M.AB.selectBackupsToDelete(POOLS.files[0], new RealDate(FIXED_NOW), 'prod'), fp: M.AB.snapshotFingerprint({ app: 'fitlog', formatVersion: 2, exportedAt: iso(1), snapshot: LOCAL }), verify: [BACKUP_V2, BACKUP_LEGACY, '{}'].map(x => { try { return M.AB.verifyReadBack(JSON.parse(BACKUP_V2), x); } catch (e) { return { err: String(e?.message ?? e) }; } }) }; });
  await record('SF.trackScrub', () => { let t = { x0: 0, c0: 0, x: 0, acc: 0, engaged: false }; const log = []; for (const [p, c] of [[5, 1], [19, 2], [21, 3], [31, 3], [52, 4], [60, 30], [40, 4], [10, 2]]) { const r = M.SF.trackScrub(t, p, c, 10); t = r.t; log.push(r); } return log; });
  await record('ES.search', () => { const entries = CN_NAMES.map((n, i) => M.ES.buildSearchEntry(n, ['bench press', 'db bench', 'squat', 'deadlift', 'pull up', 'lat pulldown', 'chest press', 'kb swing', 'custom', 'hammer press'][i], ['杠铃'])); return STRS.map(q => { const toks = M.ES.tokenize(q); return entries.map(e => M.ES.scoreEntry(e, toks)); }); });
  await record('EO.mergeOverride', () => [undefined, { name: { cn: '深蹲' } }, { regions: ['subQuad'], variants: [{ id: 'v1', name: { cn: '宽', en: 'wide' } }] }].map(o => M.EO.mergeOverride(DEF_D, o)));
  await record('CT.migrateCableTags', () => M.CT.migrateCableTags(PREFS(FIXED_NOW)));
  await record('LD.format', () => METRICS.flatMap(m => UNITS.flatMap(u => NUMS.slice(0, 12).map(v => [M.LD.formatMetric(m, v, u), M.LD.toDisplay(m, v, u), M.LD.metricUnit(m, u), M.LD.formatShown(m, v)]))));
  await record('D.week', () => { const outs = []; for (const ws of ['mon', 'sun']) { mem.set('dev:fitlog_app_prefs', JSON.stringify({ appPrefs: { ...APP_PREFS, weekStart: ws }, appPrefsUpdatedMs: 1 })); M.AP.invalidateAppPrefsCache?.(); outs.push({ ws, idx: [0, 1, 2, 3, 4, 5, 6].map(i => M.D.dayOfWeekIndex(new RealDate(2026, 9, 19 + i))), rot: M.D.rotateWeekdays(['日', '一', '二', '三', '四', '五', '六']), first: M.D.getFirstDayOfMonth(9, 2026) }); } return outs; });
  await record('WS.weight', () => { const entries = [40, 30, 10, 3, 0].map((d, i) => ({ id: `e${i}`, date: iso(d), weight: 70 + i })); return { base: M.WS.weightBaseline(entries), delta: M.WS.weightDelta(entries) }; });
  // 交替组行序：lastDone 落在不同成员上，待做行的轮换起点必须跟着变
  const altCases = [
    [[{ seq: 1 }, { ghost: true }], [{ seq: 2 }, { ghost: true }]],
    [[{ seq: 5 }, { ghost: true }, { ghost: true }], [{ seq: 2 }, { seq: 3 }, { ghost: true }], [{ seq: 4 }, { ghost: true }]],
    [[{}, { ghost: true }], [{ seq: 9 }, { ghost: true }], [{}, {}, { ghost: true }]],
    [[{ ghost: true }], [{ ghost: true }, { ghost: true }]],
    [[{ seq: 3 }, { seq: 1 }], [{ seq: 2 }]],
  ];
  for (const [ci, members] of altCases.entries()) {
    const exs = members.map((sets, mi) => ({ id: 'alt' + mi, name: CN_NAMES[mi], category: 'STRENGTH', altGroup: 'alt_c' + ci, sets: sets.map((s, k) => ({ id: 'a' + mi + '_' + k, weight: 40 + k, reps: 8, ...s })) }));
    await record('W.cardRows.alt[' + ci + ']', () => {
      const cards = M.W.buildCards(exs);
      const rows = cards.map(c => M.W.cardRows(c, exs));
      const flat = M.W.flatRows(exs);
      const taps = flat.map(r => M.W.tapSetNum(exs, r));
      const next = M.W.nextPendingRow(exs);
      let cur = exs; const walk = [];
      for (let i = 0; i < 6; i++) { const r = M.W.nextPendingRow(cur); if (!r) break; walk.push(r); cur = M.W.applySetUpdate(cur, r, { weight: 50 }); }
      return { cards, rows, flat, taps, next, walk, pointer: M.W.pointerIndex(exs), seam: M.W.pointerSeam(exs), moved: M.W.movePointerTo(exs, cards[0].key, 1) };
    });
  }
  return out;
}
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h >>> 0; }

// ───────────────────────── 6. 跑两边、比 ─────────────────────────
const outA = await bundle(tree(treeA), 'A');
const outB = await bundle(tree(treeB), 'B');
const MA = await import(pathToFileURL(outA).href);
const MB = await import(pathToFileURL(outB).href);
const RA = await runProbes(MA);
const RB = await runProbes(MB);
const keys = new Set([...Object.keys(RA), ...Object.keys(RB)]);
let diffs = 0, errBoth = 0;
const report = [], removed = new Set(), added = new Set();
for (const k of [...keys].sort()) {
  const fn = k.replace(/[#:].*$/, '');
  if (!(k in RB)) { removed.add(fn); continue; }
  if (!(k in RA)) { added.add(fn); continue; }
  const a = JSON.stringify(RA[k]), b = JSON.stringify(RB[k]);
  if (RA[k]?.res?.__err && RB[k]?.res?.__err) errBoth++;
  // 定向探针直接调了一个在 B 里不再导出的函数：归到「去掉的导出」，不算行为差异
  if (!RA[k]?.res?.__err && /is not a function/.test(RB[k]?.res?.__err ?? '')) { removed.add(k + ' (定向探针调了已不导出的函数)'); continue; }
  if (a !== b) {
    diffs++;
    if (report.length < 40) report.push(`~ ${k}\n    A: ${a?.slice(0, 300)}\n    B: ${b?.slice(0, 300)}`);
  }
}
fs.writeFileSync(path.join(OUT, 'pure-A.json'), JSON.stringify(RA, null, 1));
fs.writeFileSync(path.join(OUT, 'pure-B.json'), JSON.stringify(RB, null, 1));
console.log(report.join('\n'));
if (removed.size) console.log(`B 里不再有的导出（应与本批删除清单一致）：${[...removed].join(', ')}`);
if (added.size) console.log(`B 里新增的导出：${[...added].join(', ')}`);
console.log(`== 探针 ${keys.size} 个（两边都抛错的 ${errBoth} 个）· 行为差异 ${diffs} 个 ==`);
process.exit(diffs === 0 ? 0 : 1);
