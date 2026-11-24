/**
 * 数据安全的「后台」：挂在 App 根部。
 *   - 启动 / 回到前台时跑每日兜底备份（距上次成功超过 24 小时、数据有变化才写）
 *   - 恢复 / 导入之后那次 reload 起来，弹出跨 reload 的提示
 *   - 第一次有了训练记录、还没选备份文件夹时，引导一次
 *   - 自动备份失败时提示一次（同一原因不重复）
 *   - 承载从各处打开的「从备份恢复」「从 Strong / Hevy 导入」弹窗（openDataFlow）
 */
import React, { useEffect, useState } from 'react';
import { FolderOpen, ShieldCheck } from 'lucide-react';
import { Language } from '../../../types';
import { Modal } from '../Modal';
import { useUserSettingsContext } from '../../contexts/UserSettingsContext';
import { useUiOverlay } from '../../contexts/UiOverlayContext';
import { useWorkoutContext } from '../../contexts/WorkoutContext';
import { AUTO_BACKUP_FAILED_EVENT, maybeDailyBackup, type BackupErrorCode } from '../../../services/fitlogAutoBackup';
import { storage } from '../../../services/appStorage';
import { isDemo } from '../../../services/appEnv';
import { OPEN_DATA_FLOW_EVENT, backupErrorText, useBackupState, useChooseBackupFolder, type DataFlow } from '../../hooks/useDataSafety';
import { RestoreBackupModal } from './RestoreBackupModal';
import { ImportCsvModal } from './ImportCsvModal';
import { takeFlash } from './flash';

const PROMPTED_KEY = 'fitlog_backup_setup_prompted';

export const DataSafetyHost: React.FC = () => {
  const { lang } = useUserSettingsContext();
  const { toast } = useUiOverlay();
  const { workouts } = useWorkoutContext();
  const { supported, folder } = useBackupState();
  const choose = useChooseBackupFolder();
  const isCn = lang === Language.CN;
  const t = (cn: string, en: string) => (isCn ? cn : en);

  const [flow, setFlow] = useState<DataFlow | null>(null);

  useEffect(() => {
    const on = (e: Event) => setFlow((e as CustomEvent<DataFlow>).detail);
    window.addEventListener(OPEN_DATA_FLOW_EVENT, on);
    return () => window.removeEventListener(OPEN_DATA_FLOW_EVENT, on);
  }, []);

  useEffect(() => {
    const f = takeFlash();
    if (f) toast(f.message, f.variant);
    // 启动后稍等，别跟首屏水化抢 IndexedDB
    const timer = window.setTimeout(maybeDailyBackup, 3000);
    const onVis = () => {
      if (document.visibilityState === 'visible') maybeDailyBackup();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // 自动备份失败：同一原因只报一次（去重在 fitlogAutoBackup），首选项和「我的」页那一行一直是红的
  useEffect(() => {
    const on = (e: Event) =>
      toast(`${t('自动备份失败：', 'Auto backup failed: ')}${backupErrorText((e as CustomEvent<BackupErrorCode>).detail, isCn)}`, 'error');
    window.addEventListener(AUTO_BACKUP_FAILED_EVENT, on);
    return () => window.removeEventListener(AUTO_BACKUP_FAILED_EVENT, on);
  }, [isCn, toast]);

  // 第一次有了结束的训练、还没选文件夹 → 引导一次（只一次；之后设置页里一直有「未开启」的提示）
  const hasFinished = workouts.some(w => w.finishedAt || w.status === 'completed');
  useEffect(() => {
    if (!supported || folder || !hasFinished || isDemo() || flow) return;
    if (storage.getItem(PROMPTED_KEY) === '1') return;
    setFlow('setup');
  }, [supported, folder, hasFinished]);

  const closeSetup = () => {
    storage.setItem(PROMPTED_KEY, '1');
    setFlow(null);
  };

  return (
    <>
      <RestoreBackupModal open={flow === 'restore'} onClose={() => setFlow(null)} />
      <ImportCsvModal open={flow === 'import-csv'} onClose={() => setFlow(null)} />
      <Modal
        isOpen={flow === 'setup'}
        onClose={closeSetup}
        variant="center"
        size="sm"
        dismissOnScrim={false}
        showCloseButton={false}
        title={t('开启自动备份？', 'Turn on auto backup?')}
        testId="backup-setup-modal"
        footer={
          <div className="space-y-2">
            <button
              type="button"
              className="ui-btn-primary w-full py-3.5 flex items-center justify-center gap-2"
              data-testid="backup-setup-choose"
              onClick={async () => {
                storage.setItem(PROMPTED_KEY, '1');
                setFlow(null);
                await choose();
              }}
            >
              <FolderOpen size={18} strokeWidth={1.75} />
              {t('选择文件夹', 'Choose folder')}
            </button>
            <button type="button" className="w-full py-2 text-secondary text-small" onClick={closeSetup} data-testid="backup-setup-later">
              {t('以后再说', 'Not now')}
            </button>
          </div>
        }
      >
        <div className="space-y-3 text-small leading-relaxed text-secondary">
          <div className="flex justify-center">
            <div className="p-3 bg-accent-soft text-accent rounded-control">
              <ShieldCheck size={26} strokeWidth={1.75} />
            </div>
          </div>
          <p>
            {t(
              '每次练完自动备份到你选的文件夹，卸载后文件还在，重装可恢复。',
              'Every workout is backed up to the folder you pick. The files survive uninstalling and can be restored after reinstalling.',
            )}
          </p>
          <p>
            {t(
              '在系统窗口里点「使用此文件夹」。',
              'In the system window, tap "Use this folder".',
            )}
          </p>
        </div>
      </Modal>
    </>
  );
};
