import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Goal } from '../../types';
import { db } from '../../services/db';
import { supabase } from '../../services/supabase';

interface GoalsContextType {
  goals: Goal[];
  isLoading: boolean;
  addGoal: (goal: Goal) => Promise<void>;
  updateGoal: (goal: Goal) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  refreshGoals: () => Promise<void>;
}

const GoalsContext = createContext<GoalsContextType | undefined>(undefined);

export const GoalsProvider: React.FC<{ children: ReactNode; userId?: string }> = ({ 
  children, 
  userId 
}) => {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadGoals();
  }, [userId]);

  const loadGoals = async () => {
    try {
      const localGoals = await db.getAll('goals');
      setGoals(localGoals);
      
      if (userId && userId !== 'u_guest') {
        const { data: cloudGoals } = await supabase
          .from('goals')
          .select('*')
          .eq('user_id', userId);
          
        if (cloudGoals && cloudGoals.length > 0) {
          const merged = mergeGoals(localGoals, cloudGoals);
          setGoals(merged);
          for (const goal of merged) {
            await db.upsert('goals', goal);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load goals:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const mergeGoals = (local: Goal[], cloud: any[]): Goal[] => {
    const map = new Map(local.map(g => [g.id, g]));
    for (const cg of cloud) {
      const localGoal = map.get(cg.id);
      if (!localGoal) {
        map.set(cg.id, cg as Goal);
      } else {
        const localTime = new Date(localGoal.updatedAt || 0).getTime();
        const cloudTime = new Date(cg.updated_at || 0).getTime();
        if (cloudTime > localTime) {
          map.set(cg.id, cg as Goal);
        }
      }
    }
    return Array.from(map.values());
  };

  const addGoal = async (goal: Goal) => {
    await db.upsert('goals', goal);
    setGoals(prev => [...prev, goal]);
    
    if (userId && userId !== 'u_guest') {
      await supabase.from('goals').upsert({
        id: goal.id,
        user_id: userId,
        title: goal.title,
        type: goal.type,
        targetValue: goal.targetValue,
        currentValue: goal.currentValue,
        unit: goal.unit,
        isActive: goal.isActive,
        created_at: goal.createdAt,
        updated_at: goal.updatedAt,
      });
    }
  };

  const updateGoal = async (goal: Goal) => {
    await db.upsert('goals', goal);
    setGoals(prev => prev.map(g => g.id === goal.id ? goal : g));
    
    if (userId && userId !== 'u_guest') {
      await supabase.from('goals').upsert({
        id: goal.id,
        user_id: userId,
        title: goal.title,
        type: goal.type,
        targetValue: goal.targetValue,
        currentValue: goal.currentValue,
        unit: goal.unit,
        isActive: goal.isActive,
        created_at: goal.createdAt,
        updated_at: goal.updatedAt,
      });
    }
  };

  const deleteGoal = async (id: string) => {
    await db.delete('goals', id);
    setGoals(prev => prev.filter(g => g.id !== id));
    
    if (userId && userId !== 'u_guest') {
      await supabase.from('goals').delete().eq('id', id);
    }
  };

  return (
    <GoalsContext.Provider value={{
      goals,
      isLoading,
      addGoal,
      updateGoal,
      deleteGoal,
      refreshGoals: loadGoals,
    }}>
      {children}
    </GoalsContext.Provider>
  );
};

export const useGoalsContext = (): GoalsContextType => {
  const context = useContext(GoalsContext);
  if (!context) {
    throw new Error('useGoalsContext must be used within GoalsProvider');
  }
  return context;
};

export default GoalsContext;
