/**
 * 场地选择器（§12.11）+ 馆档案（docs/design-plates.md §3「馆档案」，示意 docs/demos/gym-workbench.html）
 *
 * 候选来自历史训练（最近用过的排最前），不是 prefs 里的一张表 —— 见 src/utils/gyms.ts。
 * 选中即落定关闭：这是个一击操作，不配确认按钮。
 *
 * 每个馆一行「编辑」：这个馆用公斤片还是磅片、有哪些片、龙门架 / 器械 / 哑铃一档多重。
 * 可以反复进（2026-10-18 用户定）。底部「新的馆…」：起名 + 填档案，存好就用这个馆。
 * 已有的馆可以改名（2026-10-21 用户要的）：馆名记在每一场历史训练和这个馆每台器械的设置上，
 * 改名时一起改（App 的 onSaveProfile + services/appPrefs.ts renameGymIn；历史训练整批写、被杀能续见 services/gymRename.ts），按馆比的纪录照样连得上。
 * 改成已有的另一个馆的名字直接拦下，不做合并；新名字也不能带半角「|」（gymNameIssue）。没有删除（2026-10-21 用户定：正式版不做）。
 *
 * 开练先选馆（startMode，2026-10-21 用户定）：开新的一场先问「这场在哪个馆练」，选了 / 存了才开；
 * 一个馆都没有就直接进「新的馆」表单（新用户不用先去别处设馆）。关掉＝这次不开练。
 * 档案表单里有没存的改动时，点遮罩 / 返回键 / × 不关（提示一句），只有表单自己的「回到馆列表 / 先不练了」才放弃改动。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Check, MapPin, Plus } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal } from '../Modal';
import { gymNameIssue, normalizeGym } from '../../utils/gyms';
import { ADDON_EACH_MAX, ADDON_MAX, DEFAULT_FIXED_BAR_INC, DEFAULT_KETTLEBELL_INC, defaultProfile, distinctRigs, INC_CHOICES, RIG_STEPS, rigInUnit, rigsOf, rigsPatch, sameSpec, withPlateUnit, type GymProfile, type IncSpec, type Rig } from '../../utils/loadable';
import { useExercisePrefs } from '../../contexts/ExercisePrefsContext';
import { useUserSettingsContext } from '../../contexts/UserSettingsContext';
import { rigLabel } from '../PlateGlyph';
import { ScrubNumber, listStepFn } from '../ScrubNumber';

import { isStandardPlate, KG_PER_LB, plateSpec, PLATE_SPECS, type PlateUnit } from '../../utils/plates';
import { GYM_INC_MAX, PLATE_MAX, RIG_NUM_MAX } from '../../utils/load';

type IncKey = 'cable' | 'machine' | 'dumbbell' | 'kettlebell' | 'fixedBar';
const INC_ROWS: IncKey[] = ['cable', 'machine', 'dumbbell', 'kettlebell', 'fixedBar'];
/** 后加的档（旧档案没有这一项）按各自的默认 */
const LATE_INC: Partial<Record<IncKey, Record<PlateUnit, IncSpec>>> = { kettlebell: DEFAULT_KETTLEBELL_INC, fixedBar: DEFAULT_FIXED_BAR_INC };

interface GymPickerModalProps {
  open: boolean;
  lang: Language;
  /** 用过的场地，最近在前 */
  options: string[];
  /** 当前场地；undefined = 未标 */
  current?: string;
  onClose: () => void;
  /** undefined 表示清掉场地 */
  onPick: (gym: string | undefined) => void;
  /** 各馆的档案（AppPrefs.gyms） */
  profiles?: Record<string, GymProfile>;
  /** 新显示单位：新建档案默认用它的片 */
  unit?: string;
  /** 存档案。isNew：新的馆（存好就用它）；renamedFrom：这次把它从这个名字改了过来 */
  onSaveProfile: (name: string, profile: GymProfile, isNew: boolean, renamedFrom?: string) => void;
  /** 开练前选馆：标题改问「这场在哪个馆练」，没有馆就直接开「新的馆」表单，表单关掉就整个关掉 */
  startMode?: boolean;
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
/** 单位和片子不一样的有几档（缺的档跟片子走，不算） */
const mixedCount = (g: GymProfile) => INC_ROWS.filter(k => g[k] && g[k]!.u !== g.plateUnit).length;

export const GymPickerModal: React.FC<GymPickerModalProps> = ({
  open,
  lang,
  options,
  current,
  onClose,
  onPick,
  profiles = {},
  unit = 'kg',
  onSaveProfile,
  startMode = false,
}) => {
  const isCn = lang === Language.CN;
  /** 正在编辑的馆：null＝列表；''＝新的馆 */
  const [editing, setEditing] = useState<string | null>(null);
  /** 表单里有没存的改动（GymProfileForm 报上来）；有的话点遮罩 / 返回键 / × 不关，表单里提示一句 */
  const dirtyRef = useRef(false);
  const [nudge, setNudge] = useState(false);

  /** 开练时一个馆都没有：直接进新建表单，表单就是整个弹层（关表单＝不开练） */
  const noGyms = options.length === 0 && Object.keys(profiles).length === 0;
  const formOnly = startMode && noGyms;

  useEffect(() => {
    if (open) setEditing(formOnly ? '' : null);
  }, [open]);
  useEffect(() => setNudge(false), [editing]);

  const commit = (gym: string | undefined) => {
    onPick(gym);
    onClose();
  };

  const row =
    'w-full min-h-[48px] px-4 flex items-center gap-3 text-left text-small active:bg-card-hover transition-colors duration-tap ease-paper';

  const allGyms = [...options, ...Object.keys(profiles).filter(g => !options.includes(g))];

  /** 表单自己的「回到馆列表 / 先不练了」：明说要走，不拦；开练时一个馆都没有就没有列表可回，整个关掉 */
  const leaveForm = () => (formOnly ? onClose() : setEditing(null));
  if (editing !== null) {
    return (
      <Modal
        isOpen={open}
        // 返回键 / ×：有没存的改动就留在表单上提示一句（表单的草稿在 GymProfileForm 里，一关就没了），没改过同「回到馆列表」
        onClose={() => (dirtyRef.current ? setNudge(true) : leaveForm())}
        title={editing ? (isCn ? `「${editing}」的器材` : `${editing} · gear`) : isCn ? '新的馆' : 'New gym'}
        size="sm"
        variant="sheet"
        layer="modal-2"
        // 不给下拉关：拉走时面板先划出去，有草稿时 onClose 只是提示、并不关，面板就停在屏幕外下不来；点背景也不关
        dismissOnScrim={false}
        testId="gym-profile"
      >
        <GymProfileForm
          isCn={isCn}
          name={editing}
          initial={profiles[editing] ?? defaultProfile(unit === 'lbs' ? 'lbs' : 'kg')}
          taken={allGyms}
          onBack={leaveForm}
          onDirty={d => {
            dirtyRef.current = d;
          }}
          unsavedHint={nudge}
          starting={formOnly}
          onSave={(name, p) => {
            onSaveProfile(name, p, !editing, editing && name !== editing ? editing : undefined);
            onClose();
          }}
        />
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={startMode ? (isCn ? '这场在哪个馆练？' : 'Where are you training?') : (translations.gymPickTitle[lang] as string)}
      size="sm"
      variant="sheet"
      layer="modal-2"
      bodyClassName="px-0"
      testId="gym-picker"
    >
      <div className="-mx-4">
        {allGyms.map((g, i) => (
          <div key={g} className="flex items-center">
            <button
              type="button"
              className={`${row} text-primary flex-1 min-w-0`}
              onClick={() => commit(g)}
              data-testid={`gym-option-${i}`}
            >
              <span className="w-4 flex-shrink-0 text-accent">
                {g === current ? <Check size={14} strokeWidth={2.5} /> : null}
              </span>
              <MapPin size={13} className="flex-shrink-0 text-tertiary" strokeWidth={1.75} />
              <span className="truncate">{g}</span>
              {profiles[g] && (
                <span className="text-micro text-tertiary flex-shrink-0">
                  {profiles[g].plateUnit === 'lbs' ? (isCn ? '磅片' : 'lb') : isCn ? '公斤片' : 'kg'}
                </span>
              )}
              {/* 11-04 前建的馆切了片子单位、各档还停在旧单位（那时不跟着换）：在列表上点出来，进编辑存一遍就能在确认页改齐 */}
              {profiles[g] && mixedCount(profiles[g]) > 0 && (
                <span className="text-micro text-warning flex-shrink-0" data-testid="gym-mixed-units">
                  {isCn ? `${mixedCount(profiles[g])} 档是 ${profiles[g].plateUnit === 'lbs' ? 'kg' : 'lb'}` : `${mixedCount(profiles[g])} in ${profiles[g].plateUnit === 'lbs' ? 'kg' : 'lb'}`}
                </span>
              )}
              {i === 0 && options[0] === g && (
                <span className="ml-auto text-label text-tertiary">
                  {translations.gymLastUsed[lang] as string}
                </span>
              )}
            </button>
            <button
              type="button"
              className="min-h-[48px] px-4 flex-shrink-0 text-label text-secondary underline underline-offset-2"
              onClick={() => setEditing(g)}
              data-testid={`gym-edit-${i}`}
            >
              {isCn ? '编辑' : 'Edit'}
            </button>
          </div>
        ))}

        {/* 清掉场地。历史记录本来就没标，这条让「标错了」有退路。 */}
        {current && (
          <button type="button" className={`${row} text-tertiary`} onClick={() => commit(undefined)}>
            <span className="w-4 flex-shrink-0" />
            <span>{translations.gymClear[lang] as string}</span>
          </button>
        )}

        <button
          type="button"
          className={`${row} text-primary border-t border-divider mt-2 font-semibold`}
          onClick={() => setEditing('')}
          data-testid="gym-new"
        >
          <Plus size={15} strokeWidth={2.5} className="flex-shrink-0" />
          {isCn ? '新的馆…' : 'New gym…'}
        </button>
      </div>
    </Modal>
  );
};

/* ── 一个馆的档案：新建 / 编辑同一张表 ── */

/**
 * 这个馆存下来的刻度（gymRigs）：配重片形式（2026-11-18，loadable.rigListKey，全馆一份）和哑铃 / 壶铃 / 固定杠铃的「台」。
 * 点一行展开就地改（2026-11-24 用户定：药丸上看得到的数这里都能改——最轻一格、每格 / 每档、单位、加片）；
 * 别的动作还在用的形式在动作卡上删不掉（那里只是「这个动作不用了」），要删到这里来。
 * 改和删都立刻生效（不跟着表单的「保存」）：用着它的动作下次取整就按新的；删了的回到馆默认。
 * 「台」带自己的单位、档案那几行管不到它，所以也列在这里（lb 馆里一台 kg 的固定杠铃只能在这儿看见）。
 */
const KIND_NAME: Record<string, { cn: string; en: string }> = {
  '~pair': { cn: '哑铃', en: 'Dumbbells' },
  '~bell': { cn: '壶铃', en: 'Kettlebells' },
  '~fixed': { cn: '固定杠铃', en: 'Fixed barbells' },
};
const SavedRigs: React.FC<{ gym: string; isCn: boolean; plateUnit: PlateUnit }> = ({ gym, isCn, plateUnit }) => {
  const { appPrefs, changeAppPrefs } = useUserSettingsContext();
  const { getTagName } = useExercisePrefs();
  const [open, setOpen] = useState<string | null>(null);
  const pin = { kind: 'pin' as const };
  const stacks = rigsOf(appPrefs.gymRigs, gym, pin, undefined);
  const stackIds = new Set(stacks.map(r => r.id));
  const pre = `${gym}|`;
  // 配重片以外的台：馆|器材（没填器材的是 馆|~画法）。旧的配重片键里的台已经折进 stacks，按 id 滤掉
  const others = Object.entries(appPrefs.gymRigs)
    .filter(([k]) => k.startsWith(pre) && k !== `${gym}|~stack` && !k.slice(pre.length).includes('|'))
    .map(([k, list]) => ({ key: k, eq: k.slice(pre.length), list: list.filter(r => !stackIds.has(r.id)) }))
    .filter(g => g.list.length);
  if (!stacks.length && !others.length) return null;
  const usedBy = (id: string) => Object.entries(appPrefs.gymRigPick).filter(([k, v]) => v === id && k.startsWith(pre)).length;
  const ul = (u: PlateUnit) => (u === 'kg' ? 'kg' : 'lb');
  const presetFn = listStepFn(RIG_STEPS);
  const segBtn = (on: boolean) => `min-h-[34px] px-3 text-label font-semibold ${on ? 'seg-on' : 'text-secondary'}`;
  const unitSeg = (r: Rig, write: (patch: Partial<IncSpec>) => void) => (
    <span className="gym-seg" role="group" data-testid="gym-rig-unit">
      {(['kg', 'lbs'] as const).map(x => (
        <button key={x} type="button" className={segBtn(r.u === x)} aria-pressed={r.u === x} onClick={() => r.u !== x && write(rigInUnit(r, x))}>
          {ul(x)}
        </button>
      ))}
    </span>
  );
  const num = (label: string, value: number | null, onCommit: (n: number | null) => void, u: PlateUnit, testId: string, opts: { allowEmpty?: boolean; placeholder?: string; max?: number } = {}) => (
    <div className="gym-row">
      <span className="text-label text-secondary">{label}</span>
      <div className="gym-inc-stepper">
        <ScrubNumber value={value} onCommit={n => n !== value && onCommit(n)} min={0.1} max={RIG_NUM_MAX} stepFn={presetFn} steps={[1, 2, 3]} testId={testId} ariaLabel={label} {...opts} />
        <small className="text-label text-tertiary">{ul(u)}</small>
      </div>
    </div>
  );
  const head = (r: Rig, label: string, n: number, onRemove: () => void) => (
    <div className="gym-row">
      <button type="button" className="flex-1 min-w-0 text-left text-small text-primary min-h-[44px]" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)} data-testid="gym-rig-edit">
        {label}
        <small className={`block text-micro ${r.u !== plateUnit ? 'text-warning' : 'text-tertiary'}`}>
          {isCn ? (n ? `${n} 个动作在用` : '没有动作在用') : n ? `${n} in use` : 'Unused'}
          {r.u !== plateUnit && (isCn ? ' · 和片子的单位不一样' : ' · differs from the plates')}
        </small>
      </button>
      <button type="button" className="text-label font-semibold text-danger px-2 min-h-[44px]" onClick={onRemove} data-testid="gym-stack-form-remove">
        {isCn ? '删掉' : 'Delete'}
      </button>
    </div>
  );
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return (
    <>
      {stacks.length > 0 && (
        <div className="gym-field" data-testid="gym-stack-forms">
          <span className="text-label text-secondary">{isCn ? '存的配重片形式' : 'Saved stack formats'}</span>
          {distinctRigs(stacks, '').map(r => {
            // 刻度一样、没起名的几份在这里算一种：一起数、一起改、一起删
            const twins = stacks.filter(x => x.id === r.id || (!x.n && !r.n && sameSpec(x, r)));
            const n = twins.reduce((sum, x) => sum + usedBy(x.id), 0);
            const save = (list: Rig[]) => changeAppPrefs({ gymRigs: rigsPatch(appPrefs.gymRigs, gym, pin, list) });
            // 显式给 undefined 的键（清掉最轻一格 / 加片）存之前去掉
            const write = (patch: Partial<IncSpec>) =>
              save(stacks.map(x => (twins.includes(x) ? (Object.fromEntries(Object.entries({ ...x, ...patch }).filter(([, v]) => v !== undefined)) as unknown as Rig) : x)));
            const each = r.a?.[0] ?? 0;
            const count = r.a?.length ?? 0;
            const addons = (w: number, c: number) => write({ a: w > 0 && c > 0 ? Array.from({ length: c }, () => r2(w)) : undefined });
            return (
              <div key={r.id} className="gym-field">
                {head(r, rigLabel(r, 'pin', isCn), n, () => save(stacks.filter(x => !twins.includes(x))))}
                {open === r.id && (
                  <div className="gym-field gym-rig-editor" data-testid="gym-rig-editor">
                    <div className="gym-row">
                      <span className="text-label text-secondary">{isCn ? '单位' : 'Unit'}</span>
                      {unitSeg(r, write)}
                    </div>
                    {num(isCn ? '最轻一格' : 'Lightest', r.s && r.s > 0 ? r.s : r.v, v => v !== null && v > 0 && write({ s: r2(v) }), r.u, 'gym-rig-start')}
                    {num(isCn ? '每格' : 'Step', r.v, v => v !== null && v > 0 && write({ v: r2(v), ...(r.s && r.s > 0 ? {} : { s: r.v }) }), r.u, 'gym-rig-step')}
                    {num(isCn ? '加片每块' : 'Add-on plate', each || null, v => (v === null ? addons(0, 0) : addons(v, Math.max(1, count))), r.u, 'gym-rig-addon', { allowEmpty: true, placeholder: '—', max: ADDON_EACH_MAX[r.u] })}
                    {each > 0 && (
                      <div className="gym-row">
                        <span className="text-label text-secondary">{isCn ? '加片有几块' : 'How many'}</span>
                        <span className="gym-seg" role="group" data-testid="gym-rig-addon-count">
                          {Array.from({ length: ADDON_MAX }, (_, i) => i + 1).map(c => (
                            <button key={c} type="button" className={segBtn(count === c)} aria-pressed={count === c} aria-label={isCn ? `${c} 块` : `${c} plates`} onClick={() => count !== c && addons(each, c)}>
                              {c}
                            </button>
                          ))}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {others.map(g => {
        const write = (id: string, patch: Partial<IncSpec> | null) =>
          changeAppPrefs({
            gymRigs: {
              ...appPrefs.gymRigs,
              [g.key]: appPrefs.gymRigs[g.key].flatMap(x => (x.id !== id ? [x] : patch ? [{ id: x.id, ...(x.n ? { n: x.n } : {}), v: x.v, u: x.u, ...patch } as Rig] : [])),
            },
          });
        // 键是「器材」「~画法」，或固定器械上的「tagMachine~画法」（rigListKey）：后者写成「固定器械 · 哑铃」
        const kindName = (k: string) => (KIND_NAME[k] ? (isCn ? KIND_NAME[k].cn : KIND_NAME[k].en) : '');
        const [eqPart, kindPart] = g.eq.startsWith('~') ? ['', g.eq] : [g.eq.split('~')[0], g.eq.includes('~') ? '~' + g.eq.split('~')[1] : ''];
        const title = [eqPart && (getTagName(eqPart) || eqPart), kindPart && (kindName(kindPart) || kindPart)].filter(Boolean).join(' · ');
        return (
          <div key={g.key} className="gym-field" data-testid="gym-other-rigs">
            <span className="text-label text-secondary">{isCn ? `存的「${title}」` : `Saved: ${title}`}</span>
            {g.list.map(r => (
              <div key={r.id} className="gym-field">
                {head(r, r.n || `${isCn ? '每档' : 'Step'} ${r2(r.v)} ${ul(r.u)}`, usedBy(r.id), () => write(r.id, null))}
                {open === r.id && (
                  <div className="gym-field gym-rig-editor" data-testid="gym-rig-editor">
                    <div className="gym-row">
                      <span className="text-label text-secondary">{isCn ? '单位' : 'Unit'}</span>
                      {unitSeg(r, patch => write(r.id, { v: patch.v, u: patch.u, ...(patch.was ? { was: patch.was } : {}) }))}
                    </div>
                    {num(isCn ? '每档' : 'Step', r.v, v => v !== null && v > 0 && write(r.id, { v: r2(v) }), r.u, 'gym-rig-step')}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
};

function GymProfileForm({
  isCn,
  name,
  initial,
  taken,
  onBack,
  onSave,
  onDirty,
  unsavedHint,
  starting = false,
}: {
  isCn: boolean;
  /** ''＝新的馆（要起名） */
  name: string;
  initial: GymProfile;
  taken: string[];
  onBack: () => void;
  onSave: (name: string, p: GymProfile) => void;
  /** 有没有没存的改动（每次变了报一次，卸载时报 false） */
  onDirty: (dirty: boolean) => void;
  /** 有改动时想关掉表单：提示一句 */
  unsavedHint: boolean;
  /** 开练前一个馆都没有、直接进的这张表：存好就开练，退出就是这次先不练 */
  starting?: boolean;
}) {
  const [p, setP] = useState<GymProfile>(() => JSON.parse(JSON.stringify(initial)));
  const [nm, setNm] = useState(name);
  const [err, setErr] = useState('');
  /** 点了「存好」：先过一遍单位确认页（2026-11-24 用户定），那里确认了才真的存 */
  const [review, setReview] = useState(false);

  const setUnit = (u: PlateUnit) => {
    if (p.plateUnit === u) return;
    // 片子表重置、跟着馆走的各档一起换单位，单独设成别的单位的那档不动（utils/loadable withPlateUnit）
    setP(withPlateUnit(p, u));
    setCu(u);
  };
  const togglePlate = (w: number) => {
    const has = p.plates.includes(w);
    // 至少留一种片：一片都没有就什么都挂不上
    if (has && p.plates.length <= 1) return;
    setP({ ...p, plates: has ? p.plates.filter(x => x !== w) : [...p.plates, w].sort((a, b) => b - a) });
  };
  /**
   * 自定义片（2026-10-20 用户定，方案 A）：一律按馆的单位存，四舍五入到 0.05；
   * 片子自己是另一种单位（kg 馆里的 45 lb 片）就在这里换算好（= 20.4 kg），不做 kg / lb 混挂。
   */
  const [cw, setCw] = useState('');
  const [cu, setCu] = useState<PlateUnit>(initial.plateUnit);
  const dirty = nm !== name || cw.trim() !== '' || JSON.stringify(p) !== JSON.stringify(initial);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty]);
  const cwNum = Number.parseFloat(cw.replace(',', '.'));
  /** 一片最重 PLATE_MAX（馆的单位）；输入框的上限按这片自己的单位换算（kg 馆里填 lb 片最多 220） */
  const customMax = cu === p.plateUnit ? PLATE_MAX : Math.floor(cu === 'lbs' ? PLATE_MAX / KG_PER_LB : PLATE_MAX * KG_PER_LB);
  const customIn = (() => {
    if (!(cwNum > 0)) return null;
    const v = cu === p.plateUnit ? cwNum : cu === 'lbs' ? cwNum * KG_PER_LB : cwNum / KG_PER_LB;
    const r = Math.round(v * 20) / 20;
    return r > 0 && r <= PLATE_MAX ? r : null;
  })();
  const addCustom = () => {
    if (customIn === null) return;
    if (!p.plates.includes(customIn)) setP({ ...p, plates: [...p.plates, customIn].sort((a, b) => b - a) });
    setCw('');
  };
  const customPlates = p.plates.filter(w => !isStandardPlate(p.plateUnit, w));
  // 壶铃 / 固定杠铃一档是后加的，旧档案没有这一项 → 按默认
  const incOf = (key: IncKey): IncSpec => p[key] ?? LATE_INC[key]![p.plateUnit];
  const stepInc = (key: IncKey, d: 1 | -1) => {
    const c = incOf(key);
    // 打过表外的数（3）：按大小走到表里紧挨着的那一格（审查 C：原来从表头算起，3 点 ＋ 跳成 1）
    setP({ ...p, [key]: { ...c, v: listStepFn(INC_CHOICES[c.u])(c.v, d, 1) } });
  };
  // 换这一档的单位＝换成那种单位的默认，最轻一格一起清掉（器械上印的是新单位，旧的那格换算过来不是整数）
  const setIncUnit = (key: IncKey, u: PlateUnit) => {
    const c = incOf(key);
    if (c.u === u) return;
    const def = defaultProfile(u)[key] ?? LATE_INC[key]![u];
    setP({ ...p, [key]: { u, v: def.v } as IncSpec });
  };
  /**
   * 龙门架 / 固定器械的最轻一格（审查 B6：12.5 lb 起、每格 5 的龙门架设在馆默认上，就不用每个动作各存一台）。
   * 空着＝从一档起。取整和换单位都已认 s（profileIn / withPlateUnit）。
   */
  const setStart = (key: 'cable' | 'machine', n: number | null) => {
    const { s: _old, ...c } = incOf(key);
    setP({ ...p, [key]: n !== null && n > 0 && n <= RIG_NUM_MAX ? { ...c, s: Math.round(n * 100) / 100 } : c });
  };

  const save = () => {
    const n = normalizeGym(nm) ?? '';
    // 空名、新建撞上已有的馆 / 改名改成另一个已有的馆（不做合并）、新名字带半角「|」：都拦下（gymNameIssue）
    const issue = gymNameIssue(nm, name, taken);
    if (issue === 'empty') {
      setErr(isCn ? '先给这个馆起个名字' : 'Give this gym a name first');
      return;
    }
    if (issue === 'taken') {
      setErr(
        name
          ? isCn ? `已有「${n}」，换个名字` : `"${n}" already exists — pick another name`
          : isCn ? `已有「${n}」，请回列表编辑它` : `"${n}" already exists — edit it from the list`,
      );
      return;
    }
    if (issue === 'pipe') {
      setErr(isCn ? '馆名里不能有「|」' : "Gym names can't contain |");
      return;
    }
    setReview(true);
  };
  /** 单位和片子不一样的档。可以是有意的（kg 馆里一台 lb 的龙门架），所以只标出来、不拦 */
  const offKeys = INC_ROWS.filter(k => incOf(k).u !== p.plateUnit);
  const unitName = (u: PlateUnit) => (u === 'kg' ? 'kg' : 'lb');

  const seg = (on: boolean) =>
    `min-h-[34px] px-3 text-label font-semibold ${on ? 'seg-on' : 'text-secondary'}`;
  const inc = (key: IncKey, label: string) => (
    <div className="gym-field">
      <div className="gym-row">
      <span className="text-label text-secondary">{label}</span>
      <div className="gym-inc-stepper">
        <button type="button" onClick={() => stepInc(key, -1)} aria-label={isCn ? '轻一点' : 'Smaller'}>−</button>
        <ScrubNumber
          value={incOf(key).v}
          onCommit={n => n !== null && n > 0 && n <= GYM_INC_MAX && setP({ ...p, [key]: { ...incOf(key), v: n } })}
          min={0.25}
          max={GYM_INC_MAX}
          stepFn={listStepFn(INC_CHOICES[incOf(key).u])}
          steps={[1, 2, 4]}
          testId={`gym-inc-${key}`}
          ariaLabel={label}
        />
        <button type="button" onClick={() => stepInc(key, 1)} aria-label={isCn ? '重一点' : 'Bigger'}>＋</button>
        <span className="gym-seg" role="group">
          <button type="button" className={seg(incOf(key).u === 'kg')} aria-pressed={incOf(key).u === 'kg'} onClick={() => setIncUnit(key, 'kg')}>kg</button>
          <button type="button" className={seg(incOf(key).u === 'lbs')} aria-pressed={incOf(key).u === 'lbs'} onClick={() => setIncUnit(key, 'lbs')}>lb</button>
        </span>
      </div>
      </div>
      {(key === 'cable' || key === 'machine') && (
        <div className="gym-row">
          <span className="text-label text-secondary">{isCn ? '最轻一格' : 'Lightest'}</span>
          <div className="gym-inc-stepper">
            <ScrubNumber
              value={incOf(key).s ?? null}
              onCommit={n => setStart(key, n)}
              allowEmpty
              min={0.1}
              max={RIG_NUM_MAX}
              // 空着时从 min 起拖：第一档落在一档本身（不是 0.1 + 一档）
              stepFn={(v, d, m) => (v < incOf(key).v - 1e-9 ? incOf(key).v : Math.max(incOf(key).v, v + d * m * incOf(key).v))}
              steps={[1, 2, 4]}
              placeholder={fmt(incOf(key).v)}
              testId={`gym-start-${key}`}
              ariaLabel={isCn ? `${label}最轻一格` : `${label} lightest`}
            />
            <small className="text-label text-tertiary">{incOf(key).u === 'kg' ? 'kg' : 'lb'}</small>
          </div>
        </div>
      )}
    </div>
  );

  if (review) {
    const rowLabel: Record<IncKey, string> = isCn
      ? { cable: '龙门架', machine: '固定器械', dumbbell: '哑铃', kettlebell: '壶铃', fixedBar: '固定杠铃' }
      : { cable: 'Cable machine', machine: 'Machines', dumbbell: 'Dumbbells', kettlebell: 'Kettlebells', fixedBar: 'Fixed barbells' };
    const unitSeg = (u: PlateUnit, set: (x: PlateUnit) => void, testId: string) => (
      <span className="gym-seg" role="group" data-testid={testId}>
        {(['kg', 'lbs'] as const).map(x => (
          <button key={x} type="button" className={seg(u === x)} aria-pressed={u === x} onClick={() => set(x)} data-testid={`${testId}-${x}`}>
            {unitName(x)}
          </button>
        ))}
      </span>
    );
    return (
      <div className="gym-form" data-testid="gym-profile-review">
        <p className="text-small text-primary font-semibold">{isCn ? `核对「${normalizeGym(nm)}」每类器材的单位` : `Check the unit of each kind of gear at ${normalizeGym(nm)}`}</p>
        <p className="text-micro text-tertiary">
          {isCn ? '动作卡上的数和 ± 一档都按这里的单位。改单位会把那一档换成该单位的常见值。' : 'Card numbers and ± steps follow these units. Changing a unit resets that step to its common value.'}
        </p>
        <div className="gym-row">
          <span className="text-label text-secondary">
            {isCn ? '杠铃片' : 'Plates'}
            <small className="block text-micro text-tertiary">{p.plates.map(fmt).join(' · ')}</small>
          </span>
          {unitSeg(p.plateUnit, setUnit, 'gym-review-plates')}
        </div>
        {INC_ROWS.map(k => {
          const c = incOf(k);
          const off = c.u !== p.plateUnit;
          return (
            <div key={k} className="gym-row" data-testid={`gym-review-${k}`}>
              <span className="text-label text-secondary">
                {rowLabel[k]}
                <small className={`block text-micro ${off ? 'text-warning' : 'text-tertiary'}`}>
                  {isCn ? `一档 ${fmt(c.v)} ${unitName(c.u)}` : `Step ${fmt(c.v)} ${unitName(c.u)}`}
                  {off && (isCn ? ' · 和片子的单位不一样' : ' · differs from the plates')}
                </small>
              </span>
              {unitSeg(c.u, u => setIncUnit(k, u), `gym-review-unit-${k}`)}
            </div>
          );
        })}
        {offKeys.length > 0 && (
          <button
            type="button"
            className="w-full min-h-[44px] text-label font-semibold text-accent"
            onClick={() => setP(offKeys.reduce<GymProfile>((q, k) => ({ ...q, [k]: defaultProfile(p.plateUnit)[k] ?? LATE_INC[k]![p.plateUnit] }), p))}
            data-testid="gym-review-align"
          >
            {isCn ? `这 ${offKeys.length} 档都改成 ${unitName(p.plateUnit)}` : `Switch these ${offKeys.length} to ${unitName(p.plateUnit)}`}
          </button>
        )}
        {name && <SavedRigs gym={name} isCn={isCn} plateUnit={p.plateUnit} />}
        <button type="button" className="ui-btn-primary w-full min-h-[48px] mt-2" onClick={() => onSave(normalizeGym(nm), p)} data-testid="gym-review-confirm">
          {name ? (isCn ? '没问题，存好' : 'Looks right, save') : starting ? (isCn ? '没问题，开练' : 'Looks right, start') : isCn ? '没问题，用这个馆' : 'Looks right, use it'}
        </button>
        <button type="button" className="w-full min-h-[44px] text-label text-secondary" onClick={() => setReview(false)} data-testid="gym-review-back">
          {isCn ? '← 回去接着改' : '← Keep editing'}
        </button>
      </div>
    );
  }

  return (
    <div className="gym-form" data-testid="gym-profile-form">
      {/* 编辑已有的馆也能改名：历史训练和器械设置上的馆名一起改 */}
      <label className="gym-field">
        <span className="text-label text-secondary">{isCn ? '馆名' : 'Name'}</span>
        <input
          className="ui-input"
          value={nm}
          onChange={e => {
            setNm(e.target.value);
            setErr('');
          }}
          placeholder={isCn ? '比如：公司楼下' : 'e.g. Office gym'}
          autoComplete="off"
          data-testid="gym-profile-name"
        />
      </label>
      <div className="gym-row">
        <span className="text-label text-secondary">{isCn ? '片子' : 'Plates'}</span>
        <span className="gym-seg" role="group">
          <button type="button" className={seg(p.plateUnit === 'kg')} aria-pressed={p.plateUnit === 'kg'} onClick={() => setUnit('kg')}>
            {isCn ? '公斤片' : 'kg plates'}
          </button>
          <button type="button" className={seg(p.plateUnit === 'lbs')} aria-pressed={p.plateUnit === 'lbs'} onClick={() => setUnit('lbs')}>
            {isCn ? '磅片' : 'lb plates'}
          </button>
        </span>
      </div>
      <div className="gym-field">
        <span className="text-label text-secondary">{isCn ? '这个馆有哪些片（点掉没有的）' : 'Plates this gym has (tap to remove)'}</span>
        <div className="gym-chips">
          {PLATE_SPECS[p.plateUnit].map(s => (
            <button
              key={s.w}
              type="button"
              aria-pressed={p.plates.includes(s.w)}
              onClick={() => togglePlate(s.w)}
              data-testid={`gym-plate-${s.w}`}
            >
              <i className={`plate-${s.token}`} style={{ height: s.dia >= 400 ? 22 : 14 }} />
              {fmt(s.w)}
            </button>
          ))}
          {customPlates.map(w => {
            const sp = plateSpec(p.plateUnit, w);
            return (
              <button
                key={`c${w}`}
                type="button"
                aria-pressed
                onClick={() => togglePlate(w)}
                aria-label={isCn ? `删掉自定义片 ${fmt(w)}` : `Remove custom plate ${fmt(w)}`}
                data-testid={`gym-plate-custom-${w}`}
              >
                {sp && <i className={`plate-${sp.token}`} style={{ height: sp.dia >= 400 ? 22 : 14 }} />}
                {fmt(w)} ×
              </button>
            );
          })}
        </div>
      </div>
      <div className="gym-field">
        <span className="text-label text-secondary">
          {isCn ? '加一种片（八角片、自带的微调片…）' : 'Add a plate (odd sizes, your own micro plates…)'}
        </span>
        {/* 输入框吃剩下的宽度，单位和「加上」按自己的宽度排（原来 fill 的输入框占满整行，lb 被裁、「加上」竖成两行） */}
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <ScrubNumber
              value={cw.trim() === '' || !Number.isFinite(Number.parseFloat(cw)) ? null : Number.parseFloat(cw)}
              onCommit={n => setCw(n === null ? '' : String(n))}
              allowEmpty
              live
              min={0.05}
              max={customMax}
              steps={cu === 'kg' ? [0.25, 0.5, 1, 2.5] : [0.5, 1, 2.5, 5]}
              placeholder={p.plateUnit === 'kg' ? '0.5' : '51'}
              ariaLabel={isCn ? '这片多重' : 'Plate weight'}
              testId="gym-custom-weight"
              fill
              className="ui-input"
            />
          </div>
          <span className="gym-seg flex-none" role="group" aria-label={isCn ? '这片自己的单位' : 'This plate is in'}>
            <button type="button" className={seg(cu === 'kg')} aria-pressed={cu === 'kg'} onClick={() => setCu('kg')}>kg</button>
            <button type="button" className={seg(cu === 'lbs')} aria-pressed={cu === 'lbs'} onClick={() => setCu('lbs')} data-testid="gym-custom-unit-lbs">lb</button>
          </span>
          <button
            type="button"
            disabled={customIn === null}
            onClick={addCustom}
            className="flex-none min-h-[36px] px-3 whitespace-nowrap text-label font-semibold text-accent disabled:text-tertiary"
            data-testid="gym-custom-add"
          >
            {isCn ? '加上' : 'Add'}
          </button>
        </div>
        {customIn !== null && cu !== p.plateUnit && (
          <p className="text-micro text-tertiary" data-testid="gym-custom-converted">
            {isCn
              ? `按这个馆的单位记：= ${fmt(customIn)} ${p.plateUnit === 'kg' ? 'kg' : 'lb'}`
              : `Saved in this gym's unit: = ${fmt(customIn)} ${p.plateUnit === 'kg' ? 'kg' : 'lb'}`}
          </p>
        )}
      </div>
      {inc('cable', isCn ? '龙门架一档' : 'Cable machine step')}
      {inc('machine', isCn ? '固定器械一档' : 'Machine step')}
      {name && <SavedRigs gym={name} isCn={isCn} plateUnit={p.plateUnit} />}
      {inc('dumbbell', isCn ? '哑铃一档' : 'Dumbbell step')}
      {inc('kettlebell', isCn ? '壶铃一档' : 'Kettlebell step')}
      {inc('fixedBar', isCn ? '固定杠铃一档' : 'Fixed barbell step')}
      {err && <p className="text-label text-warning">{err}</p>}
      {unsavedHint && dirty && !err && (
        <p className="text-label text-warning" data-testid="gym-profile-unsaved">
          {isCn ? '改动还没存' : 'Unsaved changes'}
        </p>
      )}
      <button type="button" className="ui-btn-primary w-full min-h-[48px] mt-2" onClick={save} data-testid="gym-profile-save">
        {name ? (isCn ? '存好' : 'Save') : starting ? (isCn ? '存好，开练' : 'Save and start') : isCn ? '存好，用这个馆' : 'Save and use it'}
      </button>
      <button type="button" className="w-full min-h-[44px] text-label text-secondary" onClick={onBack}>
        {starting ? (isCn ? '先不练了' : 'Not now') : isCn ? '← 回到馆列表' : '← Back to gyms'}
      </button>
    </div>
  );
}
