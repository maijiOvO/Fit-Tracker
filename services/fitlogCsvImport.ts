/**
 * 从 Strong / Hevy 导出的 CSV 搬家（设计见 docs/design-backup.md §0.2、§0.3、§6）。
 *
 * 两家都没有公开的格式文档，以下来自几个开源导入器（ryot、liftosaur、LiftShift）互相印证，仓库里还没有真实导出样本：
 *
 * Strong：安卓版用 `;` 分隔、iOS 版用 `,`。
 *   Date; Workout Name; Duration; Exercise Name; Set Order; Weight; Reps; Distance; Seconds; Notes; Workout Notes; RPE
 *   变体：Duration (sec) / Weight (kg) / Distance (m) / Distance (meters)；有的版本多 Weight Unit / Distance Unit 列。
 *   Set Order：数字 = 正式组，W 热身，F 力竭，D 递减；Rest Timer / Note 行不是组。
 *   **只有表头是裸的 Weight、又没有 Weight Unit 列时不知道单位** —— 这正是要按动作问用户的情形。
 *   Hevy 把这种文件一律当 kg 导，lb 用户的记录就全错了；做对本身就是卖点。
 *
 * Hevy：逗号分隔、带引号。
 *   title, start_time, end_time, description, exercise_title, superset_id, exercise_notes,
 *   set_index, set_type, weight_kg | weight_lbs, reps, distance_km | distance_miles, duration_seconds, rpe
 *   单位看表头，整份文件一个单位。start_time 形如「18 Oct 2025, 08:47」。superset_id 相同的动作记成交替组。
 *
 * 解析从严（审查 csv#6 / csv#7 / csv#8）：日期只认白名单格式、数字只认纯数字和千分位，读不懂的行和数不兜底成别的值，
 * 计数进 ImportPlan.skipped 给确认页报账。
 *
 * 这里全是纯函数：解析 → ImportPlan（给确认页看）→ materialize（按用户选的单位生成记录）→ planImportWrite（和本机比重叠）。
 * 写库在 fitlogBackup.addImportedRecords。
 */
import type { Exercise, ExerciseDefinition, ExerciseVariant, SetLog, SubSetLog, WorkoutSession } from '../types';
import { KG_PER_LB } from '../src/utils/plates';
import { DEFAULT_EXERCISES } from '../src/constants/exercises';
import { mergeOverride } from '../src/utils/exerciseOverride';
import { buildNameIndex, ownValue } from '../src/utils/nameIndex';
import { mergeNamesOf } from '../src/utils/exerciseMerge';
import { fnv1a } from '../src/utils/hash';
import { pad2 } from '../src/utils/format';
import { loadCapD } from '../src/utils/load';
import { normalizeGroups } from '../src/utils/workbench';
import { EQ_BAND, EQ_BARBELL, EQ_BODYWEIGHT, EQ_CABLE, EQ_DUMBBELL, EQ_KETTLEBELL, EQ_MACHINE, variantAttrs } from '../src/utils/exerciseAttrs';

export type ImportSource = 'strong' | 'hevy';
export type WeightUnit = 'kg' | 'lbs';

export class CsvImportError extends Error {
  constructor(public code: 'empty' | 'unknown-format' | 'no-rows' | 'bad-dates') {
    super(code);
  }
}

// ============ CSV ============

/**
 * RFC 4180（引号里可以有分隔符、换行、"" 转义），对别的软件另存过的文件放宽两处（审查 csv#6）：
 * - 引号只在字段开头才开始引用；引用里的 " 后面（跳过空格）紧跟分隔符、换行或文件尾才算收尾，否则当字面字符。
 *   原来字段中间一个没转义的 " 就开始引用、一路吞到下一个引号，后面几场全并进一个格子。
 * - 读到文件尾仍在引用里：那个开引号不是引用，回到它当字面字符重读。
 * 去掉 BOM，跳过空行。
 */
function parseCsv(text: string, delimiter: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const literal = new Set<number>();
  for (;;) {
    const r = scanCsv(s, delimiter, literal);
    if (Array.isArray(r)) return r;
    literal.add(r);
  }
}

/** 扫一遍；读到文件尾还在引用里时返回那个开引号的位置 */
function scanCsv(s: string, delimiter: string, literal: Set<number>): string[][] | number {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let atStart = true;
  let openAt = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (s[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        let j = i + 1;
        while (s[j] === ' ') j++;
        if (j >= s.length || s[j] === delimiter || s[j] === '\n' || s[j] === '\r') {
          quoted = false;
          i = j - 1;
        } else field += c;
      }
      continue;
    }
    if (c === '"' && atStart && !literal.has(i)) {
      quoted = true;
      openAt = i;
      atStart = false;
      continue;
    }
    atStart = false;
    if (c === delimiter) {
      row.push(field);
      field = '';
      atStart = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
      atStart = true;
    } else field += c;
  }
  if (quoted) return openAt;
  row.push(field);
  if (row.some(f => f !== '')) rows.push(row);
  return rows;
}

/** 表头那行（第一条非空行）里 `;` 比 `,` 多就是安卓版 Strong */
function detectDelimiter(text: string): string {
  const first = text.replace(/^﻿/, '').split(/\r?\n/).find(l => l.trim()) ?? '';
  const semi = (first.match(/;/g) ?? []).length;
  const comma = (first.match(/,/g) ?? []).length;
  return semi > comma ? ';' : ',';
}

// ============ 日期 ============

type DateOrder = 'dmy' | 'mdy';

/** date：解析出的时刻；wall：文件里写的年月日时分（yyyymmddTHHMM），算训练 id 用，不随设备时区变 */
interface ParsedDate {
  date: Date;
  wall: string;
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** 英文月份名或它的前缀（至少 3 个字母）：「Oct」「Sept」「October」；「Okt」认不出 */
function monthOf(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return null;
  const i = MONTH_NAMES.findIndex(m => m.startsWith(w));
  return i < 0 ? null : i + 1;
}

function hour24(h: number, ampm: string | undefined): number | null {
  if (!ampm) return h <= 23 ? h : null;
  if (h < 1 || h > 12) return null;
  return (h % 12) + (ampm.toUpperCase() === 'PM' ? 12 : 0);
}

/** 月 1–12、分秒 0–59，日按日历回读核对（31/02 不会滚成 3 月 3 日）；zoneMin = 文件写明的时区偏移 */
function dateOf(y: number, mo: number, d: number, h: number, mi: number, sec: number, zoneMin?: number): ParsedDate | null {
  if (mo < 1 || mo > 12 || d < 1 || mi > 59 || sec > 59) return null;
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return null;
  const date = zoneMin == null ? new Date(y, mo - 1, d, h, mi, sec) : new Date(Date.UTC(y, mo - 1, d, h, mi, sec) - zoneMin * 60000);
  return { date, wall: `${y}${pad2(mo)}${pad2(d)}T${pad2(h)}${pad2(mi)}` };
}

const TIME = String.raw`(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?`;
/** 2024-03-14 18:05:12 / 2024/3/14T18:05 / 带 Z 或 ±hh:mm 的 ISO */
const RE_YMD = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;
/** 14.03.2024 18:00 / 3/14/2024 6:05 PM / 14-3-24：日月顺序按整份文件定（dateOrderOf） */
const RE_NUM = new RegExp(String.raw`^(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2}),?(?:[ T]+${TIME})?$`, 'i');
/** 18 Oct 2025, 8:47 PM */
const RE_DMON = new RegExp(String.raw`^(\d{1,2})\s+([A-Za-z]+\.?)\s+(\d{4}),?\s+${TIME}$`, 'i');
/** Oct 18, 2025 8:47 AM */
const RE_MOND = new RegExp(String.raw`^([A-Za-z]+\.?)\s+(\d{1,2}),?\s+(\d{4}),?\s+${TIME}$`, 'i');

const zoneOf = (z: string | undefined): number | undefined => {
  if (!z) return undefined;
  if (/^z$/i.test(z)) return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(z)!;
  return (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]);
};

/**
 * 只认白名单格式，认不出返回 null（不交给 new Date(string) 兜底：它把 "0" 读成 2000 年、日 / 月读成月 / 日，审查 csv#6）。
 * order = null：这份文件里日在前、月在前两种都出现了，纯数字日期一律认不出。
 */
function parseDateCell(raw: string, order: DateOrder | null): ParsedDate | null {
  const s = raw.trim();
  let m = RE_YMD.exec(s);
  if (m) {
    const h = +(m[4] ?? 0);
    return h > 23 ? null : dateOf(+m[1], +m[2], +m[3], h, +(m[5] ?? 0), +(m[6] ?? 0), zoneOf(m[7]));
  }
  const time = (hh: string | undefined, mm: string | undefined, ss: string | undefined, ap: string | undefined) => {
    const h = hour24(+(hh ?? 0), ap);
    return h == null ? null : ([h, +(mm ?? 0), +(ss ?? 0)] as const);
  };
  if ((m = RE_NUM.exec(s))) {
    if (!order) return null;
    const [d, mo] = order === 'dmy' ? [+m[1], +m[3]] : [+m[3], +m[1]];
    const y = m[4].length === 2 ? 2000 + +m[4] : +m[4];
    const t = time(m[5], m[6], m[7], m[8]);
    return t && dateOf(y, mo, d, ...t);
  }
  if ((m = RE_DMON.exec(s))) {
    const mo = monthOf(m[2]);
    const t = time(m[4], m[5], m[6], m[7]);
    return mo && t ? dateOf(+m[3], mo, +m[1], ...t) : null;
  }
  if ((m = RE_MOND.exec(s))) {
    const mo = monthOf(m[1]);
    const t = time(m[4], m[5], m[6], m[7]);
    return mo && t ? dateOf(+m[3], mo, +m[2], ...t) : null;
  }
  return null;
}

/** 系统区域写日期时日在月前面（de、en-GB）还是后面（en-US、zh） */
function localeDateOrder(): DateOrder {
  const parts = new Intl.DateTimeFormat().formatToParts(new Date(2000, 10, 22));
  return parts.findIndex(p => p.type === 'day') < parts.findIndex(p => p.type === 'month') ? 'dmy' : 'mdy';
}

/**
 * 纯数字日期的日月顺序按整份文件定：有一格第一段 > 12 → 日在前，第二段 > 12 → 月在前；两种都有 → null（这类格都认不出）；
 * 都没有（全是 ≤ 12 的）→ 按系统区域，guessed 标出来给确认页说一声。
 */
function dateOrderOf(cells: string[]): { order: DateOrder | null; guessed: boolean } {
  let dmy = false;
  let mdy = false;
  let numeric = false;
  for (const c of cells) {
    const m = RE_NUM.exec(c.trim());
    if (!m) continue;
    numeric = true;
    if (+m[1] > 12) dmy = true;
    if (+m[3] > 12) mdy = true;
  }
  if (dmy && mdy) return { order: null, guessed: false };
  if (dmy || mdy) return { order: dmy ? 'dmy' : 'mdy', guessed: false };
  return { order: localeDateOrder(), guessed: numeric };
}

// ============ 数字 ============

/** 小数点是 . 还是 ,；null = 这份文件两种都见到了 */
type Decimal = '.' | ',' | null;

interface NumCtx {
  dec: Decimal;
  /** dec 是按分隔符猜的（文件里没有能说明小数符号的数） */
  guessed: boolean;
  /** 读不懂的格数 */
  bad: number;
  /** 按猜的小数符号读的「1,000 / 1.000」个数 */
  ambiguous: number;
}

const MIXED_POINT = /^-?[1-9]\d{0,2}(?:,\d{3})+\.\d+$/;
const MIXED_COMMA = /^-?[1-9]\d{0,2}(?:\.\d{3})+,\d+$/;
const THOUSANDS = /^-?[1-9]\d{0,2}(?:(,)\d{3})+$|^-?[1-9]\d{0,2}(?:(\.)\d{3})+$/;
const SIMPLE = /^-?\d+([.,])\d+$/;

/** 见到 22.5、1,234.5 → 点；22,5、1.234,5 → 逗号；都没见到 → 分号文件按逗号、逗号文件按点（guessed） */
function decimalOf(cells: string[], delimiter: string): Pick<NumCtx, 'dec' | 'guessed'> {
  let point = false;
  let comma = false;
  for (const raw of cells) {
    const c = raw.trim();
    if (MIXED_POINT.test(c)) point = true;
    else if (MIXED_COMMA.test(c)) comma = true;
    else if (!THOUSANDS.test(c)) {
      const m = SIMPLE.exec(c);
      if (m?.[1] === '.') point = true;
      else if (m) comma = true;
    }
  }
  if (point && comma) return { dec: null, guessed: false };
  if (point || comma) return { dec: point ? '.' : ',', guessed: false };
  return { dec: delimiter === ';' ? ',' : '.', guessed: true };
}

/**
 * 只认 -12、22.5 / 22,5 和千分位形态（审查 csv#7）。0x10、1e3、「100 kg」、Infinity 原来经 Number 读成 16、1000、丢掉单位，
 * 现在一律 null 并计入 ctx.bad。「1,000」只有一个分隔符、正好三位，按整份文件的小数符号读。
 */
function readNum(v: string | undefined, ctx: NumCtx): number | null {
  const t = (v ?? '').trim();
  if (!t) return null;
  if (/^-?\d+$/.test(t)) return Number(t);
  if (MIXED_POINT.test(t)) return Number(t.replace(/,/g, ''));
  if (MIXED_COMMA.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  const th = THOUSANDS.exec(t);
  if (th) {
    const sep = th[1] ?? th[2];
    if (t.split(sep).length > 2) {
      // 1,000,000：只能是千分位
      if (ctx.dec !== sep) return Number(t.split(sep).join(''));
    } else if (ctx.dec) {
      if (ctx.guessed) ctx.ambiguous++;
      return Number(sep === ctx.dec ? t.replace(sep, '.') : t.replace(sep, ''));
    }
    ctx.bad++;
    return null;
  }
  if (SIMPLE.test(t)) return Number(t.replace(',', '.'));
  ctx.bad++;
  return null;
}

// ============ 中间结构 ============

export type DraftSetType = 'normal' | 'warmup' | 'failure' | 'drop';

export interface DraftSet {
  type: DraftSetType;
  /** 文件里的原值（单位见 unit / 计划级单位） */
  weight: number | null;
  /** 行上自带的单位（Strong 的 Weight Unit 列）；null = 看整份文件 / 用户选择 */
  unit: WeightUnit | null;
  reps: number | null;
  seconds: number | null;
  /** 已换算成 km */
  distanceKm: number | null;
  rpe: number | null;
  note: string;
}

export interface DraftExercise {
  srcName: string;
  notes: string[];
  sets: DraftSet[];
  /** Hevy 的 superset_id；同名动作几块的 superset_id 不一致时记 'mixed'，不成组 */
  supersetId: string | null | 'mixed';
}

export interface DraftWorkout {
  /** 同场归组的键：时间原文 + 标题 */
  key: string;
  /** 训练 id（finish 里按墙上时间排好）：imp_来源_yyyymmddTHHMM，同一分钟的第二场起加 _2、_3 */
  id: string;
  /** 文件里写的开始时间（年月日时分），id 用 */
  wall: string;
  title: string;
  start: Date;
  end: Date | null;
  notes: string;
  exercises: DraftExercise[];
}

export interface ExerciseSummary {
  srcName: string;
  sets: number;
  /** 最重那一组的原值，给确认页「最重 225」用；比较「最重」时先换算成 kg（单位未知的按原值比） */
  maxWeight: number;
  /** 最重那一组的单位；不知道为 null（确认页就不标单位） */
  maxUnit: WeightUnit | null;
  /** 文件没告诉我们单位、又有重量 —— 确认页要让用户选 */
  needsUnit: boolean;
}

export interface ImportSkipped {
  /** 日期认不出的行 */
  date: number;
  /** 列数多于表头、缺日期 / 动作名 / 组序的行 */
  malformed: number;
  /** 读不懂的数（这一格按空导） */
  numbers: number;
}

export interface ImportPlan {
  source: ImportSource;
  /** 整份文件的单位；null = 文件没写，要按动作问 */
  fileUnit: WeightUnit | null;
  workouts: DraftWorkout[];
  /** 含热身组的汇总（单位开关按它）；确认页的动作列表用 previewMatches 按热身开关另算 */
  exercises: ExerciseSummary[];
  warmupSets: number;
  skipped: ImportSkipped;
  /** 看着像重量 / 距离 / 时长、但没有导的列（表头原文） */
  ignoredColumns: string[];
  /** 纯数字日期全是 ≤ 12 的，日月顺序按系统区域猜的 */
  dateOrderGuessed: DateOrder | null;
  /** 文件里没有能说明小数符号的数，「1,000」这类按分隔符猜着读的个数 */
  ambiguousNumbers: number;
}

// ============ 识别与解析 ============

const norm = (h: string) => h.trim().toLowerCase();

interface Parsed {
  workouts: DraftWorkout[];
  fileUnit: WeightUnit | null;
  skipped: ImportSkipped;
  ignoredColumns: string[];
  dateOrderGuessed: DateOrder | null;
  ambiguousNumbers: number;
}

export function parseImportCsv(text: string): ImportPlan {
  if (!text.trim()) throw new CsvImportError('empty');
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, delimiter);
  if (rows.length < 2) throw new CsvImportError('no-rows');
  const header = rows[0].map(norm);
  const has = (h: string) => header.includes(h);
  if (has('exercise_title') && has('set_type') && has('start_time')) return finish('hevy', parseHevy(rows[0], rows.slice(1), delimiter));
  if (has('exercise name') && has('set order') && has('date')) return finish('strong', parseStrong(rows[0], rows.slice(1), delimiter));
  throw new CsvImportError('unknown-format');
}

/** 按热身开关汇总每个外来动作（0 组的不列） */
function summarize(workouts: DraftWorkout[], fileUnit: WeightUnit | null, includeWarmups: boolean): ExerciseSummary[] {
  const byName = new Map<string, ExerciseSummary>();
  const maxKg = new Map<string, number>();
  for (const w of workouts) {
    for (const e of w.exercises) {
      const s = byName.get(e.srcName) ?? { srcName: e.srcName, sets: 0, maxWeight: 0, maxUnit: null, needsUnit: false };
      for (const set of e.sets) {
        if (set.type === 'warmup' && !includeWarmups) continue;
        s.sets++;
        const u = set.unit ?? fileUnit;
        if (set.weight != null) {
          const kg = u === 'lbs' ? set.weight * KG_PER_LB : set.weight;
          if (kg > (maxKg.get(e.srcName) ?? 0)) {
            maxKg.set(e.srcName, kg);
            s.maxWeight = set.weight;
            s.maxUnit = u;
          }
        }
        if (set.weight && !u) s.needsUnit = true;
      }
      byName.set(e.srcName, s);
    }
  }
  return [...byName.values()].filter(s => s.sets > 0).sort((a, b) => b.sets - a.sets);
}

function finish(source: ImportSource, d: Parsed): ImportPlan {
  const workouts = d.workouts.filter(w => w.exercises.some(e => e.sets.length)).sort((a, b) => a.start.getTime() - b.start.getTime());
  if (!workouts.length) throw new CsvImportError(d.skipped.date ? 'bad-dates' : 'no-rows');
  // id 只看文件里写的开始时间（到分钟），不带标题、不经哈希（审查 csv#3 / csv#4）：原来「日期原文 + 标题」的 32 位哈希会撞号，
  // 来源里改了标题、Excel 另存换了日期写法就变成另一场
  const seen = new Map<string, number>();
  for (const w of workouts) {
    const base = `imp_${source}_${w.wall}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    w.id = n === 1 ? base : `${base}_${n}`;
  }
  return {
    source,
    fileUnit: d.fileUnit,
    workouts,
    exercises: summarize(workouts, d.fileUnit, true),
    warmupSets: workouts.reduce((n, w) => n + w.exercises.reduce((m, e) => m + e.sets.filter(s => s.type === 'warmup').length, 0), 0),
    skipped: d.skipped,
    ignoredColumns: d.ignoredColumns,
    dateOrderGuessed: d.dateOrderGuessed,
    ambiguousNumbers: d.ambiguousNumbers,
  };
}

/** Strong 的 Duration：「1h 5m」「45m」「30s」或纯秒数 */
function parseDurationText(s: string | undefined): number | null {
  if (!s) return null;
  const t = s.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  let sec = 0;
  let hit = false;
  for (const [, n, u] of t.matchAll(/(\d+)\s*([hms])/gi)) {
    hit = true;
    sec += Number(n) * (u.toLowerCase() === 'h' ? 3600 : u.toLowerCase() === 'm' ? 60 : 1);
  }
  return hit ? sec : null;
}

function unitWord(s: string | undefined): WeightUnit | null {
  const t = (s ?? '').trim().toLowerCase();
  if (t === 'kg' || t === 'kgs') return 'kg';
  if (t === 'lb' || t === 'lbs') return 'lbs';
  return null;
}

type DistUnit = 'm' | 'km' | 'mi';
const KM_PER: Record<DistUnit, number> = { m: 0.001, km: 1, mi: 1.609344 };

function distUnitWord(s: string): DistUnit | null {
  const t = s.trim().toLowerCase();
  if (['m', 'meter', 'meters', 'metre', 'metres'].includes(t)) return 'm';
  if (['km', 'kms', 'kilometer', 'kilometers', 'kilometre', 'kilometres'].includes(t)) return 'km';
  if (['mi', 'mile', 'miles'].includes(t)) return 'mi';
  return null;
}

/** 看着像重量 / 距离 / 时长、但没被任何字段认领的列（表头原文） */
function unclaimed(raw: string[], header: string[], claimed: number[]): string[] {
  return header.flatMap((h, i) => (/^(weight|distance|duration|seconds)/.test(h) && !claimed.includes(i) ? [raw[i].trim()] : []));
}

/** 列数多于表头（多出来的格有字）—— 多半是引号没配对，整行不可信 */
const tooWide = (r: string[], width: number) => r.length > width && r.slice(width).some(f => f.trim());

const emptySkipped = (): ImportSkipped => ({ date: 0, malformed: 0, numbers: 0 });

/** 同名动作接着上一块、或并回这一场里已有的同名块 */
function exerciseIn(w: DraftWorkout, exName: string, supersetId: string | null): DraftExercise {
  let ex = w.exercises[w.exercises.length - 1];
  if (!ex || ex.srcName !== exName) {
    ex = w.exercises.find(e => e.srcName === exName) ?? { srcName: exName, notes: [], sets: [], supersetId };
    if (!w.exercises.includes(ex)) w.exercises.push(ex);
  }
  if (ex.supersetId !== supersetId) ex.supersetId = 'mixed';
  return ex;
}

function parseStrong(raw: string[], rows: string[][], delimiter: string): Parsed {
  const header = raw.map(norm);
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iDate = col('date');
  const iName = col('workout name');
  const iDur = col('duration', 'duration (sec)', 'workout duration');
  const durIsSec = header[iDur] === 'duration (sec)';
  const iEx = col('exercise name');
  const iOrder = col('set order');
  const iW = col('weight', 'weight (kg)', 'weight (lbs)', 'weight (lb)');
  const iWUnit = col('weight unit');
  const iReps = col('reps');
  // 距离列认第一个 distance 开头的（Distance、Distance (m)、Distance (meters)…）；括号里的单位认不出就整列不导（审查 csv#8）
  const iDistAny = header.findIndex(h => h.startsWith('distance') && h !== 'distance unit');
  const distParen = /\(([^)]*)\)/.exec(header[iDistAny] ?? '')?.[1];
  const distHeaderUnit = distParen == null ? null : distUnitWord(distParen);
  const iDist = distParen != null && !distHeaderUnit ? -1 : iDistAny;
  const iDistUnit = col('distance unit');
  const iSec = col('seconds');
  const iNotes = col('notes');
  const iWNotes = col('workout notes');
  const iRpe = col('rpe');

  const wHeader = header[iW] ?? '';
  let fileUnit: WeightUnit | null = /\(kg\)/.test(wHeader) ? 'kg' : /\(lbs?\)/.test(wHeader) ? 'lbs' : null;

  const numCols = [iW, iReps, iDist, iSec, iRpe, ...(durIsSec ? [iDur] : [])].filter(i => i >= 0);
  const ctx: NumCtx = { ...decimalOf(rows.flatMap(r => numCols.map(i => r[i] ?? '')), delimiter), bad: 0, ambiguous: 0 };
  const { order: dateOrder, guessed } = dateOrderOf(rows.map(r => r[iDate] ?? ''));
  const skipped = emptySkipped();

  const byKey = new Map<string, DraftWorkout>();
  for (const r of rows) {
    if (tooWide(r, raw.length)) {
      skipped.malformed++;
      continue;
    }
    const order = (r[iOrder] ?? '').trim();
    if (/^rest timer$/i.test(order) || /^note$/i.test(order)) continue;
    const dateRaw = (r[iDate] ?? '').trim();
    const exName = (r[iEx] ?? '').trim();
    if (!order || !dateRaw || !exName) {
      skipped.malformed++;
      continue;
    }
    const start = parseDateCell(dateRaw, dateOrder);
    if (!start) {
      skipped.date++;
      continue;
    }
    const title = (r[iName] ?? '').trim();
    const key = `${dateRaw}|${title}`;
    let w = byKey.get(key);
    if (!w) {
      const dur = durIsSec ? readNum(r[iDur], ctx) : parseDurationText(r[iDur]);
      w = {
        key,
        id: '',
        wall: start.wall,
        title,
        start: start.date,
        end: dur ? new Date(start.date.getTime() + dur * 1000) : null,
        notes: (r[iWNotes] ?? '').trim(),
        exercises: [],
      };
      byKey.set(key, w);
    }
    const ex = exerciseIn(w, exName, null);
    const type: DraftSetType = /^w$/i.test(order) ? 'warmup' : /^f$/i.test(order) ? 'failure' : /^d$/i.test(order) ? 'drop' : 'normal';
    let distKm = iDist >= 0 ? readNum(r[iDist], ctx) : null;
    if (distKm != null) {
      // 行上的 Distance Unit 优先，再看表头括号，都没有按 Strong 的默认（米）
      const du = (r[iDistUnit] ?? '').trim();
      const u = du ? distUnitWord(du) : (distHeaderUnit ?? 'm');
      if (u) distKm *= KM_PER[u];
      else {
        skipped.numbers++;
        distKm = null;
      }
    }
    ex.sets.push({
      type,
      weight: readNum(r[iW], ctx),
      unit: unitWord(r[iWUnit]),
      reps: readNum(r[iReps], ctx),
      seconds: readNum(r[iSec], ctx),
      distanceKm: distKm,
      rpe: readNum(r[iRpe], ctx),
      note: (r[iNotes] ?? '').trim(),
    });
  }
  const workouts = [...byKey.values()];
  // Weight Unit 列：每个带重量的行都写了同一个单位，就是整份文件的单位（审查 csv#5）；有一行没写或混着写，仍按行 / 按动作问
  if (!fileUnit && iWUnit >= 0) {
    const units = workouts.flatMap(w => w.exercises.flatMap(e => e.sets.filter(s => s.weight).map(s => s.unit)));
    if (units.length && units[0] && units.every(u => u === units[0])) fileUnit = units[0];
  }
  return {
    workouts,
    fileUnit,
    skipped: { ...skipped, numbers: skipped.numbers + ctx.bad },
    ignoredColumns: unclaimed(raw, header, [iDur, iW, iWUnit, iDist, iDistUnit, iSec]),
    dateOrderGuessed: guessed ? dateOrder : null,
    ambiguousNumbers: ctx.ambiguous,
  };
}

function parseHevy(raw: string[], rows: string[][], delimiter: string): Parsed {
  const header = raw.map(norm);
  const i = (n: string) => header.indexOf(n);
  const iTitle = i('title');
  const iStart = i('start_time');
  const iEnd = i('end_time');
  const iDesc = i('description');
  const iEx = i('exercise_title');
  const iSuperset = i('superset_id');
  const iExNotes = i('exercise_notes');
  const iType = i('set_type');
  const iKg = i('weight_kg');
  const iLb = i('weight_lbs');
  const iReps = i('reps');
  const iKm = i('distance_km');
  const iMi = i('distance_miles');
  const iSec = i('duration_seconds');
  const iRpe = i('rpe');
  const fileUnit: WeightUnit = iLb >= 0 && iKg < 0 ? 'lbs' : 'kg';
  const iW = fileUnit === 'lbs' ? iLb : iKg;

  const numCols = [iW, iReps, iKm, iMi, iSec, iRpe].filter(c => c >= 0);
  const ctx: NumCtx = { ...decimalOf(rows.flatMap(r => numCols.map(c => r[c] ?? '')), delimiter), bad: 0, ambiguous: 0 };
  const { order: dateOrder, guessed } = dateOrderOf(rows.flatMap(r => [r[iStart] ?? '', r[iEnd] ?? '']));
  const skipped = emptySkipped();

  const byKey = new Map<string, DraftWorkout>();
  for (const r of rows) {
    const startRaw = (r[iStart] ?? '').trim();
    const exName = (r[iEx] ?? '').trim();
    const t = (r[iType] ?? '').trim().toLowerCase();
    if (tooWide(r, raw.length) || !startRaw || !exName || !t) {
      skipped.malformed++;
      continue;
    }
    const start = parseDateCell(startRaw, dateOrder);
    if (!start) {
      skipped.date++;
      continue;
    }
    const title = (r[iTitle] ?? '').trim();
    const key = `${startRaw}|${title}`;
    let w = byKey.get(key);
    if (!w) {
      const end = parseDateCell(r[iEnd] ?? '', dateOrder)?.date ?? null;
      w = { key, id: '', wall: start.wall, title, start: start.date, end, notes: (r[iDesc] ?? '').trim(), exercises: [] };
      byKey.set(key, w);
    }
    const ex = exerciseIn(w, exName, (r[iSuperset] ?? '').trim() || null);
    const exNote = (r[iExNotes] ?? '').trim();
    if (exNote && !ex.notes.includes(exNote)) ex.notes.push(exNote);
    const type: DraftSetType = t === 'warmup' ? 'warmup' : t === 'failure' ? 'failure' : t === 'dropset' ? 'drop' : 'normal';
    const km = iKm >= 0 ? readNum(r[iKm], ctx) : null;
    const mi = iMi >= 0 ? readNum(r[iMi], ctx) : null;
    ex.sets.push({
      type,
      weight: readNum(r[iW], ctx),
      unit: null,
      reps: readNum(r[iReps], ctx),
      seconds: readNum(r[iSec], ctx),
      distanceKm: km ?? (mi != null ? mi * KM_PER.mi : null),
      rpe: readNum(r[iRpe], ctx),
      note: '',
    });
  }
  return {
    workouts: [...byKey.values()],
    fileUnit,
    skipped: { ...skipped, numbers: ctx.bad },
    ignoredColumns: unclaimed(raw, header, [iW, iKm, iMi, iSec]),
    dateOrderGuessed: guessed ? dateOrder : null,
    ambiguousNumbers: ctx.ambiguous,
  };
}

// ============ 动作名匹配 ============

/** Strong / Hevy 的器材后缀：「Bench Press (Barbell)」里括号那段 */
const EQUIP_WORDS: Record<string, string> = {
  barbell: 'barbell',
  dumbbell: 'dumbbell',
  cable: 'cable',
  machine: 'machine',
  'smith machine': 'smith',
  bodyweight: '',
  'assisted': 'assisted',
  band: 'band',
  kettlebell: 'kettlebell',
};

/** 两家常见、但按词对不上内置名的 —— 少量手工补 */
const KNOWN: Record<string, string> = {
  'squat (barbell)': 'sq_barbell',
  'deadlift (barbell)': 'dl_barbell',
  'overhead press (barbell)': 'ohp_barbell',
  'shoulder press (barbell)': 'ohp_barbell',
  'overhead press (dumbbell)': 'ohp_dumbbell',
  'shoulder press (dumbbell)': 'ohp_dumbbell',
  'shoulder press (machine)': 'press_machine_shoulder',
  'chest press (machine)': 'press_machine_chest',
  'bent over row (barbell)': 'row_barbell',
  'bicep curl (barbell)': 'cu_barbell',
  'bicep curl (dumbbell)': 'cu_dumbbell',
  'hammer curl (dumbbell)': 'cu_hammer',
  'triceps pushdown (cable - straight bar)': 'tricep_pushdown',
  'triceps pushdown': 'tricep_pushdown',
  'lat pulldown (cable)': 'lat_pulldown',
  'lat pulldown (machine)': 'lat_pulldown',
  'seated row (cable)': 'row_seated_cable',
  'seated cable row - v grip (cable)': 'row_seated_cable',
  'leg press (machine)': 'leg_press',
  'leg extension (machine)': 'leg_extension',
  'lying leg curl (machine)': 'leg_curl',
  'seated leg curl (machine)': 'leg_curl',
  'romanian deadlift (barbell)': 'romanian_deadlift',
  'lateral raise (dumbbell)': 'lat_raise_dumbbell',
  'face pull (cable)': 'face_pull_cable',
  'face pull': 'face_pull_cable',
  'push up': 'pushup',
  'pull up (weighted)': 'pu_weighted',
  'dumbbell row': 'single_arm_db_row',
  'bent over one arm row (dumbbell)': 'single_arm_db_row',
  'skullcrusher (barbell)': 'skull_crusher',
  'skull crusher (barbell)': 'skull_crusher',
  'running': 'run_out',
  'running (treadmill)': 'run_tread',
  'treadmill': 'run_tread',
  'cycling': 'bike_out',
  'cycling (indoor)': 'bike_stat',
  'rowing (machine)': 'rower',
  'stair machine': 'stair',
  'jump rope': 'rope',
  'cable crossover': 'fly_cable',
  'chest fly (cable)': 'fly_cable',
  'cable fly crossovers': 'fly_cable',
  'incline bench press (barbell)': 'bp_incline_barbell',
  'incline bench press (dumbbell)': 'bp_incline_dumbbell',
  'goblet squat (kettlebell)': 'goblet_squat',
  'goblet squat (dumbbell)': 'goblet_squat',
  'calf raise (machine)': 'calf_raise',
  'standing calf raise (machine)': 'calf_raise',
  'plank': 'plank',
  'hanging leg raise': 'leg_raise',
  't bar row': 'tbar_row',
  'preacher curl (barbell)': 'preacher_curl',
  'preacher curl (dumbbell)': 'preacher_curl',
};

function tokens(name: string): string {
  let n = name.toLowerCase();
  let equip = '';
  const m = /\(([^)]*)\)\s*$/.exec(n);
  if (m) {
    const e = m[1].trim();
    if (e in EQUIP_WORDS) {
      equip = EQUIP_WORDS[e];
      n = n.slice(0, m.index);
    }
  }
  // 留各种文字的字母 / 组合符号 / 数字（只留 a-z0-9 时中文名整段变空串，全撞成同一个）；
  // 其余标点删掉而不是换空格，否则 Farmers Walk 对不上 Farmer's Walk
  const words = `${n} ${equip}`
    .replace(/[-_/]/g, ' ')
    .replace(/[^\p{L}\p{M}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
  return [...new Set(words)].sort().join(' ');
}

/** 括号后缀 → 内置器材 id（KNOWN 命中后核对做法用）。smith machine / assisted 没有对应的内置器材，不列 */
const SUFFIX_EQUIP: Record<string, string> = {
  barbell: EQ_BARBELL,
  dumbbell: EQ_DUMBBELL,
  cable: EQ_CABLE,
  machine: EQ_MACHINE,
  kettlebell: EQ_KETTLEBELL,
  band: EQ_BAND,
  bodyweight: EQ_BODYWEIGHT,
};

const EQUIP_TOKENS = new Set(Object.values(EQUIP_WORDS).filter(Boolean));

interface ExerciseMatch {
  def: ExerciseDefinition;
  /** 括号里的器材和动作本身的不同、对上了同器材的做法 */
  variant?: ExerciseVariant;
}

/**
 * 外来动作名 → fitlog 的动作定义（+ 做法）。先看已有的名字（用户之前导入 / 自建过同名的），
 * 再看手工表：括号里的器材和动作本身的不同时，记到当前做法表里同器材的做法，没有这个做法就不用这条。
 * 最后按词集合比对内置英文名和曾用名。
 * 拿不准就返回 undefined（调用方新建自定义动作）：名字剥完没剩可比的（emoji），或只剩器材词（「卧推 (Barbell)」
 * 曾经只剩 barbell），都不比 —— 否则会和同样剥空的名字判成相等，全并进同一个动作。
 */
function matchExercise(
  srcName: string,
  defs: ExerciseDefinition[],
  findByName: (name: string) => ExerciseDefinition | undefined,
): ExerciseMatch | undefined {
  const direct = findByName(srcName);
  if (direct) return { def: direct };
  const known = KNOWN[srcName.trim().toLowerCase()];
  const d = known ? defs.find(x => x.id === known) : undefined;
  if (d) {
    const suffix = /\(([^)]*)\)\s*$/.exec(srcName.toLowerCase())?.[1].trim();
    const eq = suffix ? SUFFIX_EQUIP[suffix] : undefined;
    if (!eq || (d.equipment ?? '').toLowerCase() === eq.toLowerCase()) return { def: d };
    const variant = d.variants?.find(v => variantAttrs(v)?.equipment.toLowerCase() === eq.toLowerCase());
    if (variant) return { def: d, variant };
  }
  const t = tokens(srcName);
  if (!t || t.split(' ').every(w => EQUIP_TOKENS.has(w))) return undefined;
  const def = defs.find(x => tokens(x.name.en) === t || (x.aliases ?? []).some(a => tokens(a) === t));
  return def ? { def } : undefined;
}

/**
 * 导入时比对用的动作表和名字查找（审查 C33#6）。内置 + 自建，合上覆盖层（改过的器材、用户删 / 加的做法都按现状认），
 * 内置在前，和 ExercisePrefsContext 的名字索引一致。
 *
 * 已并入别处的动作照样在表里，只去掉「删掉且没并入」的：命中已并入的定义时写它自己的原名，
 * 读的时候名字别名照样把它解析到目标的那个做法上。原来先把它们排除、再按完整名字索引解析，
 * 并入之后再导同一份文件，已导入的记录名被改写成目标名、落进标准，或者另建一个重复动作 —— 拆回也救不回。
 * 名字查找同理：名字是经并入登记到目标上的（并入别名），返回被并入的那个定义本身。
 */
export function importLookup(
  customExercises: ExerciseDefinition[],
  exerciseOverrides: Record<string, Partial<ExerciseDefinition>>,
): { defs: ExerciseDefinition[]; findByName: (name: string) => ExerciseDefinition | undefined } {
  const all = [...DEFAULT_EXERCISES, ...customExercises];
  const index = buildNameIndex(DEFAULT_EXERCISES, customExercises, exerciseOverrides);
  const merged = all.filter(d => exerciseOverrides[d.id]?.mergedInto);
  const ownNames = (d: ExerciseDefinition) => {
    const m = mergeOverride(d, exerciseOverrides[d.id]);
    return [m.name.cn, m.name.en, ...(m.aliases ?? [])].map(n => (n || '').trim());
  };
  return {
    defs: all
      .filter(d => !(exerciseOverrides[d.id]?.hidden && !exerciseOverrides[d.id]?.mergedInto))
      .map(d => mergeOverride(d, exerciseOverrides[d.id])),
    findByName: name => {
      const n = (name || '').trim();
      const hit = index.get(n);
      if (!hit || !ownValue(exerciseOverrides[hit.id]?.variantAliases ?? hit.variantAliases, n)) return hit;
      // 连环并入（A→B→C）时 A 的名字也在 B 的别名表里：先认名字是它自己的那个
      return merged.find(d => ownNames(d).includes(n)) ?? merged.find(d => mergeNamesOf(mergeOverride(d, exerciseOverrides[d.id])).includes(n)) ?? hit;
    },
  };
}

// ============ 生成记录 ============

export interface MaterializeOptions {
  /** 文件没写单位时按动作选的单位（键是 srcName） */
  unitByExercise: Record<string, WeightUnit>;
  includeWarmups: boolean;
  /**
   * 超过手记上限（loadCapD：普通 500 kg / 1100 lb、带正负 ±300 kg）的组：'skip' 不导（确认页默认），'keep' 照导。
   * 和手记上限同一个理由：多一个 0 就是一条假纪录（2026-11-13 用户定的上限，审查 csv#7）
   */
  overCap: 'skip' | 'keep';
  isCn: boolean;
  userId: string;
  defs: ExerciseDefinition[];
  findByName: (name: string) => ExerciseDefinition | undefined;
}

export interface MaterializeResult {
  source: ImportSource;
  workouts: WorkoutSession[];
  /** 需要新建的自定义动作 */
  newDefs: ExerciseDefinition[];
  /**
   * 记录项种子（键是记录上的动作名）：新动作按整份文件出现过的字段；对上内置动作的，带了重量 × 次数以外的字段、
   * 或者对上的是有氧（回落值跟首选项走，不写就会在改首选项时被重读）也写（审查 csv#2 / gap-5#7）。
   * 写进本机之前要过 mergeImportSeeds：已配置的不动，本机有记录的保留当前那组
   */
  metricSeeds: Record<string, string[]>;
  sets: number;
  /** 超上限的组数（overCap 为 'skip' 时就是没导的那些） */
  overCapSets: number;
}

/** 确认页用：每个外来动作会落到哪（内置名 / 新建）；按热身开关只数能导入的组，0 组的动作不列（审查 C69） */
export function previewMatches(plan: ImportPlan, defs: ExerciseDefinition[], findByName: MaterializeOptions['findByName'], includeWarmups: boolean) {
  return summarize(plan.workouts, plan.fileUnit, includeWarmups).map(e => ({ ...e, ...matchExercise(e.srcName, defs, findByName) }));
}

/** 64 位：两遍 FNV-1a（第二遍前面垫一个字符，等于换了种子）拼起来，自建动作多了不撞号（审查 csv#4） */
const hash64 = (s: string) => fnv1a(s) + fnv1a(`\u0001${s}`);

export function materialize(plan: ImportPlan, o: MaterializeOptions): MaterializeResult {
  const now = new Date().toISOString();
  const newDefs = new Map<string, ExerciseDefinition>();
  // 没有原型：外来动作名是 constructor / __proto__ 也只是普通的键（上架审查 C09）
  const metricSeeds: Record<string, string[]> = Object.create(null);
  type Resolved = { name: string; category: string; variantId?: string; variantName?: string };
  const nameFor = new Map<string, Resolved>();
  let setCount = 0;
  let overCapSets = 0;

  const unitOf = (e: DraftExercise, s: DraftSet): WeightUnit => s.unit ?? plan.fileUnit ?? o.unitByExercise[e.srcName] ?? 'kg';
  const isOverCap = (e: DraftExercise, s: DraftSet) => Math.abs(s.weight ?? 0) > loadCapD(unitOf(e, s), (s.weight ?? 0) < 0);
  /** 这一组会不会写进去：不导的热身组、按 'skip' 丢掉的超上限组都不算 */
  const kept = (e: DraftExercise, s: DraftSet) => (o.includeWarmups || s.type !== 'warmup') && (o.overCap === 'keep' || !isOverCap(e, s));

  // 每个外来动作在整份文件里出现过哪些字段（只看会写进去的组）：新动作的类型和种子都按它，不只看第一场
  type Fields = { weight: boolean; reps: boolean; distance: boolean; duration: boolean };
  const fieldsOf = new Map<string, Fields>();
  for (const w of plan.workouts) {
    for (const e of w.exercises) {
      const f = fieldsOf.get(e.srcName) ?? { weight: false, reps: false, distance: false, duration: false };
      for (const s of e.sets) {
        if (!kept(e, s)) continue;
        f.weight ||= !!s.weight;
        f.reps ||= !!s.reps;
        f.distance ||= !!s.distanceKm;
        f.duration ||= !!s.seconds;
      }
      fieldsOf.set(e.srcName, f);
    }
  }
  const metricsIn = (f: Fields) => (['weight', 'reps', 'distance', 'duration'] as const).filter(k => f[k]);
  /** 记录上的动作名 → 字段（几个外来名对上同一个动作时取并集）和类型 */
  const seedFor = new Map<string, { metrics: Set<string>; category: string }>();

  const resolve = (src: string) => {
    const hit = nameFor.get(src);
    if (hit) return hit;
    const fields = fieldsOf.get(src) ?? { weight: false, reps: false, distance: false, duration: false };
    const m = matchExercise(src, o.defs, o.findByName);
    let r: Resolved;
    if (m) {
      const { def, variant } = m;
      r = { name: def.name[o.isCn ? 'cn' : 'en'] || def.name.en, category: def.category ?? 'STRENGTH' };
      if (variant) {
        r.variantId = variant.id;
        if (variant.name) r.variantName = variant.name;
      }
    } else {
      const cardio = !fields.weight && !fields.reps && (fields.duration || fields.distance);
      // id 按内容哈希：同一份文件导两次 id 相同，不重复建（已导入过的同名动作在上面按名字就命中了）
      const id = `imp_${hash64(plan.source + src)}`;
      newDefs.set(src, {
        id,
        name: { en: src, cn: src },
        bodyPart: 'subFullBody',
        tags: [],
        category: cardio ? 'CARDIO' : 'STRENGTH',
      });
      r = { name: src, category: cardio ? 'CARDIO' : 'STRENGTH' };
    }
    const seed = seedFor.get(r.name) ?? { metrics: new Set<string>(), category: r.category };
    for (const k of metricsIn(fields)) seed.metrics.add(k);
    seedFor.set(r.name, seed);
    nameFor.set(src, r);
    return r;
  };

  const workouts: WorkoutSession[] = plan.workouts.map(w => {
    const wid = w.id;
    const exercises: Exercise[] = [];
    const extra: string[] = [];
    w.exercises.forEach((e, ei) => {
      const sets: SetLog[] = [];
      const extraNotes: string[] = [...e.notes];
      e.sets.forEach((s, si) => {
        if (s.type === 'warmup' && !o.includeWarmups) return;
        if (isOverCap(e, s)) overCapSets++;
        if (!kept(e, s)) return;
        const unit = unitOf(e, s);
        const raw = s.weight ?? 0;
        const kg = Math.abs(raw) * (unit === 'lbs' ? KG_PER_LB : 1);
        const reps = Math.max(0, Math.round(s.reps ?? 0));
        const id = `${wid}_${ei}_${si}`;
        if (s.note) extraNotes.push(s.note);
        if (s.rpe != null) extraNotes.push(`${o.isCn ? '第' : 'Set '}${sets.length + 1}${o.isCn ? '组' : ''} RPE ${s.rpe}`);
        // 递减组挂到前一个正式组下面；前面没有组就当正式组
        if (s.type === 'drop' && sets.length) {
          const parent = sets[sets.length - 1];
          const sub: SubSetLog = { id, weight: kg, plateUnit: unit, reps };
          parent.subSets = [...(parent.subSets ?? []), sub];
          setCount++;
          return;
        }
        const set: SetLog = { id, weight: kg, reps };
        if (kg > 0) set.plateUnit = unit; // 有氧 / 自重组没有片子可言
        if (raw < 0) set.bodyweightMode = 'assisted';
        if (s.type === 'failure') set.toFailure = true;
        if (s.seconds) set.duration = s.seconds;
        if (s.distanceKm) {
          set.distance = Math.round(s.distanceKm * 1000) / 1000;
          set.distanceUnit = 'km';
        }
        sets.push(set);
        setCount++;
      });
      if (!sets.length) return;
      // 只给真正有组入库的动作建定义、种记录项（审查 C69：原来只有热身组的动作也新建了一个空动作）
      const { name, category, variantId, variantName } = resolve(e.srcName);
      const ss = e.supersetId && e.supersetId !== 'mixed' ? e.supersetId : null;
      exercises.push({
        id: `${wid}_${ei}`,
        name,
        category,
        ...(variantId ? { variantId, ...(variantName ? { variantName } : {}) } : {}),
        sets,
        exerciseTime: w.start.toISOString(),
        // Hevy 的超级组 → 交替组；组 id 带上训练 id，各场的 superset_id 0 不会串成一组（审查 gap-4#6）
        ...(ss ? { altGroup: `${wid}_ss${ss}` } : {}),
      });
      // fitlog 没有 RPE 和单组备注字段：原文并进这一场的备注，不丢
      if (extraNotes.length) extra.push(`${name}: ${extraNotes.join('; ')}`);
    });
    const notes = [w.notes, ...extra].filter(Boolean).join('\n');
    const startIso = w.start.toISOString();
    const endIso = (w.end ?? w.start).toISOString();
    return {
      id: wid,
      userId: o.userId,
      date: startIso,
      title: w.title || (o.isCn ? '导入的训练' : 'Imported workout'),
      // 交替组成员挪到相邻；只剩一个成员的组（另一个的组全被跳过）拆掉
      exercises: normalizeGroups(exercises),
      ...(notes ? { notes } : {}),
      startTime: startIso,
      endTime: endIso,
      ...(w.end ? { duration: Math.round((w.end.getTime() - w.start.getTime()) / 1000) } : {}),
      createdAt: now,
      updatedAt: now,
      finishedAt: endIso,
      status: 'completed' as const,
    };
  });

  for (const [name, { metrics, category }] of seedFor) {
    const m = ['weight', 'reps', 'distance', 'duration'].filter(k => metrics.has(k));
    // 非有氧正好记重量 × 次数＝回落值，不写；有氧的回落值跟首选项，带什么都写
    if (m.length && (category === 'CARDIO' || !(m.length === 2 && m[0] === 'weight' && m[1] === 'reps'))) metricSeeds[name] = m;
  }

  return {
    source: plan.source,
    workouts: workouts.filter(w => w.exercises.length),
    newDefs: [...newDefs.values()],
    metricSeeds,
    sets: setCount,
    overCapSets,
  };
}

/**
 * 导入的训练和本机比重叠（审查 csv#3）。「以前导入过」满足任一条：
 * - 本机有同 id 的；
 * - 本机有 imp_来源_ 开头、startTime 完全相同的 —— 认旧版的 32 位哈希 id，也认来源里改过标题的；
 * - id 在墓碑里（用户删过的导入训练）。
 * 'skip'（确认页默认）：以前导入过的不写，App 里改过的那场不被文件盖掉、删过的不被捞回来；
 * 'replace'：写文件里的版本，replaceIds 是要一并删掉的旧 id（不同 id、同一场），不出现两份。
 */
export function planImportWrite(
  incoming: WorkoutSession[],
  local: { workouts: WorkoutSession[]; tombstonedIds: string[] },
  source: ImportSource,
  mode: 'skip' | 'replace',
): { write: WorkoutSession[]; replaceIds: string[]; overlap: number } {
  const dead = new Set(local.tombstonedIds);
  const prefix = `imp_${source}_`;
  const write: WorkoutSession[] = [];
  const replaceIds = new Set<string>();
  let overlap = 0;
  for (const w of incoming) {
    const same = local.workouts.filter(x => x.id === w.id || (!!w.startTime && x.id.startsWith(prefix) && x.startTime === w.startTime));
    const seen = same.length > 0 || dead.has(w.id);
    if (seen) overlap++;
    if (seen && mode === 'skip') continue;
    write.push(w);
    for (const x of same) if (x.id !== w.id) replaceIds.add(x.id);
  }
  return { write, replaceIds: [...replaceIds], overlap };
}

/**
 * 导入的记录项种子和本机现状合并（ImportCsvModal 在写入前调）：
 * - 显示名已经配置过的丢掉 —— 另一种语言下的原键也算（configs 是按显示名归并过的）；
 * - 本机已有记录、没配置的，取此刻生效的那组和种子的并集：App 里按重量 × 次数记过平板支撑，再导入 Hevy 的时长，两列都留；
 * - 其余原样。
 * addImportedRecords 里按字面键「已有的盖住种子」是第二道。
 */
export function mergeImportSeeds(
  seeds: Record<string, string[]>,
  o: {
    resolveName: (name: string) => string;
    configs: Record<string, string[]>;
    recorded: Set<string>;
    activeOf: (name: string) => string[];
  },
): Record<string, string[]> {
  const out: Record<string, string[]> = Object.create(null);
  for (const [k, m] of Object.entries(seeds)) {
    const n = o.resolveName(k);
    if (Object.prototype.hasOwnProperty.call(o.configs, n)) continue;
    out[k] = o.recorded.has(n) ? [...new Set([...o.activeOf(n), ...m])] : m;
  }
  return out;
}
