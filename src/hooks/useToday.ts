/**
 * 今天的本地日期键（YYYY-MM-DD），跨过零点会变（审查 C78）。
 * 以前各处挂载时算一次「今天」：前台过了零点、或昨晚切后台今早回来，首页的今日计划、计划页的今天、热力图都还停在昨天。
 * 到点用定时器重算；切回前台再算一次 —— 后台的定时器会被系统冻住或推迟。
 */
import { useEffect, useState } from 'react';
import { localYmd, msToNextLocalMidnight } from '../utils/dateUtils';

export function useToday(): string {
  const [key, setKey] = useState(() => localYmd(new Date()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => setKey(localYmd(new Date()));
    // 多等 1 秒，免得定时器提前几毫秒触发时还算成昨天
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        refresh();
        arm();
      }, msToNextLocalMidnight(new Date()) + 1000);
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      refresh();
      arm();
    };
    arm();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return key;
}
