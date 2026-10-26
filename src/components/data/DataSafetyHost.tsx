/**
 * 数据安全的「后台」：挂在 App 根部。
 *   - 启动 / 回到前台时跑每日兜底备份（距上次成功超过 24 小时、数据有变化才写）
 *   - 恢复 / 导入之后那次 reload 起来，弹出跨 reload 的提示
 *   - 第一次有了训练记录、还没选备份文件夹时，引导一次
 *   - 承载从各处打开的「从备份恢复」「从 Strong / Hevy 导入」弹窗（openDataFlow）
 */
import React, { useEffect, useState } from 'react';
import { FolderOpen, ShieldCheck } from 'lucide-react';
import { Language } from '../../../types';
import { Modal } from '../Modal';
import { useUserSettingsContext } from '../../contexts/UserSettingsContext';
import { useUiOverlay } from '../../contexts/UiOverlayContext';
import { useWorkoutContext } from '../../contexts/WorkoutContext';
import { maybeDailyBackup } from '../../../services/fitlogAutoBackup';
import { storage } from '../../../services/appStorage';
import { isDemo } from '../../../services/appEnv';
import { OPEN_DATA_FLOW_EVENT, useBackupState, useChooseBackupFolder, type DataFlow } from '../../hooks/useDataSafety';
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
        title={t('让记录卸载也不丢？', 'Keep your log safe from uninstalls?')}
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
              '选一个文件夹，每次练完自动备份到这里。卸载后文件仍在，重装可恢复。',
              'Pick a folder; every workout is backed up there. Files survive uninstalling and restore after reinstalling.',
            )}
          </p>
          <p>
            {t(
              '系统窗口打开后，直接点「使用此文件夹」即可。',
              'In the system window, just tap "Use this folder".',
            )}
          </p>
        </div>
      </Modal>
    </>
  );
};
