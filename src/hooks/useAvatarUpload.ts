/**
 * 头像上传
 */
import React, { useCallback, useRef, useState } from 'react';
import { Language } from '../../types';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { useAuthContext } from '../contexts/AuthContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';

export interface UseAvatarUploadResult {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  uiBusy: boolean;
  handleAvatarUpload: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
}

export function useAvatarUpload(): UseAvatarUploadResult {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uiBusy, setUiBusy] = useState(false);
  const authCtx = useAuthContext();
  const { lang } = useUserSettingsContext();
  const { toast } = useUiOverlay();
  const isCn = lang === Language.CN;

  const handleAvatarUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      const user = authCtx.user;
      if (!file || !user) return;

      try {
        setUiBusy(true);
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(new Error('read failed'));
          r.readAsDataURL(file);
        });
        localStorage.setItem('fitlog_avatar_data_url', dataUrl);
        const updatedUser = { ...user, avatarUrl: dataUrl };
        authCtx.setUser(updatedUser);
        localStorage.setItem('fitlog_current_user', JSON.stringify(updatedUser));
        scheduleDebouncedFitlogPush();
      } catch (error: any) {
        console.error('Upload error:', error);
        toast(
          (isCn ? '上传失败: ' : 'Upload failed: ') + (error?.message || error),
          'error',
        );
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
        setUiBusy(false);
      }
    },
    [authCtx, isCn, toast],
  );

  return { fileInputRef, uiBusy, handleAvatarUpload };
}
