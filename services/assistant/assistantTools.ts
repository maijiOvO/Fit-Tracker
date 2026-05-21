/**
 * 智能助手可调用工具集合
 * - 读操作：直接访问 IndexedDB / localStorage
 * - 写操作：仅 create/update/delete schedule，其他实体一律不暴露 setter
 *
 * 工具签名按 OpenAI function calling 规范（JSON Schema）。
 */
import { db } from '../db';
import { FITLOG_SOLO_USER_ID } from '../fitlogSolo';
import { readTombstones, recordTombstone, tombstoneIdSet } from '../fitlogTombstones';
import { scheduleDebouncedFitlogPush } from '../fitlogSyncScheduler';
import { readPrefsFromLocalStorage } from '../fitlogRemote';
import {
  AssistantToolName,
  Goal,
  Measurement,
  PRRecord,
  ScheduledExercise,
  ScheduledWorkout,
  WeightEntry,
  WorkoutSession,
  ExerciseDefinition,
} from '../../types';
import { BODY_PARTS, DEFAULT_EXERCISES, ExerciseCategory } from '../../src/constants/exercises';

// ---------- 工具规格（投喂给模型） ----------

export interface ToolSpec {
  type: 'function';
  function: {
    name: AssistantToolName;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
}

const READ_TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'list_schedules',
      description: 'Return scheduled training sessions in the given date range (inclusive). Date format: YYYY-MM-DD. Omit both to return all upcoming sessions.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD' },
          to: { type: 'string', description: 'YYYY-MM-DD' },
          status: { type: 'string', enum: ['planned', 'completed', 'skipped'] },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_workouts',
      description: 'Return past workout sessions sorted by date desc.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max sessions to return; default 20, max 100.' },
          from: { type: 'string', description: 'YYYY-MM-DD (inclusive)' },
          to: { type: 'string', description: 'YYYY-MM-DD (inclusive)' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_prs',
      description: 'Return personal record entries (best lifts etc.) sorted by date desc.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_body_metrics',
      description: 'Return body-weight entries and measurement entries.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max entries per series; default 30.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_goals',
      description: 'Return active training goals.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_exercise_lib',
      description: 'Search the exercise library (system + custom). Use to discover exercise names before referencing them in create/update_schedule.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Substring match against exercise name (en/cn).' },
          category: { type: 'string', enum: ['STRENGTH', 'CARDIO', 'FREE', 'OTHER'] },
          bodyPart: { type: 'string', description: 'e.g. subChest, subBack, subLegs, subShoulder, subArms, subCore' },
          limit: { type: 'number' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_user_settings',
      description: 'Return UI/user preferences: language, unit (kg/lbs), starred exercises etc.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
];

const WRITE_TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'create_schedule',
      description: 'Create one scheduled workout (training plan). bodyParts and exercises[].bodyPart should refer to BODY_PARTS ids (subChest etc.) or custom tag ids.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          title: { type: 'string' },
          bodyParts: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
          exercises: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                category: { type: 'string', enum: ['STRENGTH', 'CARDIO', 'FREE', 'OTHER'] },
                bodyPart: { type: 'string' },
                targetSets: { type: 'number' },
                targetReps: { type: 'number' },
                targetWeight: { type: 'number', description: 'kg' },
                notes: { type: 'string' },
              },
              required: ['name'],
              additionalProperties: false,
            },
          },
        },
        required: ['date'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_schedule',
      description: 'Update an existing scheduled workout by id. Provide only the fields to change.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          title: { type: 'string' },
          bodyParts: { type: 'array', items: { type: 'string' } },
          status: { type: 'string', enum: ['planned', 'completed', 'skipped'] },
          notes: { type: 'string' },
          exercises: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                category: { type: 'string', enum: ['STRENGTH', 'CARDIO', 'FREE', 'OTHER'] },
                bodyPart: { type: 'string' },
                targetSets: { type: 'number' },
                targetReps: { type: 'number' },
                targetWeight: { type: 'number' },
              },
              required: ['name'],
              additionalProperties: false,
            },
          },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_schedule',
      description: 'Delete a scheduled workout by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
];

export const ALL_TOOL_SPECS: ToolSpec[] = [...READ_TOOLS, ...WRITE_TOOLS];

export function isWriteTool(name: AssistantToolName): boolean {
  return name === 'create_schedule' || name === 'update_schedule' || name === 'delete_schedule';
}

/** create 自动执行；update/delete 需要用户确认 */
export function requiresConfirmation(name: AssistantToolName): boolean {
  return name === 'update_schedule' || name === 'delete_schedule';
}

// ---------- 参数校验（轻量手写，避免新增依赖） ----------

function isString(v: unknown): v is string { return typeof v === 'string'; }
function isNumber(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v); }
function asDate(s: unknown): string | null {
  if (!isString(s)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

interface ValidatedScheduledExercise {
  name: string;
  category: ExerciseCategory;
  bodyPart?: string;
  targetSets?: number;
  targetReps?: number;
  targetWeight?: number;
  notes?: string;
}

function validateExercises(raw: unknown): ValidatedScheduledExercise[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(r => {
      if (!r || typeof r !== 'object') return null;
      const o = r as Record<string, unknown>;
      if (!isString(o.name) || !o.name.trim()) return null;
      const category = (isString(o.category) ? o.category : 'STRENGTH') as ExerciseCategory;
      return {
        name: o.name.trim(),
        category,
        bodyPart: isString(o.bodyPart) ? o.bodyPart : undefined,
        targetSets: isNumber(o.targetSets) ? o.targetSets : undefined,
        targetReps: isNumber(o.targetReps) ? o.targetReps : undefined,
        targetWeight: isNumber(o.targetWeight) ? o.targetWeight : undefined,
        notes: isString(o.notes) ? o.notes : undefined,
      } as ValidatedScheduledExercise;
    })
    .filter((x): x is ValidatedScheduledExercise => x !== null);
}

// ---------- 执行器 ----------

export interface ToolExecutionResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function execListSchedules(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const all = await db.getAll<ScheduledWorkout>('scheduledWorkouts');
  const tomb = tombstoneIdSet(readTombstones(), 'scheduledWorkouts');
  let list = all.filter(s => !tomb.has(s.id));
  const from = asDate(args.from);
  const to = asDate(args.to);
  if (from) list = list.filter(s => s.date >= from);
  if (to) list = list.filter(s => s.date <= to);
  if (isString(args.status)) list = list.filter(s => s.status === args.status);
  list.sort((a, b) => (a.date < b.date ? -1 : 1));
  return {
    ok: true,
    data: list.map(s => ({
      id: s.id,
      date: s.date,
      title: s.title,
      status: s.status,
      bodyParts: s.bodyParts,
      exerciseCount: s.exercises.length,
      exercises: s.exercises,
      notes: s.notes,
    })),
  };
}

async function execListWorkouts(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const all = await db.getAll<WorkoutSession>('workouts');
  const tomb = tombstoneIdSet(readTombstones(), 'workouts');
  let list = all.filter(w => !tomb.has(w.id));
  const from = asDate(args.from);
  const to = asDate(args.to);
  if (from) list = list.filter(w => w.date.slice(0, 10) >= from);
  if (to) list = list.filter(w => w.date.slice(0, 10) <= to);
  list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const limit = Math.max(1, Math.min(100, isNumber(args.limit) ? args.limit : 20));
  return {
    ok: true,
    data: list.slice(0, limit).map(w => ({
      id: w.id,
      date: w.date,
      title: w.title,
      tags: w.tags,
      duration: w.duration,
      fromSchedule: w.fromSchedule,
      exercises: w.exercises.map(ex => ({
        name: ex.name,
        category: ex.category,
        bodyPart: ex.bodyPart,
        sets: ex.sets.map(s => ({ weight: s.weight, reps: s.reps, duration: s.duration })),
      })),
    })),
  };
}

async function execListPRs(): Promise<ToolExecutionResult> {
  const all = await db.getAll<PRRecord>('prs');
  const tomb = tombstoneIdSet(readTombstones(), 'prs');
  const list = all.filter(p => !tomb.has(p.id));
  list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return { ok: true, data: list };
}

async function execReadBodyMetrics(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const limit = Math.max(1, Math.min(200, isNumber(args.limit) ? args.limit : 30));
  const weights = await db.getAll<WeightEntry>('weightLogs');
  const wTomb = tombstoneIdSet(readTombstones(), 'weightLogs');
  const measurements = await db.getAll<Measurement>('custom_metrics');
  const mTomb = tombstoneIdSet(readTombstones(), 'customMetrics');
  return {
    ok: true,
    data: {
      weight: weights
        .filter(w => !wTomb.has(w.id))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, limit),
      measurements: measurements
        .filter(m => !mTomb.has(m.id))
        .sort((a, b) => new Date((b.createdAt || b.date)).getTime() - new Date((a.createdAt || a.date)).getTime())
        .slice(0, limit),
    },
  };
}

async function execReadGoals(): Promise<ToolExecutionResult> {
  const all = await db.getAll<Goal>('goals');
  const tomb = tombstoneIdSet(readTombstones(), 'goals');
  return { ok: true, data: all.filter(g => !tomb.has(g.id)) };
}

async function execSearchExerciseLib(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const custom = await db.getAll<ExerciseDefinition>('customExercises');
  const cTomb = tombstoneIdSet(readTombstones(), 'customExerciseDefs');
  const lib: ExerciseDefinition[] = [
    ...DEFAULT_EXERCISES,
    ...custom.filter(c => !cTomb.has(c.id)),
  ];
  let list = lib;
  if (isString(args.query) && args.query.trim()) {
    const q = args.query.trim().toLowerCase();
    list = list.filter(ex =>
      ex.name.en.toLowerCase().includes(q) || ex.name.cn.toLowerCase().includes(q)
    );
  }
  if (isString(args.category)) {
    list = list.filter(ex => (ex.category || 'STRENGTH') === args.category);
  }
  if (isString(args.bodyPart)) {
    list = list.filter(ex => ex.bodyPart === args.bodyPart);
  }
  const limit = Math.max(1, Math.min(50, isNumber(args.limit) ? args.limit : 20));
  return {
    ok: true,
    data: list.slice(0, limit).map(ex => ({
      id: ex.id,
      name: ex.name,
      category: ex.category || 'STRENGTH',
      bodyPart: ex.bodyPart,
      tags: ex.tags,
    })),
  };
}

async function execReadUserSettings(): Promise<ToolExecutionResult> {
  const prefs = readPrefsFromLocalStorage();
  return {
    ok: true,
    data: {
      lang: prefs.lang,
      unit: prefs.unit,
      starredExercises: prefs.starredExercises,
      customTags: prefs.customTags,
    },
  };
}

async function execCreateSchedule(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const date = asDate(args.date);
  if (!date) return { ok: false, error: 'date is required in YYYY-MM-DD format' };
  const exercises = validateExercises(args.exercises);
  const bodyParts = Array.isArray(args.bodyParts)
    ? (args.bodyParts.filter(isString) as string[])
    : exercises
        .map(e => e.bodyPart)
        .filter((x): x is string => !!x);
  const now = new Date().toISOString();
  const sched: ScheduledWorkout = {
    id: makeId('sw'),
    userId: FITLOG_SOLO_USER_ID,
    date,
    title: isString(args.title) && args.title.trim() ? args.title.trim() : undefined,
    bodyParts: [...new Set(bodyParts)],
    exercises: exercises.map<ScheduledExercise>(e => ({
      id: makeId('sex'),
      name: e.name,
      category: e.category,
      bodyPart: e.bodyPart && BODY_PARTS.includes(e.bodyPart) ? e.bodyPart : e.bodyPart,
      targetSets: e.targetSets,
      targetReps: e.targetReps,
      targetWeight: e.targetWeight,
      notes: e.notes,
    })),
    notes: isString(args.notes) ? args.notes : undefined,
    status: 'planned',
    createdAt: now,
    updatedAt: now,
  };
  await db.upsert('scheduledWorkouts', sched);
  scheduleDebouncedFitlogPush();
  return {
    ok: true,
    data: {
      id: sched.id,
      date: sched.date,
      title: sched.title,
      exerciseCount: sched.exercises.length,
    },
  };
}

async function execUpdateSchedule(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  if (!isString(args.id)) return { ok: false, error: 'id is required' };
  const all = await db.getAll<ScheduledWorkout>('scheduledWorkouts');
  const target = all.find(s => s.id === args.id);
  if (!target) return { ok: false, error: `schedule ${args.id} not found` };
  const next: ScheduledWorkout = { ...target };
  const newDate = asDate(args.date);
  if (newDate) next.date = newDate;
  if (isString(args.title)) next.title = args.title.trim() || undefined;
  if (Array.isArray(args.bodyParts)) {
    next.bodyParts = args.bodyParts.filter(isString) as string[];
  }
  if (isString(args.status) && (args.status === 'planned' || args.status === 'completed' || args.status === 'skipped')) {
    next.status = args.status;
  }
  if (isString(args.notes)) next.notes = args.notes;
  if (Array.isArray(args.exercises)) {
    const items = validateExercises(args.exercises);
    next.exercises = items.map<ScheduledExercise>(e => ({
      id: makeId('sex'),
      name: e.name,
      category: e.category,
      bodyPart: e.bodyPart,
      targetSets: e.targetSets,
      targetReps: e.targetReps,
      targetWeight: e.targetWeight,
      notes: e.notes,
    }));
  }
  next.updatedAt = new Date().toISOString();
  await db.upsert('scheduledWorkouts', next);
  scheduleDebouncedFitlogPush();
  return { ok: true, data: { id: next.id, date: next.date, title: next.title } };
}

async function execDeleteSchedule(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  if (!isString(args.id)) return { ok: false, error: 'id is required' };
  await db.delete('scheduledWorkouts', args.id);
  recordTombstone('scheduledWorkouts', args.id);
  scheduleDebouncedFitlogPush();
  return { ok: true, data: { id: args.id } };
}

export async function executeAssistantTool(
  name: AssistantToolName,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  try {
    switch (name) {
      case 'list_schedules': return execListSchedules(args);
      case 'list_workouts': return execListWorkouts(args);
      case 'list_prs': return execListPRs();
      case 'read_body_metrics': return execReadBodyMetrics(args);
      case 'read_goals': return execReadGoals();
      case 'search_exercise_lib': return execSearchExerciseLib(args);
      case 'read_user_settings': return execReadUserSettings();
      case 'create_schedule': return execCreateSchedule(args);
      case 'update_schedule': return execUpdateSchedule(args);
      case 'delete_schedule': return execDeleteSchedule(args);
      default:
        return { ok: false, error: `unknown tool: ${name}` };
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
