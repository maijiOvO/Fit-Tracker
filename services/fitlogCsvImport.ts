/**
 * 从 Strong / Hevy 导出的 CSV 搬家（设计见 docs/design-backup.md §0.2、§0.3、§6）。
 *
 * 两家都没有公开的格式文档，以下来自几个开源导入器（ryot、liftosaur、LiftShift）互相印证：
 *
 * Strong：安卓版用 `;` 分隔、iOS 版用 `,`。
 *   Date; Workout Name; Duration; Exercise Name; Set Order; Weight; Reps; Distance; Seconds; Notes; Workout Notes; RPE
 *   变体：Duration (sec) / Weight (kg) / Distance (m)；有的版本多 Weight Unit / Distance Unit 列。
 *   Set Order：数字 = 正式组，W 热身，F 力竭，D 递减；Rest Timer / Note 行不是组。
 *   **只有表头是裸的 Weight、又没有 Weight Unit 列时不知道单位** —— 这正是要按动作问用户的情形。
 *   Hevy 把这种文件一律当 kg 导，lb 用户的记录就全错了；做对本身就是卖点。
 *
 * Hevy：逗号分隔、带引号。
 *   title, start_time, end_time, description, exercise_title, superset_id, exercise_notes,
 *   set_index, set_type, weight_kg | weight_lbs, reps, distance_km | distance_miles, duration_seconds, rpe
 *   单位看表头，整份文件一个单位。start_time 形如「18 Oct 2025, 08:47」。
 *
 * 这里全是纯函数：解析 → ImportPlan（给确认页看）→ materialize（按用户选的单位生成记录）。写库在 hook 里。
 */
import type { Exercise, ExerciseDefinition, SetLog, SubSetLog, WorkoutSession } from '../types';
import { KG_PER_LB } from '../src/utils/plates';

export type ImportSource = 'strong' | 'hevy';
export type WeightUnit = 'kg' | 'lbs';

export class CsvImportError extends Error {
  constructor(public code: 'empty' | 'unknown-format' | 'no-rows') {
    super(code);
  }
}

// ============ CSV ============

/** RFC 4180：引号里可以有分隔符、换行、"" 转义。去掉 BOM。 */
export function parseCsv(text: string, delimiter: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f !== '')) rows.push(row);
  return rows;
}

/** 表头那行里 `;` 比 `,` 多就是安卓版 Strong */
function detectDelimiter(text: string): string {
  const first = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const semi = (first.match(/;/g) ?? []).length;
  const comma = (first.match(/,/g) ?? []).length;
  return semi > comma ? ';' : ',';
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
}

export interface DraftWorkout {
  key: string;
  title: string;
  start: Date;
  end: Date | null;
  notes: string;
  exercises: DraftExercise[];
}

export interface ExerciseSummary {
  srcName: string;
  sets: number;
  /** 文件里的原值，给确认页「最重 225」用 */
  maxWeight: number;
  /** 文件没告诉我们单位、又有重量 —— 确认页要让用户选 */
  needsUnit: boolean;
}

export interface ImportPlan {
  source: ImportSource;
  /** 整份文件的单位；null = 文件没写，要按动作问 */
  fileUnit: WeightUnit | null;
  workouts: DraftWorkout[];
  exercises: ExerciseSummary[];
  warmupSets: number;
  firstDate: Date;
  lastDate: Date;
}

// ============ 识别与解析 ============

const norm = (h: string) => h.trim().toLowerCase();

export function parseImportCsv(text: string): ImportPlan {
  if (!text.trim()) throw new CsvImportError('empty');
  const rows = parseCsv(text, detectDelimiter(text));
  if (rows.length < 2) throw new CsvImportError('no-rows');
  const header = rows[0].map(norm);
  const has = (h: string) => header.includes(h);

  let drafts: { workouts: DraftWorkout[]; fileUnit: WeightUnit | null };
  if (has('exercise_title') && has('set_type') && has('start_time')) {
    drafts = parseHevy(header, rows.slice(1));
    return finish('hevy', drafts);
  }
  if (has('exercise name') && has('set order') && has('date')) {
    drafts = parseStrong(header, rows.slice(1));
    return finish('strong', drafts);
  }
  throw new CsvImportError('unknown-format');
}

function finish(source: ImportSource, d: { workouts: DraftWorkout[]; fileUnit: WeightUnit | null }): ImportPlan {
  const workouts = d.workouts.filter(w => w.exercises.some(e => e.sets.length)).sort((a, b) => a.start.getTime() - b.start.getTime());
  if (!workouts.length) throw new CsvImportError('no-rows');
  const byName = new Map<string, ExerciseSummary>();
  let warmupSets = 0;
  for (const w of workouts) {
    for (const e of w.exercises) {
      const s = byName.get(e.srcName) ?? { srcName: e.srcName, sets: 0, maxWeight: 0, needsUnit: false };
      for (const set of e.sets) {
        if (set.type === 'warmup') warmupSets++;
        s.sets++;
        if (set.weight != null && set.weight > s.maxWeight) s.maxWeight = set.weight;
        if (set.weight && !set.unit && !d.fileUnit) s.needsUnit = true;
      }
      byName.set(e.srcName, s);
    }
  }
  return {
    source,
    fileUnit: d.fileUnit,
    workouts,
    exercises: [...byName.values()].sort((a, b) => b.sets - a.sets),
    warmupSets,
    firstDate: workouts[0].start,
    lastDate: workouts[workouts.length - 1].start,
  };
}

function num(v: string | undefined): number | null {
  if (v == null) return null;
  const t = v.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 「2024-03-14 18:05:12」按本地时间；别的格式交给 Date */
function parseLocalDateTime(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  return parseLooseDate(s);
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Hevy：「18 Oct 2025, 08:47」/「Oct 18, 2025 8:47 AM」，兜底交给 Date */
function parseLooseDate(s: string): Date | null {
  const t = s.trim();
  let m = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4}),?\s+(\d{1,2}):(\d{2})/.exec(t);
  if (m && MONTHS[m[2].toLowerCase()] != null) return new Date(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +m[4], +m[5]);
  m = /^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(t);
  if (m && MONTHS[m[1].toLowerCase()] != null) {
    let h = +m[4];
    if (m[6]?.toUpperCase() === 'PM' && h < 12) h += 12;
    if (m[6]?.toUpperCase() === 'AM' && h === 12) h = 0;
    return new Date(+m[3], MONTHS[m[1].toLowerCase()], +m[2], h, +m[5]);
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
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

function parseStrong(header: string[], rows: string[][]): { workouts: DraftWorkout[]; fileUnit: WeightUnit | null } {
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
  const iDist = col('distance', 'distance (m)', 'distance (km)');
  const iDistUnit = col('distance unit');
  const iSec = col('seconds');
  const iNotes = col('notes');
  const iWNotes = col('workout notes');
  const iRpe = col('rpe');

  const wHeader = header[iW] ?? '';
  const fileUnit: WeightUnit | null = /\(kg\)/.test(wHeader) ? 'kg' : /\(lbs?\)/.test(wHeader) ? 'lbs' : null;
  const distHeader = header[iDist] ?? '';

  const byKey = new Map<string, DraftWorkout>();
  for (const r of rows) {
    const order = (r[iOrder] ?? '').trim();
    if (!order || /^rest timer$/i.test(order) || /^note$/i.test(order)) continue;
    const dateRaw = r[iDate] ?? '';
    const start = parseLocalDateTime(dateRaw);
    if (!start) continue;
    const title = (r[iName] ?? '').trim();
    const key = `${dateRaw}|${title}`;
    let w = byKey.get(key);
    if (!w) {
      const dur = durIsSec ? num(r[iDur]) : parseDurationText(r[iDur]);
      w = {
        key,
        title,
        start,
        end: dur ? new Date(start.getTime() + dur * 1000) : null,
        notes: (r[iWNotes] ?? '').trim(),
        exercises: [],
      };
      byKey.set(key, w);
    }
    const exName = (r[iEx] ?? '').trim();
    if (!exName) continue;
    let ex = w.exercises[w.exercises.length - 1];
    if (!ex || ex.srcName !== exName) {
      ex = w.exercises.find(e => e.srcName === exName) ?? { srcName: exName, notes: [], sets: [] };
      if (!w.exercises.includes(ex)) w.exercises.push(ex);
    }
    const type: DraftSetType = /^w$/i.test(order) ? 'warmup' : /^f$/i.test(order) ? 'failure' : /^d$/i.test(order) ? 'drop' : 'normal';
    let distKm = num(r[iDist]);
    if (distKm != null) {
      const du = (r[iDistUnit] ?? '').trim().toLowerCase();
      if (du === 'mi' || du === 'miles') distKm *= 1.609344;
      else if (du === 'm' || /\(m\)/.test(distHeader)) distKm /= 1000;
      else if (!du && !/\(km\)/.test(distHeader)) distKm /= 1000; // Strong 默认按米导出
    }
    ex.sets.push({
      type,
      weight: num(r[iW]),
      unit: unitWord(r[iWUnit]),
      reps: num(r[iReps]),
      seconds: num(r[iSec]),
      distanceKm: distKm,
      rpe: num(r[iRpe]),
      note: (r[iNotes] ?? '').trim(),
    });
  }
  // 有 Weight Unit 列时单位在每一行上（DraftSet.unit），fileUnit 仍是 null —— 哪行没写才需要问
  return { workouts: [...byKey.values()], fileUnit };
}

function parseHevy(header: string[], rows: string[][]): { workouts: DraftWorkout[]; fileUnit: WeightUnit | null } {
  const i = (n: string) => header.indexOf(n);
  const iTitle = i('title');
  const iStart = i('start_time');
  const iEnd = i('end_time');
  const iDesc = i('description');
  const iEx = i('exercise_title');
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

  const byKey = new Map<string, DraftWorkout>();
  for (const r of rows) {
    const startRaw = r[iStart] ?? '';
    const start = parseLooseDate(startRaw);
    if (!start) continue;
    const title = (r[iTitle] ?? '').trim();
    const key = `${startRaw}|${title}`;
    let w = byKey.get(key);
    if (!w) {
      w = { key, title, start, end: parseLooseDate(r[iEnd] ?? ''), notes: (r[iDesc] ?? '').trim(), exercises: [] };
      byKey.set(key, w);
    }
    const exName = (r[iEx] ?? '').trim();
    if (!exName) continue;
    let ex = w.exercises[w.exercises.length - 1];
    if (!ex || ex.srcName !== exName) {
      ex = w.exercises.find(e => e.srcName === exName) ?? { srcName: exName, notes: [], sets: [] };
      if (!w.exercises.includes(ex)) w.exercises.push(ex);
    }
    const exNote = (r[iExNotes] ?? '').trim();
    if (exNote && !ex.notes.includes(exNote)) ex.notes.push(exNote);
    const t = (r[iType] ?? '').trim().toLowerCase();
    const type: DraftSetType = t === 'warmup' ? 'warmup' : t === 'failure' ? 'failure' : t === 'dropset' ? 'drop' : 'normal';
    const km = num(r[iKm]);
    const mi = num(r[iMi]);
    ex.sets.push({
      type,
      weight: num(r[fileUnit === 'lbs' ? iLb : iKg]),
      unit: null,
      reps: num(r[iReps]),
      seconds: num(r[iSec]),
      distanceKm: km ?? (mi != null ? mi * 1.609344 : null),
      rpe: num(r[iRpe]),
      note: '',
    });
  }
  return { workouts: [...byKey.values()], fileUnit };
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
  const words = `${n} ${equip}`
    .replace(/[-_/]/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
  return [...new Set(words)].sort().join(' ');
}

/**
 * 外来动作名 → fitlog 的动作定义。先看已有的名字（用户之前导入 / 自建过同名的），
 * 再看手工表，最后按词集合比对内置英文名和曾用名。对不上返回 undefined（调用方新建自定义动作）。
 */
export function matchExercise(
  srcName: string,
  defs: ExerciseDefinition[],
  findByName: (name: string) => ExerciseDefinition | undefined,
): ExerciseDefinition | undefined {
  const direct = findByName(srcName);
  if (direct) return direct;
  const known = KNOWN[srcName.trim().toLowerCase()];
  if (known) {
    const d = defs.find(x => x.id === known);
    if (d) return d;
  }
  const t = tokens(srcName);
  return defs.find(d => tokens(d.name.en) === t || (d.aliases ?? []).some(a => tokens(a) === t));
}

// ============ 生成记录 ============

/** FNV-1a：同一份文件导两次，id 相同，只是覆盖那几条，不会翻倍 */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export interface MaterializeOptions {
  /** 文件没写单位时按动作选的单位（键是 srcName） */
  unitByExercise: Record<string, WeightUnit>;
  includeWarmups: boolean;
  isCn: boolean;
  userId: string;
  defs: ExerciseDefinition[];
  findByName: (name: string) => ExerciseDefinition | undefined;
}

export interface MaterializeResult {
  workouts: WorkoutSession[];
  /** 需要新建的自定义动作 */
  newDefs: ExerciseDefinition[];
  /** 新动作的记录项（有氧只有时长 / 距离的，别让它默认显示重量 × 次数） */
  metricSeeds: Record<string, string[]>;
  sets: number;
}

/** 确认页用：每个外来动作会落到哪（内置名 / 新建） */
export function previewMatches(plan: ImportPlan, defs: ExerciseDefinition[], findByName: MaterializeOptions['findByName']) {
  return plan.exercises.map(e => ({ ...e, def: matchExercise(e.srcName, defs, findByName) }));
}

export function materialize(plan: ImportPlan, o: MaterializeOptions): MaterializeResult {
  const now = new Date().toISOString();
  const newDefs = new Map<string, ExerciseDefinition>();
  const metricSeeds: Record<string, string[]> = {};
  const nameFor = new Map<string, { name: string; category: string }>();
  let setCount = 0;

  const resolve = (src: string, sets: DraftSet[]) => {
    const hit = nameFor.get(src);
    if (hit) return hit;
    const def = matchExercise(src, o.defs, o.findByName);
    let r: { name: string; category: string };
    if (def) {
      r = { name: def.name[o.isCn ? 'cn' : 'en'] || def.name.en, category: def.category ?? 'STRENGTH' };
    } else {
      const cardio = sets.every(s => !s.weight && !s.reps) && sets.some(s => s.seconds || s.distanceKm);
      const id = `imp_${hash(plan.source + src)}`;
      newDefs.set(src, {
        id,
        name: { en: src, cn: src },
        bodyPart: 'subFullBody',
        tags: [],
        category: cardio ? 'CARDIO' : 'STRENGTH',
      });
      const m: string[] = [];
      if (sets.some(s => s.weight)) m.push('weight');
      if (sets.some(s => s.reps)) m.push('reps');
      if (sets.some(s => s.distanceKm)) m.push('distance');
      if (sets.some(s => s.seconds)) m.push('duration');
      if (m.length && !(m.length === 2 && m[0] === 'weight' && m[1] === 'reps')) metricSeeds[src] = m;
      r = { name: src, category: cardio ? 'CARDIO' : 'STRENGTH' };
    }
    nameFor.set(src, r);
    return r;
  };

  const workouts: WorkoutSession[] = plan.workouts.map(w => {
    const wid = `imp_${plan.source}_${hash(w.key)}`;
    const exercises: Exercise[] = [];
    const extra: string[] = [];
    w.exercises.forEach((e, ei) => {
      const { name, category } = resolve(e.srcName, e.sets);
      const sets: SetLog[] = [];
      const extraNotes: string[] = [...e.notes];
      e.sets.forEach((s, si) => {
        if (s.type === 'warmup' && !o.includeWarmups) return;
        const unit: WeightUnit = s.unit ?? plan.fileUnit ?? o.unitByExercise[e.srcName] ?? 'kg';
        const raw = s.weight ?? 0;
        const kg = Math.abs(raw) * (unit === 'lbs' ? KG_PER_LB : 1);
        const id = `${wid}_${ei}_${si}`;
        if (s.note) extraNotes.push(s.note);
        if (s.rpe != null) extraNotes.push(`${o.isCn ? '第' : 'Set '}${sets.length + 1}${o.isCn ? '组' : ''} RPE ${s.rpe}`);
        // 递减组挂到前一个正式组下面；前面没有组就当正式组
        if (s.type === 'drop' && sets.length) {
          const parent = sets[sets.length - 1];
          const sub: SubSetLog = { id, weight: kg, plateUnit: unit, reps: s.reps ?? 0 };
          parent.subSets = [...(parent.subSets ?? []), sub];
          setCount++;
          return;
        }
        const set: SetLog = { id, weight: kg, reps: s.reps ?? 0 };
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
      exercises.push({ id: `${wid}_${ei}`, name, category, sets, exerciseTime: w.start.toISOString() });
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
      exercises,
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

  return {
    workouts: workouts.filter(w => w.exercises.length),
    newDefs: [...newDefs.values()],
    metricSeeds,
    sets: setCount,
  };
}
