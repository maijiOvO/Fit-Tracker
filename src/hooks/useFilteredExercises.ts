/**
 * 动作库过滤 + 派生数据 hook
 * 输入：搜索词、所选标签、当前分类
 * 输出：过滤后的动作列表 / 最近练过的动作名 / bestLifts（PR）
 */
import { useMemo } from 'react';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import {
  BODY_PARTS,
  DEFAULT_EXERCISES,
  EQUIPMENT_TAGS,
  ExerciseCategory,
} from '../constants/exercises';
import { Language } from '../../types';
import { buildSearchEntry, scoreEntry, tokenize } from '../utils/exerciseSearch';

export interface FilteredExercisesParams {
  searchQuery: string;
  selectedTags: string[];
  activeLibraryCategory: ExerciseCategory | null;
}

/**
 * 根据 UI 状态过滤动作库
 */
export function useFilteredExercises({
  searchQuery,
  selectedTags,
  activeLibraryCategory,
}: FilteredExercisesParams) {
  const { customExercises, exerciseOverrides, customTags, getTagName } = useExercisePrefs();
  const { lang } = useUserSettingsContext();

  return useMemo(() => {
    const allBase = [...DEFAULT_EXERCISES, ...customExercises];

    const all = allBase
      .map(ex => (exerciseOverrides[ex.id] ? { ...ex, ...exerciseOverrides[ex.id] } : ex))
      .filter(ex => !(exerciseOverrides[ex.id] as any)?.hidden)
      .filter(ex =>
        activeLibraryCategory === null
          ? true
          : (ex.category || 'STRENGTH') === activeLibraryCategory,
      );

    // 搜索：分词 + 中英双名 + 拼音全拼/首字母 + 中文子序列 + 标签名（见 utils/exerciseSearch）
    const tokens = tokenize(searchQuery);

    const scored = all
      .map(ex => {
        if (!ex.name || !ex.name[lang]) {
          console.warn('Exercise missing name:', ex);
          return null;
        }
        let score = 1;
        if (tokens.length > 0) {
          const tagNames: string[] = [];
          if (ex.bodyPart) {
            const n = getTagName(ex.bodyPart);
            if (n) tagNames.push(n);
          }
          for (const t of ex.tags ?? []) {
            const n = getTagName(t);
            if (n) tagNames.push(n);
          }
          score = scoreEntry(
            buildSearchEntry(ex.name.cn ?? '', ex.name.en ?? '', tagNames),
            tokens,
          );
          if (score === 0) return null;
        }

        const selParts = selectedTags.filter(
          t =>
            BODY_PARTS.some(bp => bp.toLowerCase() === t.toLowerCase()) ||
            customTags.some(ct => ct.id === t && ct.category === 'bodyPart'),
        );
        const selEquips = selectedTags.filter(
          t =>
            EQUIPMENT_TAGS.some(et => et.toLowerCase() === t.toLowerCase()) ||
            customTags.some(ct => ct.id === t && ct.category === 'equipment'),
        );

        const matchPart =
          selParts.length === 0 ||
          selParts.some(sp => {
            const bodyPart = ex.bodyPart || '';
            return sp.toLowerCase() === bodyPart.toLowerCase();
          });

        const matchEquip =
          selEquips.length === 0 ||
          (ex.tags &&
            Array.isArray(ex.tags) &&
            ex.tags.some(t =>
              selEquips.some(se => se.toLowerCase() === (t || '').toLowerCase()),
            ));

        return matchPart && matchEquip ? { ex, score } : null;
      })
      .filter((r): r is { ex: (typeof all)[number]; score: number } => r !== null);

    // 有搜索词时按匹配质量排序；否则保持库内顺序
    if (tokens.length > 0) scored.sort((a, b) => b.score - a.score);
    return scored.map(r => r.ex);
  }, [
    customExercises,
    exerciseOverrides,
    customTags,
    getTagName,
    activeLibraryCategory,
    searchQuery,
    selectedTags,
    lang,
  ]);
}

/**
 * 与训练历史关联的派生数据：最近练过的动作名 + best lifts（PR）
 */
export function useExerciseStats() {
  const { workouts } = useWorkoutContext();
  const { resolveName, starredExercises, exerciseOverrides } = useExercisePrefs();
  const { lang } = useUserSettingsContext();

  const recentExerciseNames = useMemo(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    const sorted = [...workouts].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    for (const w of sorted) {
      for (const ex of w.exercises) {
        const n = resolveName(ex.name);
        const key = n.toLowerCase();
        if (n && !seen.has(key)) {
          seen.add(key);
          names.push(n);
          if (names.length >= 12) return names;
        }
      }
    }
    return names;
  }, [workouts, resolveName]);

  const bestLifts = useMemo(() => {
    const liftsMap: Record<string, { weight: number; originalName: string }> = {};
    workouts.forEach(session =>
      (session.exercises ?? []).forEach(ex => {
        const weights = (ex.sets ?? []).map(s => s.weight || 0);
        const w = weights.length ? Math.max(...weights) : 0;
        const originalName = ex.name;
        if (!liftsMap[originalName] || w > liftsMap[originalName].weight) {
          liftsMap[originalName] = { weight: w, originalName };
        }
      }),
    );

    return Object.entries(liftsMap)
      .map(([key, { weight }]) => ({ name: resolveName(key), key, weight }))
      .sort((a, b) => {
        const starA = starredExercises[a.key] || 0;
        const starB = starredExercises[b.key] || 0;
        if (starA !== starB) return starB - starA;
        return a.name.localeCompare(b.name, lang === Language.CN ? 'zh-Hans-CN' : 'en');
      });
  }, [workouts, lang, exerciseOverrides, starredExercises, resolveName]);

  /**
   * 训练日历热力图数据。
   *
   * ⚠️ 强度按【当日总组数】统计而不是场数（§6.5）：
   * 单人自用一天几乎只有 1 场，按场数分档会退化成一张二值图。
   * 场数仍然记着，只用于提示文案。
   */
  const heatmapData = useMemo(() => {
    if (!workouts || workouts.length === 0) return [];

    const map = new Map<string, { sets: number; sessions: number }>();
    workouts.forEach((w, index) => {
      try {
        if (!w || typeof w !== 'object') return;
        if (!w.date || typeof w.date !== 'string') return;
        const d = new Date(w.date);
        if (isNaN(d.getTime())) return;
        const currentYear = new Date().getFullYear();
        const workoutYear = d.getFullYear();
        if (workoutYear < 1900 || workoutYear > currentYear + 10) return;

        let dayString: string;
        try {
          dayString = d.toISOString().split('T')[0];
        } catch {
          return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dayString)) return;

        const sets = (w.exercises || []).reduce(
          (n: number, ex: any) => n + (ex?.sets?.length || 0),
          0,
        );
        const prev = map.get(dayString) || { sets: 0, sessions: 0 };
        map.set(dayString, { sets: prev.sets + sets, sessions: prev.sessions + 1 });
      } catch (e) {
        console.warn(`Error processing workout at index ${index}:`, e, w);
      }
    });

    return Array.from(map.entries())
      .map(([date, v]) => ({ date, sets: v.sets, sessions: v.sessions }))
      .filter(item => item.sessions > 0 && /^\d{4}-\d{2}-\d{2}$/.test(item.date));
  }, [workouts]);

  return { recentExerciseNames, bestLifts, heatmapData };
}
