import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Goal } from '../../types';
import { db } from '../../services/db';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { recordTombstone } from '../../services/fitlogTombstones';

interface GoalsContextType {
  goals: Goal[];
  addGoal: (goal: Goal) => Promise<void>;
  updateGoal: (goal: Goal) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  refreshFromDb: () => Promise<void>;
}

const GoalsContext = createContext<GoalsContextType | undefined>(undefined);

export const GoalsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [goals, setGoals] = useState<Goal[]>([]);

  const refreshFromDb = useCallback(async () => {
    setGoals(await db.getAll<Goal>('goals'));
  }, []);

  useEffect(() => {
    void refreshFromDb();
  }, [refreshFromDb]);

  const addGoal = async (goal: Goal) => {
    await db.save('goals', goal);
    setGoals((prev) => [...prev, goal]);
    scheduleDebouncedFitlogPush();
  };

  const updateGoal = async (goal: Goal) => {
    await db.save('goals', goal);
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
        addGoal,
        updateGoal,
        deleteGoal,
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
