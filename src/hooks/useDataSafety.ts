/**
 * 数据安全的界面侧：备份文件夹状态、选文件夹、立即备份、导出 CSV，以及打开恢复 / 导入流程。
 *
 * 恢复和导入的弹窗挂在 DataSafetyHost（App 根部）里，从设置页、首页空状态、首次启动提示
 * 都能打开 —— 这里用一个 window 事件喊它，省得把回调一路穿过 App → ProfileTab → PrefsSheet。
 */
import { useCallback, useEffect, useState } from 'react';
import { Language } from '../../types';
import { translations } from '../../translations';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { mergeOverride } from '../utils/exerciseOverride';
import {
  BACKUP_STATUS_EVENT,
  backupNow,
  foreignInFolder,
  getBackupFolder,
  getBackupStatus,
  setBackupFolder,
  type BackupOutcome,
  type BackupStatus,
} from '../../services/fitlogAutoBackup';
import { FolderError, folderSupported, pickFolder, readText, writeText, type FolderRef } from '../../services/fitlogFolder';
import { buildWorkoutsCsv, csvFileName } from '../../services/fitlogCsvExport';
import { saveTextFile } from '../../services/fitlogSaveFile';
import { backupErrorText, saveOutcomeText } from '../components/data/flash';
import { plural } from '../utils/format';

export const OPEN_DATA_FLOW_EVENT = 'fitlog:open-data-flow';
export type DataFlow = 'restore' | 'import-csv' | 'setup';

export function openDataFlow(flow: DataFlow): void {
  window.dispatchEvent(new CustomEvent(OPEN_DATA_FLOW_EVENT, { detail: flow }));
}

/** 备份文件夹 + 状态，变了自动刷新 */
export function useBackupState(): { supported: boolean; folder: FolderRef | null; status: BackupStatus } {
  const read = () => ({ supported: folderSupported(), folder: getBackupFolder(), status: getBackupStatus() });
  const [state, setState] = useState(read);
  useEffect(() => {
    const on = () => setState(read());
    window.addEventListener(BACKUP_STATUS_EVENT, on);
    return () => window.removeEventListener(BACKUP_STATUS_EVENT, on);
  }, []);
  return state;
}

/** 把一次备份的结局说成人话。只有核对通过（ok）才说成功 */
function useReportBackup(): (o: BackupOutcome) => void {
  const { lang } = useUserSettingsContext();
  const { toast } = useUiOverlay();
  const isCn = lang === Language.CN;
  return useCallback(
    (o: BackupOutcome) => {
      if (o.kind === 'ok') {
        toast(
          (isCn ? `已备份并核对：${o.workouts} 场训练` : `Backed up and verified: ${o.workouts} ${plural(o.workouts, 'workout')}`) +
            (o.held > 0
              ? isCn
                ? `；${o.held} 份旧备份含这台手机没有的记录，已保留`
                : `; ${o.held} older backup${o.held > 1 ? 's' : ''} with records this phone doesn't have kept`
              : ''),
          'success',
        );
      } else if (o.kind === 'failed') {
        toast((isCn ? '备份失败：' : 'Backup failed: ') + backupErrorText(o.code, isCn), 'error');
      } else if (o.why === 'no-folder') {
        toast(backupErrorText('no-folder', isCn), 'info');
      } else if (o.why === 'empty') {
        toast(isCn ? '还没有可备份的记录' : 'Nothing to back up yet', 'info');
      }
    },
    [isCn, toast],
  );
}

/**
 * 选好文件夹之后那一段：设成备份文件夹，立刻备份一份并核对。选文件夹、进程被回收后补回来的结果（DataSafetyHost）共用。
 * 文件夹里的备份带着这台手机没有的记录（重装后选回了原来的文件夹）→ 转去恢复，不只报「已备份 3 场」（上架审查 C11）。
 */
export function useAdoptBackupFolder(): (f: FolderRef) => Promise<void> {
  const { lang } = useUserSettingsContext();
  const { toast } = useUiOverlay();
  const report = useReportBackup();
  const isCn = lang === Language.CN;
  return useCallback(
    async (f: FolderRef) => {
      setBackupFolder(f);
      // 先看再写：刚写的那份会是文件夹里最新的，写完再看就只看得到本机自己
      const foreign = await foreignInFolder(f);
      const o = await backupNow('first-setup');
      if (foreign > 0) openDataFlow('restore');
      else if (o.kind === 'skipped' && o.why === 'empty')
        toast(isCn ? '已选好文件夹，有了记录会自动备份到这里' : 'Folder set — records will be backed up here automatically', 'success');
      else report(o);
    },
    [isCn, report, toast],
  );
}

/** 选（或更换）备份文件夹，选完交给 useAdoptBackupFolder */
export function useChooseBackupFolder(): () => Promise<boolean> {
  const { lang } = useUserSettingsContext();
  const { toast } = useUiOverlay();
  const adopt = useAdoptBackupFolder();
  const isCn = lang === Language.CN;
  return useCallback(async () => {
    let f: FolderRef | null;
    try {
      f = await pickFolder('Documents', 'setup');
    } catch (e) {
      console.warn('pickFolder failed:', e);
      toast(backupErrorText((e as FolderError).code, isCn), 'error');
      return false;
    }
    if (!f) {
      toast(isCn ? '已取消' : 'Cancelled', 'info');
      return false;
    }
    await adopt(f);
    return true;
  }, [adopt, isCn, toast]);
}

export function useBackupNow(): () => Promise<void> {
  const report = useReportBackup();
  return useCallback(async () => {
    report(await backupNow('manual'));
  }, [report]);
}

/**
 * 导出 CSV。target = 'share' 走系统分享面板；'folder' 写进备份文件夹并读回核对。
 * 文件夹那条读回核对过才报成功；分享那条按 saveOutcomeText 只报到「已交给所选应用」，没报接收应用的说「没能确认」。
 */
export function useExportCsv(): (target: 'share' | 'folder') => Promise<void> {
  const { lang, unit } = useUserSettingsContext();
  const { toast } = useUiOverlay();
  const { workouts } = useWorkoutContext();
  const { resolveName, findExerciseDef, getTagName, effectiveRegions, effectivePart, exerciseOverrides, variantLabel } = useExercisePrefs();
  const isCn = lang === Language.CN;

  return useCallback(
    async (target: 'share' | 'folder') => {
      const done = workouts.filter(w => (w.exercises ?? []).length);
      if (!done.length) {
        toast(isCn ? '没有可导出的训练' : 'No workouts to export', 'info');
        return;
      }
      const { text, rows } = buildWorkoutsCsv(done, {
        isCn,
        resolveName,
        variantOf: variantLabel,
        // 部位按覆盖层之后的（内置动作改过部位、自建部位被删的都按现状，审查 gap-6#8）
        bodyPartOf: name => {
          const def = findExerciseDef(name);
          const bp = def ? effectivePart(mergeOverride(def, exerciseOverrides[def.id])) : '';
          if (!bp) return '';
          const tr = (translations as unknown as Record<string, Record<string, string> | undefined>)[bp];
          return tr?.[lang] ?? getTagName(bp) ?? '';
        },
        regionsOf: name => {
          const def = findExerciseDef(name);
          return def ? effectiveRegions(mergeOverride(def, exerciseOverrides[def.id])).map(getTagName).filter(Boolean).join(' / ') : '';
        },
        fallbackUnit: unit,
        // 系统区域的小数符号（不是 App 语言）：德语系统的 Excel 按分号分列、认 22,5
        decimalComma: new Intl.NumberFormat().formatToParts(1.5).find(p => p.type === 'decimal')?.value === ',',
      });
      const name = csvFileName(isCn);
      const ok = isCn ? `已导出 ${rows} 组（${done.length} 场训练）` : `Exported ${rows} ${plural(rows, 'set')} (${done.length} ${plural(done.length, 'workout')})`;
      try {
        if (target === 'folder') {
          const folder = getBackupFolder();
          if (!folder) {
            toast(backupErrorText('no-folder', isCn), 'info');
            return;
          }
          const w = await writeText(folder, name, text, 'text/csv');
          const back = await readText(w.uri);
          if (back.replace(/^﻿/, '') !== text.replace(/^﻿/, '')) {
            toast(isCn ? 'CSV 写入校验失败' : 'CSV failed verification after writing', 'error');
            return;
          }
          toast(`${ok} → ${w.name ?? name}`, 'success');
          return;
        }
        const { message, variant } = saveOutcomeText((await saveTextFile(name, text, 'text/csv')).kind, isCn, ok);
        toast(message, variant);
      } catch (e) {
        console.error('CSV export failed:', e);
        const msg = e instanceof FolderError ? backupErrorText(e.code, isCn) : '';
        toast((isCn ? '导出失败' : 'Export failed') + (msg ? (isCn ? `：${msg}` : `: ${msg}`) : ''), 'error');
      }
    },
    [effectivePart, effectiveRegions, exerciseOverrides, findExerciseDef, getTagName, isCn, lang, resolveName, toast, unit, variantLabel, workouts],
  );
}
