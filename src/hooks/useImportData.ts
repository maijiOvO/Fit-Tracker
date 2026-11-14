/**
 * 从单个备份文件恢复（覆盖式）+ 撤销上一次恢复 / 导入。
 *
 * 这条路只做覆盖：「把 app 恢复成这份文件里的样子」，代价由导入前的回滚槽兜住。
 * 要合并、要看摘要和多份备份，走「从备份恢复」（RestoreBackupModal，合并用的是快照里带的墓碑）。
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
import { overwriteFailedText, overwriteNote, setFlash, workbenchDropNote } from '../components/data/flash';
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
            ? isCn ? '这份备份来自更新版本的 App，请先升级' : 'This backup is from a newer version of the app — update first'
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
        ? '\n\n旧版文件不含训练计划，保留现有计划。'
        : '\n\nOld-format file: your schedule is kept as it is.'
      : '';
    // 确认弹窗是纯文本渲染（UiOverlayContext 里就是 <p>{message}</p>），
    // markdown 的 ** 会原样显示给用户。强调只能靠措辞，不能靠标记。
    const warning = isCn
      ? '\n\n当前数据将被整体替换（不是合并），导入前自动存可撤销副本。'
      : '\n\nThis replaces your current data entirely — it does not merge. An undoable copy is saved first.';

    const go = await confirm({
      title: isCn ? '用备份覆盖当前数据？' : 'Restore from backup?',
      message: summary + legacyNote + warning + (currentWorkout.exercises.length > 0 ? '\n\n' + workbenchDropNote(isCn) : ''),
      confirmLabel: isCn ? '覆盖恢复' : 'Restore',
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

/** newer：恢复 / 导入 / 重置之后新记的训练数（撤销会一起丢掉，确认框里要说，审查 A25） */
export function useRollbackImport(): (newer?: number) => Promise<void> {
  const settingsCtx = useUserSettingsContext();
  const { confirm, toast } = useUiOverlay();

  return useCallback(async (newer = 0) => {
    const isCn = settingsCtx.lang === Language.CN;
    const go = await confirm({
      title: isCn ? '撤销上次恢复、导入或重置？' : 'Undo last restore, import or reset?',
      message:
        (isCn ? '回到恢复 / 导入 / 重置之前的样子，仅能撤销一次。' : 'Go back to how things were before. Works only once.') +
        (newer > 0
          ? isCn
            ? `\n\n之后新记的 ${newer} 场训练也会一起丢掉。`
            : `\n\nThe ${newer} workout${newer > 1 ? 's' : ''} logged since then will be lost too.`
          : ''),
      confirmLabel: isCn ? '撤销' : 'Undo',
      danger: true,
    });
    if (!go) return;
    try {
      blockBack(true);
      const pushed = await rollbackImport().finally(() => blockBack(false));
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
  }, [confirm, settingsCtx, toast]);
}
