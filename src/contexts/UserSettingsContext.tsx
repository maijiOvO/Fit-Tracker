import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Language, Measurement, WeightEntry } from '../../types';
import { db } from '../../services/db';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { recordTombstone } from '../../services/fitlogTombstones';
import { storage } from '../../services/appStorage';
import {
  AppPrefs,
  ResolvedAppPrefs,
  appPrefsNow,
  invalidateAppPrefsCache,
  recordAppPrefs,
  resolveLang,
  unitOf,
} from '../../services/appPrefs';

interface UserSettingsContextType {
  lang: Language;
  /** 套用一个已经定下的值（同步拉回 / 切数据环境）：不打时间戳、不推送 */
  setLang: (lang: Language) => void;
  /** 用户改语言：记进 appPrefs（打时间戳）并推送，同步时才不会被远端旧值翻回去 */
  changeLang: (lang: Language) => void;

  unit: 'kg' | 'lbs';
  /** 套用一个已经定下的值（同步拉回 / 切数据环境）：不打时间戳、不推送 */
  setUnit: (unit: 'kg' | 'lbs') => void;
  /** 用户切单位：记进 appPrefs（打时间戳）并推送 */
  changeUnit: (unit: 'kg' | 'lbs') => void;

  /** 首选项（带默认值）：±步长、递减每档、有氧默认记录、距离单位、周起始日 */
  appPrefs: ResolvedAppPrefs;
  /** 用户改首选项：记进 appPrefs（打时间戳）并推送 */
  changeAppPrefs: (patch: Omit<AppPrefs, 'unit' | 'lang'>) => void;
  /** 同步拉回 / 切数据环境之后：按存储里已经合并好的值重读，不打时间戳 */
  reloadAppPrefs: () => void;
  /** 全局撤销 / 重做写回之后：语言 / 单位按存储现状重读，键没了就回到首帧的默认值。不写存储、不打时间戳 */
  reloadLangUnit: () => void;

  weightEntries: WeightEntry[];
  addWeightEntry: (entry: WeightEntry) => Promise<void>;
  deleteWeightEntry: (id: string) => Promise<void>;
  refreshWeightEntries: () => Promise<void>;

  measurements: Measurement[];
  addMeasurement: (measurement: Measurement) => Promise<void>;
  deleteMeasurement: (id: string) => Promise<void>;
  reloadFromIndexedDb: () => Promise<void>;
}

export const UserSettingsContext = createContext<UserSettingsContextType | undefined>(undefined);

// 存储里是认不出的单位（手改的备份恢复进来的 'lb' 之类）就当 kg：原样套用每次启动都进错误页（上架审查 i18n-settings#1）
const readUnit = (): 'kg' | 'lbs' => unitOf(storage.getItem('fitlog_unit')) ?? 'kg';

export const UserSettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // 演示版英文、单机发行版第一次按系统语言、自用版中文（resolveLang，崩溃兜底页同一套）
  const [lang, setLangState] = useState<Language>(resolveLang);

  const [unit, setUnitState] = useState<'kg' | 'lbs'>(readUnit);

  // 撤回第一次切语言 / 单位时键已经不在了：同步拉取「缺字段不覆盖本机」的规则在这里不对，要回到首帧的值（上架审查 C80）
  const reloadLangUnit = useCallback(() => {
    setLangState(resolveLang());
    setUnitState(readUnit());
  }, []);

  const [appPrefs, setAppPrefsState] = useState<ResolvedAppPrefs>(appPrefsNow);

  const changeAppPrefs = useCallback((patch: Omit<AppPrefs, 'unit' | 'lang'>) => {
    recordAppPrefs(patch);
    setAppPrefsState(appPrefsNow());
    scheduleDebouncedFitlogPush();
  }, []);

  const reloadAppPrefs = useCallback(() => {
    invalidateAppPrefsCache();
    setAppPrefsState(appPrefsNow());
  }, []);

  const [weightEntries, setWeightEntries] = useState<WeightEntry[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

  const reloadFromIndexedDb = useCallback(async () => {
    const wAll = await db.getAll<WeightEntry>('weightLogs');
    const mAll = await db.getAll<Measurement>('custom_metrics');
    setWeightEntries(
      wAll.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    );
    setMeasurements(mAll);
  }, []);

  useEffect(() => {
    // 读不出来由 db.ts 报出去（首页显示「读不出本机数据」），这里只记日志，不留没人接的 rejection
    reloadFromIndexedDb().catch(err => console.error('[UserSettingsContext] 读体重 / 围度失败:', err));
  }, [reloadFromIndexedDb]);

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

  const changeLang = (newLang: Language) => {
    setLang(newLang);
    recordAppPrefs({ lang: newLang });
    scheduleDebouncedFitlogPush();
  };

  const setUnit = (newUnit: 'kg' | 'lbs') => {
    setUnitState(newUnit);
    storage.setItem('fitlog_unit', newUnit);
  };

  const changeUnit = (newUnit: 'kg' | 'lbs') => {
    setUnit(newUnit);
    recordAppPrefs({ unit: newUnit });
    scheduleDebouncedFitlogPush();
  };

  const addWeightEntry = async (entry: WeightEntry) => {
    await db.save('weightLogs', entry);
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
    await db.save('custom_metrics', measurement);
    await reloadFromIndexedDb();
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
        changeLang,
        unit,
        setUnit,
        changeUnit,
        appPrefs,
        changeAppPrefs,
        reloadAppPrefs,
        reloadLangUnit,
        weightEntries,
        addWeightEntry,
        deleteWeightEntry,
        refreshWeightEntries: reloadFromIndexedDb,
        measurements,
        addMeasurement,
        deleteMeasurement,
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
