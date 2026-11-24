/**
 * 本机数据读 / 写失败的常驻红签（上架审查 C13 / C14）：原来只在第一次失败时弹 3.5 秒的提示，
 * 单机版的顶栏又没有同步按钮可以变红，之后记的组只在内存里、进程一被杀就没了，界面上看不出来。
 * 挂在顶栏撤销按钮旁和训练页头部，状态翻回来（db-write-ok / db-read-ok）就撤掉。
 * 点一下：写失败补写一次（腾出空间后不用等下一次改动），读失败重载。
 */
import React from 'react';
import { AlertCircle } from 'lucide-react';
import { useLocalDataHealth } from '../hooks/useLocalDataHealth';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';

export const LocalDataAlert: React.FC<{ isCn: boolean }> = ({ isCn }) => {
  const { readFailing, writeFailing } = useLocalDataHealth();
  const { persistCurrentWorkout } = useWorkoutContext();
  const { toast } = useUiOverlay();
  if (!readFailing && !writeFailing) return null;
  const onTap = () => {
    if (readFailing) return window.location.reload();
    persistCurrentWorkout();
    toast(isCn ? '存不进本机：之后的改动先留在内存里，清理空间后会整场补存' : "Can't save on this phone: changes stay in memory and are saved once there's space", 'error');
  };
  return (
    <button
      type="button"
      onClick={onTap}
      data-testid={readFailing ? 'local-read-failed' : 'local-write-failed'}
      className="flex items-center gap-1 px-2 py-1 rounded-control bg-danger-soft text-danger text-label font-semibold whitespace-nowrap active:scale-press-sm transition-ui"
    >
      <AlertCircle size={14} strokeWidth={2} />
      {readFailing ? (isCn ? '读不出' : "Can't read") : isCn ? '没存上' : 'Not saved'}
    </button>
  );
};
