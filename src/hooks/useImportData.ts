/**
 * 从单个备份文件恢复（覆盖式）+ 撤销上一次恢复 / 导入。
 *
 * 这条路只做覆盖：「把 app 恢复成这份文件里的样子」，代价由导入前的回滚槽兜住。
 * 要合并、要看摘要和多份备份，走「从备份恢复」（RestoreBackupModal，合并时本机删过的不捞回，见 mergeBackup）。
 */
import { useCallback } from 'react';
import { Language } from '../../types';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import {
  BackupParseError,
  applyBackup,
  parseBackupFile,
  rollbackImport,
} from '../../services/fitlogBackup';
import type { ExportStatus } from './useExportData';
import { overwriteFailedText, overwriteNote, setFlash, undoImportWarning, workbenchDropNote } from '../components/data/flash';
import { blockBack } from './useBackClose';

/**
 * 打开系统文件选择器。
 * 用户取消时 change 事件不会触发，靠 window focus 兜底 resolve(null)，
 * 否则调用方会永远停在 await 上（界面不卡，但状态永远转不回 idle）。
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
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
  const { currentWorkout, discardWorkbenchWith } = useWorkoutContext();

  return useCallback(async () => {
    const lang = settingsCtx.lang;
    const isCn = lang === Language.CN;

    const file = await pickFile('application/json,.json');
    if (!file) return;

    let parsed;
    try {
      parsed = parseBackupFile(await file.text());
    } catch (error) {
      const code = error instanceof BackupParseError ? error.message : '';
      const why =
        code === 'not-json'
          ? isCn ? '这不是一个 JSON 文件' : 'Not a JSON file'
          : code === 'newer-version'
            ? isCn ? '这份备份来自更新的版本，先升级 App' : 'This backup is from a newer version of the app — update first'
            : isCn ? '这不是 Fit Tracker 的备份文件' : 'Not a Fit Tracker backup';
      toast(why, 'error');
      return;
    }

    const { counts } = parsed;
    const summary = isCn
      ? `备份包含 ${counts.workouts} 场训练、${counts.weightLogs} 条体重、${counts.goals} 个目标、${counts.scheduledWorkouts} 条计划。`
      : `Backup has ${counts.workouts} workouts, ${counts.weightLogs} weight entries, ${counts.goals} goals, ${counts.scheduledWorkouts} scheduled.`;
    const skippedNote = parsed.skipped
      ? isCn
        ? `另有 ${parsed.skipped} 条记录形态不对，不会恢复。`
        : ` ${parsed.skipped} malformed record${parsed.skipped > 1 ? 's' : ''} will be skipped.`
      : '';
    const legacyNote = parsed.legacy
      ? isCn
        ? '\n\n旧版文件不含训练计划，保留现有计划。'
        : '\n\nOld-format file has no schedule; yours is kept.'
      : '';
    // 确认弹窗是纯文本渲染（UiOverlayContext 里就是 <p>{message}</p>），
    // markdown 的 ** 会原样显示给用户。强调只能靠措辞，不能靠标记。
    const warning = isCn
      ? '\n\n当前数据会被整份替换，不合并（先自动存可撤销副本）。'
      : '\n\nThis replaces your current data entirely, no merge (an undoable copy is saved first).';

    const go = await confirm({
      title: isCn ? '用备份覆盖当前数据？' : 'Replace current data with the backup?',
      message: summary + skippedNote + legacyNote + warning + (currentWorkout.exercises.length > 0 ? '\n\n' + workbenchDropNote(isCn) : ''),
      confirmLabel: isCn ? '覆盖' : 'Replace',
      danger: true,
    });
    if (!go) return;

    try {
      setSyncStatus('syncing');
      blockBack(true);
      const pushed = await discardWorkbenchWith(() => applyBackup(parsed)).finally(() => blockBack(false));
      const note = overwriteNote(pushed, isCn);
      if (note) setFlash((isCn ? '已恢复' : 'Restored') + note, 'info');
      // 所有 context 都是启动时从存储水化的，只能靠重载让它们看到新数据
      window.location.reload();
    } catch (error) {
      console.error('Import failed:', error);
      toast(overwriteFailedText(error, isCn, { cn: '导入', en: 'Import' }), 'error');
      setSyncStatus('error');
    }
  }, [confirm, currentWorkout, discardWorkbenchWith, setSyncStatus, settingsCtx, toast]);
}

/**
 * newer：恢复 / 导入 / 重置之后新记、改过的训练数（撤销会一起丢掉，确认框里要说，审查 A25）。
 * 工作台上进行中的那场不算、也不丢：交给 rollbackImport 一起写进去（keepWorkbenchWith，C62）。
 */
export function useRollbackImport(): (newer?: number) => Promise<void> {
  const settingsCtx = useUserSettingsContext();
  const { confirm, toast } = useUiOverlay();
  const { currentWorkout, keepWorkbenchWith } = useWorkoutContext();

  return useCallback(async (newer = 0) => {
    const isCn = settingsCtx.lang === Language.CN;
    const go = await confirm({
      title: isCn ? '撤销上次恢复、导入或重置？' : 'Undo last restore, import or reset?',
      message:
        undoImportWarning(newer, isCn) +
        (currentWorkout.exercises.length > 0
          ? isCn ? '\n\n训练页上进行中的这场会保留。' : '\n\nThe workout in progress on the Workout tab is kept.'
          : ''),
      confirmLabel: isCn ? '撤销' : 'Undo',
      danger: true,
    });
    if (!go) return;
    try {
      blockBack(true);
      const pushed = await keepWorkbenchWith(live => rollbackImport(live)).finally(() => blockBack(false));
      const note = overwriteNote(pushed, isCn);
      if (note) setFlash((isCn ? '已撤销' : 'Undone') + note, 'info');
      window.location.reload();
    } catch (error) {
      console.error('Rollback failed:', error);
      toast(
        error instanceof Error && error.message === 'no-rollback'
          ? isCn ? '之前的副本已过期（只留 7 天）' : 'The saved copy has expired (kept 7 days)'
          : overwriteFailedText(error, isCn, { cn: '撤销', en: 'Undo' }),
        'error',
      );
    }
  }, [confirm, currentWorkout.exercises.length, keepWorkbenchWith, settingsCtx, toast]);
}
