import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../../types';
import { FITLOG_SOLO_USER, FITLOG_SOLO_USER_ID } from '../../services/fitlogSolo';
import { storage } from '../../services/appStorage';

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
      if (!parsed?.id || parsed.id === 'u_guest') return { ...FITLOG_SOLO_USER };
      /** 统一到单机 ID（保留头像等字段） */
      return { ...FITLOG_SOLO_USER, avatarUrl: parsed.avatarUrl };
    } catch {
      return { ...FITLOG_SOLO_USER };
    }
  });

  useEffect(() => {
    const u =
      user && user.id !== 'u_guest' ? user : ({ ...FITLOG_SOLO_USER, avatarUrl: user?.avatarUrl } as User);
    storage.setItem('fitlog_current_user', JSON.stringify(u));
  }, [user]);

  const value: AuthContextType = { user, setUser };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuthContext must be used within an AuthProvider');
  return context;
};

export { FITLOG_SOLO_USER_ID };
