/**
 * 从 Strong / Hevy 的 CSV 导入：选文件 → 确认页 → 写入（设计见 docs/design-backup.md §6）。
 *
 * 确认页的重点是单位：Strong 的文件常常不写单位，这里按动作让用户选 kg / lb，
 * 并把「最重 225」摆出来 —— 225 kg 卧推一眼就知道选错了。单位已知（Hevy、带单位列的 Strong）时不问。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Language } from '../../../types';
import { Modal } from '../Modal';
import { useUserSettingsContext } from '../../contexts/UserSettingsContext';
import { useUiOverlay } from '../../contexts/UiOverlayContext';
import { useExercisePrefs } from '../../contexts/ExercisePrefsContext';
import { useWorkoutContext } from '../../contexts/WorkoutContext';
import { recordedNames } from '../../utils/metricDefaults';
import { pickFile } from '../../../services/fitlogPickFile';
import {
  CsvImportError,
  importLookup,
  materialize,
  mergeImportSeeds,
  parseImportCsv,
  planImportWrite,
  previewMatches,
  type ImportPlan,
  type WeightUnit,
} from '../../../services/fitlogCsvImport';
import { addImportedRecords } from '../../../services/fitlogBackup';
import { readTombstones } from '../../../services/fitlogTombstones';
import { markBackupPending } from '../../../services/fitlogAutoBackup';
import { FITLOG_SOLO_USER_ID } from '../../../services/fitlogSolo';
import { overwriteFailedText, overwriteNote, setFlash } from './flash';
import { blockBack } from '../../hooks/useBackClose';

export const ImportCsvModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { lang, unit } = useUserSettingsContext();
  const { toast } = useUiOverlay();
  const { customExercises, exerciseOverrides, withVariantNames, liftKey, resolveName, exerciseMetricConfigs, getActiveMetrics } = useExercisePrefs();
  const { workouts, currentWorkout } = useWorkoutContext();
  const isCn = lang === Language.CN;
  const t = (cn: string, en: string) => (isCn ? cn : en);

  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [units, setUnits] = useState<Record<string, WeightUnit>>({});
  const [warmups, setWarmups] = useState(false);
  const [keepOverCap, setKeepOverCap] = useState(false);
  /** 以前导入过的场：默认保留 fitlog 里的（App 里改过的不被盖掉），可选用文件覆盖（审查 csv#3） */
  const [mode, setMode] = useState<'skip' | 'replace'>('skip');
  const [busy, setBusy] = useState(false);

  // 打开就弹文件选择器；取消 / 认不出 → 关掉并说明。
  // live：同一个流程再点一次会换一个 key 重新挂载，新的那次 pickFile 把这次按取消收掉 —— 这时不能再 onClose 把新的关了
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPlan(null);
    setWarmups(false);
    setKeepOverCap(false);
    setMode('skip');
    void (async () => {
      const file = await pickFile('text/csv,.csv,text/comma-separated-values,text/plain');
      if (!live) return;
      if (!file) {
        onClose();
        return;
      }
      try {
        const p = parseImportCsv(await file.text());
        const def: WeightUnit = unit === 'lbs' ? 'lbs' : 'kg';
        setUnits(Object.fromEntries(p.exercises.filter(e => e.needsUnit).map(e => [e.srcName, def])));
        setPlan(p);
      } catch (e) {
        const code = e instanceof CsvImportError ? e.code : 'unknown';
        toast(
          code === 'unknown-format'
            ? t('认不出这个文件：只支持 Strong / Hevy 用英文界面导出的 CSV', 'Unrecognised file: only English-language Strong / Hevy CSV exports are supported')
            : code === 'bad-dates'
              ? t('日期格式认不出：文件里的日期一行都没读懂', "Couldn't read the dates in that file")
              : t('文件里没有能导入的训练', 'No workouts found in that file'),
          'error',
        );
        onClose();
      }
    })();
    return () => {
      live = false;
    };
  }, [open]);

  /** 做法按当前生效的做法表认（用户删过 / 自建过同器材的做法）；内置做法补上当前语言的器材名，记录上的 variantName 才和 App 里记的一样 */
  // 已并入的动作也在表里、名字查找认得并入别名（services/fitlogCsvImport.importLookup）：并入后再导同一份文件，记录名不被改写
  const lookup = useMemo(() => importLookup(customExercises, exerciseOverrides), [customExercises, exerciseOverrides]);
  const defs = useMemo(
    () => lookup.defs.map(d => (d.variants ? { ...d, variants: withVariantNames(d.variants) } : d)),
    [lookup, withVariantNames],
  );
  const rows = useMemo(() => (plan ? previewMatches(plan, defs, lookup.findByName, warmups) : []), [plan, defs, lookup, warmups]);
  const asking = rows.some(r => r.needsUnit);
  // 确认页的场数、日期范围和真正写入的是同一份结果（审查 C69：原来取解析的原始汇总，含热身组）
  const res = useMemo(
    () =>
      plan
        ? materialize(plan, {
            unitByExercise: units,
            includeWarmups: warmups,
            overCap: keepOverCap ? 'keep' : 'skip',
            isCn,
            userId: FITLOG_SOLO_USER_ID,
            defs,
            findByName: lookup.findByName,
          })
        : null,
    [plan, units, warmups, keepOverCap, isCn, defs, lookup],
  );
  const tombstonedIds = useMemo(() => (plan ? (readTombstones().workouts ?? []) : []), [plan]);
  const local = { workouts, tombstonedIds };
  const overlap = res ? planImportWrite(res.workouts, local, res.source, 'skip').overlap : 0;
  const write = res ? planImportWrite(res.workouts, local, res.source, mode).write : [];
  const first = res?.workouts[0];
  const last = res?.workouts[res.workouts.length - 1];

  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(isCn ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const uLabel = (u: WeightUnit) => (u === 'lbs' ? 'lb' : 'kg');
  // 读不懂的行、数和列照实报出来（审查 csv#6 / csv#7 / csv#8）：解析从严以后，被跳过的东西不能悄悄没了
  const report: string[] = [];
  if (plan) {
    const { date, malformed, numbers } = plan.skipped;
    if (date + malformed) {
      const why = [date ? t(`日期认不出 ${date} 行`, `${date} with unreadable dates`) : '', malformed ? t(`格式不对 ${malformed} 行`, `${malformed} malformed`) : ''];
      report.push(t(`跳过 ${date + malformed} 行（${why.filter(Boolean).join('、')}）`, `Skipped ${date + malformed} rows (${why.filter(Boolean).join(', ')})`));
    }
    if (numbers) report.push(t(`${numbers} 个数没读懂，按空导`, `${numbers} numbers couldn't be read and were left empty`));
    if (plan.ambiguousNumbers)
      report.push(t(`${plan.ambiguousNumbers} 个数分不清小数点和千分位，按分隔符猜着读`, `${plan.ambiguousNumbers} numbers were ambiguous (decimal or thousands) and read by the file's delimiter`));
    if (plan.ignoredColumns.length) report.push(t(`没读的列：${plan.ignoredColumns.join('、')}`, `Columns not imported: ${plan.ignoredColumns.join(', ')}`));
    if (plan.dateOrderGuessed)
      report.push(
        plan.dateOrderGuessed === 'dmy' ? t('日期按 日/月 读', 'Dates read as day/month') : t('日期按 月/日 读', 'Dates read as month/day'),
      );
  }
  const setsIn = (ws: typeof write) => ws.reduce((n, w) => n + w.exercises.reduce((m, e) => m + e.sets.reduce((k, s) => k + 1 + (s.subSets?.length ?? 0), 0), 0), 0);

  const run = async () => {
    if (!plan || !res) return;
    // 一场都写不进去：不进 addImportedRecords —— 既不占掉回滚槽里上一份副本，也不清撤销历史（审查 C69）
    if (!write.length) {
      toast(
        res.workouts.length
          ? t(`这 ${overlap} 场都导入过了`, `All ${overlap} workouts were imported before`)
          : !warmups && plan.warmupSets
            ? t('文件里只有热身组：勾选「热身组也导入」再导', 'Only warm-up sets in this file: tick "Also import warm-up sets" first')
            : t('文件里的组都超出重量上限：勾选「也导入超上限的组」再导', 'Every set is over the weight cap: tick "Also import sets over the cap" first'),
        'info',
      );
      return;
    }
    setBusy(true);
    try {
      // 已配置的不动，本机有记录的保留当前那组：导入不藏掉 App 里已经记的列（审查 csv#2）
      const metricSeeds = mergeImportSeeds(res.metricSeeds, {
        resolveName,
        configs: exerciseMetricConfigs,
        recorded: recordedNames([...workouts, currentWorkout], resolveName),
        activeOf: getActiveMetrics,
      });
      blockBack(true);
      const pushed = await addImportedRecords({ ...res, metricSeeds }, mode).finally(() => blockBack(false));
      markBackupPending();
      setFlash(
        t(`已导入 ${write.length} 场训练（${setsIn(write)} 组）`, `Imported ${write.length} workouts (${setsIn(write)} sets)`) + overwriteNote(pushed, isCn),
        'success',
      );
      window.location.reload();
    } catch (e) {
      console.error('CSV import failed:', e);
      toast(overwriteFailedText(e, isCn, { cn: '导入', en: 'Import' }), 'error');
      setBusy(false);
    }
  };

  const UnitToggle: React.FC<{ value: WeightUnit; onPick: (u: WeightUnit) => void; testId?: string }> = ({ value, onPick, testId }) => (
    <span className="inline-flex rounded-control border border-divider overflow-hidden flex-shrink-0" data-testid={testId}>
      {(['kg', 'lbs'] as WeightUnit[]).map(u => (
        <button
          key={u}
          type="button"
          onClick={() => onPick(u)}
          className={`px-3 py-1.5 text-xs font-semibold ${value === u ? 'bg-accent text-on-accent' : 'text-secondary'}`}
        >
          {uLabel(u)}
        </button>
      ))}
    </span>
  );

  return (
    <Modal
      isOpen={open && !!plan}
      onClose={onClose}
      variant="sheet"
      size="md"
      dismissOnScrim={false}
      title={plan ? t(`从 ${plan.source === 'strong' ? 'Strong' : 'Hevy'} 导入`, `Import from ${plan.source === 'strong' ? 'Strong' : 'Hevy'}`) : ''}
      subtitle={
        res && first && last
          ? t(`${res.workouts.length} 场训练 · ${fmtDay(first.date)} 至 ${fmtDay(last.date)}`, `${res.workouts.length} workouts · ${fmtDay(first.date)} – ${fmtDay(last.date)}`)
          : t('0 场训练', '0 workouts')
      }
      testId="import-csv-modal"
      footer={
        <button type="button" className="ui-btn-primary w-full py-3.5 flex items-center justify-center gap-2" disabled={busy} onClick={() => void run()} data-testid="import-csv-run">
          {busy && <RefreshCw size={16} className="animate-spin" />}
          {t(`导入 ${write.length} 场训练`, `Import ${write.length} workouts`)}
        </button>
      }
    >
      {plan && (
        <div className="space-y-4 text-small text-secondary">
          {asking ? (
            <div className="space-y-3">
              <p className="text-primary font-medium" data-testid="import-unit-ask">
                {t('文件没写单位：确认每个动作是 kg 还是 lb', 'No units in this file: confirm kg or lb for each exercise')}
              </p>
              <div className="flex items-center justify-between">
                <span>{t('全部设为', 'Set all to')}</span>
                <UnitToggle
                  value={Object.values(units).every(u => u === 'lbs') ? 'lbs' : 'kg'}
                  onPick={u => setUnits(Object.fromEntries(Object.keys(units).map(k => [k, u])))}
                  testId="import-unit-all"
                />
              </div>
            </div>
          ) : (
            <p data-testid="import-unit-known">
              {plan.fileUnit
                ? t(`单位：${uLabel(plan.fileUnit)}（来自文件）`, `Unit: ${uLabel(plan.fileUnit)} (from the file)`)
                : t('单位：每组自带（来自文件）', 'Units: per set (from the file)')}
            </p>
          )}

          <ul className="ui-card divide-y divide-divider">
            {rows.map(r => (
              <li key={r.srcName} className="px-3 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-primary font-medium truncate">{r.def ? liftKey({ name: r.def.name.en, variantId: r.variant?.id }) : r.srcName}</p>
                  {/* 「最重」放最前：判断单位全靠它，名字太长被截掉的应该是来源名 */}
                  <p className="text-xs text-tertiary truncate">
                    {r.maxWeight > 0 && `${t('最重', 'max')} ${r.maxWeight}${r.maxUnit ? ` ${uLabel(r.maxUnit)}` : ''} · `}
                    {t(`${r.sets} 组`, `${r.sets} sets`)}
                    {' · '}
                    {r.def ? `← ${r.srcName}` : t('新建自定义动作', 'New custom exercise')}
                  </p>
                </div>
                {r.needsUnit && (
                  <UnitToggle value={units[r.srcName] ?? 'kg'} onPick={u => setUnits(p => ({ ...p, [r.srcName]: u }))} />
                )}
              </li>
            ))}
          </ul>

          {plan.warmupSets > 0 && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={warmups} onChange={e => setWarmups(e.target.checked)} />
              {t(`热身组也导入（${plan.warmupSets} 组，当正式组记）`, `Also import warm-up sets (${plan.warmupSets}, as working sets)`)}
            </label>
          )}
          {/* 超上限默认不导：和手记上限同一个理由，多一个 0 就是一条假纪录（审查 csv#7） */}
          {!!res?.overCapSets && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={keepOverCap} onChange={e => setKeepOverCap(e.target.checked)} />
              {t(`也导入超出重量上限的 ${res.overCapSets} 组`, `Also import ${res.overCapSets} sets over the weight cap`)}
            </label>
          )}
          {overlap > 0 && (
            <div className="space-y-2" data-testid="import-overlap">
              <p className="text-primary font-medium">{t(`其中 ${overlap} 场以前导入过`, `${overlap} of these were imported before`)}</p>
              <label className="flex items-center gap-2">
                <input type="radio" name="import-overlap" checked={mode === 'skip'} onChange={() => setMode('skip')} />
                {t('保留 fitlog 里的', 'Keep the ones in fitlog')}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="import-overlap" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                {t(`用文件覆盖这 ${overlap} 场`, `Replace these ${overlap} with the file`)}
              </label>
            </div>
          )}
          {report.length > 0 && (
            <ul className="text-xs text-tertiary space-y-1" data-testid="import-report">
              {report.map(line => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-tertiary">
            {overlap > 0 && mode === 'replace'
              ? t(
                  `这 ${overlap} 场会换成文件里的内容，在 fitlog 里改过的也一样；其余记录不动，导入前自动存可撤销副本。`,
                  `These ${overlap} workouts will be replaced with the file's version, including any edits made in fitlog; other records stay as they are and an undoable copy is saved first.`,
                )
              : t(
                  '不影响现有记录，导入前自动存可撤销副本。对错的动作之后可在动作库并入。',
                  'Existing records stay as they are; an undoable copy is saved first. Mismatched exercises can be merged in the library later.',
                )}
          </p>
        </div>
      )}
    </Modal>
  );
};
