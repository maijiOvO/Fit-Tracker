/**
 * 从备份文件夹恢复（设计见 docs/design-backup.md §3）。
 *
 * 重装后的典型路径：系统选择器打开在「文档/fitlog」→ 点「使用此文件夹」→ 这里列出能用的备份，
 * 默认取最新一份，先给摘要（几次训练、最后一次哪天、哪天备份的）→ 确认才写。
 *
 * 本地没数据：直接覆盖。本地有数据：新格式给「合并（推荐）/ 覆盖」，旧格式只能覆盖
 * （旧格式没有墓碑，按 id 合并会把删掉的训练捞回来）。两条路都先存回滚槽。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { Language } from '../../../types';
import { Modal } from '../Modal';
import { useUserSettingsContext } from '../../contexts/UserSettingsContext';
import { useUiOverlay } from '../../contexts/UiOverlayContext';
import { useWorkoutContext } from '../../contexts/WorkoutContext';
import {
  applyBackup,
  lastWorkoutDate,
  mergeBackup,
  parseBackupFile,
  type ParsedBackup,
} from '../../../services/fitlogBackup';
import {
  displayPath,
  hasAccess,
  listFiles,
  pickFolder,
  readText,
  type FolderFile,
  type FolderRef,
} from '../../../services/fitlogFolder';
import {
  getBackupFolder,
  markBackupPending,
  parseAutoBackupName,
  setBackupFolder,
} from '../../../services/fitlogAutoBackup';
import { overwriteFailedText, overwriteNote, setFlash } from './flash';

interface Entry {
  file: FolderFile;
  /** 命名里带的时间（自动备份）；手动导出的文件用修改时间 */
  at: number;
  dev: boolean;
  parsed?: ParsedBackup;
  exportedAt?: string;
  bad?: boolean;
}

type Phase =
  | { kind: 'picking' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'none' }
  | { kind: 'error'; message: string }
  | { kind: 'applying' };

function toEntries(files: FolderFile[]): Entry[] {
  return files
    .filter(f => /\.json$/i.test(f.name))
    .map(f => {
      const named = parseAutoBackupName(f);
      return { file: f, at: named ? named.at.getTime() : f.modified, dev: !!named?.dev };
    })
    .sort((a, b) => b.at - a.at);
}

export const RestoreBackupModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { lang } = useUserSettingsContext();
  const { confirm, toast } = useUiOverlay();
  const { workouts } = useWorkoutContext();
  const isCn = lang === Language.CN;
  const t = (cn: string, en: string) => (isCn ? cn : en);

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [folder, setFolder] = useState<FolderRef | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sel, setSel] = useState(0);
  const [showList, setShowList] = useState(false);

  const fmtDay = (iso: string | number) =>
    new Date(iso).toLocaleDateString(isCn ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const fmtTime = (iso: string | number) =>
    new Date(iso).toLocaleString(isCn ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  /** 读一份并解析；坏的标记出来 */
  const load = useCallback(async (e: Entry): Promise<Entry> => {
    if (e.parsed || e.bad) return e;
    try {
      const text = await readText(e.file.uri);
      const parsed = parseBackupFile(text);
      let exportedAt: string | undefined;
      try {
        exportedAt = JSON.parse(text).exportedAt ?? JSON.parse(text).exportDate;
      } catch {
        /* parseBackupFile 已经过了，这里不会到 */
      }
      return { ...e, parsed, exportedAt };
    } catch {
      return { ...e, bad: true };
    }
  }, []);

  /** 列出文件夹里的备份，从最新往旧找第一份能解析的 */
  const scan = useCallback(
    async (f: FolderRef) => {
      setPhase({ kind: 'loading' });
      try {
        const list = toEntries(await listFiles(f));
        if (!list.length) {
          setEntries([]);
          setPhase({ kind: 'none' });
          return;
        }
        for (let i = 0; i < list.length; i++) {
          list[i] = await load(list[i]);
          if (list[i].parsed) {
            setEntries([...list]);
            setSel(i);
            setPhase({ kind: 'ready' });
            return;
          }
        }
        setEntries(list);
        setPhase({ kind: 'none' });
      } catch (e) {
        setPhase({ kind: 'error', message: (e as Error).message });
      }
    },
    [load],
  );

  const choose = useCallback(async () => {
    setPhase({ kind: 'picking' });
    try {
      const f = await pickFolder('Documents/fitlog');
      if (!f) {
        // 取消：没选到就关掉，什么都没动
        onClose();
        return;
      }
      setFolder(f);
      await scan(f);
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message });
    }
  }, [onClose, scan]);

  // 打开时：已经有授权的备份文件夹就直接列，没有就弹选择器
  useEffect(() => {
    if (!open) return;
    setShowList(false);
    void (async () => {
      const f = getBackupFolder();
      if (f && (await hasAccess(f))) {
        setFolder(f);
        await scan(f);
      } else {
        await choose();
      }
    })();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (i: number) => {
    const e = await load(entries[i]);
    const next = [...entries];
    next[i] = e;
    setEntries(next);
    if (e.parsed) {
      setSel(i);
      setShowList(false);
    } else toast(t('这份文件读不出来，换一份', 'Could not read that file'), 'error');
  };

  const cur = entries[sel];
  const parsed = cur?.parsed;
  const localHas = workouts.length > 0;

  const apply = async (mode: 'overwrite' | 'merge') => {
    if (!parsed || !folder) return;
    if (mode === 'overwrite' && localHas) {
      const go = await confirm({
        title: t('用备份覆盖当前数据？', 'Replace current data?'),
        message: t(
          `现有 ${workouts.length} 次训练将被备份整体替换，恢复前自动存可撤销副本。`,
          `Your current ${workouts.length} workouts will be replaced. An undoable copy is saved first.`,
        ),
        confirmLabel: t('覆盖恢复', 'Replace'),
        danger: true,
      });
      if (!go) return;
    }
    setPhase({ kind: 'applying' });
    try {
      const pushed = mode === 'merge' ? await mergeBackup(parsed) : await applyBackup(parsed);
      // 授权刚拿到：这个文件夹顺手设成备份文件夹，重载后补一份备份
      setBackupFolder(folder);
      markBackupPending();
      setFlash(
        t(`已恢复：${parsed.counts.workouts} 次训练`, `Restored: ${parsed.counts.workouts} workouts`) + overwriteNote(pushed, isCn),
        'success',
      );
      window.location.reload();
    } catch (e) {
      console.error('Restore failed:', e);
      toast(overwriteFailedText(e, isCn, { cn: '恢复', en: 'Restore' }), 'error');
      setPhase({ kind: 'ready' });
    }
  };

  const where = folder ? displayPath(folder, isCn) : '';
  const last = parsed ? lastWorkoutDate(parsed) : null;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      variant="center"
      size="sm"
      dismissOnScrim={phase.kind !== 'applying'}
      title={t('从备份恢复', 'Restore from backup')}
      testId="restore-modal"
    >
      <div className="space-y-4 text-sm text-secondary leading-relaxed">
        {(phase.kind === 'loading' || phase.kind === 'picking' || phase.kind === 'applying') && (
          <p className="flex items-center gap-2 py-6 justify-center">
            <RefreshCw size={16} className="animate-spin" />
            {phase.kind === 'picking'
              ? t('在系统窗口里选「文档/fitlog」，点「使用此文件夹」', 'Pick Documents/fitlog in the system window')
              : phase.kind === 'applying'
                ? t('正在恢复…', 'Restoring…')
                : t('正在读取备份…', 'Reading backups…')}
          </p>
        )}

        {phase.kind === 'none' && (
          <>
            <p data-testid="restore-none">
              {t(`「${where}」里没有找到能用的备份。`, `No usable backup found in "${where}".`)}
            </p>
            <button type="button" className="ui-btn-secondary w-full py-3 flex items-center justify-center gap-2" onClick={() => void choose()}>
              <FolderOpen size={18} strokeWidth={1.75} className="text-accent" />
              {t('换个文件夹', 'Choose another folder')}
            </button>
          </>
        )}

        {phase.kind === 'error' && (
          <>
            <p className="text-danger">{t('读不了这个文件夹：', 'Could not read that folder: ') + phase.message}</p>
            <button type="button" className="ui-btn-secondary w-full py-3" onClick={() => void choose()}>
              {t('重新选择文件夹', 'Choose folder again')}
            </button>
          </>
        )}

        {phase.kind === 'ready' && parsed && cur && (
          <>
            <div className="ui-card p-4 space-y-1" data-testid="restore-summary">
              <p className="text-primary font-semibold text-base">
                {t(`找到备份：${parsed.counts.workouts} 次训练`, `Found: ${parsed.counts.workouts} workouts`)}
              </p>
              {last && <p>{t(`最后一次训练 ${fmtDay(last)}`, `Last workout ${fmtDay(last)}`)}</p>}
              <p className="text-tertiary text-xs">
                {t('备份于 ', 'Backed up ') + fmtTime(cur.exportedAt ?? cur.at)} · {where}
              </p>
              {cur.dev && <p className="text-danger text-xs">{t('这是测试数据环境的备份', 'This is a dev-environment backup')}</p>}
              {parsed.legacy && (
                <p className="text-xs">{t('旧版文件不含 PR 和训练计划，这两项保留现有数据。', 'Old-format file: PRs and schedule are kept as they are.')}</p>
              )}
            </div>

            {entries.length > 1 && (
              <button type="button" className="text-accent text-xs underline" onClick={() => setShowList(v => !v)} data-testid="restore-other">
                {showList ? t('收起', 'Hide') : t(`换一份（共 ${entries.length} 份）`, `Pick another (${entries.length})`)}
              </button>
            )}
            {showList && (
              <ul className="max-h-56 overflow-y-auto divide-y divide-divider ui-card">
                {entries.map((e, i) => (
                  <li key={e.file.uri}>
                    <button
                      type="button"
                      onClick={() => void pick(i)}
                      className={`w-full text-left px-3 py-2 flex justify-between gap-2 ${i === sel ? 'text-accent font-semibold' : ''}`}
                    >
                      <span>
                        {fmtTime(e.at)}
                        {e.dev && <span className="text-danger"> · dev</span>}
                      </span>
                      <span className="text-tertiary">
                        {e.bad ? t('读不出', 'unreadable') : e.parsed ? t(`${e.parsed.counts.workouts} 次`, `${e.parsed.counts.workouts}`) : `${Math.round(e.file.size / 1024)} KB`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {!localHas ? (
              <button type="button" className="ui-btn-primary w-full py-3.5" onClick={() => void apply('overwrite')} data-testid="restore-apply">
                {t('恢复', 'Restore')}
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs">
                  {t(`这台手机上已经有 ${workouts.length} 次训练。`, `This phone already has ${workouts.length} workouts.`)}
                </p>
                {!parsed.legacy && (
                  <button type="button" className="ui-btn-primary w-full py-3.5" onClick={() => void apply('merge')} data-testid="restore-merge">
                    {t('合并（推荐）：两边都保留', 'Merge (recommended): keep both')}
                  </button>
                )}
                <button type="button" className="ui-btn-secondary w-full py-3" onClick={() => void apply('overwrite')} data-testid="restore-overwrite">
                  {t('用备份覆盖', 'Replace with backup')}
                </button>
              </div>
            )}
            <button type="button" className="text-tertiary text-xs w-full" onClick={() => void choose()}>
              {t('换个文件夹', 'Choose another folder')}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
};
