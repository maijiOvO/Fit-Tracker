/**
 * 头像上传
 */
import React, { useCallback, useRef } from 'react';
import { Language } from '../../types';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { useAvatar } from '../contexts/AvatarContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { storage } from '../../services/appStorage';
import { markPrefsUpdated } from '../../services/fitlogRemote';
import { shrinkAvatar } from '../utils/avatarImage';

export interface UseAvatarUploadResult {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleAvatarUpload: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
}

export function useAvatarUpload(): UseAvatarUploadResult {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setAvatarUrl } = useAvatar();
  const { lang } = useUserSettingsContext();
  const { toast } = useUiOverlay();
  const isCn = lang === Language.CN;

  const handleAvatarUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        // 缩成 256px JPEG、只存这一份（fitlog_current_user 里不再带头像，AvatarContext 从这里读）
        const dataUrl = await shrinkAvatar(file);
        storage.setItem('fitlog_avatar_data_url', dataUrl);
        setAvatarUrl(dataUrl);
        // 头像在 prefs 块里同步：打时间戳，否则下次合并会被远端的旧头像盖回去
        markPrefsUpdated();
        scheduleDebouncedFitlogPush();
      } catch (error) {
        console.error('Upload error:', error);
        // 固定文案：解码报错原文（英文、浏览器各不相同）用户看不懂，原文留在日志里
        toast(isCn ? '上传失败：读不了这张图片，换一张试试' : "Upload failed: couldn't read this image. Try another one", 'error');
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [setAvatarUrl, isCn, toast],
  );

  return { fileInputRef, handleAvatarUpload };
}
