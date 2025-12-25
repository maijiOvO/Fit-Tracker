
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://yepfzeubssitiqzqiddn.supabase.co';
// 使用环境变量或直接填入你的 Key
const SUPABASE_ANON_KEY = 'sb_publishable_TkHbaHyzA628yheX4Xs9vg_tELu7hnj';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * 严格同步用户训练数据到云端
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

/**
 * 从云端获取当前用户的训练记录
 */
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
 * 严格同步用户目标数据到云端
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
// 在 supabase.ts 中添加：

export const syncWeightToCloud = async (weights: any[]) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const dataToSync = weights.map(w => ({
    id: w.id,
    user_id: session.user.id,
    weight: w.weight,
    date: w.date,
    unit: w.unit
  }));

  const { error } = await supabase
    .from('weight_logs')
    .upsert(dataToSync, { onConflict: 'id' });

  if (error) throw error;
};

export const fetchWeightFromCloud = async () => {
  const { data, error } = await supabase
    .from('weight_logs')
    .select('*')
    .order('date', { ascending: false });

  if (error) throw error;
  return data;
};
/**
 * 从云端获取当前用户的所有目标
 */
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
