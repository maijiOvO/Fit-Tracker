import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://yepfzeubssitiqzqiddn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_TkHbaHyzA628yheX4Xs9vg_tELu7hnj';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * 1. 训练数据同步 (Workouts)
 */
export const syncWorkoutsToCloud = async (workouts: any[]) => {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return;

  const filteredWorkouts = workouts.filter(w => w.userId === userId);
  if (filteredWorkouts.length === 0) return;

  const { error } = await supabase
    .from('workouts')
    .upsert(filteredWorkouts.map(w => ({ 
      id: w.id,
      user_id: userId,
      date: w.date,
      title: w.title,
      exercises: w.exercises,
      notes: w.notes || ''
    })));
  
  if (error) throw error;
};

export const fetchWorkoutsFromCloud = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return [];

  const { data, error } = await supabase
    .from('workouts')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });
  
  if (error) throw error;
  return data;
};

/**
 * 2. 训练目标同步 (Goals)
 */
export const syncGoalsToCloud = async (goals: any[]) => {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return;

  const filteredGoals = goals.filter(g => g.userId === userId);
  if (filteredGoals.length === 0) return;

  const { error } = await supabase
    .from('goals')
    .upsert(filteredGoals.map(g => ({
      id: g.id,
      user_id: userId,
      type: g.type,
      label: g.label,
      target_value: g.targetValue,
      current_value: g.currentValue,
      unit: g.unit
    })));

  if (error) throw error;
};

export const fetchGoalsFromCloud = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return [];

  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('user_id', userId);

  if (error) throw error;
  return data;
};

/**
 * 3. 体重数据同步 (Weight Logs)
 */
export const syncWeightToCloud = async (weights: any[]) => {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return;

  const { error } = await supabase
    .from('weight_logs')
    .upsert(weights.map(w => ({
      id: w.id,
      user_id: userId,
      weight: w.weight,
      date: w.date,
      unit: w.unit
    })));

  if (error) throw error;
};

export const fetchWeightFromCloud = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return [];

  const { data, error } = await supabase
    .from('weight_logs')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  if (error) throw error;
  return data;
};

/**
 * 4. 身体指标同步 (Custom Metrics)
 */
export const syncMeasurementsToCloud = async (measurements: any[]) => {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return;

  const { error } = await supabase
    .from('custom_metrics')
    .upsert(measurements.map(m => ({
      id: m.id,
      user_id: userId,
      name: m.name,
      value: m.value,
      unit: m.unit,
      date: m.date
    })));

  if (error) throw error;
};

export const fetchMeasurementsFromCloud = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return [];

  const { data, error } = await supabase
    .from('custom_metrics')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  if (error) throw error;
  return data;
};

/**
 * 5. 用户个性化配置同步 (备注、偏好等)
 */
export const syncUserConfigsToCloud = async (configData: any) => {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return;

  const { error } = await supabase
    .from('user_configs')
    .upsert({
      user_id: userId,
      data: configData,
      updated_at: new Date().toISOString()
    });

  if (error) throw error;
};

export const fetchUserConfigsFromCloud = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from('user_configs')
    .select('data')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data?.data || null;
};
/**
 * 从云端删除指定的训练记录
 */
export const deleteWorkoutFromCloud = async (workoutId: string) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) return;

  const { error } = await supabase
    .from('workouts')
    .delete()
    .eq('id', workoutId)
    .eq('user_id', session.user.id); // 增加安全检查
  
  if (error) throw error;
};