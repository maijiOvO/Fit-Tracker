/**
 * 首选项「数据」组里的自动备份 / CSV / 搬家入口（设计见 docs/design-backup.md §4）。
 *
 * 「上次备份」只来自读回核对通过的那一次：时间、位置、份数都是实际值。
 * 失败时红字写原因和下一步，不留「看起来正常」的空隙。
 */
import React from 'react';
import { FileSpreadsheet, FolderOpen, History, RefreshCw, Upload } from 'lucide-react';
import { Language } from '../../../types';
import { useUserSettingsContext } from '../../contexts/UserSettingsContext';
import { displayPath } from '../../../services/fitlogFolder';
import {
  backupErrorText,
  openDataFlow,
  useBackupNow,
  useBackupState,
  useChooseBackupFolder,
  useExportCsv,
} from '../../hooks/useDataSafety';

function ago(iso: string, isCn: boolean): string {
  const d = new Date(iso);
  const now = new Date();
  const hm = d.toLocaleTimeString(isCn ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86400000,
  );
  if (days === 0) return `${isCn ? '今天' : 'Today'} ${hm}`;
  if (days === 1) return `${isCn ? '昨天' : 'Yesterday'} ${hm}`;
  return d.toLocaleDateString(isCn ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }) + ` ${hm}`;
}

const Btn: React.FC<{ onClick: () => void; icon: React.ReactNode; children: React.ReactNode; testId?: string }> = ({
  onClick,
  icon,
  children,
  testId,
}) => (
  <button
    type="button"
    onClick={onClick}
    data-testid={testId}
    className="ui-btn-secondary flex-1 w-full min-w-0 flex items-center justify-center gap-2 py-3 text-sm"
  >
    {icon}
    <span className="truncate">{children}</span>
  </button>
);

export const DataSafetySection: React.FC = () => {
  const { lang } = useUserSettingsContext();
  const isCn = lang === Language.CN;
  const t = (cn: string, en: string) => (isCn ? cn : en);
  const { supported, folder, status } = useBackupState();
  const choose = useChooseBackupFolder();
  const backup = useBackupNow();
  const exportCsv = useExportCsv();
  const ic = (C: typeof FolderOpen) => <C size={17} strokeWidth={1.75} className="text-accent flex-shrink-0" />;

  // 错误比成功新 → 显示错误；否则显示最近一次成功
  const errNewer = status.lastError && (!status.lastOkAt || status.lastError.at > status.lastOkAt);

  return (
    <div className="space-y-3" data-testid="data-safety">
      {supported && (
        <>
          <div className="space-y-1">
            <p className="font-bold text-primary">{t('自动备份', 'Auto backup')}</p>
            {!folder ? (
              <p className="text-xs text-danger" data-testid="backup-status">
                {t('未开启 · 卸载 App 会丢失全部记录', 'Off · uninstalling the app loses everything')}
              </p>
            ) : errNewer ? (
              <p className="text-xs text-danger" data-testid="backup-status">
                {t('上次备份失败：', 'Last backup failed: ') + backupErrorText(status.lastError!.code, isCn)}
              </p>
            ) : status.lastOkAt ? (
              <p className="text-xs text-secondary" data-testid="backup-status">
                {t('上次备份：', 'Last backup: ')}
                {ago(status.lastOkAt, isCn)} · {displayPath(folder, isCn)}
                {status.fileCount != null && t(` · 共 ${status.fileCount} 份`, ` · ${status.fileCount} files`)}
              </p>
            ) : (
              <p className="text-xs text-secondary" data-testid="backup-status">
                {displayPath(folder, isCn)} · {t('还没有备份', 'No backup yet')}
              </p>
            )}
            {folder && status.shrinkWarning && !errNewer && (
              <p className="text-xs text-danger">
                {t('这次备份的训练次数比上次少很多，旧备份都保留着', 'Far fewer workouts than last time — older backups kept')}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {folder ? (
              <>
                <Btn onClick={() => void backup()} icon={ic(RefreshCw)} testId="backup-now">
                  {t('立即备份', 'Back up now')}
                </Btn>
                <Btn onClick={() => void choose()} icon={ic(FolderOpen)} testId="backup-change-folder">
                  {errNewer && status.lastError?.code === 'no-access' ? t('重新选择', 'Choose again') : t('更换文件夹', 'Change folder')}
                </Btn>
              </>
            ) : (
              <Btn onClick={() => void choose()} icon={ic(FolderOpen)} testId="backup-choose-folder">
                {t('选择文件夹', 'Choose folder')}
              </Btn>
            )}
          </div>
          <Btn onClick={() => openDataFlow('restore')} icon={ic(History)} testId="backup-restore">
            {t('从备份文件夹恢复', 'Restore from backup folder')}
          </Btn>
          <p className="text-[10px] text-tertiary leading-relaxed px-1">
            {t(
              '也可以选 SD 卡，或者被坚果云 / Syncthing 同步的文件夹 —— App 不联网也能做到云端备份。',
              'You can also pick an SD card, or a folder synced by Syncthing / a cloud drive app — cloud backup without this app going online.',
            )}
          </p>
        </>
      )}

      <div className="flex gap-2">
        <Btn onClick={() => void exportCsv('share')} icon={ic(FileSpreadsheet)} testId="export-csv">
          {t('导出 CSV', 'Export CSV')}
        </Btn>
        {supported && folder && (
          <Btn onClick={() => void exportCsv('folder')} icon={ic(FolderOpen)} testId="export-csv-folder">
            {t('存到文件夹', 'Save to folder')}
          </Btn>
        )}
      </div>
      <p className="text-[10px] text-tertiary leading-relaxed px-1 -mt-1">
        {t('一行一组，Excel 直接打开；也可以交给 AI 分析。', 'One row per set; opens in Excel. Hand it to an AI for analysis.')}
      </p>
      <Btn onClick={() => openDataFlow('import-csv')} icon={ic(Upload)} testId="import-csv">
        {t('从 Strong / Hevy 导入', 'Import from Strong / Hevy')}
      </Btn>
    </div>
  );
};
