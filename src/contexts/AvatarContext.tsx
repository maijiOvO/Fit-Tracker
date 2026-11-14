import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { FITLOG_SOLO_USER } from '../../services/fitlogSolo';
import { storage } from '../../services/appStorage';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { AVATAR_LEGACY_MIN_CHARS, shrinkAvatar } from '../utils/avatarImage';

/**
 * 头像只存一份：fitlog_avatar_data_url（它也是同步的那份）。fitlog_current_user 里不再带 avatarUrl ——
 * 原先两处各存一整张 base64 原图（avatar-bloats-storage）。旧数据里只在 current_user 里有的，读一次兜底。
 */
const AVATAR_KEY = 'fitlog_avatar_data_url';
const CURRENT_USER_KEY = 'fitlog_current_user';

interface AvatarContextType {
  avatarUrl: string | undefined;
  setAvatarUrl: (url: string | undefined) => void;
}

const AvatarContext = createContext<AvatarContextType | null>(null);

export const AvatarProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(() => {
    try {
      const raw = storage.getItem(CURRENT_USER_KEY);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as { avatarUrl?: string };
      return storage.getItem(AVATAR_KEY) || parsed?.avatarUrl || undefined;
    } catch {
      return undefined;
    }
  });

  // 把旧版 current_user 里的那份头像清掉：只留固定的单机身份
  useEffect(() => {
    storage.setItem(CURRENT_USER_KEY, JSON.stringify(FITLOG_SOLO_USER));
  }, [avatarUrl]);

  // 旧版存的是相册原图（百万字符级）：启动时缩一次，写回唯一那份，下一次推送把远端也换成小的
  useEffect(() => {
    const stored = storage.getItem(AVATAR_KEY) || avatarUrl;
    if (!stored || stored.length < AVATAR_LEGACY_MIN_CHARS) return;
    let cancelled = false;
    shrinkAvatar(stored)
      .then(small => {
        if (cancelled) return;
        storage.setItem(AVATAR_KEY, small);
        setAvatarUrl(small);
        scheduleDebouncedFitlogPush();
      })
      .catch(err => console.warn('[fitlog] 旧头像缩小失败，保留原样:', err));
    return () => {
      cancelled = true;
    };
    // 只在启动时跑一次
  }, []);

  return <AvatarContext.Provider value={{ avatarUrl, setAvatarUrl }}>{children}</AvatarContext.Provider>;
};

export const useAvatar = () => {
  const context = useContext(AvatarContext);
  if (!context) throw new Error('useAvatar must be used within an AvatarProvider');
  return context;
};
