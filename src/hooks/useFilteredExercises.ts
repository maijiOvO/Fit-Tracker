/**
 * 动作库派生数据 hook：最近练过的动作名 / bestLifts（PR）/ 热力图
 * （旧全屏动作库的过滤 useFilteredExercises 随 LibraryModal 一起删了，选动作统一走 ExercisePickerSheet）
 */
import { useMemo } from 'react';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { Language } from '../../types';
import { localYmd } from '../utils/dateUtils';
import { signedKg, usesSignedLoad } from '../utils/load';

/**
 * 与训练历史关联的派生数据：最近练过的动作名 + best lifts（PR）
 */
export function useExerciseStats() {
  const { workouts } = useWorkoutContext();
  const { resolveName, liftKey, starredExercises, exerciseOverrides, signedLoadOf } = useExercisePrefs();
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
    const liftsMap: Record<string, { weight: number; originalName: string; baseName: string; signed: boolean }> = {};
    workouts.forEach(session =>
      (session.exercises ?? []).forEach(ex => {
        // 底稿行不算数据（§12.6）：未收尾的草稿里可能带着 ghost 行，别让它顶进 PR
        // 带正负的负荷（自重类）按带符号的数比：辅助 −20 比 −30 好，自重 0、负重为正（原先自重动作永远是 0.0）
        const signed = usesSignedLoad(ex, signedLoadOf(ex.name));
        const realSets = (ex.sets ?? []).filter(s => !s.ghost);
        const weights = realSets.map(s => (signed ? signedKg(s, ex) : s.weight || 0));
        if (!weights.length) return;
        const w = Math.max(...weights);
        // 按显示名聚合：改过名的动作，旧名下的记录和新名下的是同一个动作，
        // 原先按存的原名分组会在 PR 列表里裂成两行（旧名那行还显示成新名）。
        // 练法（第 8 条）各占一行：「高位下拉（宽握）」和「高位下拉」是两个纪录
        const originalName = liftKey(ex);
        if (!liftsMap[originalName] || w > liftsMap[originalName].weight) {
          liftsMap[originalName] = { weight: w, originalName, baseName: resolveName(ex.name), signed };
        } else if (signed) {
          liftsMap[originalName].signed = true;
        }
      }),
    );

    return Object.entries(liftsMap)
      .map(([key, { weight, baseName, signed }]) => ({ name: key, key, weight, baseName, signed }))
      .sort((a, b) => {
        // 收藏按动作，不分练法
        const starA = starredExercises[a.baseName] || 0;
        const starB = starredExercises[b.baseName] || 0;
        if (starA !== starB) return starB - starA;
        return a.name.localeCompare(b.name, lang === Language.CN ? 'zh-Hans-CN' : 'en');
      });
  }, [workouts, lang, exerciseOverrides, starredExercises, resolveName, liftKey, signedLoadOf]);

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

        // 按本地日期归日（和 ActivityHeatmap 的网格同一个函数），不是 UTC 日期
        const dayString = localYmd(d);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dayString)) return;

        const sets = (w.exercises || []).reduce(
          (n: number, ex: any) =>
            n + (ex?.sets?.filter((s: any) => !s.ghost).length || 0),
          0,
        );
        // 一组都没做完的空场（放弃的、还在进行中的）不算一场
        if (sets === 0) return;
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
