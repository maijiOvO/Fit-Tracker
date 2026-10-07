/**
 * 动作偏好与定制 Context
 * 集中管理所有 localStorage 驱动的「偏好类」状态及其相关 helpers：
 *  - 自定义标签 / 自定义动作 / 动作备注 / 维度配置 / 星标
 *  - 动作覆盖（重命名 / 隐藏 / 修改标签）/ 标签重命名覆盖
 *  - 名称解析 / 标签名解析 / 维度查询 / 标签 + 动作管理函数
 *  - 与远端 snapshot 同步用的 applyPrefsFromSnapshot
 *
 * 该 Context 不依赖 WorkoutContext，所有依赖 workouts 的派生数据由 useExerciseStats 提供。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { ExerciseDefinition, Language } from '../../types';
import { translations } from '../../translations';
import { BODY_PARTS, BODY_REGIONS, DEFAULT_EXERCISES, EQUIPMENT_TAGS } from '../constants/exercises';
import { mergeOverride } from '../utils/exerciseOverride';
import { markPrefsUpdated } from '../../services/fitlogRemote';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import type { FitlogSyncedPrefs } from '../../services/fitlogSnapshotTypes';
import { useUiOverlay } from './UiOverlayContext';
import { useUserSettingsContext } from './UserSettingsContext';
import { storage } from '../../services/appStorage';

export interface CustomTag {
  id: string;
  name: string;
  /**
   * 'regionLayout'：某个部位的细分布局（列的顺序 + 删掉的系统细分），每个部位至多一条，
   * id 固定为 `regionLayout:<部位>`。放进 customTags 是为了不新增 prefs key（四处枚举）。
   */
  category: 'bodyPart' | 'equipment' | 'region' | 'regionLayout';
  parentCategory?: string;
  /** category='region' / 'regionLayout' 时：挂在哪个部位下（如 'subChest'） */
  parentPart?: string;
  /** regionLayout：列的顺序（细分 id）；没列到的接在后面按默认 */
  order?: string[];
  /** regionLayout：删掉（隐藏）的系统细分。动作上的引用不动，自然回未细分；恢复即回来 */
  hidden?: string[];
}

interface ExercisePrefsContextValue {
  /** ============ State ============ */
  customTags: CustomTag[];
  customExercises: ExerciseDefinition[];
  /**
   * 备注 / 维度配置 / 收藏都按名字存，存的是「当时」的名字（可能是旧名、可能是另一种语言）。
   * 这里给出去的是【按当前显示名归并过的视图】：键 = resolveName(原键)。
   * 所以读处一律拿 resolveName(...) 去查就对，跟语言、改没改过名都无关；
   * 存储里的原键不动（兼容旧数据），写入走下面的 actions，它们会找回原键。
   */
  exerciseNotes: Record<string, string>;
  exerciseMetricConfigs: Record<string, string[]>;
  starredExercises: Record<string, number>;
  exerciseOverrides: Record<string, Partial<ExerciseDefinition>>;
  tagRenameOverrides: Record<string, string>;

  /** ============ Setters（保留少量直接写入，绝大多数操作走下方 actions） ============ */
  setCustomTags: React.Dispatch<React.SetStateAction<CustomTag[]>>;
  setCustomExercises: React.Dispatch<React.SetStateAction<ExerciseDefinition[]>>;
  setExerciseNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setExerciseMetricConfigs: React.Dispatch<
    React.SetStateAction<Record<string, string[]>>
  >;
  setStarredExercises: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setExerciseOverrides: React.Dispatch<
    React.SetStateAction<Record<string, Partial<ExerciseDefinition>>>
  >;
  setTagRenameOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>>;

  /** ============ Helpers（纯函数） ============ */
  resolveName: (storedName: string) => string;
  /** 任意一个名字（原名 / 现名 / 曾用名，中英皆可）→ 它属于的动作定义；库里没有返回 undefined */
  findExerciseDef: (name: string) => ExerciseDefinition | undefined;
  /** 部位下的细分：按用户排的列顺序（没排过：系统在前、自建在后），删掉的系统细分不在内 */
  regionsOf: (part: string) => { id: string; custom: boolean }[];
  /** 动作的练法（第 8 条）；不在库里的名字返回 [] */
  variantsOf: (exerciseName: string) => { id: string; name: string }[];
  /** 一条记录的练法名：现名优先，练法被删了用记录里当时的名字；标准返回 '' */
  variantLabel: (ex: { name: string; variantId?: string; variantName?: string }) => string;
  /**
   * 「项目键」：现名，带练法时是「现名（练法）」。PR、PR 列表、趋势图、历史筛选都按它分开。
   */
  liftKey: (ex: { name: string; variantId?: string; variantName?: string }) => string;
  /** 部位下被删掉（隐藏）的系统细分，可恢复 */
  hiddenRegionsOf: (part: string) => string[];
  /** 动作（已合并覆盖层）此刻落在哪一列；不分细分 / 未细分 / 细分不属于当前部位 → null */
  effectiveRegion: (ex: ExerciseDefinition) => string | null;
  /**
   * 动作此刻属于哪个部位：系统部位 / 还在的自建部位原样返回；部位为空、或自建部位已被删 → ''（「未分部位」）。
   * 删自建部位不改写动作上的引用，撤销把标签放回来，动作也就回去了（同细分的做法）。
   */
  effectivePart: (ex: ExerciseDefinition) => string;
  getTagName: (tid: string) => string;
  getActiveMetrics: (exerciseName: string) => string[];

  /** ============ Actions ============ */
  toggleMetric: (exerciseName: string, metricKey: string) => void;
  resetMetricsToDefault: (exerciseName: string) => void;
  toggleStarExercise: (exerciseName: string) => void;
  saveExerciseNote: (name: string, note: string) => void;
  /** region 不传 = 不动细分；'' = 放回未细分。category 不传 = 不动训练类型 */
  saveExerciseTags: (
    exerciseId: string,
    bodyPart: string,
    tags: string[],
    region?: string,
    category?: ExerciseDefinition['category'],
  ) => void;
  /** 返回 false = 没改成（同类标签重名：部位之间、器材之间、同一部位的细分之间，已 toast） */
  renameTag: (id: string, newName: string) => boolean;
  /** 新建自建部位 / 器材，返回新 id；同类重名返回 null（已 toast） */
  addTag: (category: 'bodyPart' | 'equipment', name: string) => string | null;
  deleteTag: (id: string) => Promise<void>;
  /** 返回 false = 没改成（重名 / 空名），调用方别关弹窗 */
  renameExercise: (exerciseId: string, newName: string) => boolean;
  /** 从动作库删除＝隐藏（内置 / 自建一样），不弹确认，给撤销条；可在整理的「已删除」里恢复 */
  deleteLibraryExercise: (exerciseId: string) => void;
  restoreLibraryExercise: (exerciseId: string) => void;
  addCustomExercise: (ex: ExerciseDefinition) => void;
  addCustomTag: (tag: CustomTag) => void;
  /** 归到细分；'' = 放回未细分 */
  assignRegion: (exerciseId: string, regionId: string) => void;
  /**
   * 批量写细分与列内顺序（拖到细分 / 撤销都走这里）。regionRank 不给＝去掉手动顺序。
   * 内置动作写覆盖层、自建动作写定义本身，一次写完、一次推送。
   */
  applyRegionLayout: (changes: { id: string; region: string; regionRank?: number }[]) => void;
  /**
   * 新建自建细分，返回新 id；同一部位下重名返回 null（已 toast）。
   * 撞上这个部位被删掉（隐藏）的系统细分：直接把它恢复，返回它的 id，不再建一个同名的。
   */
  addRegionTag: (part: string, name: string) => string | null;
  /** 练法：新建返回 id（同名返回 null 并 toast）、改名（同名返回 false）、删除（撤销条） */
  addVariant: (exerciseName: string, name: string) => string | null;
  renameVariant: (exerciseName: string, id: string, name: string) => boolean;
  removeVariant: (exerciseName: string, id: string) => void;
  /** 整理里挪列：dir = -1 左移 / 1 右移 */
  moveRegion: (part: string, id: string, dir: -1 | 1) => void;
  /** 整理里删细分：系统细分＝隐藏、自建细分＝删标签；都走撤销条，动作回未细分 */
  removeRegion: (part: string, id: string) => void;
  restoreRegion: (part: string, id: string) => void;

  /** 用远端拉下来的 snapshot 全量覆盖偏好（语言/单位/头像由 caller 处理） */
  applyPrefsFromSnapshot: (p: FitlogSyncedPrefs) => void;

  /** 一键重置（重置账户用） */
  resetAllPrefs: () => void;
}

const ExercisePrefsContext = createContext<ExercisePrefsContextValue | null>(null);

const LS_KEYS = {
  customTags: 'fitlog_custom_tags',
  customExercises: 'fitlog_custom_exercises',
  exerciseNotes: 'fitlog_exercise_notes',
  exerciseMetricConfigs: 'fitlog_metric_configs',
  metricsLastUpdate: 'fitlog_metrics_last_update',
  starredExercises: 'fitlog_starred_exercises',
  starredLastUpdate: 'fitlog_starred_last_update',
  exerciseOverrides: 'fitlog_exercise_overrides',
  tagRenameOverrides: 'fitlog_tag_rename_overrides',
} as const;

/** 系统细分 id → 它所在的部位（自建细分看 CustomTag.parentPart） */
function systemRegionPart(id: string): string | undefined {
  return Object.keys(BODY_REGIONS).find(p => BODY_REGIONS[p].includes(id));
}

/**
 * 自建动作的稳定次序：id 从新到旧。id 是 Date.now() 的十进制串，按数值比；
 * 不是纯数字的（理论上没有）退到字符串比较，保证次序只由 id 决定、与数组顺序无关。
 */
function newestCustomFirst(a: ExerciseDefinition, b: ExerciseDefinition): number {
  const na = /^\d+$/.test(a.id) ? Number(a.id) : NaN;
  const nb = /^\d+$/.test(b.id) ? Number(b.id) : NaN;
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return nb - na;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* localStorage 可能配额满，忽略 */
  }
}

/**
 * 清理 metric 配置中可能存在的空格脏数据（兼容历史数据）
 */
function sanitizeMetricConfigs(
  parsed: Record<string, string[]>,
): { cleaned: Record<string, string[]>; mutated: boolean } {
  const cleaned: Record<string, string[]> = {};
  let mutated = false;
  Object.entries(parsed).forEach(([exerciseName, metrics]) => {
    if (!Array.isArray(metrics)) return;
    const cleanedMetrics = metrics
      .map(m => (typeof m === 'string' ? m.trim() : String(m).trim()))
      .filter(m => m.length > 0);
    if (JSON.stringify(metrics) !== JSON.stringify(cleanedMetrics)) {
      mutated = true;
    }
    cleaned[exerciseName] = cleanedMetrics;
  });
  return { cleaned, mutated };
}

export const ExercisePrefsProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { lang } = useUserSettingsContext();
  const { toast, toastUndo } = useUiOverlay();

  const [customTags, setCustomTags] = useState<CustomTag[]>(() =>
    readJSON<CustomTag[]>(LS_KEYS.customTags, []),
  );
  const [customExercises, setCustomExercises] = useState<ExerciseDefinition[]>(() =>
    readJSON<ExerciseDefinition[]>(LS_KEYS.customExercises, []),
  );
  const [rawNotes, setExerciseNotes] = useState<Record<string, string>>(() =>
    readJSON<Record<string, string>>(LS_KEYS.exerciseNotes, {}),
  );
  const [rawMetricConfigs, setExerciseMetricConfigs] = useState<
    Record<string, string[]>
  >(() => {
    const parsed = readJSON<Record<string, string[]>>(LS_KEYS.exerciseMetricConfigs, {});
    const { cleaned, mutated } = sanitizeMetricConfigs(parsed);
    if (mutated) writeJSON(LS_KEYS.exerciseMetricConfigs, cleaned);
    return cleaned;
  });
  const [rawStarred, setStarredExercises] = useState<Record<string, number>>(() =>
    readJSON<Record<string, number>>(LS_KEYS.starredExercises, {}),
  );
  const [exerciseOverrides, setExerciseOverrides] = useState<
    Record<string, Partial<ExerciseDefinition>>
  >(() =>
    readJSON<Record<string, Partial<ExerciseDefinition>>>(LS_KEYS.exerciseOverrides, {}),
  );
  const [tagRenameOverrides, setTagRenameOverrides] = useState<Record<string, string>>(
    () => readJSON<Record<string, string>>(LS_KEYS.tagRenameOverrides, {}),
  );

  /** ====================== Helpers ====================== */

  /**
   * 名字索引：一个动作认得的全部名字 → 定义。
   * 三轮登记、先到先得：现名（覆盖层）→ 原名（中英）→ 曾用名。
   * 现名优先，是为了曾用名和别的动作现名撞车时，以现名为准。
   *
   * 同一轮里撞名（name-index-order-dependent：真实数据里两个自建动作原名都是「悍马卧推」）
   * 不能看自建列表的数组顺序 —— 「从动作库删除再撤销」会改顺序，历史就整批换了主人。
   * 规则写死：内置在前（常量顺序），自建按 id 从新到旧（id 是创建时刻）。
   * 选「新到旧」是因为自建列表一直是新建插在最前，现存数据的解析结果因此一个都不变。
   */
  const nameIndex = useMemo(() => {
    const m = new Map<string, ExerciseDefinition>();
    const defs = [...DEFAULT_EXERCISES, ...[...customExercises].sort(newestCustomFirst)];
    const put = (n: string | undefined, d: ExerciseDefinition) => {
      const k = (n || '').trim();
      if (k && !m.has(k)) m.set(k, d);
    };
    for (const d of defs) {
      const over = exerciseOverrides[d.id];
      put(over?.name?.cn, d);
      put(over?.name?.en, d);
    }
    for (const d of defs) {
      put(d.name.cn, d);
      put(d.name.en, d);
    }
    for (const d of defs) {
      for (const a of d.aliases ?? []) put(a, d);
      for (const a of exerciseOverrides[d.id]?.aliases ?? []) put(a, d);
    }
    return m;
  }, [customExercises, exerciseOverrides]);

  const findExerciseDef = useCallback(
    (name: string) => nameIndex.get((name || '').trim()),
    [nameIndex],
  );

  /** 存的名字（原名 / 曾用名 / 另一语言名）→ 当前语言下的现名。库里没有的名字原样返回。 */
  const resolveName = useCallback(
    (storedName: string): string => {
      const def = findExerciseDef(storedName);
      if (def) {
        return exerciseOverrides[def.id]?.name?.[lang] || def.name[lang] || storedName;
      }
      return storedName;
    },
    [findExerciseDef, exerciseOverrides, lang],
  );

  const variantsOf = useCallback(
    (exerciseName: string) => {
      const def = findExerciseDef(exerciseName);
      if (!def) return [];
      return exerciseOverrides[def.id]?.variants ?? def.variants ?? [];
    },
    [findExerciseDef, exerciseOverrides],
  );

  const variantLabel = useCallback(
    (ex: { name: string; variantId?: string; variantName?: string }) => {
      if (!ex.variantId) return '';
      return variantsOf(ex.name).find(v => v.id === ex.variantId)?.name || ex.variantName || '';
    },
    [variantsOf],
  );

  const liftKey = useCallback(
    (ex: { name: string; variantId?: string; variantName?: string }) => {
      const base = resolveName(ex.name).trim();
      const v = variantLabel(ex);
      // 括号而不是「 · 」：时间线副行本来就用「 · 」隔开不同动作，「上斜哑铃卧推 · 宽握」读起来像两个动作（走查实测）
      if (!v) return base;
      return lang === Language.CN ? `${base}（${v}）` : `${base} (${v})`;
    },
    [lang, resolveName, variantLabel],
  );

  /** 原键 → 显示名归并。同一动作有多个原键时，键名正好等于显示名的那个说了算。 */
  const byDisplayName = useCallback(
    <T,>(raw: Record<string, T>): Record<string, T> => {
      const out: Record<string, T> = {};
      for (const [k, v] of Object.entries(raw)) {
        const d = resolveName(k);
        if (!(d in out) || k === d) out[d] = v;
      }
      return out;
    },
    [resolveName],
  );
  const exerciseNotes = useMemo(() => byDisplayName(rawNotes), [byDisplayName, rawNotes]);
  const exerciseMetricConfigs = useMemo(
    () => byDisplayName(rawMetricConfigs),
    [byDisplayName, rawMetricConfigs],
  );
  const starredExercises = useMemo(() => byDisplayName(rawStarred), [byDisplayName, rawStarred]);

  /** 写入用：这个名字在原始存储里对应的全部键（同一动作的旧名 / 另一语言名都算） */
  const rawKeysFor = useCallback(
    (raw: Record<string, unknown>, name: string): string[] => {
      const d = resolveName(name);
      return Object.keys(raw).filter(k => k === name || resolveName(k) === d);
    },
    [resolveName],
  );

  const getTagName = useCallback(
    (tid: string): string => {
      if (!tid) return '';
      const lowerId = tid.toLowerCase();
      if (tagRenameOverrides[tid]) return tagRenameOverrides[tid];

      const customTag = customTags.find(
        ct => ct.id === tid || ct.id.toLowerCase() === lowerId,
      );
      if (customTag) return customTag.name;

      const systemKey = Object.keys(translations).find(k => k.toLowerCase() === lowerId);
      if (systemKey) {
        return (translations as any)[systemKey][lang];
      }
      if (/^\d{10,13}$/.test(tid)) return '';
      // 已删除的自建部位 / 器材 / 细分：动作上的引用还在，不能把原始 id「CT_…」露出来
      if (/^(ct|rg)_/i.test(tid)) return '';
      return tid;
    },
    [customTags, tagRenameOverrides, lang],
  );

  // 按显示名查：原先直接拿传进来的名字查原键，中文下设的「跑步机 = 距离/时长/速度」
  // 到英文模式（名字是 Treadmill）就查不到，有氧变回重量 × 次数。
  const layoutOf = useCallback(
    (part: string) => customTags.find(t => t.category === 'regionLayout' && t.parentPart === part),
    [customTags],
  );

  const regionsOf = useCallback(
    (part: string) => {
      const sys = BODY_REGIONS[part] ?? [];
      const lay = layoutOf(part);
      const hidden = new Set(lay?.hidden ?? []);
      const all = [
        ...sys,
        ...customTags.filter(t => t.category === 'region' && t.parentPart === part).map(t => t.id),
      ].filter(id => !hidden.has(id));
      const order = (lay?.order ?? []).filter(id => all.includes(id));
      return [...order, ...all.filter(id => !order.includes(id))].map(id => ({ id, custom: !sys.includes(id) }));
    },
    [customTags, layoutOf],
  );

  const hiddenRegionsOf = useCallback(
    (part: string) => (layoutOf(part)?.hidden ?? []).filter(id => (BODY_REGIONS[part] ?? []).includes(id)),
    [layoutOf],
  );

  const effectiveRegion = useCallback(
    (ex: ExerciseDefinition): string | null => {
      // 有氧 / 自由不分细分（跑步机挂在腿部、划船机挂在背部，不能混进细分列）
      if ((ex.category || 'STRENGTH') !== 'STRENGTH' || !ex.region) return null;
      return regionsOf(ex.bodyPart).some(r => r.id === ex.region) ? ex.region : null;
    },
    [regionsOf],
  );

  const effectivePart = useCallback(
    (ex: ExerciseDefinition): string => {
      const bp = ex.bodyPart || '';
      if (!bp) return '';
      const lower = bp.toLowerCase();
      if (BODY_PARTS.some(p => p.toLowerCase() === lower)) return bp;
      return customTags.some(t => t.category === 'bodyPart' && t.id.toLowerCase() === lower) ? bp : '';
    },
    [customTags],
  );

  const getActiveMetrics = useCallback(
    (exerciseName: string): string[] =>
      exerciseMetricConfigs[resolveName(exerciseName)] || ['weight', 'reps'],
    [exerciseMetricConfigs, resolveName],
  );

  /** ====================== Actions ====================== */

  const toggleMetric = useCallback(
    (exerciseName: string, metricKey: string) => {
      setExerciseMetricConfigs(prev => {
        // 写回这个动作原来就有的那个键（可能是旧名 / 另一语言名），没有才用显示名新开
        const key = rawKeysFor(prev, exerciseName)[0] ?? resolveName(exerciseName);
        const current = prev[key] || ['weight', 'reps'];
        const normalizedCurrent = current.map(m => m.trim());
        const normalizedKey = metricKey.trim();
        const isCurrentlySelected = normalizedCurrent.includes(normalizedKey);

        let next: string[];
        if (isCurrentlySelected) {
          const indexToRemove = normalizedCurrent.indexOf(normalizedKey);
          next = current.filter((_, index) => index !== indexToRemove);
        } else {
          next = [...current, metricKey];
        }
        if (next.length === 0) next = ['reps'];
        const cleanNext = next.map(m => m.trim()).filter(m => m.length > 0);
        const updated = { ...prev, [key]: cleanNext };
        writeJSON(LS_KEYS.exerciseMetricConfigs, updated);
        storage.setItem(LS_KEYS.metricsLastUpdate, String(Date.now()));
        scheduleDebouncedFitlogPush();
        return updated;
      });
    },
    [rawKeysFor, resolveName],
  );

  const resetMetricsToDefault = useCallback((exerciseName: string) => {
    setExerciseMetricConfigs(prev => {
      const updated = { ...prev };
      for (const k of rawKeysFor(prev, exerciseName)) delete updated[k];
      writeJSON(LS_KEYS.exerciseMetricConfigs, updated);
      storage.setItem(LS_KEYS.metricsLastUpdate, String(Date.now()));
      scheduleDebouncedFitlogPush();
      return updated;
    });
  }, [rawKeysFor]);

  const toggleStarExercise = useCallback((exerciseName: string) => {
    setStarredExercises(prev => {
      const next = { ...prev };
      const keys = rawKeysFor(prev, exerciseName);
      // 取消收藏要把同一动作的所有原键一起删，否则旧名那个键会让它「取消不掉」
      if (keys.some(k => next[k])) for (const k of keys) delete next[k];
      else next[resolveName(exerciseName)] = Date.now();
      writeJSON(LS_KEYS.starredExercises, next);
      storage.setItem(LS_KEYS.starredLastUpdate, Date.now().toString());
      markPrefsUpdated();
      scheduleDebouncedFitlogPush();
      return next;
    });
  }, [rawKeysFor, resolveName]);

  const saveExerciseNote = useCallback((name: string, note: string) => {
    setExerciseNotes(prev => {
      const next = { ...prev };
      const keys = rawKeysFor(prev, name);
      for (const k of keys) delete next[k];
      if (note.trim()) next[resolveName(name)] = note;
      writeJSON(LS_KEYS.exerciseNotes, next);
      markPrefsUpdated();
      scheduleDebouncedFitlogPush();
      return next;
    });
  }, [rawKeysFor, resolveName]);

  const saveExerciseTags = useCallback(
    (
      exerciseId: string,
      bodyPart: string,
      tags: string[],
      region?: string,
      category?: ExerciseDefinition['category'],
    ) => {
      const isCustom = customExercises.some(c => c.id === exerciseId);
      const withRegion = {
        ...(region === undefined ? {} : { region }),
        ...(category === undefined ? {} : { category }),
      };
      if (isCustom) {
        setCustomExercises(prev => {
          const next = prev.map(c =>
            c.id === exerciseId ? { ...c, bodyPart, tags, ...withRegion } : c,
          );
          writeJSON(LS_KEYS.customExercises, next);
          return next;
        });
      } else {
        setExerciseOverrides(prev => {
          const current = prev[exerciseId] || {};
          const next = { ...current, bodyPart, tags, ...withRegion };
          const updated = { ...prev, [exerciseId]: next };
          writeJSON(LS_KEYS.exerciseOverrides, updated);
          return updated;
        });
      }
      markPrefsUpdated();
      scheduleDebouncedFitlogPush();
    },
    [customExercises],
  );

  /** 同一类标签的全部 id（部位 / 器材：系统 + 自建），查重用 */
  const idsOfKind = useCallback(
    (kind: 'bodyPart' | 'equipment') => [
      ...(kind === 'bodyPart' ? BODY_PARTS : EQUIPMENT_TAGS),
      ...customTags.filter(t => t.category === kind).map(t => t.id),
    ],
    [customTags],
  );
  const kindOfTag = useCallback(
    (id: string): 'bodyPart' | 'equipment' | null => {
      const lower = id.toLowerCase();
      if (BODY_PARTS.some(p => p.toLowerCase() === lower)) return 'bodyPart';
      if (EQUIPMENT_TAGS.some(p => p.toLowerCase() === lower)) return 'equipment';
      const ct = customTags.find(t => t.id.toLowerCase() === lower);
      return ct && (ct.category === 'bodyPart' || ct.category === 'equipment') ? ct.category : null;
    },
    [customTags],
  );
  const dupToast = useCallback(
    (name: string, where?: string) =>
      toast(
        lang === Language.CN ? `${where ?? ''}已经有「${name}」了` : `"${name}" already exists`,
        'error',
      ),
    [lang, toast],
  );

  const renameTag = useCallback(
    (id: string, newName: string): boolean => {
      const name = newName.trim();
      if (!name) return false;
      // 细分只在同一部位下查重（「内收」既可以是腿部细分，也可以是别处的东西）；
      // 被删掉（隐藏）的系统细分也算，不然恢复它时就成了两个同名
      const part = systemRegionPart(id) ?? customTags.find(t => t.id === id)?.parentPart;
      if (part) {
        const hiddenSys = (layoutOf(part)?.hidden ?? []).filter(h => (BODY_REGIONS[part] ?? []).includes(h));
        if ([...regionsOf(part).map(r => r.id), ...hiddenSys].some(r => r !== id && getTagName(r) === name)) {
          dupToast(name, getTagName(part));
          return false;
        }
      } else {
        // 部位之间、器材之间不许重名（原先「肩部」能改成「胸部」，部位行出现两个胸部）
        const kind = kindOfTag(id);
        if (kind && idsOfKind(kind).some(t => t.toLowerCase() !== id.toLowerCase() && getTagName(t) === name)) {
          dupToast(name);
          return false;
        }
      }
      setTagRenameOverrides(prev => {
        const updated = { ...prev, [id]: name };
        writeJSON(LS_KEYS.tagRenameOverrides, updated);
        return updated;
      });
      // 原先两样都没做：改名只活在本机，下次拉远端还会被旧快照盖回去
      markPrefsUpdated();
      scheduleDebouncedFitlogPush();
      return true;
    },
    [customTags, dupToast, getTagName, idsOfKind, kindOfTag, layoutOf, regionsOf],
  );

  const addTag = useCallback(
    (category: 'bodyPart' | 'equipment', name: string): string | null => {
      const n = name.trim();
      if (!n) return null;
      if (idsOfKind(category).some(t => getTagName(t) === n)) {
        dupToast(n);
        return null;
      }
      const id = `ct_${Date.now()}`;
      setCustomTags(prev => {
        const next = [...prev, { id, name: n, category }];
        writeJSON(LS_KEYS.customTags, next);
        return next;
      });
      markPrefsUpdated();
      scheduleDebouncedFitlogPush();
      return id;
    },
    [dupToast, getTagName, idsOfKind],
  );

  const deleteTag = useCallback(
    async (id: string) => {
      const tag = customTags.find(ct => ct.id === id);
      if (!tag) return;
      // 一律先执行 + 撤销（§12.5 通则 3），不弹确认。动作上的引用原样留着 ——
      // 细分：effectiveRegion 认不到被删的 id，动作自然回到「未细分」；
      // 部位：effectivePart 认不到，动作落到「未分部位」；器材：getTagName 返回空，不显示。
      // 撤销把标签放回原位置，动作也就回去了。
      const live = [...DEFAULT_EXERCISES, ...customExercises]
        .filter(d => !exerciseOverrides[d.id]?.hidden)
        .map(d => mergeOverride(d, exerciseOverrides[d.id]));
      const affected =
        tag.category === 'region'
          ? live.filter(d => d.region === id).length
          : tag.category === 'bodyPart'
            ? live.filter(d => (d.bodyPart || '').toLowerCase() === id.toLowerCase()).length
            : 0;
      const name = getTagName(id);
      const tagSnapshot = structuredClone(tag);
      const tagIndex = customTags.findIndex(ct => ct.id === id);
      const overrideSnapshot = tagRenameOverrides[id];

      setCustomTags(prev => {
        const next = prev.filter(ct => ct.id !== id);
        writeJSON(LS_KEYS.customTags, next);
        return next;
      });
      setTagRenameOverrides(prev => {
        const next = { ...prev };
        delete next[id];
        writeJSON(LS_KEYS.tagRenameOverrides, next);
        return next;
      });

      markPrefsUpdated();
      scheduleDebouncedFitlogPush();

      const cn = lang === Language.CN;
      const msg =
        tag.category === 'region'
          ? cn
            ? `已删除细分「${name}」${affected ? `，${affected} 个动作回到未细分` : ''}`
            : `Region deleted${affected ? ` — ${affected} back to unassigned` : ''}`
          : tag.category === 'bodyPart'
            ? cn
              ? `已删除部位「${name}」${affected ? `，${affected} 个动作回到未分部位` : ''}`
              : `Part deleted${affected ? ` — ${affected} now without a part` : ''}`
            : cn ? `已删除器材「${name}」` : 'Gear deleted';
      toastUndo(msg, () => {
        setCustomTags(prev => {
          const next = prev.filter(ct => ct.id !== id);
          next.splice(Math.min(Math.max(tagIndex, 0), next.length), 0, tagSnapshot);
          writeJSON(LS_KEYS.customTags, next);
          return next;
        });
        if (overrideSnapshot) {
          setTagRenameOverrides(prev => {
            const next = { ...prev, [id]: overrideSnapshot };
            writeJSON(LS_KEYS.tagRenameOverrides, next);
            return next;
          });
        }
        markPrefsUpdated();
        scheduleDebouncedFitlogPush();
      });
    },
    [customExercises, customTags, exerciseOverrides, getTagName, lang, tagRenameOverrides, toastUndo],
  );

  /**
   * 改名（第 7 条）。改的是动作库里的名字，历史记录一条都不改写 ——
   * 旧名推进 aliases，名字解析靠它把旧记录认回来；历史 / PR / 图表 / 备注 / 设置 / 收藏跟着走。
   *   - 覆盖层 name 按语言合并（只动当前语言那一个）
   *   - 与别的动作现名 / 曾用名重名 → 拒绝（否则两个动作的历史会被认成一个）
   *   - 备注 / 维度配置 / 收藏的原键搬到新名下（视图本来就认得旧键，搬是为了存储整洁）
   */
  const renameExercise = useCallback(
    (exerciseId: string, newName: string): boolean => {
      const next = newName.trim();
      const def = [...DEFAULT_EXERCISES, ...customExercises].find(d => d.id === exerciseId);
      if (!def || !next) return false;
      const current = exerciseOverrides[exerciseId] || {};
      const oldName = current.name?.[lang] || def.name[lang];
      if (next === oldName) return true;

      const clash = findExerciseDef(next);
      if (clash && clash.id !== exerciseId) {
        toast(
          lang === Language.CN
            ? `「${next}」已经是另一个动作的名字（或曾用名）`
            : `"${next}" is already used by another exercise`,
          'error',
        );
        return false;
      }

      // 在改名前的状态下找出要搬的原键（此刻的 resolveName 还认旧名）
      const moveKeys = <T,>(raw: Record<string, T>): Record<string, T> | null => {
        const keys = rawKeysFor(raw, oldName);
        if (!keys.length) return null;
        const out = { ...raw };
        const keep = keys.includes(oldName) ? oldName : keys[0];
        const val = raw[keep];
        for (const k of keys) delete out[k];
        out[next] = val;
        return out;
      };
      const notes = moveKeys(rawNotes);
      const metrics = moveKeys(rawMetricConfigs);
      const starred = moveKeys(rawStarred);

      // 自建动作中英本来是同一个名字：改名两种语言一起改（rename-custom-only-current-lang ——
      // 只改当前语言的话，切到英文还是旧名，还会跟另一个同名动作撞在一起）。内置动作仍按语言改。
      const isCustom = customExercises.some(c => c.id === exerciseId);
      const otherLang = lang === Language.CN ? Language.EN : Language.CN;
      const otherOld = current.name?.[otherLang] || def.name[otherLang];
      // 曾用名：旧名进去、新名出来（改回原来的名字时它就不再是「曾用」）
      const aliases = [
        ...new Set([...(current.aliases ?? []), oldName, ...(isCustom ? [otherOld] : [])]),
      ].filter(a => a && a !== next);
      const name = isCustom
        ? { cn: next, en: next }
        : { ...((current.name as ExerciseDefinition['name']) || {}), [lang]: next };
      const updated = {
        ...exerciseOverrides,
        [exerciseId]: { ...current, name, aliases } as Partial<ExerciseDefinition>,
      };
      setExerciseOverrides(updated);
      writeJSON(LS_KEYS.exerciseOverrides, updated);
      if (notes) {
        setExerciseNotes(notes);
        writeJSON(LS_KEYS.exerciseNotes, notes);
      }
      if (metrics) {
        setExerciseMetricConfigs(metrics);
        writeJSON(LS_KEYS.exerciseMetricConfigs, metrics);
        storage.setItem(LS_KEYS.metricsLastUpdate, String(Date.now()));
      }
      if (starred) {
        setStarredExercises(starred);
        writeJSON(LS_KEYS.starredExercises, starred);
        storage.setItem(LS_KEYS.starredLastUpdate, String(Date.now()));
      }
      markPrefsUpdated();
      scheduleDebouncedFitlogPush();
      return true;
    },
    [
      customExercises,
      exerciseOverrides,
      findExerciseDef,
      lang,
      rawKeysFor,
      rawMetricConfigs,
      rawNotes,
      rawStarred,
      toast,
    ],
  );

  /** 覆盖层里写 / 摘 hidden（内置、自建一样；自建动作的定义不再移走，所以能恢复，历史也还认得） */
  const writeHidden = useCallback((exId: string, hidden: boolean) => {
    setExerciseOverrides(prev => {
      const { hidden: _old, ...rest } = prev[exId] || {};
      const updated = { ...prev };
      if (hidden) updated[exId] = { ...rest, hidden: true };
      else if (Object.keys(rest).length) updated[exId] = rest;
      else delete updated[exId];
      writeJSON(LS_KEYS.exerciseOverrides, updated);
      return updated;
    });
    markPrefsUpdated();
    scheduleDebouncedFitlogPush();
  }, []);

  const displayNameOf = useCallback(
    (exId: string) => {
      const def = [...DEFAULT_EXERCISES, ...customExercises].find(d => d.id === exId);
      return def ? exerciseOverrides[exId]?.name?.[lang] || def.name[lang] : '';
    },
    [customExercises, exerciseOverrides, lang],
  );

  /**
   * 从动作库删除：先执行 + 撤销（§12.5 通则 3），不弹确认。
   * 原先自建动作会从 customExercises 里移走，撤销条一过就再也找不回来；现在统一只打 hidden，
   * 在整理的「已删除」里点一下就恢复。
   */
  const deleteLibraryExercise = useCallback(
    (exId: string) => {
      const name = displayNameOf(exId);
      writeHidden(exId, true);
      toastUndo(
        lang === Language.CN ? `已从动作库删除「${name}」` : `Deleted "${name}"`,
        () => writeHidden(exId, false),
      );
    },
    [displayNameOf, lang, toastUndo, writeHidden],
  );

  const restoreLibraryExercise = useCallback(
    (exId: string) => {
      writeHidden(exId, false);
      toast(lang === Language.CN ? `已恢复「${displayNameOf(exId)}」` : `Restored "${displayNameOf(exId)}"`, 'success');
    },
    [displayNameOf, lang, toast, writeHidden],
  );

  const addCustomExercise = useCallback((ex: ExerciseDefinition) => {
    setCustomExercises(prev => {
      const next = [ex, ...prev];
      writeJSON(LS_KEYS.customExercises, next);
      return next;
    });
    markPrefsUpdated();
    scheduleDebouncedFitlogPush();
  }, []);

  const addCustomTag = useCallback((tag: CustomTag) => {
    setCustomTags(prev => {
      const next = [...prev, tag];
      writeJSON(LS_KEYS.customTags, next);
      return next;
    });
    markPrefsUpdated();
    scheduleDebouncedFitlogPush();
  }, []);

  /** 归到细分：自建动作写进定义本身，内置动作写进覆盖层（已有同步容器，不新增 prefs key） */
  const assignRegion = useCallback(
    (exerciseId: string, regionId: string) => {
      if (customExercises.some(c => c.id === exerciseId)) {
        setCustomExercises(prev => {
          const next = prev.map(c => (c.id === exerciseId ? { ...c, region: regionId } : c));
          writeJSON(LS_KEYS.customExercises, next);
          return next;
        });
      } else {
        setExerciseOverrides(prev => {
          const updated = { ...prev, [exerciseId]: { ...(prev[exerciseId] || {}), region: regionId } };
          writeJSON(LS_KEYS.exerciseOverrides, updated);
          return updated;
        });
      }
      markPrefsUpdated();
      scheduleDebouncedFitlogPush();
    },
    [customExercises],
  );

  const applyRegionLayout = useCallback(
    (changes: { id: string; region: string; regionRank?: number }[]) => {
      if (!changes.length) return;
      const byId = new Map(changes.map(c => [c.id, c]));
      const customIds = new Set(customExercises.map(c => c.id));
      const put = <T extends Partial<ExerciseDefinition>>(base: T, ch: { region: string; regionRank?: number }): T => {
        const { regionRank: _old, ...rest } = base;
        return { ...rest, region: ch.region, ...(ch.regionRank != null ? { regionRank: ch.regionRank } : {}) } as T;
      };
      if (changes.some(c => customIds.has(c.id))) {
        setCustomExercises(prev => {
          const next = prev.map(c => (byId.has(c.id) ? put(c, byId.get(c.id)!) : c));
          writeJSON(LS_KEYS.customExercises, next);
          return next;
        });
      }
      if (changes.some(c => !customIds.has(c.id))) {
        setExerciseOverrides(prev => {
          const updated = { ...prev };
          for (const c of changes) if (!customIds.has(c.id)) updated[c.id] = put(prev[c.id] || {}, c);
          writeJSON(LS_KEYS.exerciseOverrides, updated);
          return updated;
        });
      }
      markPrefsUpdated();
      scheduleDebouncedFitlogPush();
    },
    [customExercises],
  );

  /** 写某个部位的细分布局（upsert 那一条 regionLayout） */
  const writeLayout = useCallback((part: string, patch: { order?: string[]; hidden?: string[] }) => {
    setCustomTags(prev => {
      const id = `regionLayout:${part}`;
      const cur = prev.find(t => t.id === id);
      const nextTag: CustomTag = { id, name: '', category: 'regionLayout', parentPart: part, ...cur, ...patch };
      const next = cur ? prev.map(t => (t.id === id ? nextTag : t)) : [...prev, nextTag];
      writeJSON(LS_KEYS.customTags, next);
      return next;
    });
    markPrefsUpdated();
    scheduleDebouncedFitlogPush();
  }, []);

  const addRegionTag = useCallback(
    (part: string, name: string): string | null => {
      const n = name.trim();
      if (!n) return null;
      if (regionsOf(part).some(r => getTagName(r.id) === n)) {
        dupToast(n, getTagName(part));
        return null;
      }
      // 撞上删掉的系统细分（duplicate-names-allowed：原先会建出第二个「中缝」）：直接恢复它
      const lay = layoutOf(part);
      const hiddenSys = (lay?.hidden ?? []).find(
        h => (BODY_REGIONS[part] ?? []).includes(h) && getTagName(h) === n,
      );
      if (hiddenSys) {
        writeLayout(part, { hidden: (lay?.hidden ?? []).filter(h => h !== hiddenSys) });
        toast(lang === Language.CN ? `已恢复细分「${n}」` : `Restored "${n}"`, 'success');
        return hiddenSys;
      }
      const id = `rg_${Date.now()}`;
      setCustomTags(prev => {
        const next = [...prev, { id, name: n, category: 'region' as const, parentPart: part }];
        writeJSON(LS_KEYS.customTags, next);
        return next;
      });
      markPrefsUpdated();
      scheduleDebouncedFitlogPush();
      return id;
    },
    [dupToast, getTagName, lang, layoutOf, regionsOf, toast, writeLayout],
  );

  /** 写练法表：自建动作写定义本身、内置动作写覆盖层 */
  const writeVariants = useCallback(
    (exerciseName: string, next: { id: string; name: string }[]) => {
      const def = findExerciseDef(exerciseName);
      if (!def) return;
      if (customExercises.some(c => c.id === def.id)) {
        setCustomExercises(prev => {
          const list = prev.map(c => (c.id === def.id ? { ...c, variants: next } : c));
          writeJSON(LS_KEYS.customExercises, list);
          return list;
        });
      } else {
        setExerciseOverrides(prev => {
          const updated = { ...prev, [def.id]: { ...(prev[def.id] || {}), variants: next } };
          writeJSON(LS_KEYS.exerciseOverrides, updated);
          return updated;
        });
      }
      markPrefsUpdated();
      scheduleDebouncedFitlogPush();
    },
    [customExercises, findExerciseDef],
  );

  const variantClash = useCallback(
    (exerciseName: string, name: string, exceptId?: string) => {
      const n = name.trim();
      const std = lang === Language.CN ? '标准' : 'Standard';
      return n === std || variantsOf(exerciseName).some(v => v.id !== exceptId && v.name === n);
    },
    [lang, variantsOf],
  );

  const addVariant = useCallback(
    (exerciseName: string, name: string): string | null => {
      const n = name.trim();
      if (!n || !findExerciseDef(exerciseName)) return null;
      if (variantClash(exerciseName, n)) {
        toast(lang === Language.CN ? `已经有「${n}」这个练法了` : `"${n}" already exists`, 'error');
        return null;
      }
      const id = `v_${Date.now()}`;
      writeVariants(exerciseName, [...variantsOf(exerciseName), { id, name: n }]);
      return id;
    },
    [findExerciseDef, lang, toast, variantClash, variantsOf, writeVariants],
  );

  const renameVariant = useCallback(
    (exerciseName: string, id: string, name: string): boolean => {
      const n = name.trim();
      if (!n) return false;
      if (variantClash(exerciseName, n, id)) {
        toast(lang === Language.CN ? `已经有「${n}」这个练法了` : `"${n}" already exists`, 'error');
        return false;
      }
      writeVariants(exerciseName, variantsOf(exerciseName).map(v => (v.id === id ? { ...v, name: n } : v)));
      return true;
    },
    [lang, toast, variantClash, variantsOf, writeVariants],
  );

  /** 删练法：历史记录里带着当时的名字，照样能显示、照样单独算 PR；撤销放回原位 */
  const removeVariant = useCallback(
    (exerciseName: string, id: string) => {
      const before = variantsOf(exerciseName);
      const gone = before.find(v => v.id === id);
      if (!gone) return;
      writeVariants(exerciseName, before.filter(v => v.id !== id));
      toastUndo(
        lang === Language.CN ? `已删除练法「${gone.name}」` : `Variant "${gone.name}" removed`,
        () => writeVariants(exerciseName, before),
      );
    },
    [lang, toastUndo, variantsOf, writeVariants],
  );

  const moveRegion = useCallback(
    (part: string, id: string, dir: -1 | 1) => {
      const ids = regionsOf(part).map(r => r.id);
      const i = ids.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      writeLayout(part, { order: ids });
    },
    [regionsOf, writeLayout],
  );

  /** 此刻落在某一列的动作数（撤销条里说「N 个动作回到未细分」） */
  const countInRegion = useCallback(
    (id: string) =>
      [...DEFAULT_EXERCISES, ...customExercises]
        .map(d => mergeOverride(d, exerciseOverrides[d.id]))
        .filter(d => d.region === id && !(exerciseOverrides[d.id] as { hidden?: boolean } | undefined)?.hidden)
        .length,
    [customExercises, exerciseOverrides],
  );

  const restoreRegion = useCallback(
    (part: string, id: string) => {
      writeLayout(part, { hidden: (layoutOf(part)?.hidden ?? []).filter(h => h !== id) });
    },
    [layoutOf, writeLayout],
  );

  const removeRegion = useCallback(
    (part: string, id: string) => {
      if (!(BODY_REGIONS[part] ?? []).includes(id)) {
        void deleteTag(id); // 自建细分：删标签（自带撤销条，不弹确认）
        return;
      }
      const n = countInRegion(id);
      const name = getTagName(id);
      writeLayout(part, { hidden: [...new Set([...(layoutOf(part)?.hidden ?? []), id])] });
      toastUndo(
        lang === Language.CN
          ? `已删除细分「${name}」${n ? `，${n} 个动作回到未细分` : ''}`
          : `Region removed${n ? ` — ${n} back to unassigned` : ''}`,
        () => restoreRegion(part, id),
      );
    },
    [countInRegion, deleteTag, getTagName, lang, layoutOf, restoreRegion, toastUndo, writeLayout],
  );

  const applyPrefsFromSnapshot = useCallback((p: FitlogSyncedPrefs) => {
    setCustomTags(Array.isArray(p.customTags) ? p.customTags : []);
    setCustomExercises(Array.isArray(p.customExercises) ? p.customExercises : []);
    setExerciseNotes(
      p.exerciseNotes && typeof p.exerciseNotes === 'object' ? p.exerciseNotes : {},
    );
    setStarredExercises(
      p.starredExercises && typeof p.starredExercises === 'object'
        ? p.starredExercises
        : {},
    );
    setExerciseMetricConfigs(
      p.exerciseMetricConfigs && typeof p.exerciseMetricConfigs === 'object'
        ? p.exerciseMetricConfigs
        : {},
    );
    setTagRenameOverrides(
      p.tagRenameOverrides && typeof p.tagRenameOverrides === 'object'
        ? p.tagRenameOverrides
        : {},
    );
    setExerciseOverrides(
      p.exerciseOverrides && typeof p.exerciseOverrides === 'object'
        ? p.exerciseOverrides
        : {},
    );
  }, []);

  const resetAllPrefs = useCallback(() => {
    setCustomTags([]);
    setCustomExercises([]);
    setExerciseNotes({});
    setExerciseMetricConfigs({});
    setStarredExercises({});
    setExerciseOverrides({});
    setTagRenameOverrides({});
    Object.values(LS_KEYS).forEach(k => storage.removeItem(k));
  }, []);

  const value: ExercisePrefsContextValue = useMemo(
    () => ({
      customTags,
      customExercises,
      exerciseNotes,
      exerciseMetricConfigs,
      starredExercises,
      exerciseOverrides,
      tagRenameOverrides,
      setCustomTags,
      setCustomExercises,
      setExerciseNotes,
      setExerciseMetricConfigs,
      setStarredExercises,
      setExerciseOverrides,
      setTagRenameOverrides,
      resolveName,
      findExerciseDef,
      regionsOf,
      hiddenRegionsOf,
      variantsOf,
      variantLabel,
      liftKey,
      effectiveRegion,
      effectivePart,
      getTagName,
      getActiveMetrics,
      toggleMetric,
      resetMetricsToDefault,
      toggleStarExercise,
      saveExerciseNote,
      saveExerciseTags,
      renameTag,
      deleteTag,
      renameExercise,
      deleteLibraryExercise,
      restoreLibraryExercise,
      addTag,
      addCustomExercise,
      addCustomTag,
      assignRegion,
      applyRegionLayout,
      addRegionTag,
      moveRegion,
      removeRegion,
      restoreRegion,
      addVariant,
      renameVariant,
      removeVariant,
      applyPrefsFromSnapshot,
      resetAllPrefs,
    }),
    [
      customTags,
      customExercises,
      exerciseNotes,
      exerciseMetricConfigs,
      starredExercises,
      exerciseOverrides,
      tagRenameOverrides,
      resolveName,
      findExerciseDef,
      regionsOf,
      hiddenRegionsOf,
      variantsOf,
      variantLabel,
      liftKey,
      effectiveRegion,
      effectivePart,
      getTagName,
      getActiveMetrics,
      toggleMetric,
      resetMetricsToDefault,
      toggleStarExercise,
      saveExerciseNote,
      saveExerciseTags,
      renameTag,
      deleteTag,
      renameExercise,
      deleteLibraryExercise,
      restoreLibraryExercise,
      addTag,
      addCustomExercise,
      addCustomTag,
      assignRegion,
      applyRegionLayout,
      addRegionTag,
      moveRegion,
      removeRegion,
      restoreRegion,
      addVariant,
      renameVariant,
      removeVariant,
      applyPrefsFromSnapshot,
      resetAllPrefs,
    ],
  );

  return (
    <ExercisePrefsContext.Provider value={value}>{children}</ExercisePrefsContext.Provider>
  );
};

export function useExercisePrefs(): ExercisePrefsContextValue {
  const ctx = useContext(ExercisePrefsContext);
  if (!ctx) {
    throw new Error('useExercisePrefs must be used within ExercisePrefsProvider');
  }
  return ctx;
}
