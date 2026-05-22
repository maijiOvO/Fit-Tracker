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
  renameExercise: (exerciseId: string, newName: string) => void;
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
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
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
  const { confirm, toastUndo } = useUiOverlay();

  const [customTags, setCustomTags] = useState<CustomTag[]>(() =>
    readJSON<CustomTag[]>(LS_KEYS.customTags, []),
  );
  const [customExercises, setCustomExercises] = useState<ExerciseDefinition[]>(() =>
    readJSON<ExerciseDefinition[]>(LS_KEYS.customExercises, []),
  );
  const [exerciseNotes, setExerciseNotes] = useState<Record<string, string>>(() =>
    readJSON<Record<string, string>>(LS_KEYS.exerciseNotes, {}),
  );
  const [exerciseMetricConfigs, setExerciseMetricConfigs] = useState<
    Record<string, string[]>
  >(() => {
    const parsed = readJSON<Record<string, string[]>>(LS_KEYS.exerciseMetricConfigs, {});
    const { cleaned, mutated } = sanitizeMetricConfigs(parsed);
    if (mutated) writeJSON(LS_KEYS.exerciseMetricConfigs, cleaned);
    return cleaned;
  });
  const [starredExercises, setStarredExercises] = useState<Record<string, number>>(() =>
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

  const resolveName = useCallback(
    (storedName: string): string => {
      const allDef = [...DEFAULT_EXERCISES, ...customExercises];
      const def = allDef.find(d => {
        const over = exerciseOverrides[d.id];
        return (
          d.name.en === storedName ||
          d.name.cn === storedName ||
          over?.name?.en === storedName ||
          over?.name?.cn === storedName
        );
      });
      if (def) {
        return exerciseOverrides[def.id]?.name?.[lang] || def.name[lang];
      }
      return storedName;
    },
    [customExercises, exerciseOverrides, lang],
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

  const getActiveMetrics = useCallback(
    (exerciseName: string): string[] =>
      exerciseMetricConfigs[exerciseName] || ['weight', 'reps'],
    [exerciseMetricConfigs],
  );

  /** ====================== Actions ====================== */

  const toggleMetric = useCallback(
    (exerciseName: string, metricKey: string) => {
      setExerciseMetricConfigs(prev => {
        const current = prev[exerciseName] || ['weight', 'reps'];
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
        const updated = { ...prev, [exerciseName]: cleanNext };
        writeJSON(LS_KEYS.exerciseMetricConfigs, updated);
        localStorage.setItem(LS_KEYS.metricsLastUpdate, String(Date.now()));
        scheduleDebouncedFitlogPush();
        return updated;
      });
    },
    [],
  );

  const resetMetricsToDefault = useCallback((exerciseName: string) => {
    setExerciseMetricConfigs(prev => {
      const updated = { ...prev };
      delete updated[exerciseName];
      writeJSON(LS_KEYS.exerciseMetricConfigs, updated);
      localStorage.setItem(LS_KEYS.metricsLastUpdate, String(Date.now()));
      scheduleDebouncedFitlogPush();
      return updated;
    });
  }, []);

  const toggleStarExercise = useCallback((exerciseName: string) => {
    setStarredExercises(prev => {
      const next = { ...prev };
      if (next[exerciseName]) delete next[exerciseName];
      else next[exerciseName] = Date.now();
      writeJSON(LS_KEYS.starredExercises, next);
      localStorage.setItem(LS_KEYS.starredLastUpdate, Date.now().toString());
      markPrefsUpdated();
      scheduleDebouncedFitlogPush();
      return next;
    });
  }, []);

  const saveExerciseNote = useCallback((name: string, note: string) => {
    setExerciseNotes(prev => {
      const next = { ...prev, [name]: note };
      if (!note.trim()) delete next[name];
      writeJSON(LS_KEYS.exerciseNotes, next);
      markPrefsUpdated();
      scheduleDebouncedFitlogPush();
      return next;
    });
  }, []);

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

  const renameExercise = useCallback(
    (exerciseId: string, newName: string) => {
      setExerciseOverrides(prev => {
        const current = prev[exerciseId] || {};
        const next: Partial<ExerciseDefinition> = {
          ...current,
          name: { ...((current.name as any) || {}), [lang]: newName },
        };
        const updated = { ...prev, [exerciseId]: next };
        writeJSON(LS_KEYS.exerciseOverrides, updated);
        return updated;
      });
      scheduleDebouncedFitlogPush();
    },
    [lang],
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
    Object.values(LS_KEYS).forEach(k => localStorage.removeItem(k));
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
