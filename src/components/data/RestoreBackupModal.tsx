/**
 * 从备份恢复（设计见 docs/design-backup.md §3）。自动备份页和导入页的「从备份恢复」都打开这里。
 *
 * 重装后的典型路径：系统选择器打开在「文档/fitlog」→ 点「使用此文件夹」→ 这里列出能用的备份，
 * 先给摘要（几次训练、最后一次哪天、哪天备份的）→ 确认才写。
 * 打开时读最新 40 份，内存里只留摘要（大文件全留着太占），恢复时按 uri 重新读选中的那份。
 * 默认项见 pickDefaultBackup：优先带着本机没有的记录的，跳过空的、时间在未来的、读不出的（上架审查 C53 / C66 / C67）。
 * 恢复后只在还没有能用的备份文件夹时，才把这个文件夹设成备份目的地（adoptRestoreFolder，C56）。
 *
 * 本地没数据：直接覆盖。本地有数据：新格式给「合并 / 覆盖」，旧格式只能覆盖
 * （旧格式没有墓碑，按 id 合并会把删掉的训练捞回来）。两条路都先存回滚槽。
 * 「本地有没有数据」打开时读库按各表数（localDataSummary，上架审查 C68）：只看训练条数时，
 * 只记过体重 / 只建过馆的手机会被直接覆盖，不给合并也不确认。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { Language } from '../../../types';
import { Modal } from '../Modal';
import { useUserSettingsContext } from '../../contexts/UserSettingsContext';
import { useUiOverlay } from '../../contexts/UiOverlayContext';
import { useWorkoutContext } from '../../contexts/WorkoutContext';
import {
  applyBackup,
  lastWorkoutDate,
  localDataSummary,
  mergeBackup,
  parseBackupFile,
} from '../../../services/fitlogBackup';
import { collectLocalSnapshot } from '../../../services/fitlogRemote';
import type { FitlogRemoteSnapshot } from '../../../services/fitlogSnapshotTypes';
import {
  displayPath,
  hasAccess,
  listFiles,
  pickFolder,
  readText,
  type FolderRef,
} from '../../../services/fitlogFolder';
import {
  adoptRestoreFolder,
  backupInFuture,
  getBackupFolder,
  listBackups,
  markBackupPending,
  orderBackups,
  pickDefaultBackup,
  uncoveredRecords,
  type ListedBackup,
} from '../../../services/fitlogAutoBackup';
import { overwriteFailedText, overwriteNote, setFlash, workbenchDropNote } from './flash';
import { blockBack } from '../../hooks/useBackClose';

/** 一份备份的摘要（读过才有后几项）；完整内容不留在内存里 */
interface Entry extends ListedBackup {
  workouts?: number;
  lastDate?: string | null;
  legacy?: boolean;
  skipped?: number;
}

/** 打开时读最新几份：读得越多默认项挑得越准，也越慢 */
const SCAN_LIMIT = 40;

type Phase =
  | { kind: 'picking' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'none' }
  | { kind: 'error'; message: string }
  | { kind: 'applying' };

type LocalSummary = ReturnType<typeof localDataSummary>;

/** 本机各类数据非零的条数：「12 场训练、3 条体重」 */
function summaryText(s: LocalSummary, isCn: boolean): string {
  const parts: [number, string, string][] = [
    [s.workouts, '场训练', 'workouts'],
    [s.weightLogs, '条体重', 'weight entries'],
    [s.customMetrics, '条身体指标', 'body measurements'],
    [s.goals, '个目标', 'goals'],
    [s.scheduledWorkouts, '个计划', 'plans'],
    [s.customExercises, '个自建动作', 'custom exercises'],
    [s.gyms, '个馆档案', 'gym profiles'],
  ];
  return parts
    .filter(([n]) => n > 0)
    .map(([n, cn, en]) => (isCn ? `${n} ${cn}` : `${n} ${en}`))
    .join(isCn ? '、' : ', ');
}

/** 读一份、只留摘要；读不出的标 bad */
async function summarize(e: Entry, local: FitlogRemoteSnapshot): Promise<Entry> {
  try {
    const parsed = parseBackupFile(await readText(e.file.uri));
    const ms = parsed.exportedAt ? Date.parse(parsed.exportedAt) : NaN;
    return {
      ...e,
      exportedAt: Number.isFinite(ms) ? ms : undefined,
      records: Object.values(localDataSummary(parsed.snapshot)).reduce((a, b) => a + b, 0),
      foreign: uncoveredRecords(parsed.snapshot, local).length,
      workouts: parsed.counts.workouts,
      lastDate: lastWorkoutDate(parsed),
      legacy: parsed.legacy,
      skipped: parsed.skipped,
    };
  } catch {
    return { ...e, bad: true };
  }
}

export const RestoreBackupModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { lang } = useUserSettingsContext();
  const { confirm, toast } = useUiOverlay();
  const { currentWorkout, discardWorkbenchWith } = useWorkoutContext();
  const isCn = lang === Language.CN;
  const t = (cn: string, en: string) => (isCn ? cn : en);

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [folder, setFolder] = useState<FolderRef | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sel, setSel] = useState(0);
  const [showList, setShowList] = useState(false);
  /** 本机现有数据（打开时读库数）；读完之前不出按钮 */
  const [local, setLocal] = useState<LocalSummary | null>(null);
  /** 本机快照：算每份备份带着几条本机没有的记录 */
  const localSnap = useRef<Promise<FitlogRemoteSnapshot> | null>(null);

  const fmtDay = (iso: string | number) =>
    new Date(iso).toLocaleDateString(isCn ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const fmtTime = (iso: string | number) =>
    new Date(iso).toLocaleString(isCn ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  /** 列出文件夹里的备份，读最新 SCAN_LIMIT 份的摘要，挑默认项 */
  const scan = useCallback(async (f: FolderRef) => {
    setPhase({ kind: 'loading' });
    try {
      const listed: Entry[] = listBackups(await listFiles(f));
      const snap = await localSnap.current!;
      const head: Entry[] = [];
      for (const e of listed.slice(0, SCAN_LIMIT)) head.push(await summarize(e, snap));
      const all = [...orderBackups(head), ...listed.slice(SCAN_LIMIT)];
      setEntries(all);
      const def = pickDefaultBackup(head);
      if (!def) {
        setPhase({ kind: 'none' });
        return;
      }
      setSel(all.indexOf(def));
      setPhase({ kind: 'ready' });
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message });
    }
  }, []);

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
    setLocal(null);
    const p = collectLocalSnapshot();
    localSnap.current = p;
    p.then(
      s => setLocal(localDataSummary(s)),
      e => setPhase({ kind: 'error', message: (e as Error).message }),
    );
    void (async () => {
      const f = getBackupFolder();
      if (f && (await hasAccess(f))) {
        setFolder(f);
        await scan(f);
      } else {
        await choose();
      }
    })();
  }, [open]);

  const pick = async (i: number) => {
    let e = entries[i];
    // 超出打开时读的那几份：点到才读
    if (e.workouts === undefined && !e.bad && localSnap.current) {
      e = await summarize(e, await localSnap.current);
      setEntries(prev => prev.map((x, j) => (j === i ? e : x)));
    }
    if (e.workouts !== undefined) {
      setSel(i);
      setShowList(false);
    } else toast(t('这份文件读不出来，换一份', 'Could not read that file — pick another'), 'error');
  };

  const cur: Entry | undefined = entries[sel];
  const loaded = cur?.workouts !== undefined;
  const localHas = !!local && Object.values<number>(local).some(n => n > 0);

  const apply = async (mode: 'overwrite' | 'merge') => {
    if (!cur || !loaded || !folder || !local) return;
    // 摘要之后文件可能被改过 / 删了：恢复的是现在读到的这份
    let parsed;
    try {
      parsed = parseBackupFile(await readText(cur.file.uri));
    } catch {
      toast(t('这份文件读不出来，换一份', 'Could not read that file — pick another'), 'error');
      return;
    }
    if (mode === 'overwrite' && localHas) {
      const go = await confirm({
        title: t('用备份覆盖当前数据？', 'Replace current data with the backup?'),
        message: t(
          `现有的 ${summaryText(local, true)} 会被备份整份替换（先自动存可撤销副本）。`,
          `Your current ${summaryText(local, false)} will be replaced by the backup (an undoable copy is saved first).`,
        ) + (currentWorkout.exercises.length > 0 ? '\n\n' + workbenchDropNote(isCn) : ''),
        confirmLabel: t('覆盖', 'Replace'),
        danger: true,
      });
      if (!go) return;
    }
    setPhase({ kind: 'applying' });
    // 写数据的这段时间返回键不理（审查 B11）：写到一半把页面关了只会更糟
    blockBack(true);
    try {
      // 覆盖时工作台上那场跟着丢；合并不动它（它在库里，合并照样留着）
      let message: string;
      if (mode === 'merge') {
        // 如实报新增几场、几场因为本机删过没带回（原来报备份里的总场数，没带回来的也算进去，C10）
        const { pushed, added, blocked } = await mergeBackup(parsed);
        message =
          t(`已合并：新增 ${added} 场训练`, `Merged: ${added} new workout${added === 1 ? '' : 's'}`) +
          (blocked > 0
            ? t(`；${blocked} 场在这台手机上删过，没有带回`, `; ${blocked} deleted on this phone were not brought back`)
            : '') +
          overwriteNote(pushed, isCn);
      } else {
        const pushed = await discardWorkbenchWith(() => applyBackup(parsed));
        message = t(`已恢复：${parsed.counts.workouts} 场训练`, `Restored: ${parsed.counts.workouts} workouts`) + overwriteNote(pushed, isCn);
      }
      // 还没有能用的备份文件夹才顺手设成这个（授权刚拿到）；已有的不改。重载后补一份备份
      const prior = getBackupFolder();
      if ((await adoptRestoreFolder(folder)) && prior && prior.dirUri !== folder.dirUri) {
        message += t(`；以后备份到「${where}」`, `; backups now go to "${where}"`);
      }
      markBackupPending();
      setFlash(message, 'success');
      window.location.reload();
    } catch (e) {
      console.error('Restore failed:', e);
      toast(overwriteFailedText(e, isCn, { cn: '恢复', en: 'Restore' }), 'error');
      setPhase({ kind: 'ready' });
    } finally {
      blockBack(false);
    }
  };

  const where = folder ? displayPath(folder, isCn) : '';
  const now = Date.now();

  /** 列表里每份的标注：读不出 / 空 / 时间在未来 / dev */
  const tags = (e: Entry): string[] =>
    [
      e.bad && t('读不出', 'unreadable'),
      e.records === 0 && t('空', 'empty'),
      !e.bad && backupInFuture(e, now) && t('时间在未来', 'future date'),
      e.dev && 'dev',
    ].filter((x): x is string => !!x);

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
      <div className="space-y-4 text-small text-secondary leading-relaxed">
        {(phase.kind === 'loading' || phase.kind === 'picking' || phase.kind === 'applying') && (
          <p className="flex items-center gap-2 py-6 justify-center">
            <RefreshCw size={16} className="animate-spin" />
            {phase.kind === 'picking'
              ? t('在系统窗口里选「文档/fitlog」，点「使用此文件夹」', 'Pick Documents/fitlog in the system window, then tap "Use this folder"')
              : phase.kind === 'applying'
                ? t('正在恢复…', 'Restoring…')
                : t('正在读取备份…', 'Reading backups…')}
          </p>
        )}

        {phase.kind === 'none' && (
          <>
            <p data-testid="restore-none">
              {t(`「${where}」里没有能用的备份`, `No usable backup in "${where}"`)}
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

        {phase.kind === 'ready' && cur && loaded && local && (
          <>
            <div className="ui-card p-4 space-y-1" data-testid="restore-summary" data-workouts={cur.workouts}>
              <p className="text-primary font-semibold text-base">
                {t(`找到备份：${cur.workouts} 场训练`, `Found: ${cur.workouts} workouts`)}
              </p>
              {cur.lastDate && <p>{t(`最后一场 ${fmtDay(cur.lastDate)}`, `Last workout ${fmtDay(cur.lastDate)}`)}</p>}
              <p className="text-tertiary text-xs">
                {t('备份于 ', 'Backed up ') + fmtTime(cur.exportedAt ?? cur.at)} · {where}
              </p>
              {cur.dev && <p className="text-danger text-xs">{t('这是开发环境的备份', 'This is a dev-environment backup')}</p>}
              {backupInFuture(cur, now) && (
                <p className="text-danger text-xs">{t('备份时间比现在还晚，手机时钟可能调过', 'Backup time is in the future — the phone clock may have been changed')}</p>
              )}
              {!!cur.skipped && (
                <p className="text-xs" data-testid="restore-skipped">
                  {t(`另有 ${cur.skipped} 条记录形态不对，不会恢复`, `${cur.skipped} malformed record${cur.skipped > 1 ? 's' : ''} will be skipped`)}
                </p>
              )}
              {cur.legacy && (
                <p className="text-xs">{t('旧版文件不含训练计划，保留现有计划。', 'Old-format file has no schedule; yours is kept.')}</p>
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
                        {fmtTime(e.exportedAt ?? e.at)}
                        {tags(e).length > 0 && <span className="text-danger"> · {tags(e).join(' · ')}</span>}
                      </span>
                      <span className="text-tertiary whitespace-nowrap">
                        {e.workouts !== undefined ? t(`${e.workouts} 场`, `${e.workouts} workouts`) : e.bad ? '' : `${Math.round(e.file.size / 1024)} KB`}
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
                  {t(`这台手机上已经有 ${summaryText(local, true)}。`, `This phone already has ${summaryText(local, false)}.`)}
                </p>
                {!cur.legacy && (
                  <button type="button" className="ui-btn-primary w-full py-3.5" onClick={() => void apply('merge')} data-testid="restore-merge">
                    {/* 训练按条合并、首选项按 id / 键取并集（mergeBackup 的 unionPrefs），同一条两边都改过时较新的为准；不标「推荐」（审查 E8） */}
                    {t('合并：训练和设置两边都留', 'Merge: keep workouts and settings from both')}
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
