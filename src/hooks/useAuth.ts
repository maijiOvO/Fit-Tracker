/**
 * useAuth Hook - 认证相关状态和操作
 * 
 * 集中管理：
 * - 用户登录/注册/登出
 * - 认证表单状态
 * - 认证错误处理
 */
import { useState, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { User } from '../types';

export type AuthMode = 'login' | 'register' | 'forgotPassword' | 'updatePassword';

interface UseAuthReturn {
  // 状态
  user: User | null;
  authMode: AuthMode;
  email: string;
  password: string;
  username: string;
  showPassword: boolean;
  authError: string | null;
  isLoading: boolean;
  isUpdateSuccess: boolean;
  
  // 操作函数
  setUser: (user: User | null) => void;
  setAuthMode: (mode: AuthMode) => void;
  setEmail: (email: string) => void;
  setPassword: (password: string) => void;
  setUsername: (username: string) => void;
  setShowPassword: (show: boolean) => void;
  setAuthError: (error: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setIsUpdateSuccess: (success: boolean) => void;
  
  // 认证操作
  handleAuth: (e: React.FormEvent) => Promise<User | null>;
  handleResetPassword: (e: React.FormEvent) => Promise<void>;
  handleUpdatePassword: (e: React.FormEvent) => Promise<void>;
  handleLogout: () => void;
}

export const useAuth = () => {
  // 认证表单状态
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdateSuccess, setIsUpdateSuccess] = useState(false);

  // 登录/注册 - 返回用户对象以便调用方处理同步
  const handleAuth = useCallback(async (e: React.FormEvent): Promise<User | null> => {
    e.preventDefault();
    setIsLoading(true);
    setAuthError(null);
    
    try {
      const res = authMode === 'register'
        ? await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: 'https://fit.myronhub.com',
              data: { display_name: username }
            }
          })
        : await supabase.auth.signInWithPassword({ email, password });

      if (res.error) throw res.error;
      
      if (res.data.user) {
        const u: User = {
          id: res.data.user.id,
          username: res.data.user.user_metadata?.display_name || email.split('@')[0],
          email,
          avatarUrl: res.data.user.user_metadata?.avatar_url
        };
        setUser(u);
        localStorage.setItem('fitlog_current_user', JSON.stringify(u));
        return u; // 返回用户对象，调用方负责同步
      }
      return null;
    } catch (err: any) {
      setAuthError(err.message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [authMode, email, password, username]);

  // 忘记密码
  const handleResetPassword = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setAuthError(null);
    
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://fit.myronhub.com',
      });
      if (error) throw error;
      
      alert('重置邮件已发送，请检查邮箱！');
      setAuthMode('login');
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [email]);

  // 更新密码
  const handleUpdatePassword = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!password || password.length < 6) {
      setAuthError('密码至少需要6位');
      return;
    }

    setIsLoading(true);
    setAuthError(null);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      setIsUpdateSuccess(true);
      setPassword('');
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [password]);

  // 登出
  const handleLogout = useCallback(() => {
    supabase.auth.signOut();
    setUser(null);
    localStorage.removeItem('fitlog_current_user');
  }, []);

  // 重置表单
  const resetAuthForm = useCallback(() => {
    setEmail('');
    setPassword('');
    setUsername('');
    setAuthError(null);
    setShowPassword(false);
    setIsUpdateSuccess(false);
  }, []);

  return {
    // 状态
    user,
    authMode,
    email,
    password,
    username,
    showPassword,
    authError,
    isLoading,
    isUpdateSuccess,
    
    // 设置函数
    setUser,
    setAuthMode,
    setEmail,
    setPassword,
    setUsername,
    setShowPassword,
    setAuthError,
    setIsLoading,
    setIsUpdateSuccess,
    
    // 认证操作
    handleAuth,
    handleResetPassword,
    handleUpdatePassword,
    handleLogout,
    resetAuthForm,
  };
};

export default useAuth;
