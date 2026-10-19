/**
 * 场地选择器（§12.11）+ 馆档案（docs/design-plates.md §3「馆档案」，示意 docs/demos/gym-workbench.html）
 *
 * 候选来自历史训练（最近用过的排最前），不是 prefs 里的一张表 —— 见 src/utils/gyms.ts。
 * 选中即落定关闭：这是个一击操作，不配确认按钮。
 *
 * 每个馆一行「编辑」：这个馆用公斤片还是磅片、有哪些片、龙门架 / 器械 / 哑铃一档多重。
 * 可以反复进（2026-10-18 用户定）。底部「新的馆…」：起名 + 填档案，存好就用这个馆。
 * 已有的馆不改名：馆名记在每一场历史训练上，改名会和历史对不上。
 */
import React, { useEffect, useState } from 'react';
import { Check, MapPin, Plus } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal } from '../Modal';
import { normalizeGym } from '../../utils/gyms';
import { defaultProfile, INC_CHOICES, type GymProfile, type IncSpec } from '../../utils/loadable';
import { PLATE_SPECS, type PlateUnit } from '../../utils/plates';

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
  /** 存档案。isNew：新的馆（存好就用它） */
  onSaveProfile?: (name: string, profile: GymProfile, isNew: boolean) => void;
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

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
}) => {
  const isCn = lang === Language.CN;
  const [draft, setDraft] = useState('');
  /** 正在编辑的馆：null＝列表；''＝新的馆 */
  const [editing, setEditing] = useState<string | null>(null);

  // 每次打开都从空输入开始，免得上次没提交的半截名字残留
  useEffect(() => {
    if (open) {
      setDraft('');
      setEditing(null);
    }
  }, [open]);

  const commit = (gym: string | undefined) => {
    onPick(gym);
    onClose();
  };

  const draftGym = normalizeGym(draft);
  const isNew = !!draftGym && !options.some(o => o === draftGym);

  const row =
    'w-full min-h-[48px] px-4 flex items-center gap-3 text-left text-sm active:bg-card-hover transition-colors duration-tap ease-paper';

  const allGyms = [...options, ...Object.keys(profiles).filter(g => !options.includes(g))];

  if (editing !== null && onSaveProfile) {
    return (
      <Modal
        isOpen={open}
        // 点背景 / 关闭＝回馆列表，不把没存的改动连同整个弹层一起丢掉
        onClose={() => setEditing(null)}
        title={editing ? (isCn ? `「${editing}」的器材` : `${editing} · equipment`) : isCn ? '新的馆' : 'New gym'}
        size="sm"
        variant="sheet"
        layer="modal-2"
        testId="gym-profile"
      >
        <GymProfileForm
          isCn={isCn}
          name={editing}
          initial={profiles[editing] ?? defaultProfile(unit === 'lbs' ? 'lbs' : 'kg')}
          taken={allGyms}
          onBack={() => setEditing(null)}
          onSave={(name, p) => {
            onSaveProfile(name, p, !editing);
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
      title={translations.gymPickTitle[lang] as string}
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
              {i === 0 && options[0] === g && (
                <span className="ml-auto text-label text-tertiary">
                  {translations.gymLastUsed[lang] as string}
                </span>
              )}
            </button>
            {onSaveProfile && (
              <button
                type="button"
                className="min-h-[48px] px-4 flex-shrink-0 text-label text-secondary underline underline-offset-2"
                onClick={() => setEditing(g)}
                data-testid={`gym-edit-${i}`}
              >
                {isCn ? '编辑' : 'Edit'}
              </button>
            )}
          </div>
        ))}

        {/* 清掉场地。历史记录本来就没标，这条让「标错了」有退路。 */}
        {current && (
          <button type="button" className={`${row} text-tertiary`} onClick={() => commit(undefined)}>
            <span className="w-4 flex-shrink-0" />
            <span>{translations.gymClear[lang] as string}</span>
          </button>
        )}

        {onSaveProfile ? (
          <button
            type="button"
            className={`${row} text-primary border-t border-divider mt-2 font-semibold`}
            onClick={() => setEditing('')}
            data-testid="gym-new"
          >
            <Plus size={15} strokeWidth={2.5} className="flex-shrink-0" />
            {isCn ? '新的馆…' : 'New gym…'}
          </button>
        ) : (
          <div className="border-t border-divider mt-2 px-4 pt-3 pb-1 flex items-center gap-2">
            <input
              className="ui-input flex-1"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && draftGym) commit(draftGym);
              }}
              placeholder={translations.gymNewPlaceholder[lang] as string}
              data-testid="gym-new-input"
            />
            <button
              type="button"
              disabled={!isNew}
              onClick={() => draftGym && commit(draftGym)}
              className={`min-h-[44px] px-3 rounded-card flex-shrink-0 flex items-center gap-1 text-sm font-bold transition-ui active:scale-press-sm ${
                isNew ? 'bg-accent text-on-accent' : 'bg-card/40 text-tertiary cursor-not-allowed'
              }`}
              aria-label={isCn ? '添加场地' : 'Add gym'}
            >
              <Plus size={15} strokeWidth={2.5} />
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
};

/* ── 一个馆的档案：新建 / 编辑同一张表 ── */

function GymProfileForm({
  isCn,
  name,
  initial,
  taken,
  onBack,
  onSave,
}: {
  isCn: boolean;
  /** ''＝新的馆（要起名） */
  name: string;
  initial: GymProfile;
  taken: string[];
  onBack: () => void;
  onSave: (name: string, p: GymProfile) => void;
}) {
  const [p, setP] = useState<GymProfile>(() => JSON.parse(JSON.stringify(initial)));
  const [nm, setNm] = useState(name);
  const [err, setErr] = useState('');

  const setUnit = (u: PlateUnit) => {
    if (p.plateUnit === u) return;
    setP({ ...p, plateUnit: u, plates: PLATE_SPECS[u].map(s => s.w) });
  };
  const togglePlate = (w: number) => {
    const has = p.plates.includes(w);
    // 至少留一种片：一片都没有就什么都挂不上
    if (has && p.plates.length <= 1) return;
    setP({ ...p, plates: has ? p.plates.filter(x => x !== w) : [...p.plates, w].sort((a, b) => b - a) });
  };
  const stepInc = (key: 'cable' | 'machine' | 'dumbbell', d: 1 | -1) => {
    const c = p[key];
    const list = INC_CHOICES[c.u];
    let k = list.indexOf(c.v);
    if (k < 0) k = 0;
    setP({ ...p, [key]: { ...c, v: list[Math.max(0, Math.min(list.length - 1, k + d))] } });
  };
  const setIncUnit = (key: 'cable' | 'machine' | 'dumbbell', u: PlateUnit) => {
    const c = p[key];
    if (c.u === u) return;
    const def = defaultProfile(u)[key];
    setP({ ...p, [key]: { u, v: def.v } as IncSpec });
  };

  const save = () => {
    const n = name || normalizeGym(nm);
    if (!n) {
      setErr(isCn ? '先给这个馆起个名字' : 'Give this gym a name first');
      return;
    }
    if (!name && taken.includes(n)) {
      setErr(isCn ? `已经有叫「${n}」的馆了，回列表点它的「编辑」` : `"${n}" already exists — edit it from the list`);
      return;
    }
    onSave(n, p);
  };

  const seg = (on: boolean) =>
    `min-h-[36px] px-3 text-label font-semibold ${on ? 'seg-on' : 'text-secondary'}`;
  const inc = (key: 'cable' | 'machine' | 'dumbbell', label: string) => (
    <div className="gym-field">
      <span className="text-label text-secondary">{label}</span>
      <div className="gym-inc-stepper">
        <button type="button" onClick={() => stepInc(key, -1)} aria-label={isCn ? '轻一点' : 'Smaller'}>−</button>
        <b>{fmt(p[key].v)}</b>
        <button type="button" onClick={() => stepInc(key, 1)} aria-label={isCn ? '重一点' : 'Bigger'}>＋</button>
        <span className="gym-seg" role="group">
          <button type="button" className={seg(p[key].u === 'kg')} aria-pressed={p[key].u === 'kg'} onClick={() => setIncUnit(key, 'kg')}>kg</button>
          <button type="button" className={seg(p[key].u === 'lbs')} aria-pressed={p[key].u === 'lbs'} onClick={() => setIncUnit(key, 'lbs')}>lb</button>
        </span>
      </div>
    </div>
  );

  return (
    <div className="gym-form" data-testid="gym-profile-form">
      {!name && (
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
      )}
      <div className="gym-field">
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
        </div>
      </div>
      {inc('cable', isCn ? '龙门架 / 绳索一档' : 'Cable step')}
      {inc('machine', isCn ? '固定器械一档（个别不一样的，在那个动作的 ⋯ 里单独设）' : 'Machine step (set odd ones in the exercise ⋯ menu)')}
      {inc('dumbbell', isCn ? '哑铃一档' : 'Dumbbell step')}
      {err && <p className="text-label text-warning">{err}</p>}
      <button type="button" className="ui-btn-primary w-full min-h-[48px] mt-2" onClick={save} data-testid="gym-profile-save">
        {name ? (isCn ? '存好' : 'Save') : isCn ? '存好，用这个馆' : 'Save and use it'}
      </button>
      <button type="button" className="w-full min-h-[44px] text-label text-secondary" onClick={onBack}>
        {isCn ? '← 回到馆列表' : '← Back to gyms'}
      </button>
    </div>
  );
}

export default GymPickerModal;
