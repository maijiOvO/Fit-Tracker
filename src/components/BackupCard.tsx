/**
 * 备份卡片：导出 / 导入 / 撤销上次导入。
 *
 * 对单机发行版（solo）来说这张卡是数据的唯一出路 —— 没有服务端兜底，
 * 卸载即失。所以「撤销」不是锦上添花：覆盖式恢复要是没有退路，
 * 用户点错一次就没了。回滚副本存在 IndexedDB，见 services/fitlogBackup.ts。
 */
import React, { useEffect, useState } from 'react';
import { Cloud, Download, Undo2, Upload } from 'lucide-react';
import { Language } from '../../types';
import { translations } from '../../translations';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useRollbackImport } from '../hooks/useImportData';
import { readRollback, type RollbackInfo } from '../../services/fitlogBackup';

interface BackupCardProps {
  onExportData: () => void;
  onImportData: () => void;
}

export const BackupCard: React.FC<BackupCardProps> = ({ onExportData, onImportData }) => {
  const { lang } = useUserSettingsContext();
  const isCn = lang === Language.CN;
  const rollbackImport = useRollbackImport();
  const [rollback, setRollback] = useState<RollbackInfo | null>(null);

  useEffect(() => {
    let alive = true;
    void readRollback()
      .then((info) => { if (alive) setRollback(info); })
      .catch(() => { /* 读不到就是没有，不打扰用户 */ });
    return () => { alive = false; };
  }, []);

  return (
    <div className="mt-8 mb-8 px-1 pb-16">
      <div className="ui-card p-6 text-center space-y-4">
        <div className="flex justify-center">
          <div className="p-3 bg-accent-soft text-accent rounded-control">
            <Cloud size={28} strokeWidth={1.75} />
          </div>
        </div>
        <h4 className="font-display text-lg font-semibold text-primary">
          {translations.exportData[lang]}
        </h4>
        <p className="text-xs text-secondary leading-relaxed max-w-[240px] mx-auto">
          {translations.exportDesc[lang]}
        </p>

        <button
          onClick={onExportData}
          className="ui-btn-secondary w-full flex items-center justify-center gap-2 py-3.5"
        >
          <Download size={18} strokeWidth={1.75} className="text-accent" />
          {isCn ? '立即导出备份' : 'Export backup'}
        </button>

        <button
          onClick={onImportData}
          className="ui-btn-secondary w-full flex items-center justify-center gap-2 py-3.5"
        >
          <Upload size={18} strokeWidth={1.75} className="text-accent" />
          {translations.importData[lang]}
        </button>
        <p className="text-[10px] text-tertiary leading-relaxed max-w-[260px] mx-auto">
          {translations.importDesc[lang]}
        </p>

        {rollback && (
          <div className="pt-2 border-t border-subtle space-y-2">
            <button
              onClick={() => { void rollbackImport(); }}
              className="ui-btn-secondary w-full flex items-center justify-center gap-2 py-3"
            >
              <Undo2 size={18} strokeWidth={1.75} className="text-accent" />
              {translations.undoImport[lang]}
            </button>
            <p className="text-[10px] text-tertiary">
              {isCn
                ? `导入前的副本 · ${rollback.workouts} 次训练 · ${rollback.createdAt.split('T')[0]}`
                : `Pre-import copy · ${rollback.workouts} workouts · ${rollback.createdAt.split('T')[0]}`}
            </p>
          </div>
        )}

        <p className="text-[10px] text-tertiary">
          {isCn ? '你的数据，始终属于你。' : 'Your data is yours. Always.'}
        </p>
      </div>
    </div>
  );
};

export default BackupCard;
