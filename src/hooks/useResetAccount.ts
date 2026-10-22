/**
 * 一键重置账户
 */
import React, { useCallback, useState } from 'react';
import { translations } from '../../translations';
import { collectLocalSnapshot } from '../../services/fitlogRemote';
import { overwriteLocal } from '../../services/fitlogBackup';
import type { FitlogRemoteSnapshot } from '../../services/fitlogSnapshotTypes';
import { setFlash } from '../components/data/flash';
import { blockBack } from './useBackClose';
import { useAuthContext } from '../contexts/AuthContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';

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
  const authCtx = useAuthContext();
  const settingsCtx = useUserSettingsContext();
  const { toast } = useUiOverlay();

  const [showResetAccountModal, setShowResetAccountModal] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  const handleResetAccount = useCallback(async () => {
    const user = authCtx.user;
    if (!user) return;

    setIsResetting(true);
    const lang = settingsCtx.lang;

    try {
      /**
       * 2026-10-22（审查 A24）：和恢复备份走同一条整份改写的路（overwriteLocal）——
       *   - 删掉的每一条都记墓碑（原来是清空墓碑：下次启动拉取会把服务器上的全部合并回来，重置白做）
       *   - 训练计划、馆档案等首选项（appPrefs）一起清掉，只留语言和单位
       *   - 以本机为准推上去；推不上去如实说，联网后自动补推（不会先拉回旧数据）
       */
      const before = await collectLocalSnapshot();
      const keepApp = before.prefs.appPrefs;
      const empty: FitlogRemoteSnapshot = {
        schemaVersion: 2,
        clientExportedAt: new Date().toISOString(),
        workouts: [],
        goals: [],
        weightLogs: [],
        customMetrics: [],
        prs: [],
        scheduledWorkouts: [],
        customExerciseDefsFromDb: [],
        prefs: {
          customTags: [],
          customExercises: [],
          exerciseNotes: {},
          starredExercises: {},
          exerciseMetricConfigs: {},
          tagRenameOverrides: {},
          exerciseOverrides: {},
          starredLastUpdateMs: 0,
          metricsLastUpdateMs: 0,
          prefsLastUpdateMs: 0,
          lang: before.prefs.lang,
          unit: before.prefs.unit,
          avatarDataUrl: null,
          appPrefs: { ...(keepApp?.lang ? { lang: keepApp.lang } : {}), ...(keepApp?.unit ? { unit: keepApp.unit } : {}) },
        },
      };
      blockBack(true);
      const pushed = await overwriteLocal(empty, before).finally(() => blockBack(false));

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
  }, [authCtx.user, setActiveTab, setEditingWorkoutId, settingsCtx, toast]);

  return {
    showResetAccountModal,
    setShowResetAccountModal,
    resetConfirmText,
    setResetConfirmText,
    isResetting,
    handleResetAccount,
  };
}
