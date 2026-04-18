import React, { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { supabase } from '../../services/supabase';
import { User } from '../../types';

interface AuthContextType {
  // 用户状态
  user: User | null;
  setUser: (user: User | null) => void;
  
  // 认证表单状态
  authMode: 'login' | 'register' | 'forgotPassword' | 'updatePassword';
  setAuthMode: (mode: 'login' | 'register' | 'forgotPassword' | 'updatePassword') => void;
  email: string;
  setEmail: (email: string) => void;
  password: string;
  setPassword: (password: string) => void;
  username: string;
  setUsername: (username: string) => void;
  showPassword: boolean;
  setShowPassword: (show: boolean) => void;
  authError: string | null;
  setAuthError: (error: string | null) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  isUpdateSuccess: boolean;
  setIsUpdateSuccess: (success: boolean) => void;
  
  // 认证操作
  handleAuth: (e: React.FormEvent) => Promise<void>;
  handleResetPassword: (e: React.FormEvent) => Promise<void>;
  handleUpdatePassword: (e: React.FormEvent) => Promise<void>;
  handleGuestLogin: () => Promise<void>;
  handleLogout: () => Promise<void>;
  
  // Ref for recovery mode
  isRecoveryMode: React.MutableRefObject<boolean>;
}

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  onAuthSuccess?: (user: User) => void;
  onGuestLogin?: () => Promise<void>;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ 
  children, 
  onAuthSuccess,
  onGuestLogin 
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgotPassword' | 'updatePassword'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdateSuccess, setIsUpdateSuccess] = useState(false);
  
  const isRecoveryMode = useRef(false);
  
  // 认证操作 - 登录/注册
  const handleAuth = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsLoading(true);
    
    try {
      if (authMode === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: username } }
        });
        if (error) throw error;
        if (data.user) {
          setAuthMode('login');
          setAuthError(null);
          alert('注册成功！请查收验证邮件。');
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.user) {
          const u: User = {
            id: data.user.id,
            username: data.user.user_metadata?.display_name || email.split('@')[0],
            email: data.user.email!,
            avatarUrl: data.user.user_metadata?.avatar_url
          };
          setUser(u);
          localStorage.setItem('fitlog_current_user', JSON.stringify(u));
          if (onAuthSuccess) onAuthSuccess(u);
        }
      }
    } catch (error: any) {
      setAuthError(error.message || '认证失败');
    } finally {
      setIsLoading(false);
    }
  }, [authMode, email, password, username, onAuthSuccess]);
  
  // 重置密码
  const handleResetPassword = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsLoading(true);
    
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`
      });
      if (error) throw error;
      alert('密码重置链接已发送到您的邮箱');
      setAuthMode('login');
    } catch (error: any) {
      setAuthError(error.message || '发送失败');
    } finally {
      setIsLoading(false);
    }
  }, [email]);
  
  // 更新密码
  const handleUpdatePassword = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsLoading(true);
    
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setIsUpdateSuccess(true);
      isRecoveryMode.current = false;
    } catch (error: any) {
      setAuthError(error.message || '更新失败');
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  // 游客登录
  const handleGuestLogin = useCallback(async () => {
    const u: User = { id: 'u_guest', username: 'Guest', email: 'guest@fitlog.ai' };
    setUser(u);
    localStorage.setItem('fitlog_current_user', JSON.stringify(u));
    if (onGuestLogin) await onGuestLogin();
  }, [onGuestLogin]);
  
  // 登出
  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    localStorage.removeItem('fitlog_current_user');
  }, []);
  
  const value: AuthContextType = {
    user,
    setUser,
    authMode,
    setAuthMode,
    email,
    setEmail,
    password,
    setPassword,
    username,
    setUsername,
    showPassword,
    setShowPassword,
    authError,
    setAuthError,
    isLoading,
    setIsLoading,
    isUpdateSuccess,
    setIsUpdateSuccess,
    handleAuth,
    handleResetPassword,
    handleUpdatePassword,
    handleGuestLogin,
    handleLogout,
    isRecoveryMode
  };
  
  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
};
