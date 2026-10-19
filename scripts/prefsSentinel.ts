/**
 * prefs 往返自检（scripts/prefs-check.mjs）用的哨兵：每个 key 都填了能认出来的值。
 *
 * `satisfies Required<FitlogSyncedPrefs>` 是防漏的那一半：给 FitlogSyncedPrefs 加了 key 却没在这里补，
 * `npx tsc --noEmit -p .` 就红；补上之后 prefs-check 再查读 / 写 / 合并三处有没有一处漏了它。
 */
import type { FitlogSyncedPrefs } from '../services/fitlogSnapshotTypes';
import type { AppPrefs } from '../services/appPrefs';

export const PREFS_SENTINEL = {
  customTags: [{ id: 'CT_sentinel', name: '哨兵标签', category: 'bodyPart' }],
  customExercises: [
    { id: 'EX_sentinel', name: { cn: '哨兵动作', en: 'Sentinel' }, bodyPart: 'subChest', tags: [], category: 'STRENGTH' },
  ],
  exerciseNotes: { 哨兵动作: '哨兵备注' },
  restPrefs: { 哨兵动作: 90 },
  starredExercises: { 哨兵动作: 1700000000001 },
  exerciseMetricConfigs: { 哨兵动作: ['reps', 'duration'] },
  tagRenameOverrides: { subChest: '哨兵胸' },
  exerciseOverrides: { EX_sentinel: { name: { cn: '哨兵改名', en: 'Sentinel renamed' } } },
  starredLastUpdateMs: 1700000000002,
  metricsLastUpdateMs: 1700000000003,
  prefsLastUpdateMs: 1700000000004,
  lang: 'en',
  unit: 'lbs',
  avatarDataUrl: 'data:image/jpeg;base64,c2VudGluZWw=',
  appPrefs: {
    unit: 'lbs',
    lang: 'en',
    weightStep: 2.5,
    dropStep: 15,
    cardioMetrics: ['speed', 'reps'],
    distUnit: 'mi',
    weekStart: 'sun',
    gyms: {
      哨兵馆: { plateUnit: 'lbs', plates: [45, 25, 2.5], cable: { v: 2.5, u: 'kg' }, machine: { v: 10, u: 'lbs' }, dumbbell: { v: 5, u: 'lbs' } },
    },
    gymOverrides: { '哨兵馆|EX_sentinel|': { v: 5, u: 'kg' } },
  } satisfies Required<AppPrefs>,
  appPrefsUpdatedMs: 1700000000005,
} satisfies Required<FitlogSyncedPrefs>;

/**
 * 不走 localStorage 往返的 key 和原因。新加的 key 想进这里要写理由 —— 默认是「必须往返」。
 */
export const NOT_ROUND_TRIPPED: Partial<Record<keyof FitlogSyncedPrefs, string>> = {
  restPrefs: '休息计时器已移除，只为解析旧快照保留，读写都不碰',
};
