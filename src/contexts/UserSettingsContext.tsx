import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Language, Measurement, WeightEntry } from '../../types';
import { db } from '../../services/db';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { FITLOG_SOLO_USER_ID } from '../../services/fitlogSolo';
import { recordTombstone } from '../../services/fitlogTombstones';
import { storage } from '../../services/appStorage';

interface UserSettingsContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLanguage: () => void;

  unit: 'kg' | 'lbs';
  setUnit: (unit: 'kg' | 'lbs') => void;

  weightEntries: WeightEntry[];
  addWeightEntry: (entry: WeightEntry) => Promise<void>;
  deleteWeightEntry: (id: string) => Promise<void>;
  refreshWeightEntries: () => Promise<void>;

  measurements: Measurement[];
  addMeasurement: (measurement: Measurement) => Promise<void>;
  updateMeasurement: (measurement: Measurement) => Promise<void>;
  deleteMeasurement: (id: string) => Promise<void>;
  refreshMeasurements: () => Promise<void>;
  reloadFromIndexedDb: () => Promise<void>;
}

export const UserSettingsContext = createContext<UserSettingsContextType | undefined>(undefined);

export const UserSettingsProvider: React.FC<{ children: ReactNode; userId?: string }> = ({
  children,
  userId,
}) => {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = storage.getItem('fitlog_lang');
    return saved === Language.EN ? Language.EN : Language.CN;
  });

  const [unit, setUnitState] = useState<'kg' | 'lbs'>(() => {
    const saved = storage.getItem('fitlog_unit');
    return (saved as 'kg' | 'lbs') || 'kg';
  });

  const [weightEntries, setWeightEntries] = useState<WeightEntry[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

  const reloadFromIndexedDb = useCallback(async () => {
    const uid = userId || FITLOG_SOLO_USER_ID;
    const wAll = await db.getAll<WeightEntry>('weightLogs');
    const mAll = await db.getAll<Measurement>('custom_metrics');
    const wFiltered =
      uid === FITLOG_SOLO_USER_ID || uid === 'u_guest'
        ? wAll
        : wAll.filter((w) => w.userId === uid);
    const mFiltered =
      uid === FITLOG_SOLO_USER_ID || uid === 'u_guest'
        ? mAll
        : mAll.filter((m) => m.userId === uid);

    setWeightEntries(
      wFiltered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    );
    setMeasurements(mFiltered);
  }, [userId]);

  useEffect(() => {
    void reloadFromIndexedDb();
  }, [userId, reloadFromIndexedDb]);

  /**
   * <html lang> 跟着语言走。index.html 里写死的是 zh-CN，切到英文后一直没人改它 ——
   * 读屏会用中文嗓子念英文界面，浏览器的 CJK／拉丁字体回退也照中文规则来。
   * 放在 Provider 里而不是 index.html 的引导脚本里：语言键带数据环境前缀
   * （dev: / 无），引导脚本拿不到前缀，读出来的可能是另一个环境的设置。
   */
  useEffect(() => {
    document.documentElement.lang = lang === Language.EN ? 'en' : 'zh-CN';
  }, [lang]);

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    storage.setItem('fitlog_lang', newLang);
  };

  const toggleLanguage = () => {
    const nextLang = lang === Language.CN ? Language.EN : Language.CN;
    setLang(nextLang);
  };

  const setUnit = (newUnit: 'kg' | 'lbs') => {
    setUnitState(newUnit);
    storage.setItem('fitlog_unit', newUnit);
  };

  const addWeightEntry = async (entry: WeightEntry) => {
    await db.upsert('weightLogs', entry);
    setWeightEntries((prev) =>
      [...prev, entry].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    );
    scheduleDebouncedFitlogPush();
  };

  const deleteWeightEntry = async (id: string) => {
    await db.delete('weightLogs', id);
    recordTombstone('weightLogs', id);
    setWeightEntries((prev) => prev.filter((w) => w.id !== id));
    scheduleDebouncedFitlogPush();
  };

  const addMeasurement = async (measurement: Measurement) => {
    await db.upsert('custom_metrics', measurement);
    await reloadFromIndexedDb();
    scheduleDebouncedFitlogPush();
  };

  const updateMeasurement = async (measurement: Measurement) => {
    await db.upsert('custom_metrics', measurement);
    setMeasurements((prev) => prev.map((m) => (m.id === measurement.id ? measurement : m)));
    scheduleDebouncedFitlogPush();
  };

  const deleteMeasurement = async (id: string) => {
    await db.delete('custom_metrics', id);
    recordTombstone('customMetrics', id);
    setMeasurements((prev) => prev.filter((m) => m.id !== id));
    scheduleDebouncedFitlogPush();
  };

  return (
    <UserSettingsContext.Provider
      value={{
        lang,
        setLang,
        toggleLanguage,
        unit,
        setUnit,
        weightEntries,
        addWeightEntry,
        deleteWeightEntry,
        refreshWeightEntries: reloadFromIndexedDb,
        measurements,
        addMeasurement,
        updateMeasurement,
        deleteMeasurement,
        refreshMeasurements: reloadFromIndexedDb,
        reloadFromIndexedDb,
      }}
    >
      {children}
    </UserSettingsContext.Provider>
  );
};

export const useUserSettingsContext = (): UserSettingsContextType => {
  const context = useContext(UserSettingsContext);
  if (!context) throw new Error('useUserSettingsContext must be used within UserSettingsProvider');
  return context;
};

export default UserSettingsContext;
