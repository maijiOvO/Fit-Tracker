import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { ScheduledWorkout } from '../../types';
import { db } from '../../services/db';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { FITLOG_SOLO_USER_ID } from '../../services/fitlogSolo';
import { recordTombstone } from '../../services/fitlogTombstones';

interface ScheduleContextType {
  schedules: ScheduledWorkout[];
  isLoading: boolean;
  addSchedule: (s: ScheduledWorkout) => Promise<void>;
  updateSchedule: (s: ScheduledWorkout) => Promise<void>;
  deleteSchedule: (id: string) => Promise<void>;
  refreshFromDb: () => Promise<void>;
  schedulesByDate: (date: string) => ScheduledWorkout[];
}

const ScheduleContext = createContext<ScheduleContextType | undefined>(undefined);

export const ScheduleProvider: React.FC<{ children: ReactNode; userId?: string }> = ({
  children,
  userId,
}) => {
  const [schedules, setSchedules] = useState<ScheduledWorkout[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshFromDb = useCallback(async () => {
    const rows = await db.getAll<ScheduledWorkout>('scheduledWorkouts');
    const uid = userId || FITLOG_SOLO_USER_ID;
    const filtered =
      uid === FITLOG_SOLO_USER_ID || uid === 'u_guest'
        ? rows
        : rows.filter(r => r.userId === uid);
    setSchedules(filtered.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)));
    setIsLoading(false);
  }, [userId]);

  useEffect(() => {
    void refreshFromDb();
  }, [userId, refreshFromDb]);

  const addSchedule = async (s: ScheduledWorkout) => {
    await db.upsert('scheduledWorkouts', s);
    setSchedules(prev => [...prev, s].sort((a, b) => (a.date < b.date ? -1 : 1)));
    scheduleDebouncedFitlogPush();
  };

  const updateSchedule = async (s: ScheduledWorkout) => {
    await db.upsert('scheduledWorkouts', s);
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
      value={{ schedules, isLoading, addSchedule, updateSchedule, deleteSchedule, refreshFromDb, schedulesByDate }}
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

export default ScheduleContext;
