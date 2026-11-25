/**
 * 数据安全的「后台」：挂在 App 根部。
 *   - 启动 / 回到前台时跑每日兜底备份（距上次成功超过 24 小时、数据有变化才写）
 *   - 恢复 / 导入之后那次 reload 起来，弹出跨 reload 的提示
 *   - 第一次有了训练记录、还没选备份文件夹时，引导一次
 *   - 自动备份失败时提示一次（同一原因不重复）
 *   - 承载从各处打开的「从备份恢复」「从 Strong / Hevy 导入」弹窗（openDataFlow）
 *   - 选文件夹时进程被回收、回来后补到的结果（appRestoredResult）：按用途接着开启备份，或直接出恢复摘要
 */
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { FolderOpen, ShieldCheck } from 'lucide-react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Language } from '../../../types';
import { Modal } from '../Modal';
import { useUserSettingsContext } from '../../contexts/UserSettingsContext';
import { useUiOverlay } from '../../contexts/UiOverlayContext';
import { useWorkoutContext } from '../../contexts/WorkoutContext';
import { AUTO_BACKUP_FAILED_EVENT, maybeDailyBackup, type BackupErrorCode } from '../../../services/fitlogAutoBackup';
import { routeRestoredPick, type FolderRef } from '../../../services/fitlogFolder';
import { storage } from '../../../services/appStorage';
import { isDemo } from '../../../services/appEnv';
import { openLayerCount, subscribeLayers } from '../../hooks/useBackClose';
import { OPEN_DATA_FLOW_EVENT, useAdoptBackupFolder, useBackupState, useChooseBackupFolder, type DataFlow } from '../../hooks/useDataSafety';
import { RestoreBackupModal } from './RestoreBackupModal';
import { ImportCsvModal } from './ImportCsvModal';
import { backupErrorText, takeFlash } from './flash';

const PROMPTED_KEY = 'fitlog_backup_setup_prompted';

export const DataSafetyHost: React.FC = () => {
  const { lang } = useUserSettingsContext();
  const { toast } = useUiOverlay();
  const { workouts } = useWorkoutContext();
  const { supported, folder } = useBackupState();
  const choose = useChooseBackupFolder();
  const adopt = useAdoptBackupFolder();
  const isCn = lang === Language.CN;
  const t = (cn: string, en: string) => (isCn ? cn : en);

  const [flow, setFlow] = useState<DataFlow | null>(null);
  /**
   * 每打开一次加一，当两个弹窗的 key：同一个流程再点一次也重新挂载、重新弹选择器
   * （万一系统选择器关了却没派发 cancel，原来那次一直等着，再点入口照样能用，上架审查 C63）。关掉时不变，不打断关的动画
   */
  const [seq, setSeq] = useState(0);
  /** 进程被回收后补回来的恢复用文件夹：恢复弹窗拿它直接列，不再弹选择器 */
  const [restoreFolder, setRestoreFolder] = useState<FolderRef>();
  const openFlow = (kind: DataFlow, f?: FolderRef) => {
    setRestoreFolder(f);
    setSeq(s => s + 1);
    setFlow(kind);
  };

  useEffect(() => {
    const on = (e: Event) => openFlow((e as CustomEvent<DataFlow>).detail);
    window.addEventListener(OPEN_DATA_FLOW_EVENT, on);
    return () => window.removeEventListener(OPEN_DATA_FLOW_EVENT, on);
  }, []);

  // 选文件夹时进程被回收（系统选择器开着、内存紧）：原来那次的 Promise 没了，结果由 appRestoredResult 补回来。
  // 结果会留到有人接为止，晚挂也收得到。文件输入（导入 JSON / CSV、选一个备份文件）的结果 WebView 自己会丢，接不回（design-backup §7）
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = CapApp.addListener('appRestoredResult', e => {
      const r = routeRestoredPick(e);
      if (!r) return;
      if ('code' in r) toast(backupErrorText(r.code, isCn), 'error');
      else if (r.purpose === 'setup') void adopt(r.folder);
      else openFlow('restore', r.folder);
    });
    return () => void handle.then(h => h.remove());
  }, [adopt, isCn, toast]);

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

  // 第一次有了结束的训练、还没选文件夹 → 引导一次（只一次；之后设置页里一直有「未开启」的提示）。
  // 引导是自己弹出来的：有任何层开着（刊末页、首次说明、恢复 / 导入）就排队，等它们都收了再弹，
  // 否则它落在刊末页底下却登记在返回键栈顶，一按返回就被静默关掉、再也不弹（useBackClose 头注释）。
  // 等约 0.5 秒再复查一次：刊末页和 hasFinished 同一次提交生效，这里的 effect 先于刊末页登记跑，读到的层数还是 0；
  // 这段延时也大于安卓连点间隔，收刊末页的第二下落不到「以后再说」上
  const hasFinished = workouts.some(w => w.finishedAt || w.status === 'completed');
  const layers = useSyncExternalStore(subscribeLayers, openLayerCount);
  useEffect(() => {
    if (!supported || folder || !hasFinished || isDemo() || flow || layers > 0) return;
    if (storage.getItem(PROMPTED_KEY) === '1') return;
    const timer = window.setTimeout(() => {
      if (openLayerCount() === 0) setFlow(f => f ?? 'setup');
    }, 500);
    return () => window.clearTimeout(timer);
  }, [supported, folder, hasFinished, layers]);

  const closeSetup = () => {
    storage.setItem(PROMPTED_KEY, '1');
    setFlow(null);
  };

  return (
    <>
      <RestoreBackupModal key={`r${seq}`} open={flow === 'restore'} initialFolder={restoreFolder} onClose={() => setFlow(null)} />
      <ImportCsvModal key={`c${seq}`} open={flow === 'import-csv'} onClose={() => setFlow(null)} />
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
