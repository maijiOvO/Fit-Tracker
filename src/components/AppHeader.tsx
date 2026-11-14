/**
 * App 顶部导航：刊名 + 同步按钮 + 单位切换
 *
 * 刊名前面不挂图标。这套视觉是「墨与纸」——一份刊物的报头只有刊名本身，
 * 加一枚通用哑铃图标既没有信息量，又把整页的调子拉回到通用 App 模板。
 */
import React from 'react';
import {
  AlertCircle,
  Check as CheckIcon,
  RefreshCw,
} from 'lucide-react';
import { Language } from '../../types';
import { translations } from '../../translations';
import type { SyncStatus } from '../hooks/useFitlogSync';
import type { SyncState } from '../../services/fitlogRemoteSync';
import { isRemoteConfigured } from '../../services/fitlogRemote';
import { UndoRedoButtons } from './UndoRedoButtons';

interface AppHeaderProps {
  lang: Language;
  unit: 'kg' | 'lbs';
  /** 手动同步这一头：同步中 / 失败 */
  syncStatus: SyncStatus;
  /** 后台推送这一头：有没有推上去 */
  pushState: SyncState;
  /** 是否禁用同步按钮（同步中 / user 不存在） */
  syncDisabled: boolean;
  onSync: () => void;
  onToggleUnit: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  lang,
  unit,
  syncStatus,
  pushState,
  syncDisabled,
  onSync,
  onToggleUnit,
}) => (
  <header data-chrome="top" className="sticky top-0 z-bar bg-base border-b border-divider px-6 pb-4 pt-14 md:pt-[calc(env(safe-area-inset-top)+1.5rem)] flex justify-between items-center">
    <h1 className="font-display text-lg font-semibold tracking-tight text-primary">
      {translations.appTitle[lang]}
    </h1>

    <div className="flex items-center gap-2">
      {/* 全局撤销 / 重做：顶栏上方是状态栏留白、下方是分隔线，纵向没有别的按钮 */}
      <UndoRedoButtons isCn={lang === Language.CN} />
      {/* 没有服务器（单机版 / 演示版）就没有同步这回事：不出这颗按钮（同首选项「同步」一行） */}
      {isRemoteConfigured() && (
        <button
          data-testid="header-sync"
          onClick={onSync}
          disabled={syncDisabled}
          aria-label={lang === Language.CN ? '同步' : 'Sync'}
          className={`p-2 rounded-control border transition-ui active:scale-press-sm ${
            syncStatus === 'error'
              ? 'bg-danger/10 border-danger/20'
              : 'bg-card border-divider'
          }`}
        >
          {syncStatus === 'syncing' ? (
            <RefreshCw className="animate-spin text-accent" size={18} />
          ) : syncStatus === 'error' ? (
            <AlertCircle className="text-danger" size={18} />
          ) : pushState === 'failed' ? (
            // 后台推送没推上去：改动在本机是安全的，中性的「待同步」，不用红（审查 E1）。原先这里照样是绿勾
            <RefreshCw className="text-tertiary" size={18} />
          ) : (
            <CheckIcon className="text-success" size={18} strokeWidth={2.5} />
          )}
        </button>
      )}

      <button
        onClick={onToggleUnit}
        data-testid="header-unit-toggle"
        className="bg-card border border-divider px-3 py-1.5 rounded-control text-xs font-semibold uppercase text-accent hover:bg-card-hover hover:text-primary transition-ui active:scale-press-sm shadow-sm"
      >
        {unit}
      </button>
    </div>
  </header>
);
