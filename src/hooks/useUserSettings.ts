/**
 * useUserSettings Hook - 用户设置相关状态
 * 
 * 集中管理：
 * - 语言设置
 * - 单位设置 (kg/lbs)
 * - 其他用户偏好
 */
import { useState, useCallback, useEffect } from 'react';
import { Language } from '../types';

type Unit = 'kg' | 'lbs';

interface UseUserSettingsReturn {
  // 状态
  lang: Language;
  unit: Unit;
  
  // 设置函数
  setLang: (lang: Language) => void;
  setUnit: (unit: Unit) => void;
  toggleLanguage: () => void;
  toggleUnit: () => void;
}

export const useUserSettings = () => {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem('fitlog_lang') as Language;
    return saved || Language.CN;
  });
  
  const [unit, setUnitState] = useState<Unit>(() => {
    const saved = localStorage.getItem('fitlog_unit') as Unit;
    return saved || 'kg';
  });

  // 设置语言并持久化
  const setLang = useCallback((newLang: Language) => {
    setLangState(newLang);
    localStorage.setItem('fitlog_lang', newLang);
  }, []);

  // 切换语言
  const toggleLanguage = useCallback(() => {
    const newLang = lang === Language.CN ? Language.EN : Language.CN;
    setLang(newLang);
  }, [lang, setLang]);

  // 设置单位并持久化
  const setUnit = useCallback((newUnit: Unit) => {
    setUnitState(newUnit);
    localStorage.setItem('fitlog_unit', newUnit);
  }, []);

  // 切换单位
  const toggleUnit = useCallback(() => {
    const newUnit = unit === 'kg' ? 'lbs' : 'kg';
    setUnit(newUnit);
  }, [unit, setUnit]);

  return {
    // 状态
    lang,
    unit,
    
    // 设置函数
    setLang,
    setUnit,
    toggleLanguage,
    toggleUnit,
  };
};

export default useUserSettings;
