/**
 * CSV 导出：一行一组，Excel 双击就能打开（设计见 docs/design-backup.md §5）。
 *
 * 这不是备份 —— 完整数据在 JSON 备份里。CSV 是给人看、给 Excel / AI 分析用的，
 * 同时回答「App 哪天没了，我的记录还在不在」：普通文本，任何软件都读得了。
 *
 * - UTF-8 带 BOM：不带的话 Windows Excel 按本地编码读，中文全成乱码。
 * - CRLF 换行、RFC 4180 引号：Excel / Numbers / Google 表格都按这个认。
 * - 日期和时间拆两列，Excel 才会把日期认成日期（拼在一起带 T 的 ISO 它当文本）。
 */
import type { Exercise, SetLog, SubSetLog, WorkoutSession } from '../types';
import { signedKg } from '../src/utils/load';
import { plateUnitOf } from '../src/utils/plates';

export interface CsvExportHelpers {
  isCn: boolean;
  /** 存的名字 → 当前语言的现名 */
  resolveName: (stored: string) => string;
  /** 动作名 → 部位（已翻译）；不知道返回 '' */
  bodyPartOf: (stored: string) => string;
  /** 动作名 → 细分（已翻译，主细分在前，「 / 」隔开）；没有返回 '' */
  regionsOf: (stored: string) => string;
  /** 老数据没记片子单位时的兜底 */
  fallbackUnit: 'kg' | 'lbs';
}

const KG_TO_LBS = 2.20462;

function cell(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const pad = (n: number) => String(n).padStart(2, '0');
function localDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function localTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const round2 = (n: number) => Math.round(n * 100) / 100;

const CSV_HEADERS = {
  cn: ['日期', '开始时间', '训练', '场地', '动作', '做法', '部位', '细分', '组序', '类型', '重量', '单位', '重量(kg)', '次数', '力竭', '时长(秒)', '距离', '距离单位', '训练备注'],
  en: ['Date', 'Start Time', 'Workout', 'Gym', 'Exercise', 'Variant', 'Body Part', 'Region', 'Set', 'Type', 'Weight', 'Unit', 'Weight (kg)', 'Reps', 'To Failure', 'Duration (s)', 'Distance', 'Distance Unit', 'Workout Notes'],
};

/** 返回整份 CSV 文本（含 BOM）和行数（不含表头） */
export function buildWorkoutsCsv(workouts: WorkoutSession[], h: CsvExportHelpers): { text: string; rows: number } {
  const lines: string[] = [(h.isCn ? CSV_HEADERS.cn : CSV_HEADERS.en).map(cell).join(',')];
  const sorted = [...workouts].sort((a, b) => (a.startTime || a.date || '').localeCompare(b.startTime || b.date || ''));

  for (const w of sorted) {
    const when = w.startTime || w.date;
    const base = [localDate(when), localTime(when), w.title ?? '', w.gym ?? ''];
    for (const ex of w.exercises ?? []) {
      const name = h.resolveName(ex.name);
      const exCols = [name, ex.variantName ?? '', h.bodyPartOf(ex.name), h.regionsOf(ex.name)];
      let n = 0;
      for (const s of ex.sets ?? []) {
        if (s.ghost) continue; // 底稿行不是事实
        n++;
        lines.push(row(base, exCols, String(n), h.isCn ? '正式' : 'Working', s, ex, undefined, w, h));
        (s.subSets ?? []).forEach((sub, i) => {
          lines.push(row(base, exCols, `${n}.${i + 1}`, h.isCn ? '递减' : 'Drop', sub, ex, s, w, h));
        });
      }
    }
  }
  return { text: '﻿' + lines.join('\r\n') + '\r\n', rows: lines.length - 1 };
}

function row(
  base: string[],
  exCols: string[],
  order: string,
  type: string,
  s: SetLog | SubSetLog,
  ex: Exercise,
  parent: SetLog | undefined,
  w: WorkoutSession,
  h: CsvExportHelpers,
): string {
  const kg = signedKg(s, ex, parent);
  const unit = plateUnitOf(parent ? { weight: s.weight, plateUnit: s.plateUnit ?? parent.plateUnit } : s, h.fallbackUnit);
  const shown = unit === 'lbs' ? kg * KG_TO_LBS : kg;
  const full = s as SetLog;
  const hasLoad = kg !== 0 || (s.reps ?? 0) > 0;
  return [
    ...base,
    ...exCols,
    order,
    type,
    hasLoad ? round2(shown) : '',
    hasLoad ? (unit === 'lbs' ? 'lb' : 'kg') : '',
    hasLoad ? round2(kg) : '',
    s.reps ?? '',
    full.toFailure ? (h.isCn ? '是' : 'yes') : '',
    full.duration ?? '',
    full.distance ?? '',
    full.distance != null ? full.distanceUnit ?? 'km' : '',
    w.notes ?? '',
  ]
    .map(cell)
    .join(',');
}

export function csvFileName(isCn: boolean, when = new Date()): string {
  const d = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  return isCn ? `fitlog-训练记录-${d}.csv` : `fitlog-workouts-${d}.csv`;
}
