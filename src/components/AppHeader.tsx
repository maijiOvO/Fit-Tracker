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

interface AppHeaderProps {
  lang: Language;
  unit: 'kg' | 'lbs';
  syncStatus: SyncStatus;
  /** 是否禁用同步按钮（未配置远端 / 同步中 / user 不存在） */
  syncDisabled: boolean;
  onSync: () => void;
  onToggleUnit: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  lang,
  unit,
  syncStatus,
  syncDisabled,
  onSync,
  onToggleUnit,
}) => (
  <header className="sticky top-0 z-bar bg-base/90 border-b border-divider px-6 pb-4 pt-14 md:pt-[calc(env(safe-area-inset-top)+1.5rem)] flex justify-between items-center">
    <h1 className="font-display text-lg font-semibold tracking-tight text-primary">
      {translations.appTitle[lang]}
    </h1>

    <div className="flex items-center gap-2">
      <button
        onClick={onSync}
        disabled={syncDisabled}
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
        ) : (
          <CheckIcon className="text-success" size={18} strokeWidth={2.5} />
        )}
      </button>

      <button
        onClick={onToggleUnit}
        className="bg-card border border-divider px-3 py-1.5 rounded-control text-xs font-semibold uppercase text-accent hover:bg-card-hover hover:text-primary transition-ui active:scale-press-sm shadow-sm"
      >
        {unit}
      </button>
    </div>
  </header>
);

export default AppHeader;
