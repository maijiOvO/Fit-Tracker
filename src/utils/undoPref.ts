/**
 * 删组 / 删训练里的动作要不要给撤销条（2.6，2026-10-06 用户定：做成选项，默认关）。
 *
 * 只管这两处：训练页里删一组（含递减档）、删一个动作。删整场训练、删体重、并入上一场、
 * 从动作库删除这些照旧给撤销 —— 它们不在训练现场、而且删掉的东西更多。
 * 关着的时候：单击即删，不弹确认、不给撤销。
 *
 * 跟设备走（同振动开关），不进同步：它是手感偏好，不是数据。
 */
const KEY = 'fitlog_undo_workout_deletes';
let cached: boolean | null = null;

export function undoWorkoutDeletes(): boolean {
  if (cached === null) {
    try {
      cached = localStorage.getItem(KEY) === '1';
    } catch {
      cached = false;
    }
  }
  return cached;
}

export function setUndoWorkoutDeletes(on: boolean): void {
  cached = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* 写不进去时内存里的开关仍然生效 */
  }
}
