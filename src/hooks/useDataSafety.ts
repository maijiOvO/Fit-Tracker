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
  getBackupFolder,
  getBackupStatus,
  setBackupFolder,
  type BackupErrorCode,
  type BackupOutcome,
  type BackupStatus,
} from '../../services/fitlogAutoBackup';
import { FolderError, folderSupported, pickFolder, readText, writeText, type FolderRef } from '../../services/fitlogFolder';
import { buildWorkoutsCsv, csvFileName } from '../../services/fitlogCsvExport';
import { saveTextFile } from '../../services/fitlogSaveFile';

export const OPEN_DATA_FLOW_EVENT = 'fitlog:open-data-flow';
export type DataFlow = 'restore' | 'import-csv' | 'setup';

export function openDataFlow(flow: DataFlow): void {
  window.dispatchEvent(new CustomEvent(OPEN_DATA_FLOW_EVENT, { detail: flow }));
}

export function backupErrorText(code: BackupErrorCode, isCn: boolean): string {
  switch (code) {
    case 'no-access':
      return isCn ? '文件夹权限已失效，请重新选择' : 'Folder access was lost — choose it again';
    case 'verify-failed':
      return isCn ? '备份校验失败，这份备份不可用' : 'The written file did not read back correctly';
    case 'no-folder':
      return isCn ? '还没有选备份文件夹' : 'No backup folder chosen';
    case 'unsupported':
      return isCn ? '这台设备不支持备份文件夹' : 'Backup folder is not supported here';
    default:
      return isCn ? '写入失败' : 'Write failed';
  }
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
          o.shrinkWarning
            ? isCn
              ? `已备份 ${o.workouts} 次训练，比上次少很多，旧备份已保留`
              : `Backed up (${o.workouts} workouts). Much fewer than last time — older backups kept`
            : isCn
              ? `已备份并核对：${o.workouts} 次训练`
              : `Backed up and verified: ${o.workouts} workouts`,
          'success',
        );
      } else if (o.kind === 'failed') {
        toast((isCn ? '备份失败：' : 'Backup failed: ') + backupErrorText(o.code, isCn), 'error');
      } else if (o.why === 'no-folder') {
        toast(backupErrorText('no-folder', isCn), 'info');
      }
    },
    [isCn, toast],
  );
}

/** 选（或更换）备份文件夹，选完立刻备份一份并核对 */
export function useChooseBackupFolder(): () => Promise<boolean> {
  const { lang } = useUserSettingsContext();
  const { toast } = useUiOverlay();
  const report = useReportBackup();
  const isCn = lang === Language.CN;
  return useCallback(async () => {
    let f: FolderRef | null;
    try {
      f = await pickFolder('Documents');
    } catch (e) {
      toast((isCn ? '没能使用这个文件夹：' : 'Could not use that folder: ') + (e as Error).message, 'error');
      return false;
    }
    if (!f) {
      toast(isCn ? '已取消，没有选文件夹' : 'Cancelled, no folder chosen', 'info');
      return false;
    }
    setBackupFolder(f);
    report(await backupNow('first-setup'));
    return true;
  }, [isCn, report, toast]);
}

export function useBackupNow(): () => Promise<void> {
  const report = useReportBackup();
  return useCallback(async () => {
    report(await backupNow('manual'));
  }, [report]);
}

/**
 * 导出 CSV。target = 'share' 走系统分享面板；'folder' 写进备份文件夹并读回核对。
 * 两条路都只在用户真拿到文件时报成功（分享面板取消 = 没导出）。
 */
export function useExportCsv(): (target: 'share' | 'folder') => Promise<void> {
  const { lang, unit } = useUserSettingsContext();
  const { toast } = useUiOverlay();
  const { workouts } = useWorkoutContext();
  const { resolveName, findExerciseDef, getTagName, effectiveRegions, exerciseOverrides } = useExercisePrefs();
  const isCn = lang === Language.CN;

  return useCallback(
    async (target: 'share' | 'folder') => {
      const done = workouts.filter(w => (w.exercises ?? []).length);
      if (!done.length) {
        toast(isCn ? '还没有训练记录可以导出' : 'No workouts to export yet', 'info');
        return;
      }
      const { text, rows } = buildWorkoutsCsv(done, {
        isCn,
        resolveName,
        bodyPartOf: name => {
          const bp = findExerciseDef(name)?.bodyPart;
          if (!bp) return '';
          const tr = (translations as unknown as Record<string, Record<string, string> | undefined>)[bp];
          return tr?.[lang] ?? getTagName(bp) ?? '';
        },
        regionsOf: name => {
          const def = findExerciseDef(name);
          return def ? effectiveRegions(mergeOverride(def, exerciseOverrides[def.id])).map(getTagName).filter(Boolean).join(' / ') : '';
        },
        fallbackUnit: unit,
      });
      const name = csvFileName(isCn);
      const ok = isCn ? `已导出 ${rows} 组（${done.length} 次训练）` : `Exported ${rows} sets (${done.length} workouts)`;
      const aiHint = isCn ? '，可直接发给 AI 分析' : ' — ready for AI analysis';
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
            toast(isCn ? 'CSV 写进去读回来对不上，请重试' : 'CSV did not read back correctly', 'error');
            return;
          }
          toast(`${ok} → ${w.name ?? name}${aiHint}`, 'success');
          return;
        }
        const outcome = await saveTextFile(name, text, 'text/csv');
        if (outcome.kind === 'cancelled') {
          toast(isCn ? '已取消，没有导出文件' : 'Cancelled, nothing exported', 'info');
          return;
        }
        toast(ok + aiHint, 'success');
      } catch (e) {
        console.error('CSV export failed:', e);
        const msg = e instanceof FolderError ? backupErrorText(e.code === 'no-access' ? 'no-access' : 'write-failed', isCn) : '';
        toast((isCn ? '导出失败' : 'Export failed') + (msg ? (isCn ? `：${msg}` : `: ${msg}`) : ''), 'error');
      }
    },
    [effectiveRegions, exerciseOverrides, findExerciseDef, getTagName, isCn, lang, resolveName, toast, unit, workouts],
  );
}
