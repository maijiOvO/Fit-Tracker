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
import { pickFile } from '../../hooks/useImportData';
import {
  CsvImportError,
  materialize,
  parseImportCsv,
  previewMatches,
  type ImportPlan,
  type WeightUnit,
} from '../../../services/fitlogCsvImport';
import { addImportedRecords } from '../../../services/fitlogBackup';
import { markBackupPending } from '../../../services/fitlogAutoBackup';
import { DEFAULT_EXERCISES } from '../../constants/exercises';
import { FITLOG_SOLO_USER_ID } from '../../../services/fitlogSolo';
import { overwriteFailedText, overwriteNote, setFlash } from './flash';
import { blockBack } from '../../hooks/useBackClose';

export const ImportCsvModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { lang, unit } = useUserSettingsContext();
  const { toast } = useUiOverlay();
  const { customExercises, findExerciseDef, exerciseOverrides } = useExercisePrefs();
  const isCn = lang === Language.CN;
  const t = (cn: string, en: string) => (isCn ? cn : en);

  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [units, setUnits] = useState<Record<string, WeightUnit>>({});
  const [warmups, setWarmups] = useState(false);
  const [busy, setBusy] = useState(false);

  // 打开就弹文件选择器；取消 / 认不出 → 关掉并说明
  useEffect(() => {
    if (!open) return;
    setPlan(null);
    setWarmups(false);
    void (async () => {
      const file = await pickFile('text/csv,.csv,text/comma-separated-values,text/plain');
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
            : t('文件里没有能导入的训练', 'No workouts found in that file'),
          'error',
        );
        onClose();
      }
    })();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 名字解析要绕开已并入别的动作的定义；内置在前，和 ExercisePrefsContext 的名字索引一致 */
  const defs = useMemo(
    () => [...DEFAULT_EXERCISES, ...customExercises].filter(d => !exerciseOverrides[d.id]?.mergedInto && !exerciseOverrides[d.id]?.hidden),
    [customExercises, exerciseOverrides],
  );
  const rows = useMemo(() => (plan ? previewMatches(plan, defs, findExerciseDef) : []), [plan, defs, findExerciseDef]);
  const asking = rows.some(r => r.needsUnit);

  const fmtDay = (d: Date) => d.toLocaleDateString(isCn ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const uLabel = (u: WeightUnit) => (u === 'lbs' ? 'lb' : 'kg');

  const run = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const r = materialize(plan, {
        unitByExercise: units,
        includeWarmups: warmups,
        isCn,
        userId: FITLOG_SOLO_USER_ID,
        defs,
        findByName: findExerciseDef,
      });
      blockBack(true);
      const pushed = await addImportedRecords(r).finally(() => blockBack(false));
      markBackupPending();
      setFlash(
        t(`已导入 ${r.workouts.length} 次训练（${r.sets} 组）`, `Imported ${r.workouts.length} workouts (${r.sets} sets)`) + overwriteNote(pushed, isCn),
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
      subtitle={plan ? t(`${plan.workouts.length} 次训练 · ${fmtDay(plan.firstDate)} 至 ${fmtDay(plan.lastDate)}`, `${plan.workouts.length} workouts · ${fmtDay(plan.firstDate)} – ${fmtDay(plan.lastDate)}`) : ''}
      testId="import-csv-modal"
      footer={
        <button type="button" className="ui-btn-primary w-full py-3.5 flex items-center justify-center gap-2" disabled={busy} onClick={() => void run()} data-testid="import-csv-run">
          {busy && <RefreshCw size={16} className="animate-spin" />}
          {plan ? t(`导入 ${plan.workouts.length} 次训练`, `Import ${plan.workouts.length} workouts`) : ''}
        </button>
      }
    >
      {plan && (
        <div className="space-y-4 text-small text-secondary">
          {asking ? (
            <div className="space-y-3">
              <p className="text-primary font-medium" data-testid="import-unit-ask">
                {t('文件没写单位，请确认每个动作是 kg 还是 lb', 'This file has no units — confirm kg or lb for each exercise')}
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
                  <p className="text-primary font-medium truncate">{r.def ? r.def.name[isCn ? 'cn' : 'en'] : r.srcName}</p>
                  {/* 「最重」放最前：判断单位全靠它，名字太长被截掉的应该是来源名 */}
                  <p className="text-xs text-tertiary truncate">
                    {r.maxWeight > 0 && `${t('最重', 'max')} ${r.maxWeight}${r.needsUnit ? '' : ` ${uLabel(plan.fileUnit ?? 'kg')}`} · `}
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
          <p className="text-xs text-tertiary">
            {t(
              '不影响现有记录，导入前自动存可撤销副本。对错的动作可在动作库「并入另一个动作」。',
              'Existing records stay as they are. Mismatched exercises can be merged later in the library. An undoable copy is saved first.',
            )}
          </p>
        </div>
      )}
    </Modal>
  );
};
