import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Goal } from '../../types';
import { db } from '../../services/db';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { FITLOG_SOLO_USER_ID } from '../../services/fitlogSolo';
import { recordTombstone } from '../../services/fitlogTombstones';

interface GoalsContextType {
  goals: Goal[];
  isLoading: boolean;
  addGoal: (goal: Goal) => Promise<void>;
  updateGoal: (goal: Goal) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  refreshGoals: () => Promise<void>;
  refreshFromDb: () => Promise<void>;
}

const GoalsContext = createContext<GoalsContextType | undefined>(undefined);

export const GoalsProvider: React.FC<{ children: ReactNode; userId?: string }> = ({
  children,
  userId,
}) => {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshFromDb = useCallback(async () => {
    const localGoals = await db.getAll<Goal>('goals');
    const uid = userId || FITLOG_SOLO_USER_ID;
    const filtered =
      uid === FITLOG_SOLO_USER_ID || uid === 'u_guest'
        ? localGoals
        : localGoals.filter((g) => g.userId === uid);
    setGoals(filtered);
    setIsLoading(false);
  }, [userId]);

  useEffect(() => {
    void refreshFromDb();
  }, [userId, refreshFromDb]);

  const addGoal = async (goal: Goal) => {
    await db.upsert('goals', goal);
    setGoals((prev) => [...prev, goal]);
    scheduleDebouncedFitlogPush();
  };

  const updateGoal = async (goal: Goal) => {
    await db.upsert('goals', goal);
    setGoals((prev) => prev.map((g) => (g.id === goal.id ? goal : g)));
    scheduleDebouncedFitlogPush();
  };

  const deleteGoal = async (id: string) => {
    await db.delete('goals', id);
    recordTombstone('goals', id);
    setGoals((prev) => prev.filter((g) => g.id !== id));
    scheduleDebouncedFitlogPush();
  };

  return (
    <GoalsContext.Provider
      value={{
        goals,
        isLoading,
        addGoal,
        updateGoal,
        deleteGoal,
        refreshGoals: refreshFromDb,
        refreshFromDb,
      }}
    >
      {children}
    </GoalsContext.Provider>
  );
};

export const useGoalsContext = (): GoalsContextType => {
  const context = useContext(GoalsContext);
  if (!context) throw new Error('useGoalsContext must be used within GoalsProvider');
  return context;
};

export default GoalsContext;
