/**
 * 全量数据导出。
 *
 * 导出的是 services/fitlogBackup 里的完整快照，**不是**自己攒的字段子集。
 * 改版前这里手工列字段，漏了 prs 与 scheduledWorkouts —— 导出会成功、
 * 文件也有模有样，直到换手机恢复后才发现训练计划没了。见 fitlogBackup.ts 顶部。
 */
import { useCallback } from 'react';
import { Language } from '../../types';
import { translations } from '../../translations';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { backupFileName, buildBackupFile } from '../../services/fitlogBackup';
import { saveTextFile } from '../../services/fitlogSaveFile';
import { saveOutcomeText } from '../components/data/flash';

export type ExportStatus = 'idle' | 'syncing' | 'error';

export function useExportData(
  setSyncStatus: (status: ExportStatus) => void,
): () => Promise<void> {
  const settingsCtx = useUserSettingsContext();
  const { toast } = useUiOverlay();

  return useCallback(async () => {
    const lang = settingsCtx.lang;
    try {
      setSyncStatus('syncing');
      const file = await buildBackupFile();
      const outcome = await saveTextFile(backupFileName(), JSON.stringify(file, null, 2));
      setSyncStatus('idle');
      // 只有真的交出去了才报成功：取消分享、没报接收应用都不是「导出成功」，
      // 一律报成功就是又造一个假信号 —— 这条路正是这么坏过一次的
      const { message, variant } = saveOutcomeText(outcome.kind, lang === Language.CN, String(translations.exportSuccess[lang]));
      toast(message, variant);
    } catch (error) {
      console.error('Export failed:', error);
      toast(lang === Language.CN ? '导出失败' : 'Export failed', 'error');
      setSyncStatus('error');
    }
  }, [setSyncStatus, settingsCtx, toast]);
}
