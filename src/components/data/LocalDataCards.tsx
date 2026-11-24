/**
 * 首页的两张本机数据卡（上架审查 C12 / C14）：
 *   - LocalLossCard：库被系统清掉 / 损坏重建，本机记着的 N 场训练不见了 —— 原来静默变成空库，用户以为什么都没记过；
 *   - LocalReadErrorCard：开库 / 读库失败 —— 原来显示成全新用户的空状态，数据其实还在库里。
 * 只给状态和出路，不写说明。
 */
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { clearLocalLoss, type LocalLoss } from '../../../services/localCensus';
import { folderSupported } from '../../../services/fitlogFolder';
import { openDataFlow } from '../../hooks/useDataSafety';
import { getBackupFolder } from '../../../services/fitlogAutoBackup';

export const LocalLossCard: React.FC<{ loss: LocalLoss; isCn: boolean }> = ({ loss, isCn }) => {
  const t = (cn: string, en: string) => (isCn ? cn : en);
  const canRestore = folderSupported();
  return (
    <div className="ui-card p-4 space-y-3 border border-danger/30" data-testid="local-loss" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} strokeWidth={1.75} className="text-danger shrink-0 mt-0.5" />
        <div className="space-y-1 text-small">
          <p className="text-primary font-semibold">
            {loss.expected > 0
              ? t(`这台手机上的 ${loss.expected} 场训练不见了`, `${loss.expected} workout${loss.expected > 1 ? 's' : ''} on this phone went missing`)
              : t('这台手机上的训练记录不见了', 'The workouts on this phone went missing')}
          </p>
          <p className="text-secondary">{t('系统清理了存储，或者数据损坏。', 'The system cleared storage, or the data was damaged.')}</p>
          {canRestore && !getBackupFolder() && (
            <p className="text-secondary">{t('没开过自动备份；导出过的备份文件也能从这里选。', 'Auto backup was never on; a backup file you exported also works.')}</p>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        {canRestore && (
          <button type="button" className="ui-btn-primary flex-1 py-2.5" onClick={() => openDataFlow('restore')} data-testid="local-loss-restore">
            {t('从备份恢复', 'Restore from backup')}
          </button>
        )}
        <button type="button" className="ui-btn-secondary flex-1 py-2.5" onClick={clearLocalLoss} data-testid="local-loss-dismiss">
          {t('不恢复', 'Not now')}
        </button>
      </div>
    </div>
  );
};

export const LocalReadErrorCard: React.FC<{ isCn: boolean }> = ({ isCn }) => {
  const t = (cn: string, en: string) => (isCn ? cn : en);
  return (
    <div className="ui-card p-4 space-y-3" data-testid="local-read-error" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} strokeWidth={1.75} className="text-danger shrink-0 mt-0.5" />
        <div className="space-y-1 text-small">
          <p className="text-primary font-semibold">{t('读不出本机数据', "Can't read the data on this phone")}</p>
          <p className="text-secondary">{t('数据还在，先检查手机存储空间，再重试。', 'Your data is still there. Check free storage, then retry.')}</p>
        </div>
      </div>
      <button type="button" className="ui-btn-primary w-full py-2.5" onClick={() => window.location.reload()} data-testid="local-read-retry">
        {t('重试', 'Retry')}
      </button>
    </div>
  );
};
