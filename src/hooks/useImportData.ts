/**
 * 从备份文件恢复（覆盖式）+ 撤销上一次导入。
 *
 * 覆盖不合并，是刻意的：导出文件里**没有墓碑**（见 fitlogSnapshotTypes 的
 * FitlogTombstones —— 它只存在于同步快照里）。按 id 合并会把用户删掉的训练
 * 从旧备份里捞回来，而且界面上看不出来。覆盖则语义干净：
 * 「把 app 恢复成备份里的样子」。代价由导入前的回滚槽兜住。
 */
import { useCallback } from 'react';
import { Language } from '../../types';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import {
  BackupParseError,
  applyBackup,
  parseBackupFile,
  rollbackImport,
} from '../../services/fitlogBackup';
import type { ExportStatus } from './useExportData';

/**
 * 打开系统文件选择器。
 * 用户取消时 change 事件不会触发，靠 window focus 兜底 resolve(null)，
 * 否则调用方会永远停在 await 上（界面不卡，但状态永远转不回 idle）。
 */
function pickJsonFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    let settled = false;
    const finish = (f: File | null): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(f);
    };
    const onFocus = (): void => {
      // 选择器关闭后 focus 先回到窗口，change 才派发 —— 留一拍再判定取消
      window.setTimeout(() => finish(input.files?.[0] ?? null), 400);
    };
    input.onchange = () => finish(input.files?.[0] ?? null);
    window.addEventListener('focus', onFocus);
    document.body.appendChild(input);
    input.click();
  });
}

export function useImportData(
  setSyncStatus: (status: ExportStatus) => void,
): () => Promise<void> {
  const settingsCtx = useUserSettingsContext();
  const { confirm, toast } = useUiOverlay();

  return useCallback(async () => {
    const lang = settingsCtx.lang;
    const isCn = lang === Language.CN;

    const file = await pickJsonFile();
    if (!file) return;

    let parsed;
    try {
      parsed = parseBackupFile(await file.text());
    } catch (error) {
      const why =
        error instanceof BackupParseError && error.message === 'not-json'
          ? isCn ? '这不是一个 JSON 文件' : 'Not a JSON file'
          : isCn ? '这不是 Fit Tracker 的备份文件' : 'Not a Fit Tracker backup';
      toast(why, 'error');
      return;
    }

    const { counts } = parsed;
    const summary = isCn
      ? `备份包含 ${counts.workouts} 次训练、${counts.weightLogs} 条体重、${counts.goals} 个目标、${counts.scheduledWorkouts} 条计划。`
      : `Backup has ${counts.workouts} workouts, ${counts.weightLogs} weight entries, ${counts.goals} goals, ${counts.scheduledWorkouts} scheduled.`;
    const legacyNote = parsed.legacy
      ? isCn
        ? '\n\n这是旧版导出的文件，里面没有 PR 和训练计划 —— 这两项会保留你现在的数据，不会被清空。'
        : '\n\nThis is an old-format export with no PRs or schedule — those will be kept as they are now.'
      : '';
    const warning = isCn
      ? '\n\n当前数据会被**完全替换**。导入前会自动存一份可撤销的副本。'
      : '\n\nYour current data will be **replaced**. An undoable copy is saved first.';

    const go = await confirm({
      title: isCn ? '用备份覆盖当前数据？' : 'Restore from backup?',
      message: summary + legacyNote + warning,
      confirmLabel: isCn ? '覆盖恢复' : 'Restore',
      danger: true,
    });
    if (!go) return;

    try {
      setSyncStatus('syncing');
      await applyBackup(parsed);
      // 所有 context 都是启动时从存储水化的，只能靠重载让它们看到新数据
      window.location.reload();
    } catch (error) {
      console.error('Import failed:', error);
      toast(isCn ? '导入失败，数据未改动' : 'Import failed, nothing changed', 'error');
      setSyncStatus('error');
    }
  }, [confirm, setSyncStatus, settingsCtx, toast]);
}

export function useRollbackImport(): () => Promise<void> {
  const settingsCtx = useUserSettingsContext();
  const { confirm, toast } = useUiOverlay();

  return useCallback(async () => {
    const isCn = settingsCtx.lang === Language.CN;
    const go = await confirm({
      title: isCn ? '撤销上次导入？' : 'Undo last import?',
      message: isCn
        ? '恢复到那次导入之前的状态。撤销只能用一次。'
        : 'Restore the state from before that import. This can only be used once.',
      confirmLabel: isCn ? '撤销' : 'Undo',
      danger: true,
    });
    if (!go) return;
    try {
      await rollbackImport();
      window.location.reload();
    } catch (error) {
      console.error('Rollback failed:', error);
      toast(isCn ? '撤销失败' : 'Undo failed', 'error');
    }
  }, [confirm, settingsCtx, toast]);
}
