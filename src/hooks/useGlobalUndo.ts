/**
 * 按下全局撤销 / 重做之后的收尾（App 登记一次，按钮调 runGlobalUndo）：
 *   - 写回由 services/undoJournal.ts 做；这里让界面跟上：各个数据源从库里重读（和同步拉取之后同一条路，
 *     useFitlogSync 接 fitlog:local-restored），计划单独重读。
 *   - 撤销回来的那一份要推上服务器：标脏 + 排一次推送（推送是整份覆盖，墓碑跟着撤销一起回去）。
 *   - 不弹提示（2026-10-25 用户定：撤销 / 重做本身就是反馈，底部只留报错这类没做成的提示）。
 *   - 撤销「结束训练」：那场回到进行中，跳回训练页。别的撤销不跳页。
 */
import { useEffect, useRef } from 'react';
import type { WorkoutSession } from '../../types';
import { undoJournal } from '../../services/undoJournal';
import { invalidateAppPrefsCache } from '../../services/appPrefs';
import { markPushDirty } from '../../services/fitlogRemoteSync';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';

type Direction = 'undo' | 'redo';

let host: ((d: Direction) => Promise<void>) | null = null;

export function runGlobalUndo(d: Direction): Promise<void> {
  return host ? host(d) : Promise.resolve();
}

export interface GlobalUndoDeps {
  activeTab: string;
  goTo: (tab: 'new') => void;
  refreshSchedules: () => Promise<void>;
}

const hasExercises = (w: unknown) => ((w as WorkoutSession | undefined)?.exercises?.length ?? 0) > 0;

export function useGlobalUndoHost(deps: GlobalUndoDeps): void {
  const ref = useRef(deps);
  ref.current = deps;
  useEffect(() => {
    host = async (d: Direction) => {
      const res = d === 'undo' ? await undoJournal.undo() : await undoJournal.redo();
      if (!res) return;
      const { activeTab, goTo, refreshSchedules } = ref.current;
      invalidateAppPrefsCache();
      window.dispatchEvent(new CustomEvent('fitlog:local-restored'));
      if (res.stores.includes('scheduledWorkouts')) void refreshSchedules();
      markPushDirty();
      scheduleDebouncedFitlogPush();

      const cw = res.sources.currentWorkout;
      // 工作台从空的变回有一场（撤销结束训练）或换了一场：跳回训练页。别的情况不跳页（2026-10-25 用户定）
      if (cw && hasExercises(cw.to) && activeTab !== 'new') {
        if (!hasExercises(cw.from) || (cw.from as WorkoutSession).id !== (cw.to as WorkoutSession).id) goTo('new');
      }
    };
    return () => {
      host = null;
    };
  }, []);
}
