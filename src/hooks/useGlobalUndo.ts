/**
 * 按下全局撤销 / 重做之后的收尾（App 登记一次，按钮调 runGlobalUndo）：
 *   - 写回由 services/undoJournal.ts 做；这里让界面跟上：各个数据源从库里重读（和同步拉取之后同一条路，
 *     useFitlogSync 接 fitlog:local-restored），计划单独重读。
 *   - 撤销回来的那一份要推上服务器：标脏 + 排一次推送（推送是整份覆盖，墓碑跟着撤销一起回去；
 *     动到墓碑时以本机为准，见下面）。
 *   - 做成了不弹提示（2026-10-25 用户定：撤销 / 重做本身就是反馈，底部只留报错这类没做成的提示）；
 *     没做成（写不进本机，这一步还在）、撤不回（读不到改之前的记录，更早的历史也清掉了）弹报错。
 *   - 撤销「结束训练」：那场回到进行中，跳回训练页。别的撤销不跳页。
 *   - 撤销 / 重做把编辑态写回成「不在编辑」（重做「保存修改」、撤销「进编辑」）：接回进行中的那场。
 *     写回的工作台是当时退出编辑那一刻的样子（可能是空场），进行中那场接回是之后系统做的、不在这一步里（上架审查 C07）。
 */
import { useEffect, useRef } from 'react';
import type { WorkoutSession } from '../../types';
import { undoJournal } from '../../services/undoJournal';
import { invalidateAppPrefsCache } from '../../services/appPrefs';
import { markLocalAuthoritative, markPushDirty } from '../../services/fitlogRemoteSync';
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
  toast: (message: string, variant: 'error') => void;
  isCn: boolean;
  restoreInProgress: () => Promise<void>;
}

const hasExercises = (w: unknown) => ((w as WorkoutSession | undefined)?.exercises?.length ?? 0) > 0;

export function useGlobalUndoHost(deps: GlobalUndoDeps): void {
  const ref = useRef(deps);
  ref.current = deps;
  useEffect(() => {
    host = async (d: Direction) => {
      const res = d === 'undo' ? await undoJournal.undo() : await undoJournal.redo();
      if (!res) return;
      const { activeTab, goTo, refreshSchedules, toast, isCn, restoreInProgress } = ref.current;
      if (res.outcome === 'blocked') {
        // 什么都没写，不用重读
        toast(
          isCn
            ? '这一步撤不回：读不到改之前的记录，更早的改动也撤不回了'
            : "Can't undo this step: the earlier version couldn't be read, so older changes can't be undone either",
          'error',
        );
        return;
      }
      invalidateAppPrefsCache();
      window.dispatchEvent(new CustomEvent('fitlog:local-restored'));
      if (res.stores.includes('scheduledWorkouts')) void refreshSchedules();
      // 撤销 / 重做动到了墓碑（撤销删除）：下一次推送以本机为准、启动时先推不拉。只标脏的话，推送没落地就被杀，
      // 下次启动先拉，服务器上那条墓碑并回来，撤销回来的记录又被删掉（墓碑取并集是单调的，审查 E6）
      if (res.keys.includes('fitlog_tombstones')) markLocalAuthoritative();
      else markPushDirty();
      scheduleDebouncedFitlogPush();
      // 没做成也照上面重读、标脏：库里的行是一个事务、没动，键可能写了一半
      if (res.outcome === 'failed') {
        toast(
          d === 'undo'
            ? isCn
              ? '没撤成：本机存储写不进去，这一步还在，腾出空间后再按一次'
              : "Couldn't undo: device storage wouldn't take the write. The step is still there — free up space and try again"
            : isCn
              ? '没重做成：本机存储写不进去，这一步还在，腾出空间后再按一次'
              : "Couldn't redo: device storage wouldn't take the write. The step is still there — free up space and try again",
          'error',
        );
        return;
      }

      // 不能放进 editMode 的 set 里：写回先写 editMode、后写工作台，在那里接回会看到旧工作台、直接返回
      const em = res.sources.editMode;
      if (em && (em.to as { id: string | null }).id === null) void restoreInProgress();

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
