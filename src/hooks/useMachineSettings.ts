/**
 * 「在 X 的这一台」（design-plates.md「换馆重量」）：这个馆这台器械的加重方式 / 每格 / 最轻一格 / 片子单位 / 单边 / 空载，
 * 存 AppPrefs.gymRigs（键：馆|器材，刻度）/ gymRigPick / gymKinds / gymTares（键：馆|动作|做法），
 * 改完把没做完、没改过的组吸到新刻度上（snapUntouched）。
 * 2026-11-02 从 ExerciseCard 抽出来：交替组卡没有重量大图，以前只能先拆开再设（动作设置改版时记下的复议条件）。
 * 单卡传大图的 slot / onOpen 拼成 MachineCtl 给 LoadHero；交替卡只把 MachineFace portal 进动作设置弹窗。
 */
import { KG_TO_LBS } from '../constants';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { keyedPatch } from '../../services/appPrefs';
import type { Exercise, SetLog } from '../../types';
import { gymMachineKey, gymSwitchableKind, useLoadInfoOf } from './useLoadKind';
import { oneSideKey, snapUntouched, useLoadRounder, withInc, withKind, withOneSide, type ExRounder } from './useLoadRounder';
import { defaultProfile, gymSpecOf, incIn, newRigId, rigKind, rigListKey, sameSpec, startIn, type IncSpec, type Rig } from '../utils/loadable';
import type { PlateUnit } from '../utils/plates';
import { haptic, H } from '../utils/haptics';
import type { MachineCtl } from '../components/PlateGlyph';

/** 以前按动作单独设的那份，在台子列表里占的位置（不是存下来的 id） */
export const OWN_RIG = '~own';

export function useMachineSettings(exercise: Exercise, gym: string | undefined, signed: boolean, onSets: (sets: SetLog[]) => void) {
  // 「杠铃片」§3：这个动作的重量怎么画、怎么拖（带上馆：这台在这个馆是插销还是挂片）
  const loadInfo = useLoadInfoOf()(exercise, signed, gym);
  const loadKind = loadInfo.kind;
  const { appPrefs, changeAppPrefs } = useUserSettingsContext();
  const gymKey = gymMachineKey(gym, loadInfo);
  // 馆档案取整器：纯数字的动作（含没有重量这一项的）是 null，组行照旧走首选项的步长
  const rounderFor = useLoadRounder();
  const rounder = rounderFor(exercise, gym);
  /**
   * 「在 X，这台器械一档多重」（2026-10-18 用户定：馆默认一档，个别器械单独调）。
   * 只给配重片 / 哑铃 / 壶铃 / 固定杠铃 / 带正负的辅助：杠铃和挂片器械的一档就是片子，在馆档案里管。
   * 没标馆的训练不给（改了也找不到下一次）。改完把没做完、没改过的组吸到新的一档上。
   */
  const incKey = rounder && gym && (rigKind(loadKind) || loadKind === 'signed') ? gymMachineKey(gym, rounder.info) : null;
  /**
   * 这件器材在这个馆存的几台（2026-11-10 用户定：同馆一台 lb、一台 kg 的龙门架，练不同动作时一点就切）：
   * 列表存 gymRigs[馆|器材]、这件器材的动作共用，每个动作记住上次用的哪一台（gymRigPick）。
   * 以前按动作单独设的（gymOverrides）不迁移、照常生效，在这里显示成选中的一台；
   * 一旦切走或改它，就收进列表（刻度一样的并成一台）并删掉旧键——不收的话切走就找不回来了。
   * 带正负的辅助没有自己的单位，照旧按动作存 gymOverrides。
   */
  const rigKey = incKey ? rigListKey(gym, loadInfo) : null;
  const rigs = rigKey ? appPrefs.gymRigs[rigKey] ?? [] : [];
  /** 馆档案里这类器材的一档（列表第一格「默认」）；没设过档案＝按显示单位的常见档位，和取整器同一个口径 */
  const gymSpec = rigKey && rounder && rigKind(loadKind)
    ? gymSpecOf((gym && appPrefs.gyms[gym]) || defaultProfile(rounder.display), loadKind, loadInfo.stack)
    : null;
  const picked = incKey ? rigs.find(r => r.id === appPrefs.gymRigPick[incKey]) : undefined;
  const legacy = rigKey && incKey && !picked ? appPrefs.gymOverrides[incKey] : undefined;
  /** 存一次：列表、这个动作选的哪一台（'' ＝馆默认），旧的按动作设置一并删掉；没做完、没改过的组吸到新刻度上 */
  const commitRigs = (list: Rig[], pick: string) => {
    if (!rigKey || !incKey) return;
    haptic(H.tap);
    const gymOverrides = { ...appPrefs.gymOverrides };
    delete gymOverrides[incKey];
    const gymRigs = { ...appPrefs.gymRigs, [rigKey]: list };
    changeAppPrefs({ gymRigs, ...keyedPatch('gymRigPick', incKey, pick), ...(legacy ? { gymOverrides } : {}) });
    const fresh = rounderFor(exercise, gym, undefined, undefined, { gymOverrides, gymRigs, gymRigPick: { ...appPrefs.gymRigPick, [incKey]: pick } });
    onSets(snapUntouched(exercise.sets, exercise, fresh));
  };
  /** 眼下的刻度（馆默认 / 旧的按动作设置）。配重片的最轻一格没设过时把显示的那格（＝一档）钉住，免得它跟着每格一起变（2026-10-21 修） */
  const curSpec = (r: ExRounder): IncSpec => ({
    v: r.ctx.inc,
    u: r.unit,
    ...(loadKind === 'pin' ? { s: r.ctx.start && r.ctx.start > 0 ? r.ctx.start : r.ctx.inc } : {}),
  });
  /** 旧的按动作设置收进列表（刻度一样的那台直接用） */
  const withLegacy = (): { list: Rig[]; rig?: Rig } => {
    if (!legacy) return { list: rigs, rig: picked };
    const hit = rigs.find(r => sameSpec(r, legacy));
    const rig = hit ?? { ...legacy, id: newRigId() };
    return { list: hit ? rigs : [...rigs, rig], rig };
  };
  const pickRig = (id: string) => commitRigs(withLegacy().list, id);
  /** 加一台：照眼下的刻度抄一份、选中它，接着在设置里改 */
  const addRig = () => {
    if (!rounder) return;
    const { list } = withLegacy();
    const rig: Rig = { ...curSpec(rounder), id: newRigId() };
    commitRigs([...list, rig], rig.id);
  };
  /** 改选中这一台的刻度：在馆默认上改＝另存一台（馆默认留着随时切回去） */
  const editRig = (patch: Partial<IncSpec>) => {
    if (!rounder) return;
    const { list, rig } = withLegacy();
    const cur = rig ?? { ...curSpec(rounder), id: newRigId() };
    const next = { ...cur, ...patch };
    commitRigs(rig ? list.map(r => (r.id === cur.id ? next : r)) : [...list, next], cur.id);
  };
  const removeRig = () => picked && commitRigs(rigs.filter(r => r.id !== picked.id), '');
  /** 起名只改列表里这一条：刻度没变，不用重新取整 */
  const nameRig = (n: string) => {
    if (!rigKey || !picked || n === (picked.n ?? '')) return;
    const { n: _old, ...rest } = picked;
    changeAppPrefs({ gymRigs: { ...appPrefs.gymRigs, [rigKey]: rigs.map(r => (r.id === picked.id ? { ...rest, ...(n ? { n } : {}) } : r)) } });
  };
  /** 带正负的辅助：一档按动作存 gymOverrides */
  const signedKey = incKey && !rigKey ? incKey : null;
  const setSignedInc = (next: number | null) => {
    if (!rounder || !signedKey) return;
    haptic(H.tap);
    const gymOverrides = { ...appPrefs.gymOverrides };
    if (next === null) delete gymOverrides[signedKey];
    else gymOverrides[signedKey] = { v: next, u: rounder.unit };
    changeAppPrefs({ gymOverrides });
    onSets(snapUntouched(exercise.sets, exercise, next === null ? rounderFor(exercise, gym, undefined, undefined, { gymOverrides }) : withInc(rounder, next)));
  };
  /**
   * 换这一台的片子单位（2026-10-25 用户定：一台器械只有一种片，同一个馆里可以一台 lb、一台 kg）：
   * 每格换成新单位里最接近的档位，最轻一格按实际重量换算。
   */
  const setMachineUnit = (u: PlateUnit) => {
    if (!rounder || u === rounder.unit) return;
    const cur = curSpec(rounder);
    const s = startIn(cur, u);
    editRig({ v: incIn(cur, u), u, s: s > 0 ? s : undefined });
  };
  /**
   * 改「最轻一格 · 每格」（2026-10-20 用户定：从 12.5 起、每格 +5 的龙门架）。最轻一格也是下限：
   * 和一档对齐（每格 5、最轻 15）照样要存；恰好等于一档也要存——不存就读回成「没设」＝跟着每格走。
   */
  const setStack = (step: number, start: number) => editRig({ v: step, s: start > 0 ? Math.round(start * 100) / 100 : undefined });

  /**
   * ⋯「在 X，这台是 插销 / 挂片」（design-plates.md「换馆重量」A2）：库里是配重片或挂片式器械的动作才给。
   * 和动作库一样就写墓碑（恢复动作库），不一样就记住；没做完、没改过的组按新形式重新取整。
   */
  const kindKey = rounder && gymSwitchableKind(loadInfo.libKind) ? gymKey : null;
  /**
   * 挂片时多一行「空载」（滑台 / 史密斯杠自重）：器械上标了就填，不知道就空着。
   * 存 appPrefs.gymTares（带单位），只进大图说明，不改记录。
   */
  const tareKey = kindKey && loadKind === 'loaded' ? kindKey : null;
  const tareSpec = tareKey ? appPrefs.gymTares[tareKey] : undefined;
  const tareD = tareSpec && rounder
    ? Math.round((tareSpec.u === rounder.unit ? tareSpec.v : tareSpec.u === 'kg' ? tareSpec.v * KG_TO_LBS : tareSpec.v / KG_TO_LBS) * 10) / 10
    : undefined;
  // 空载：横划 / 打字都行；清空＝不知道（墓碑）
  const saveTare = (n: number | null) => {
    if (!tareKey || !rounder) return;
    if (n === null) {
      if (tareSpec) changeAppPrefs(keyedPatch('gymTares', tareKey, ''));
      return;
    }
    if (n !== tareD) changeAppPrefs(keyedPatch('gymTares', tareKey, { v: n, u: rounder.unit }));
  };
  /** 单边挂片（T 杠、地雷架）：存这一台的 gymOverrides（键 + '|one'），没做完、没改过的组按新算法重新取整 */
  const sideKey = kindKey && loadKind === 'loaded' ? oneSideKey(kindKey) : null;
  const setOneSide = (on: boolean) => {
    if (!rounder || !sideKey) return;
    haptic(H.tap);
    const ov = { ...appPrefs.gymOverrides };
    if (on) ov[sideKey] = { v: 1, u: rounder.unit };
    else delete ov[sideKey];
    changeAppPrefs({ gymOverrides: ov });
    onSets(snapUntouched(exercise.sets, exercise, withOneSide(rounder, on)));
  };
  const setGymKind = (k: 'pin' | 'loaded') => {
    if (!rounder || !kindKey || k === loadKind) return;
    haptic(H.tap);
    changeAppPrefs(keyedPatch('gymKinds', kindKey, k === loadInfo.libKind ? '' : k));
    onSets(snapUntouched(exercise.sets, exercise, withKind(rounder, k)));
  };
  /** 这台能不能设：标了馆、有取整器、至少有一项能改（杠铃按馆的片子算、纯数字动作都没有） */
  const canSet = !!(gym && rounder && (kindKey || incKey));
  /** 给 LoadHero / MachineFace 的控制面；slot＝渲染进动作设置弹窗的挂载点，onOpen＝大图小药丸打开弹窗 */
  const machineCtl = (slot: HTMLElement | null | undefined, onOpen?: () => void): MachineCtl | undefined =>
    gym && rounder && (kindKey || incKey)
      ? {
          gym,
          canSwitch: !!kindKey,
          libKind: kindKey ? (loadInfo.libKind as 'pin' | 'loaded') : undefined,
          slot,
          onOpen,
          onKind: setGymKind,
          onStack: rigKey && loadKind === 'pin' ? setStack : undefined,
          inc: rigKey
            ? { onSet: v => editRig({ v }) }
            : signedKey
              ? { onSet: setSignedInc, onReset: appPrefs.gymOverrides[signedKey] ? () => setSignedInc(null) : undefined }
              : undefined,
          rigs: rigKey
            ? {
                list: [...(gymSpec ? [{ ...gymSpec, id: '' }] : []), ...rigs, ...(legacy ? [{ ...legacy, id: OWN_RIG }] : [])],
                sel: picked?.id ?? (legacy ? OWN_RIG : ''),
                onPick: pickRig,
                onAdd: addRig,
                onName: picked ? nameRig : undefined,
                onRemove: picked ? removeRig : undefined,
              }
            : undefined,
          tare: tareKey ? { value: tareD ?? null, onSet: saveTare } : undefined,
          oneSide: sideKey ? { on: !!rounder.ctx.oneSide, onSet: setOneSide } : undefined,
          onUnit: rigKey ? setMachineUnit : undefined,
        }
      : undefined;
  return { loadInfo, loadKind, gymKey, rounder, tareD, canSet, machineCtl };
}
