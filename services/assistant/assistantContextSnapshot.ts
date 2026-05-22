/**
 * 构造每次发请求时注入的 system 摘要，把用户的整体训练态势压成一段 ~1k token 的文本。
 * 细节让模型按需通过 tool 拉。
 */
import { db } from '../db';
import { readTombstones, tombstoneIdSet } from '../fitlogTombstones';
import { readPrefsFromLocalStorage } from '../fitlogRemote';
import { Goal, ScheduledWorkout, WeightEntry, WorkoutSession } from '../../types';

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

function daysAhead(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export async function buildContextSnapshot(): Promise<string> {
  const tomb = readTombstones();
  const today = new Date();
  const todayStr = ymd(today);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][today.getDay()];

  const prefs = readPrefsFromLocalStorage();
  const lang = prefs.lang ?? 'cn';
  const unit = prefs.unit ?? 'kg';

  const workouts = (await db.getAll<WorkoutSession>('workouts'))
    .filter(w => !tombstoneIdSet(tomb, 'workouts').has(w.id));
  const goals = (await db.getAll<Goal>('goals'))
    .filter(g => !tombstoneIdSet(tomb, 'goals').has(g.id));
  const schedules = (await db.getAll<ScheduledWorkout>('scheduledWorkouts'))
    .filter(s => !tombstoneIdSet(tomb, 'scheduledWorkouts').has(s.id));
  const weights = (await db.getAll<WeightEntry>('weightLogs'))
    .filter(w => !tombstoneIdSet(tomb, 'weightLogs').has(w.id));

  // 近 30 天训练
  const since = daysAgo(30);
  const recent = workouts.filter(w => w.date.slice(0, 10) >= since);
  const bodyPartCounts: Record<string, number> = {};
  for (const w of recent) {
    for (const ex of w.exercises) {
      const bp = ex.bodyPart || 'unknown';
      bodyPartCounts[bp] = (bodyPartCounts[bp] || 0) + 1;
    }
  }
  const bodyPartLine = Object.entries(bodyPartCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `${k}:${v}`)
    .join(', ') || '—';

  // 体重趋势
  const sortedW = [...weights].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const last30 = sortedW.filter(w => w.date.slice(0, 10) >= since);
  let weightLine = '—';
  if (last30.length >= 2) {
    const first = last30[0];
    const last = last30[last30.length - 1];
    const delta = (last.weight - first.weight).toFixed(1);
    weightLine = `${first.weight}${unit} → ${last.weight}${unit} (Δ${delta} in 30d)`;
  } else if (sortedW.length > 0) {
    const last = sortedW[sortedW.length - 1];
    weightLine = `${last.weight}${unit} (single entry)`;
  }

  // 未来 7 天日程
  const horizon = daysAhead(7);
  const upcoming = schedules
    .filter(s => s.date >= todayStr && s.date <= horizon && s.status === 'planned')
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const upcomingLines = upcoming.length
    ? upcoming.map(s => `  - ${s.date} ${s.title || '(untitled)'} · ${s.exercises.length} exercises · parts=[${s.bodyParts.join(',') || '—'}]`).join('\n')
    : '  (none)';

  // 活跃目标
  const goalLines = goals.length
    ? goals.slice(0, 5).map(g => `  - ${g.title || g.type}: ${g.currentValue}/${g.targetValue}${g.unit || ''}`).join('\n')
    : '  (none)';

  return [
    `You are the in-app training assistant inside a fitness tracker.`,
    `Today: ${todayStr} (${weekday}). User locale=${lang}, unit=${unit}.`,
    ``,
    `Recent activity (last 30 days):`,
    `  workouts: ${recent.length} sessions`,
    `  body-part exposure: ${bodyPartLine}`,
    `  body weight: ${weightLine}`,
    ``,
    `Active goals:`,
    goalLines,
    ``,
    `Upcoming planned sessions (next 7 days):`,
    upcomingLines,
    ``,
    `Permissions:`,
    `  - You MAY create / update / delete scheduled workouts via the corresponding tools.`,
    `  - You MUST NOT modify workouts, PR records, goals, weight entries, exercise library, or user settings from chat — the user edits those in the app UI.`,
    `  - The user CAN edit past workouts in the app (add missed exercises, change sets, delete sessions); you only READ that data via tools, never write workouts.`,
    `  - Update_schedule and delete_schedule are gated by user confirmation in the UI; create_schedule applies immediately.`,
    ``,
    `Use tools to fetch more detail when needed; do not invent data.`,
    `Reply in the user's locale (${lang === 'cn' ? 'Simplified Chinese' : 'English'}).`,
    ``,
    `Planning policy (IMPORTANT):`,
    `  - DO NOT produce a training plan, schedule, or call create_schedule/update_schedule/delete_schedule unless the user EXPLICITLY asks for one.`,
    `    Explicit asks look like: "帮我安排…/给我做个计划/排一下下周/明天练什么/add to my schedule/plan my week" etc.`,
    `  - If the user is just chatting, asking a question, discussing soreness/feelings, reporting a workout, or asking for advice in general, RESPOND CONVERSATIONALLY only. Do NOT volunteer a plan.`,
    `  - At most you may end with a short, single-sentence offer like "需要我帮你安排进日程吗？" — and only proceed after the user confirms.`,
    `  - When you do build a plan (after explicit ask), prefer exercise names returned by search_exercise_lib so they match the user's library.`,
  ].join('\n');
}
