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
import { DEFAULT_EXERCISES } from '../constants/exercises';
import { markPrefsUpdated } from '../../services/fitlogRemote';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import type { FitlogSyncedPrefs } from '../../services/fitlogSnapshotTypes';
import { useUiOverlay } from './UiOverlayContext';
import { useUserSettingsContext } from './UserSettingsContext';
import { storage } from '../../services/appStorage';

export interface CustomTag {
  id: string;
  name: string;
  category: 'bodyPart' | 'equipment';
  parentCategory?: string;
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
  getTagName: (tid: string) => string;
  getActiveMetrics: (exerciseName: string) => string[];

  /** ============ Actions ============ */
  toggleMetric: (exerciseName: string, metricKey: string) => void;
  resetMetricsToDefault: (exerciseName: string) => void;
  toggleStarExercise: (exerciseName: string) => void;
  saveExerciseNote: (name: string, note: string) => void;
  saveExerciseTags: (exerciseId: string, bodyPart: string, tags: string[]) => void;
  renameTag: (id: string, newName: string) => void;
  deleteTag: (id: string) => Promise<void>;
  /** 返回 false = 没改成（重名 / 空名），调用方别关弹窗 */
  renameExercise: (exerciseId: string, newName: string) => boolean;
  deleteLibraryExercise: (
    exerciseId: string,
    options?: { skipConfirm?: boolean },
  ) => Promise<void>;
  addCustomExercise: (ex: ExerciseDefinition) => void;
  addCustomTag: (tag: CustomTag) => void;

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
  const { confirm, toast, toastUndo } = useUiOverlay();

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
   */
  const nameIndex = useMemo(() => {
    const m = new Map<string, ExerciseDefinition>();
    const defs = [...DEFAULT_EXERCISES, ...customExercises];
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
      return tid;
    },
    [customTags, tagRenameOverrides, lang],
  );

  // 按显示名查：原先直接拿传进来的名字查原键，中文下设的「跑步机 = 距离/时长/速度」
  // 到英文模式（名字是 Treadmill）就查不到，有氧变回重量 × 次数。
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
    (exerciseId: string, bodyPart: string, tags: string[]) => {
      const isCustom = customExercises.some(c => c.id === exerciseId);
      if (isCustom) {
        setCustomExercises(prev => {
          const next = prev.map(c =>
            c.id === exerciseId ? { ...c, bodyPart, tags } : c,
          );
          writeJSON(LS_KEYS.customExercises, next);
          return next;
        });
      } else {
        setExerciseOverrides(prev => {
          const current = prev[exerciseId] || {};
          const next = { ...current, bodyPart, tags };
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

  const renameTag = useCallback((id: string, newName: string) => {
    setTagRenameOverrides(prev => {
      const updated = { ...prev, [id]: newName };
      writeJSON(LS_KEYS.tagRenameOverrides, updated);
      return updated;
    });
    // 原先两样都没做：改名只活在本机，下次拉远端还会被旧快照盖回去
    markPrefsUpdated();
    scheduleDebouncedFitlogPush();
  }, []);

  const deleteTag = useCallback(
    async (id: string) => {
      const tag = customTags.find(ct => ct.id === id);
      if (!tag) return;
      const ok = await confirm({
        message:
          lang === Language.CN
            ? `确定删除标签「${tag.name}」吗？\n（已经标记过这个标签的动作会保留这个引用，但筛选器里不再出现。）`
            : `Delete tag "${tag.name}"?\nExercises already tagged with it will keep the reference but it will no longer appear in filters.`,
        danger: true,
        confirmLabel: lang === Language.CN ? '删除' : 'Delete',
      });
      if (!ok) return;

      const tagSnapshot = structuredClone(tag);
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

      toastUndo(lang === Language.CN ? '已删除标签' : 'Tag deleted', () => {
        setCustomTags(prev => {
          const next = [...prev, tagSnapshot];
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
    [confirm, customTags, lang, tagRenameOverrides, toastUndo],
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

      // 曾用名：旧名进去、新名出来（改回原来的名字时它就不再是「曾用」）
      const aliases = [...new Set([...(current.aliases ?? []), oldName])].filter(
        a => a && a !== next,
      );
      const updated = {
        ...exerciseOverrides,
        [exerciseId]: {
          ...current,
          name: { ...((current.name as ExerciseDefinition['name']) || {}), [lang]: next },
          aliases,
        } as Partial<ExerciseDefinition>,
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

  const deleteLibraryExercise = useCallback(
    async (exId: string, options?: { skipConfirm?: boolean }) => {
      if (!options?.skipConfirm) {
        const ok = await confirm({
          message:
            lang === Language.CN
              ? '确定要从动作库中删除此动作吗？'
              : 'Delete this exercise from library?',
          danger: true,
          confirmLabel: lang === Language.CN ? '删除' : 'Delete',
        });
        if (!ok) return;
      }

      const customSnapshot = customExercises.find(ex => ex.id === exId);
      const overrideSnapshot = exerciseOverrides[exId];

      setCustomExercises(prev => {
        const next = prev.filter(ex => ex.id !== exId);
        writeJSON(LS_KEYS.customExercises, next);
        return next;
      });
      setExerciseOverrides(prev => {
        const current = prev[exId] || {};
        const next: Partial<ExerciseDefinition> & { hidden?: boolean } = {
          ...current,
          hidden: true,
        };
        const updated = { ...prev, [exId]: next };
        writeJSON(LS_KEYS.exerciseOverrides, updated);
        return updated;
      });
      markPrefsUpdated();
      scheduleDebouncedFitlogPush();

      if (!options?.skipConfirm) {
        toastUndo(
          lang === Language.CN ? '已从动作库移除' : 'Removed from library',
          () => {
            if (customSnapshot) {
              setCustomExercises(prev => {
                const next = [customSnapshot, ...prev.filter(ex => ex.id !== exId)];
                writeJSON(LS_KEYS.customExercises, next);
                return next;
              });
            }
            setExerciseOverrides(prev => {
              const updated = { ...prev };
              if (overrideSnapshot) {
                updated[exId] = overrideSnapshot;
              } else {
                delete updated[exId];
              }
              writeJSON(LS_KEYS.exerciseOverrides, updated);
              return updated;
            });
            markPrefsUpdated();
            scheduleDebouncedFitlogPush();
          },
        );
      }
    },
    [confirm, customExercises, exerciseOverrides, lang, toastUndo],
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
      addCustomExercise,
      addCustomTag,
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
      addCustomExercise,
      addCustomTag,
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
