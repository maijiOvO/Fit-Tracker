import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { WorkoutSession, Exercise, ExerciseDefinition, Goal } from '../../types';
import { db } from '../../services/db';
import { supabase } from '../../services/supabase';

interface WorkoutContextType {
  // State
  workouts: WorkoutSession[];
  currentWorkout: WorkoutSession | null;
  isLoading: boolean;
  
  // CRUD Operations
  addWorkout: (workout: WorkoutSession) => Promise<void>;
  updateWorkout: (workout: WorkoutSession) => Promise<void>;
  deleteWorkout: (id: string) => Promise<void>;
  
  // Current Workout Operations
  setCurrentWorkout: React.Dispatch<React.SetStateAction<WorkoutSession | null>>;
  createNewWorkout: () => WorkoutSession;
  
  // Sync
  syncWorkouts: () => Promise<void>;
}

const WorkoutContext = createContext<WorkoutContextType | undefined>(undefined);

export const WorkoutProvider: React.FC<{ children: ReactNode; userId?: string }> = ({ 
  children, 
  userId 
}) => {
  const [workouts, setWorkouts] = useState<WorkoutSession[]>([]);
  const [currentWorkout, setCurrentWorkout] = useState<WorkoutSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load workouts on mount or user change
  useEffect(() => {
    loadWorkouts();
  }, [userId]);

  const loadWorkouts = async () => {
    if (!userId) {
      // Guest mode - load from local
      const localWorkouts = await db.getAll('workouts');
      setWorkouts(localWorkouts);
      setIsLoading(false);
      return;
    }

    try {
      // Load from IndexedDB first
      const localWorkouts = await db.getAll('workouts');
      setWorkouts(localWorkouts);

      // Then sync with cloud
      const { data: cloudWorkouts } = await supabase
        .from('workouts')
        .select('*')
        .eq('user_id', userId);

      if (cloudWorkouts && cloudWorkouts.length > 0) {
        // Merge cloud data with local
        const mergedWorkouts = mergeWorkouts(localWorkouts, cloudWorkouts);
        setWorkouts(mergedWorkouts);
        
        // Save merged data to local
        for (const workout of mergedWorkouts) {
          await db.upsert('workouts', workout);
        }
      }
    } catch (error) {
      console.error('Failed to load workouts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const mergeWorkouts = (local: WorkoutSession[], cloud: any[]): WorkoutSession[] => {
    const localMap = new Map(local.map(w => [w.id, w]));
    
    for (const cloudWorkout of cloud) {
      const localWorkout = localMap.get(cloudWorkout.id);
      if (!localWorkout) {
        // New from cloud
        localMap.set(cloudWorkout.id, cloudWorkout as WorkoutSession);
      } else {
        // Compare timestamps
        const localTime = new Date(localWorkout.updatedAt || 0).getTime();
        const cloudTime = new Date(cloudWorkout.updated_at || 0).getTime();
        if (cloudTime > localTime) {
          localMap.set(cloudWorkout.id, cloudWorkout as WorkoutSession);
        }
      }
    }
    
    return Array.from(localMap.values())
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  const addWorkout = async (workout: WorkoutSession) => {
    await db.upsert('workouts', workout);
    setWorkouts(prev => [workout, ...prev]);
    
    // Sync to cloud if logged in
    if (userId && userId !== 'u_guest') {
      try {
        await supabase.from('workouts').upsert({
          id: workout.id,
          user_id: userId,
          title: workout.title,
          date: workout.date,
          duration: workout.duration,
          exercises: workout.exercises,
          notes: workout.notes,
          tags: workout.tags,
          created_at: workout.createdAt,
          updated_at: workout.updatedAt,
        });
      } catch (error) {
        console.error('Failed to sync workout to cloud:', error);
      }
    }
  };

  const updateWorkout = async (workout: WorkoutSession) => {
    await db.upsert('workouts', workout);
    setWorkouts(prev => prev.map(w => w.id === workout.id ? workout : w));
    
    if (currentWorkout?.id === workout.id) {
      setCurrentWorkout(workout);
    }
    
    // Sync to cloud
    if (userId && userId !== 'u_guest') {
      try {
        await supabase.from('workouts').upsert({
          id: workout.id,
          user_id: userId,
          title: workout.title,
          date: workout.date,
          duration: workout.duration,
          exercises: workout.exercises,
          notes: workout.notes,
          tags: workout.tags,
          created_at: workout.createdAt,
          updated_at: workout.updatedAt,
        });
      } catch (error) {
        console.error('Failed to sync workout to cloud:', error);
      }
    }
  };

  const deleteWorkout = async (id: string) => {
    await db.delete('workouts', id);
    setWorkouts(prev => prev.filter(w => w.id !== id));
    
    if (currentWorkout?.id === id) {
      setCurrentWorkout(null);
    }
    
    if (userId && userId !== 'u_guest') {
      try {
        await supabase.from('workouts').delete().eq('id', id);
      } catch (error) {
        console.error('Failed to delete workout from cloud:', error);
      }
    }
  };

  const createNewWorkout = (): WorkoutSession => {
    return {
      id: `w_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: userId || 'u_guest',
      title: '',
      date: new Date().toISOString(),
      duration: 0,
      exercises: [],
      notes: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  const syncWorkouts = async () => {
    if (!userId || userId === 'u_guest') return;
    await loadWorkouts();
  };

  return (
    <WorkoutContext.Provider value={{
      workouts,
      currentWorkout,
      isLoading,
      addWorkout,
      updateWorkout,
      deleteWorkout,
      setCurrentWorkout,
      createNewWorkout,
      syncWorkouts,
    }}>
      {children}
    </WorkoutContext.Provider>
  );
};

export const useWorkoutContext = (): WorkoutContextType => {
  const context = useContext(WorkoutContext);
  if (!context) {
    throw new Error('useWorkoutContext must be used within WorkoutProvider');
  }
  return context;
};

export default WorkoutContext;
