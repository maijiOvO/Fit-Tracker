/**
 * 渲染出错时的兜底（审查 F1）：没有它，任何一个组件读到一条缺字段的记录就是整页空白，
 * 唯一的出路是清应用数据，没推上去 / 没备份出去的训练跟着没。
 *
 * 两层：index.tsx 包整个 App（重新载入）；App.tsx 包每个 Tab、以 activeTab 为 key（还能回首页，
 * 训练页崩了从首页结束 / 放弃那一场）。兜底页只给状态和出路，不写说明。
 * 导出直接走 services（buildBackupFile + saveTextFile，和首选项里的导出同一条、真机验过的路），
 * 不依赖 context / toast —— 它们可能正是坏掉的那一层。
 */
import React from 'react';
import { backupFileName, buildBackupFile } from '../../services/fitlogBackup';
import { saveTextFile } from '../../services/fitlogSaveFile';
import { storage } from '../../services/appStorage';
import { Language } from '../../types';

type ExportState = 'idle' | 'busy' | 'done' | 'cancelled' | 'failed';

interface Props {
  children: React.ReactNode;
  /** Tab 那一层传：回首页。根那一层没有首页可回，只给重新载入 */
  onHome?: () => void;
}

interface State {
  error: Error | null;
  exportState: ExportState;
}

export class ErrorBoundary extends React.Component<Props, State> {
  // 仓库没装 @types/react，基类是 any：用到的两个成员在这里声明类型
  declare props: Readonly<Props>;
  declare setState: (s: Partial<State>) => void;
  state: State = { error: null, exportState: 'idle' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private exportBackup = async () => {
    this.setState({ exportState: 'busy' });
    try {
      const file = await buildBackupFile();
      const outcome = await saveTextFile(backupFileName(), JSON.stringify(file, null, 2));
      this.setState({ exportState: outcome.kind === 'cancelled' ? 'cancelled' : 'done' });
    } catch (e) {
      console.error('[ErrorBoundary] 导出失败:', e);
      this.setState({ exportState: 'failed' });
    }
  };

  render() {
    const { error, exportState } = this.state;
    if (!error) return this.props.children;
    const { onHome } = this.props;
    const cn = storage.getItem('fitlog_lang') !== Language.EN;
    const detail = `${error.name}: ${error.message}\n${error.stack ?? ''}`.trim();
    const exportNote = {
      idle: null,
      busy: cn ? '正在导出…' : 'Exporting…',
      done: cn ? '已导出' : 'Exported',
      cancelled: cn ? '已取消' : 'Cancelled',
      failed: cn ? '导出失败' : 'Export failed',
    }[exportState];
    const btn = 'w-full min-h-[52px] rounded-control font-semibold transition-opacity duration-tap ease-paper disabled:opacity-40';

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
          <button
            type="button"
            disabled={exportState === 'busy'}
            className={`${btn} bg-card border border-divider text-primary`}
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
