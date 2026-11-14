/**
 * 一键重置账户
 */
import React, { useCallback, useState } from 'react';
import { translations } from '../../translations';
import { resetAccount } from '../../services/fitlogBackup';
import { setFlash } from '../components/data/flash';
import { blockBack } from './useBackClose';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { useWorkoutContext } from '../contexts/WorkoutContext';

export interface UseResetAccountResult {
  showResetAccountModal: boolean;
  setShowResetAccountModal: React.Dispatch<React.SetStateAction<boolean>>;
  resetConfirmText: string;
  setResetConfirmText: React.Dispatch<React.SetStateAction<string>>;
  isResetting: boolean;
  handleResetAccount: () => Promise<void>;
}

export interface UseResetAccountParams {
  setActiveTab: (tab: 'dashboard' | 'new' | 'plan' | 'profile') => void;
  setEditingWorkoutId: (id: string | null) => void;
}

export function useResetAccount({
  setActiveTab,
  setEditingWorkoutId,
}: UseResetAccountParams): UseResetAccountResult {
  const settingsCtx = useUserSettingsContext();
  const { toast } = useUiOverlay();
  const { discardWorkbenchWith } = useWorkoutContext();

  const [showResetAccountModal, setShowResetAccountModal] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  const handleResetAccount = useCallback(async () => {
    setIsResetting(true);
    const lang = settingsCtx.lang;

    try {
      // 先存回滚槽再清空、以本机为准推上去（见 resetAccount）；工作台上那场跟着丢（discardWorkbenchWith）
      blockBack(true);
      const pushed = await discardWorkbenchWith(resetAccount).finally(() => blockBack(false));

      setShowResetAccountModal(false);
      setResetConfirmText('');
      setEditingWorkoutId(null);
      setActiveTab('dashboard');
      setFlash(
        String(translations.resetSuccess[lang]) +
          (pushed === 'failed'
            ? lang === 'cn'
              ? '（服务器暂时没连上，还没清空；联网后会自动补推）'
              : ' (server unreachable — it is not cleared yet; it will sync once online)'
            : ''),
        pushed === 'failed' ? 'info' : 'success',
      );
      // 各个 context 都是启动时从存储水化的：重载一次最干净（同恢复备份）
      window.location.reload();
    } catch (error) {
      console.error('重置账户失败:', error);
      toast(String(translations.resetError[settingsCtx.lang]), 'error');
    } finally {
      setIsResetting(false);
    }
  }, [discardWorkbenchWith, setActiveTab, setEditingWorkoutId, settingsCtx, toast]);

  return {
    showResetAccountModal,
    setShowResetAccountModal,
    resetConfirmText,
    setResetConfirmText,
    isResetting,
    handleResetAccount,
  };
}
