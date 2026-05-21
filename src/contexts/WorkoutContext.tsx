import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { WorkoutSession } from '../../types';
import { db } from '../../services/db';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { FITLOG_SOLO_USER_ID } from '../../services/fitlogSolo';
import { recordTombstone } from '../../services/fitlogTombstones';

function createEmptyWorkout(userId: string): WorkoutSession {
  const now = new Date().toISOString();
  return {
    id: '',
    userId,
    title: '',
    date: now,
    exercises: [],
    notes: '',
    duration: 0,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

interface WorkoutContextType {
  workouts: WorkoutSession[];
  currentWorkout: WorkoutSession;
  isLoading: boolean;

  addWorkout: (workout: WorkoutSession) => Promise<void>;
  updateWorkout: (workout: WorkoutSession) => Promise<void>;
  deleteWorkout: (id: string) => Promise<void>;

  setCurrentWorkout: React.Dispatch<React.SetStateAction<WorkoutSession>>;
  updateCurrentWorkout: (updates: Partial<WorkoutSession>) => void;
  createNewWorkout: () => WorkoutSession;

  syncWorkouts: () => Promise<void>;
  refreshFromDb: () => Promise<void>;
}

const WorkoutContext = createContext<WorkoutContextType | undefined>(undefined);

export const WorkoutProvider: React.FC<{ children: ReactNode; userId?: string }> = ({
  children,
  userId,
}) => {
  const uid = userId || FITLOG_SOLO_USER_ID;
  const [workouts, setWorkouts] = useState<WorkoutSession[]>([]);
  const [currentWorkout, setCurrentWorkout] = useState<WorkoutSession>(() => createEmptyWorkout(uid));
  const [isLoading, setIsLoading] = useState(true);

  const refreshFromDb = useCallback(async () => {
    const localWorkouts = await db.getAll<WorkoutSession>('workouts');
    const filtered =
      uid === FITLOG_SOLO_USER_ID || uid === 'u_guest'
        ? localWorkouts
        : localWorkouts.filter((w) => w.userId === uid);
    setWorkouts(
      filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    );
    setIsLoading(false);
  }, [uid]);

  useEffect(() => {
    void refreshFromDb();
  }, [uid, refreshFromDb]);

  const addWorkout = async (workout: WorkoutSession) => {
    await db.upsert('workouts', workout);
    setWorkouts((prev) => [workout, ...prev]);
    scheduleDebouncedFitlogPush();
  };

  const updateWorkout = async (workout: WorkoutSession) => {
    await db.upsert('workouts', workout);
    setWorkouts((prev) => prev.map((w) => (w.id === workout.id ? workout : w)));
    if (currentWorkout.id === workout.id) setCurrentWorkout(workout);
    scheduleDebouncedFitlogPush();
  };

  const deleteWorkout = async (id: string) => {
    await db.delete('workouts', id);
    recordTombstone('workouts', id);
    setWorkouts((prev) => prev.filter((w) => w.id !== id));
    if (currentWorkout.id === id) setCurrentWorkout(createEmptyWorkout(uid));
    scheduleDebouncedFitlogPush();
  };

  const createNewWorkout = (): WorkoutSession => createEmptyWorkout(uid);

  const updateCurrentWorkout = (updates: Partial<WorkoutSession>) => {
    setCurrentWorkout((prev) => ({ ...prev, ...updates }));
  };

  const syncWorkouts = async () => {
    await refreshFromDb();
  };

  return (
    <WorkoutContext.Provider
      value={{
        workouts,
        currentWorkout,
        isLoading,
        addWorkout,
        updateWorkout,
        deleteWorkout,
        setCurrentWorkout,
        updateCurrentWorkout,
        createNewWorkout,
        syncWorkouts,
        refreshFromDb,
      }}
    >
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
