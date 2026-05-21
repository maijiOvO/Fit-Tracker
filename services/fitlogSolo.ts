import type { User } from '../types';

/** 单机版固定用户 ID；历史数据中可能仍存在旧 Supabase UUID，启动时会迁移为该 ID */
export const FITLOG_SOLO_USER_ID = 'u_solo';

export const FITLOG_SOLO_USER: User = {
  id: FITLOG_SOLO_USER_ID,
  username: 'Me',
  email: 'solo@fitlog.local',
};
