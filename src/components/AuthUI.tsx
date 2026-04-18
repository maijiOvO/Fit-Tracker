import React from 'react';
import { 
  Dumbbell, Mail, Lock, User as UserIcon, Eye, EyeOff, 
  X, Check, RefreshCw, ArrowLeft, Zap 
} from 'lucide-react';
import { useAuthContext } from '../contexts/AuthContext';
import { Language } from '../../types';
import { translations } from '../../translations';
import { supabase } from '../../services/supabase';

interface AuthUIProps {
  lang: Language;
}

const AuthUI: React.FC<AuthUIProps> = ({ lang }) => {
  const {
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
    setUser,
    isRecoveryMode
  } = useAuthContext();

  const getTitle = () => {
    switch (authMode) {
      case 'login': return translations.loginWelcome[lang];
      case 'register': return translations.registerWelcome[lang];
      case 'forgotPassword': return lang === Language.CN ? '找回密码' : 'Reset Password';
      case 'updatePassword': return lang === Language.CN ? '设置新密码' : 'Set New Password';
    }
  };

  const getButtonText = () => {
    if (isLoading) return <RefreshCw className="animate-spin" />;
    switch (authMode) {
      case 'login': return translations.login[lang];
      case 'register': return translations.createAccount[lang];
      case 'forgotPassword': return lang === Language.CN ? '发送重置链接' : 'Send Reset Link';
      case 'updatePassword': return lang === Language.CN ? '更新密码' : 'Update Password';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (authMode === 'forgotPassword') {
      handleResetPassword(e);
    } else if (authMode === 'updatePassword') {
      handleUpdatePassword(e);
    } else {
      handleAuth(e);
    }
  };

  const handleGoToLogin = async () => {
    try { await supabase.auth.signOut(); } catch(e) {}
    setUser(null);
    localStorage.removeItem('fitlog_current_user');
    isRecoveryMode.current = false;
    setIsUpdateSuccess(false);
    setAuthMode('login');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#0f172a]">
      <div className="w-full max-w-md bg-slate-800/30 backdrop-blur-2xl rounded-[3rem] p-10 border border-slate-700/50 shadow-2xl relative overflow-hidden">
        {/* 装饰元素 */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
        
        {/* 标题区域 */}
        <div className="flex flex-col items-center mb-8">
          <div className="bg-blue-600/20 p-5 rounded-3xl mb-6 shadow-inner">
            <Dumbbell className="w-12 h-12 text-blue-500" />
          </div>
          <h1 className="text-4xl font-black text-white tracking-tight">{translations.appTitle[lang]}</h1>
          <p className="text-slate-400 mt-2 font-medium">{getTitle()}</p>
        </div>

        {/* 成功状态 */}
        {isUpdateSuccess ? (
          <div className="flex flex-col items-center text-center py-4 space-y-6 animate-in fade-in zoom-in-95">
            <div className="bg-green-500/20 p-6 rounded-full border-4 border-green-500/30 animate-bounce">
              <Check className="text-green-500 w-12 h-12" strokeWidth={4} />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-black text-white">
                {lang === Language.CN ? '密码修改成功！' : 'Success!'}
              </h2>
              <p className="text-sm text-slate-400 font-medium leading-relaxed px-2">
                {lang === Language.CN 
                  ? '您的密码已更新。请关闭此页面，返回您的健身助手 App 或浏览器重新登录。' 
                  : 'Password updated. Please close this page and go back to your App to login.'}
              </p>
            </div>
            <button 
              onClick={handleGoToLogin}
              className="w-full bg-slate-800 py-4 rounded-2xl text-slate-300 font-bold hover:bg-slate-700 transition-all"
            >
              {lang === Language.CN ? '前往登录' : 'Go to Login'}
            </button>
          </div>
        ) : (
          <>
            {/* 错误提示 */}
            {authError && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 text-xs font-black flex items-center gap-3 animate-in slide-in-from-top-2">
                <div className="p-1 bg-red-500 text-white rounded-full"><X size={12} strokeWidth={4} /></div>
                {authError}
              </div>
            )}

            {/* 认证表单 */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 用户名 - 仅注册时显示 */}
              {authMode === 'register' && (
                <div className="relative group animate-in fade-in slide-in-from-bottom-2">
                  <UserIcon className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-500 transition-colors" size={20} />
                  <input 
                    type="text" 
                    value={username} 
                    onChange={e => setUsername(e.target.value)} 
                    placeholder={translations.username[lang]} 
                    className="w-full bg-slate-900 border border-slate-700 rounded-2xl py-4 pl-14 pr-6 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
                    required 
                  />
                </div>
              )}
              
              {/* 邮箱 - 忘记密码时隐藏 */}
              {authMode !== 'updatePassword' && (
                <div className="relative group animate-in fade-in slide-in-from-bottom-2">
                  <Mail className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-500 transition-colors" size={20} />
                  <input 
                    type="email" 
                    value={email} 
                    onChange={e => setEmail(e.target.value)} 
                    placeholder={translations.email[lang]} 
                    className="w-full bg-slate-900 border border-slate-700 rounded-2xl py-4 pl-14 pr-6 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
                    required 
                  />
                </div>
              )}

              {/* 密码 - 忘记密码时隐藏 */}
              {authMode !== 'forgotPassword' && (
                <div className="relative group animate-in fade-in slide-in-from-bottom-2">
                  <Lock className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-500 transition-colors" size={20} />
                  <input 
                    type={showPassword ? "text" : "password"} 
                    value={password} 
                    onChange={e => setPassword(e.target.value)} 
                    placeholder={authMode === 'updatePassword' ? (lang === Language.CN ? '输入新密码' : 'New Password') : translations.password[lang]} 
                    className="w-full bg-slate-900 border border-slate-700 rounded-2xl py-4 pl-14 pr-16 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
                    required 
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowPassword(!showPassword)} 
                    className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              )}

              {/* 忘记密码链接 */}
              {authMode === 'login' && (
                <div className="flex justify-end">
                  <button 
                    type="button" 
                    onClick={() => setAuthMode('forgotPassword')} 
                    className="text-xs text-slate-500 hover:text-blue-400 font-bold transition-colors"
                  >
                    {lang === Language.CN ? '忘记密码？' : 'Forgot Password?'}
                  </button>
                </div>
              )}

              {/* 提交按钮 */}
              <button 
                type="submit" 
                disabled={isLoading} 
                className="w-full bg-blue-600 hover:bg-blue-500 text-white py-5 rounded-3xl font-black text-lg flex items-center justify-center gap-3 shadow-xl shadow-blue-600/20 active:scale-95 transition-all disabled:opacity-50"
              >
                {getButtonText()}
              </button>
            </form>
          </>
        )}

        {/* 底部切换链接 */}
        <div className="flex flex-col gap-4 mt-8">
          {authMode === 'login' && (
            <button 
              onClick={() => setAuthMode('register')} 
              className="text-slate-500 text-xs font-bold hover:text-blue-400 transition-colors text-center"
            >
              {translations.noAccount[lang]} <span className="text-blue-500">{translations.createAccount[lang]}</span>
            </button>
          )}
          {authMode === 'register' && (
            <button 
              onClick={() => setAuthMode('login')} 
              className="text-slate-500 text-xs font-bold hover:text-blue-400 transition-colors text-center"
            >
              {translations.hasAccount[lang]} <span className="text-blue-500">{translations.login[lang]}</span>
            </button>
          )}
          {authMode === 'forgotPassword' && (
            <button 
              onClick={() => setAuthMode('login')} 
              className="text-slate-500 text-xs font-bold hover:text-white transition-colors text-center flex items-center justify-center gap-2"
            >
              <ArrowLeft size={14} /> {lang === Language.CN ? '返回登录' : 'Back to Login'}
            </button>
          )}
        </div>

        {/* 游客登录 - 更新密码时隐藏 */}
        {authMode !== 'updatePassword' && (
          <>
            <div className="flex items-center my-6">
              <div className="flex-1 h-[1px] bg-slate-800"></div>
              <span className="px-4 text-[10px] font-black uppercase text-slate-700 tracking-widest">{translations.orSeparator[lang]}</span>
              <div className="flex-1 h-[1px] bg-slate-800"></div>
            </div>
            <button 
              onClick={handleGuestLogin} 
              className="w-full bg-slate-800/50 text-slate-300 py-4 rounded-3xl font-bold flex items-center justify-center gap-2 hover:bg-slate-700 transition-all active:scale-90"
            >
              <Zap size={18} className="text-amber-400" /> {translations.quickLogin[lang]}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default AuthUI;
