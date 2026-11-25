/**
 * 渲染出错时的兜底（审查 F1）：没有它，任何一个组件读到一条缺字段的记录就是整页空白，
 * 唯一的出路是清应用数据，没推上去 / 没备份出去的训练跟着没。
 *
 * 两层：index.tsx 包整个 App（重新载入）；App.tsx 包每个 Tab、以 activeTab 为 key（还能回首页，
 * 训练页崩了从首页结束 / 放弃那一场）。兜底页只给状态和出路，不写说明。
 * 导出、撤销直接走 services（和首选项里同一条、真机验过的路），不依赖 context / toast —— 它们可能正是坏掉的那一层。
 * 恢复了坏备份之后崩的，撤销入口原来挂在已经崩掉的「我的」页里，够不着（上架审查 C08 / gap-r3-2#1）：这里有 7 天内的副本就直接给。
 */
import React from 'react';
import { backupFileName, buildBackupFile, readRollback, rollbackImport, type RollbackInfo } from '../../services/fitlogBackup';
import { saveTextFile, type SaveOutcome } from '../../services/fitlogSaveFile';
import { resolveLang } from '../../services/appPrefs';
import { folderSupported } from '../../services/fitlogFolder';
import { openDataFlow } from '../hooks/useDataSafety';
import { overwriteFailedText, overwriteNote, saveOutcomeText, setFlash, undoImportWarning } from './data/flash';
import { translations } from '../../translations';
import { Language } from '../../types';

/** 导出完了就是 saveTextFile 的结局（下载 / 已交给 / 没能确认 / 取消），文案和首选项里同一份 */
type ExportState = 'idle' | 'busy' | 'failed' | SaveOutcome['kind'];
/** 撤销：idle → confirm（原地展开确认，不用 UiOverlay 的弹窗）→ busy → 成功即重载；失败留在 failed */
type UndoState = 'idle' | 'confirm' | 'busy' | 'failed';

interface Props {
  children: React.ReactNode;
  /** Tab 那一层传：回首页。根那一层没有首页可回，只给重新载入 */
  onHome?: () => void;
}

interface State {
  error: Error | null;
  exportState: ExportState;
  rollback: RollbackInfo | null;
  undoState: UndoState;
  undoError: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  // 仓库没装 @types/react，基类是 any：用到的两个成员在这里声明类型
  declare props: Readonly<Props>;
  declare setState: (s: Partial<State>) => void;
  state: State = { error: null, exportState: 'idle', rollback: null, undoState: 'idle', undoError: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
    readRollback().then(
      rollback => this.setState({ rollback }),
      e => console.error('[ErrorBoundary] 读回滚副本失败:', e),
    );
  }

  private exportBackup = async () => {
    this.setState({ exportState: 'busy' });
    try {
      const file = await buildBackupFile();
      const outcome = await saveTextFile(backupFileName(), JSON.stringify(file));
      this.setState({ exportState: outcome.kind });
    } catch (e) {
      console.error('[ErrorBoundary] 导出失败:', e);
      this.setState({ exportState: 'failed' });
    }
  };

  private undo = async (cn: boolean) => {
    if (this.state.undoState !== 'confirm') {
      this.setState({ undoState: 'confirm', undoError: '' });
      return;
    }
    this.setState({ undoState: 'busy' });
    try {
      const note = overwriteNote(await rollbackImport(), cn);
      if (note) setFlash((cn ? '已撤销' : 'Undone') + note, 'info');
      window.location.reload();
    } catch (e) {
      console.error('[ErrorBoundary] 撤销失败:', e);
      this.setState({ undoState: 'failed', undoError: overwriteFailedText(e, cn, { cn: '撤销', en: 'Undo' }) });
    }
  };

  render() {
    const { error, exportState, rollback, undoState, undoError } = this.state;
    if (!error) return this.props.children;
    const { onHome } = this.props;
    // 和首帧同一套（上架审查 i18n-settings#3）：英文系统没手动选过语言的，崩了也看英文
    const cn = resolveLang() === Language.CN;
    const detail = `${error.name}: ${error.message}\n${error.stack ?? ''}`.trim();
    const exportNote =
      exportState === 'idle'
        ? null
        : exportState === 'busy'
          ? cn ? '正在导出…' : 'Exporting…'
          : exportState === 'failed'
            ? cn ? '导出失败' : 'Export failed'
            : saveOutcomeText(exportState, cn, cn ? '已导出' : 'Exported').message;
    const btn = 'w-full min-h-[52px] rounded-control font-semibold transition-opacity duration-tap ease-paper disabled:opacity-40';
    const quiet = `${btn} bg-card border border-divider text-primary`;

    return (
      <div role="alert" data-testid="error-fallback" className="bg-base text-primary px-6 pt-14 pb-10 max-w-2xl mx-auto">
        <h2 className="font-display text-lg font-semibold">{cn ? '这一页出错了' : 'This page hit an error'}</h2>
        {/* 只读 textarea：全局关了选区（index.css），这里要能长按全选复制 */}
        <textarea
          readOnly
          value={detail}
          rows={6}
          className="mt-4 w-full bg-card border border-divider rounded-control p-3 font-mono text-label text-secondary"
        />
        <div className="mt-6 flex flex-col gap-3">
          {onHome && (
            <button
              type="button"
              className={`${btn} bg-accent text-on-accent`}
              onClick={onHome}
            >
              {cn ? '回首页' : 'Go to home'}
            </button>
          )}
          <button
            type="button"
            className={`${btn} ${onHome ? 'bg-card border border-divider text-primary' : 'bg-accent text-on-accent'}`}
            onClick={() => window.location.reload()}
          >
            {cn ? '重新载入' : 'Reload'}
          </button>
          {rollback && (
            <>
              <button
                type="button"
                data-testid={undoState === 'confirm' ? 'error-undo-confirm' : 'error-undo-import'}
                disabled={undoState === 'busy'}
                className={undoState === 'confirm' ? `${btn} bg-danger text-on-semantic` : quiet}
                onClick={() => void this.undo(cn)}
              >
                {undoState === 'confirm' ? (cn ? '撤销' : 'Undo') : translations.undoImport[cn ? 'cn' : 'en']}
              </button>
              <p className="text-small text-secondary whitespace-pre-line">
                {undoState === 'confirm'
                  ? undoImportWarning(rollback.newer, cn)
                  : cn
                    ? `副本 · ${rollback.workouts} 场训练 · ${rollback.createdAt.split('T')[0]}`
                    : `Copy · ${rollback.workouts} workouts · ${rollback.createdAt.split('T')[0]}`}
              </p>
              {undoState === 'failed' && <p className="text-small text-danger">{undoError}</p>}
            </>
          )}
          {/* Tab 一层：恢复弹窗挂在 Tab 边界之外（DataSafetyHost），照常打得开；根一层 Provider 都卸了，不给 */}
          {onHome && folderSupported() && (
            <button type="button" className={quiet} onClick={() => openDataFlow('restore')}>
              {cn ? '从备份恢复' : 'Restore from backup'}
            </button>
          )}
          <button
            type="button"
            disabled={exportState === 'busy'}
            className={quiet}
            onClick={() => void this.exportBackup()}
          >
            {cn ? '导出完整备份' : 'Export full backup'}
          </button>
          {exportNote && <p className={`text-small ${exportState === 'failed' ? 'text-danger' : 'text-secondary'}`}>{exportNote}</p>}
        </div>
      </div>
    );
  }
}
