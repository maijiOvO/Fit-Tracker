/**
 * App 顶部导航：Logo + 同步按钮 + 单位切换
 */
import React from 'react';
import {
  AlertCircle,
  Check as CheckIcon,
  Dumbbell,
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
  <header className="sticky top-0 z-40 bg-base/90 backdrop-blur-xl border-b border-divider px-6 pb-4 pt-14 md:pt-[calc(env(safe-area-inset-top)+1.5rem)] flex justify-between items-center">
    <div className="flex items-center gap-3">
      <Dumbbell className="text-accent" />
      <h1 className="font-display text-lg font-semibold tracking-tight text-primary">
        {translations.appTitle[lang]}
      </h1>
    </div>

    <div className="flex items-center gap-2">
      <button
        onClick={onSync}
        disabled={syncDisabled}
        className={`p-2 rounded-xl border transition-all active:scale-90 ${
          syncStatus === 'error'
            ? 'bg-red-500/10 border-red-500/20'
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
        className="bg-card border border-divider px-3 py-1.5 rounded-xl text-xs font-semibold uppercase text-accent hover:bg-card-hover hover:text-primary transition-all active:scale-95 shadow-sm"
      >
        {unit}
      </button>
    </div>
  </header>
);

export default AppHeader;
