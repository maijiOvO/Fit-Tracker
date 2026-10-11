/**
 * 首选项容器 appPrefs：一个对象、一个时间戳，随 prefs 同步（审查 2026-10-06「首选项 · 同步怎么存」）。
 *
 * 为什么不塞进已有的 prefs 块：customTags / exerciseOverrides 等共用一个 prefsLastUpdateMs、整块比谁新，
 * 在手机上切一次单位，电脑上的标签改动就会被盖掉（反过来单位被翻回去，unit-lang-sync-revert 就是这么来的）。
 * 以后的首选项都往这个对象里加字段，不再新增同步 key；加字段不用动读 / 写 / 合并三处。
 *
 * 单位、语言迁进来了。旧字段 fitlog_unit / fitlog_lang 照写（UserSettingsContext 首帧读它们，
 * 没升级的设备也只认它们），但胜负按这里的时间戳定。
 */
import { storage } from './appStorage';

export interface AppPrefs {
  unit?: 'kg' | 'lbs';
  lang?: string;
}

const KEY = 'fitlog_app_prefs';
const TS_KEY = 'fitlog_app_prefs_last_update';

export function readAppPrefs(): { appPrefs?: AppPrefs; appPrefsUpdatedMs: number } {
  let appPrefs: AppPrefs | undefined;
  try {
    const raw = storage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) appPrefs = parsed as AppPrefs;
  } catch {
    appPrefs = undefined;
  }
  const appPrefsUpdatedMs = Number.parseInt(storage.getItem(TS_KEY) || '0', 10) || 0;
  return { appPrefs, appPrefsUpdatedMs };
}

export function writeAppPrefs(appPrefs: AppPrefs | undefined, appPrefsUpdatedMs: number): void {
  if (appPrefs) storage.setItem(KEY, JSON.stringify(appPrefs));
  else storage.removeItem(KEY);
  if (appPrefsUpdatedMs) storage.setItem(TS_KEY, String(appPrefsUpdatedMs));
  else storage.removeItem(TS_KEY);
}

/** 用户改了某项首选项：并进对象、打时间戳。推送由调用方排（scheduleDebouncedFitlogPush） */
export function recordAppPrefs(patch: AppPrefs): void {
  const { appPrefs } = readAppPrefs();
  writeAppPrefs({ ...(appPrefs ?? {}), ...patch }, Date.now());
}

/**
 * 合并两边的 appPrefs：时间戳新的一方整体赢，它没有的字段用另一方的补（旧设备的对象字段可能更少）。
 * 两边都没有 → undefined（调用方退回旧口径）。
 */
export function mergeAppPrefs(
  local: AppPrefs | undefined,
  localMs: number,
  remote: AppPrefs | undefined,
  remoteMs: number,
): { appPrefs?: AppPrefs; appPrefsUpdatedMs: number } {
  if (!local && !remote) return { appPrefs: undefined, appPrefsUpdatedMs: Math.max(localMs, remoteMs) };
  const remoteWins = !!remote && (!local || remoteMs > localMs);
  const appPrefs = remoteWins ? { ...(local ?? {}), ...remote } : { ...(remote ?? {}), ...local };
  return { appPrefs, appPrefsUpdatedMs: Math.max(localMs, remoteMs) };
}
