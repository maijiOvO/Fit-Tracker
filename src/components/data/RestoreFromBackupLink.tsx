/**
 * 首页空状态下的「以前用过 fitlog？从备份恢复」。
 * 重装后 App 无权静默读旧文件（Android 11+），只能让用户点一下、在系统窗口里选回备份文件夹。
 * 不支持备份文件夹的平台（浏览器）不显示。
 */
import React from 'react';
import { History } from 'lucide-react';
import { Language } from '../../../types';
import { useUserSettingsContext } from '../../contexts/UserSettingsContext';
import { folderSupported } from '../../../services/fitlogFolder';
import { openDataFlow } from '../../hooks/useDataSafety';

export const RestoreFromBackupLink: React.FC = () => {
  const { lang } = useUserSettingsContext();
  if (!folderSupported()) return null;
  const isCn = lang === Language.CN;
  return (
    <button
      type="button"
      onClick={() => openDataFlow('restore')}
      data-testid="empty-restore"
      className="mt-6 flex items-center gap-2 text-secondary text-small py-2 px-3 rounded-control active:bg-inset"
    >
      <History size={16} strokeWidth={1.75} className="text-accent" />
      {isCn ? '以前用过 fitlog？从备份恢复' : 'Used fitlog before? Restore from backup'}
    </button>
  );
};
