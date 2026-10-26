import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../../types';
import { FITLOG_SOLO_USER, FITLOG_SOLO_USER_ID } from '../../services/fitlogSolo';
import { storage } from '../../services/appStorage';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { AVATAR_LEGACY_MIN_CHARS, shrinkAvatar } from '../utils/avatarImage';

/**
 * 头像只存一份：fitlog_avatar_data_url（它也是同步的那份）。fitlog_current_user 里不再带 avatarUrl ——
 * 原先两处各存一整张 base64 原图（avatar-bloats-storage）。旧数据里只在 current_user 里有的，读一次兜底。
 */
const AVATAR_KEY = 'fitlog_avatar_data_url';

interface AuthContextType {
  user: User | null;
  setUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const raw = storage.getItem('fitlog_current_user');
      if (!raw) return { ...FITLOG_SOLO_USER };
      const parsed = JSON.parse(raw) as User;
      const avatarUrl = storage.getItem(AVATAR_KEY) || parsed?.avatarUrl || undefined;
      if (!parsed?.id || parsed.id === 'u_guest') return { ...FITLOG_SOLO_USER, avatarUrl };
      /** 统一到单机 ID（保留头像） */
      return { ...FITLOG_SOLO_USER, avatarUrl };
    } catch {
      return { ...FITLOG_SOLO_USER };
    }
  });

  useEffect(() => {
    const u = user && user.id !== 'u_guest' ? user : ({ ...FITLOG_SOLO_USER } as User);
    const { avatarUrl: _a, ...rest } = u;
    storage.setItem('fitlog_current_user', JSON.stringify(rest));
  }, [user]);

  // 旧版存的是相册原图（百万字符级）：启动时缩一次，写回唯一那份，下一次推送把远端也换成小的
  useEffect(() => {
    const stored = storage.getItem(AVATAR_KEY) || user?.avatarUrl;
    if (!stored || stored.length < AVATAR_LEGACY_MIN_CHARS) return;
    let cancelled = false;
    shrinkAvatar(stored)
      .then(small => {
        if (cancelled) return;
        storage.setItem(AVATAR_KEY, small);
        setUser(prev => (prev ? { ...prev, avatarUrl: small } : prev));
        scheduleDebouncedFitlogPush();
      })
      .catch(err => console.warn('[fitlog] 旧头像缩小失败，保留原样:', err));
    return () => {
      cancelled = true;
    };
    // 只在启动时跑一次
  }, []);

  const value: AuthContextType = { user, setUser };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuthContext must be used within an AuthProvider');
  return context;
};

export { FITLOG_SOLO_USER_ID };
