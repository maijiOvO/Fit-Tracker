import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { ScheduledWorkout } from '../../types';
import { db } from '../../services/db';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { recordTombstone } from '../../services/fitlogTombstones';

interface ScheduleContextType {
  schedules: ScheduledWorkout[];
  addSchedule: (s: ScheduledWorkout) => Promise<void>;
  updateSchedule: (s: ScheduledWorkout) => Promise<void>;
  deleteSchedule: (id: string) => Promise<void>;
  refreshFromDb: () => Promise<void>;
  schedulesByDate: (date: string) => ScheduledWorkout[];
}

const ScheduleContext = createContext<ScheduleContextType | undefined>(undefined);

export const ScheduleProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [schedules, setSchedules] = useState<ScheduledWorkout[]>([]);

  const refreshFromDb = useCallback(async () => {
    const rows = await db.getAll<ScheduledWorkout>('scheduledWorkouts');
    setSchedules(rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)));
  }, []);

  useEffect(() => {
    // 读不出来由 db.ts 报出去（首页显示「读不出本机数据」），这里只记日志，不留没人接的 rejection
    refreshFromDb().catch(err => console.error('[ScheduleContext] 读计划失败:', err));
  }, [refreshFromDb]);

  const addSchedule = async (s: ScheduledWorkout) => {
    await db.save('scheduledWorkouts', s);
    setSchedules(prev => [...prev, s].sort((a, b) => (a.date < b.date ? -1 : 1)));
    scheduleDebouncedFitlogPush();
  };

  const updateSchedule = async (s: ScheduledWorkout) => {
    await db.save('scheduledWorkouts', s);
    setSchedules(prev =>
      prev.map(p => (p.id === s.id ? s : p)).sort((a, b) => (a.date < b.date ? -1 : 1)),
    );
    scheduleDebouncedFitlogPush();
  };

  const deleteSchedule = async (id: string) => {
    await db.delete('scheduledWorkouts', id);
    recordTombstone('scheduledWorkouts', id);
    setSchedules(prev => prev.filter(p => p.id !== id));
    scheduleDebouncedFitlogPush();
  };

  const byDate = useMemo(() => {
    const map = new Map<string, ScheduledWorkout[]>();
    for (const s of schedules) {
      const list = map.get(s.date) ?? [];
      list.push(s);
      map.set(s.date, list);
    }
    return map;
  }, [schedules]);

  const schedulesByDate = useCallback((date: string) => byDate.get(date) ?? [], [byDate]);

  return (
    <ScheduleContext.Provider
      value={{ schedules, addSchedule, updateSchedule, deleteSchedule, refreshFromDb, schedulesByDate }}
    >
      {children}
    </ScheduleContext.Provider>
  );
};

export const useScheduleContext = (): ScheduleContextType => {
  const ctx = useContext(ScheduleContext);
  if (!ctx) throw new Error('useScheduleContext must be used within ScheduleProvider');
  return ctx;
};
