/**
 * 「在 X 的这一台」（design-plates.md「换馆重量」）：这个馆这台器械的加重方式 / 每格 / 最轻一格 / 最重一格 / 加片 / 片子单位 / 单边 / 空载，
 * 存 AppPrefs.gymRigs（键见 rigListKey，刻度）/ gymRigPick / gymKinds / gymTares（键：馆|动作|做法），
 * 改完把没做完、没改过的组吸到新刻度上：口径同换馆（reRoundPending），没动过的底稿从上一次的原值重算，来回切不漂；
 * 只有平移器械自重从当前值走（snapUntouched）。
 * 2026-11-02 从 ExerciseCard 抽出来：交替组卡没有重量大图，以前只能先拆开再设（动作设置改版时记下的复议条件）。
 * 单卡传大图的 slot / onOpen 拼成 MachineCtl 给 LoadHero；交替卡只把 MachineFace portal 进动作设置弹窗。
 */
import { useEffect, useRef } from 'react';
import { KG_TO_LBS } from '../constants';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { keyedPatch } from '../../services/appPrefs';
import type { Exercise, SetLog, SubSetLog } from '../../types';
import { gymMachineKey, gymSwitchableKind, useLoadInfoOf } from './useLoadKind';
import { oneSideKey, reRoundPending, snapUntouched, tareIn, useLoadRounder, withInc, withKind, withOneSide, withTare, type ExRounder } from './useLoadRounder';
import { defaultProfile, distinctRigs, dropTwins, gymSpecOf, newRigId, rigInUnit, rigKind, rigListKey, rigsOf, rigsPatch, sameSpec, type IncSpec, type Rig } from '../utils/loadable';
import type { PlateUnit } from '../utils/plates';
import { haptic, H } from '../utils/haptics';
import type { MachineCtl } from '../components/PlateGlyph';

/** 以前按动作单独设的那份，在台子列表里占的位置（不是存下来的 id） */
export const OWN_RIG = '~own';
/** 还没存过台时那枚另一种单位的候选（点了才存，见 altSpec）；交替卡据此判「有没有存过台」 */
export const ALT_RIG = '~alt';

/** 重新取整前后重量一样（reRoundPending 对没变的组也给新对象）：一样就不写，免得白推一次更新 */
function sameLoads(a: SetLog[], b: SetLog[]): boolean {
  const same = (x: SetLog | SubSetLog, y: SetLog | SubSetLog | undefined) =>
    !!y && x.weight === y.weight && x.bodyweightMode === y.bodyweightMode && x.plateUnit === y.plateUnit;
  return a.every((s, i) => s === b[i] || (same(s, b[i]) && (s.subSets ?? []).every((x, j) => same(x, b[i].subSets?.[j]))));
}

export function useMachineSettings(exercise: Exercise, gym: string | undefined, signed: boolean, onSets: (sets: SetLog[]) => void) {
  // 「杠铃片」§3：这个动作的重量怎么画、怎么拖（带上馆：这台在这个馆是插销还是挂片）
  const loadInfo = useLoadInfoOf()(exercise, signed, gym);
  const loadKind = loadInfo.kind;
  const { unit, appPrefs, changeAppPrefs } = useUserSettingsContext();
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
   * 这件器材在这个馆存的几种刻度（2026-11-10 用户定：同馆一台 lb、一台 kg 的龙门架，练不同动作时一点就切）：
   * 列表存 gymRigs（配重片的形式全馆一份，哑铃等按器材共用，见 rigListKey），每个动作记住上次用的哪一种（gymRigPick）。
   * 以前按动作单独设的（gymOverrides）不迁移、照常生效，在这里显示成选中的一台；
   * 一旦切走或改它，就收进列表（刻度一样的并成一台）并删掉旧键——不收的话切走就找不回来了。
   * 带正负的辅助没有自己的单位，照旧按动作存 gymOverrides。
   */
  const rigKey = incKey ? rigListKey(gym, loadInfo) : null;
  const rigs = rigKey && incKey ? rigsOf(appPrefs.gymRigs, gym, loadInfo, appPrefs.gymRigPick[incKey]) : [];
  /**
   * 馆档案里这类器材的一档（列表第一格「默认」）；没设过档案＝按顶栏显示单位的常见档位，和取整器同一个口径。
   * 不用 rounder.display：选了一台 lb 的之后那是这台的单位（cardUnitOf），默认那格会跟着变
   */
  const gymSpec = rigKey && rounder && rigKind(loadKind)
    ? gymSpecOf((gym && appPrefs.gyms[gym]) || defaultProfile(unit), loadKind, loadInfo.stack)
    : null;
  const picked = incKey ? rigs.find(r => r.id === appPrefs.gymRigPick[incKey]) : undefined;
  const legacy = rigKey && incKey && !picked ? appPrefs.gymOverrides[incKey] : undefined;
  /** 存一次：列表、这个动作选的哪一台（'' ＝馆默认），旧的按动作设置一并删掉；组的重新取整交给下面的 effect */
  const commitRigs = (list: Rig[], pick: string) => {
    if (!rigKey || !incKey) return;
    haptic(H.tap);
    const gymOverrides = { ...appPrefs.gymOverrides };
    delete gymOverrides[incKey];
    changeAppPrefs({ gymRigs: rigsPatch(appPrefs.gymRigs, gym!, loadInfo, list), ...keyedPatch('gymRigPick', incKey, pick), ...(legacy ? { gymOverrides } : {}) });
  };
  /**
   * 选中的这种形式别的动作也在用（2026-11-18 用户定：配重片形式全馆共用）：在它上面改刻度＝另存一种、只有这个动作换过去，
   * 别的动作的格子不跟着变（11-13 把固定器械拆成按动作存，防的就是「改一台带动别的器械」）。哑铃 / 壶铃 / 固定杠铃一个馆就那一架，照旧一起变。
   */
  const sharedPick = !!picked && loadKind === 'pin'
    && Object.entries(appPrefs.gymRigPick).some(([k, v]) => v === picked.id && k !== incKey && k.startsWith(`${gym}|`));
  /** 眼下的刻度（馆默认 / 旧的按动作设置）。配重片的最轻一格没设过时把显示的那格（＝一档）钉住，免得它跟着每格一起变（2026-10-21 修） */
  const curSpec = (r: ExRounder): IncSpec => ({
    v: r.ctx.inc,
    u: r.unit,
    ...(loadKind === 'pin' ? { s: r.ctx.start && r.ctx.start > 0 ? r.ctx.start : r.ctx.inc } : {}),
    ...(loadKind === 'pin' && r.ctx.end ? { e: r.ctx.end } : {}),
    ...(loadKind === 'pin' && r.ctx.addons?.length ? { a: r.ctx.addons } : {}),
  });
  /** 旧的按动作设置收进列表（刻度一样的那台直接用） */
  const withLegacy = (): { list: Rig[]; rig?: Rig } => {
    if (!legacy) return { list: rigs, rig: picked };
    const hit = rigs.find(r => sameSpec(r, legacy));
    const rig = hit ?? { ...legacy, id: newRigId() };
    return { list: hit ? rigs : [...rigs, rig], rig };
  };
  /**
   * 这个动作用的那台换了（切台、改刻度、删掉）：没做完、没改过的组吸到新刻度上。
   * 放在 effect 里而不是 commitRigs：同一场里别的卡选的是同一台、在那张卡上改的，这张卡也得跟着吸（审查 B8）。
   * 只认同一个馆、同一个动作下「选的哪台 / 那台的刻度」变了；换馆、换做法、切显示单位各有自己的重新取整，不在这里。
   * 没选过台时不看馆默认刻度（legacy）：它只在保存馆档案时变，那条路由 switchGym 重新取整，这里再跑一遍会叠两次（60 kg 吸成 135 lb 而不是 130）。
   */
  const rigSig = rigKey && incKey ? [rigKey, incKey, appPrefs.gymRigPick[incKey] ?? '', picked ? JSON.stringify(picked) : ''] : null;
  const rigSigKey = rigSig ? rigSig.join('\n') : null;
  const rigSigRef = useRef(rigSig);
  useEffect(() => {
    const prev = rigSigRef.current;
    rigSigRef.current = rigSig;
    // 挂载时 prev 就是这一次：什么都没换，不动组（切 tab 回来重挂不该改底稿）
    if (!prev || !rigSig || !rounder || prev.join('\n') === rigSigKey || prev[0] !== rigSig[0] || prev[1] !== rigSig[1]) return;
    const next = reRoundPending(exercise.sets, exercise, rounder);
    if (!sameLoads(exercise.sets, next)) onSets(next);
  }, [rigSigKey]);
  /** 加一台：照眼下的刻度抄一份、选中它，接着在设置里改（记进 freshRef，关设置时没改过就收掉） */
  const freshRef = useRef(new Set<string>());
  const addRig = () => {
    if (!rounder) return;
    const { list } = withLegacy();
    const rig: Rig = { ...curSpec(rounder), id: newRigId() };
    freshRef.current.add(rig.id);
    commitRigs([...list, rig], rig.id);
  };
  /**
   * 这件器材在这个馆一台都没存过：药丸排里多给一枚另一种单位的常见刻度（kg 馆里的 10 + 10 lb 龙门架），
   * 一点就存成一台并选中（审查 B4，和新建动作弹窗同一个做法）。
   */
  const altSpec = gymSpec && rigKind(loadKind) && !rigs.length && !legacy
    ? gymSpecOf(defaultProfile(gymSpec.u === 'kg' ? 'lbs' : 'kg'), loadKind, loadInfo.stack)
    : null;
  const pickRig = (id: string) => {
    if (id !== ALT_RIG || !altSpec) return commitRigs(withLegacy().list, id);
    const rig: Rig = { ...altSpec, id: newRigId() };
    commitRigs([rig], rig.id);
  };
  /**
   * 设置行收起（动作设置弹窗关了）：这次「＋」出来、没起名、刻度又和默认或别的台一样的收掉（审查 B5），
   * 免得误点或中途放弃留下一枚和默认分不清的药丸。slotRef 由 machineCtl 每次渲染写入，没调用＝没开。
   */
  const slotRef = useRef<HTMLElement | null | undefined>(null);
  slotRef.current = null;
  const openRef = useRef(false);
  useEffect(() => {
    const open = !!slotRef.current;
    const left = openRef.current && !open;
    openRef.current = open;
    if (!left || !freshRef.current.size || !rigKey || !incKey) return;
    const fresh = freshRef.current;
    freshRef.current = new Set();
    const pick = appPrefs.gymRigPick[incKey] ?? '';
    const next = dropTwins(rigs, fresh, gymSpec, pick, loadKind === 'pin');
    if (next.list.length === rigs.length) return;
    changeAppPrefs({ gymRigs: rigsPatch(appPrefs.gymRigs, gym!, loadInfo, next.list), ...(next.pick !== pick ? keyedPatch('gymRigPick', incKey, next.pick) : {}) });
  });
  /** 改选中这一台的刻度：在馆默认上改＝另存一台（馆默认留着随时切回去） */
  const editRig = (patch: Partial<IncSpec>) => {
    if (!rounder) return;
    const { list, rig } = withLegacy();
    if (rig && sharedPick) {
      // 另存的那份不带名字：名字是原来那种的
      const { n: _name, ...spec } = rig;
      const fork = { ...spec, ...patch, id: newRigId() };
      return commitRigs([...list, fork], fork.id);
    }
    const cur = rig ?? { ...curSpec(rounder), id: newRigId() };
    const next = { ...cur, ...patch };
    commitRigs(rig ? list.map(r => (r.id === cur.id ? next : r)) : [...list, next], cur.id);
  };
  /** 删掉选中的这种；别的动作还在用的不删，只是这个动作不用了（回到默认） */
  const removeRig = () => picked && commitRigs(sharedPick ? rigs : rigs.filter(r => r.id !== picked.id), '');
  /** 起名只改列表里这一条：刻度没变，不用重新取整 */
  const nameRig = (n: string) => {
    if (!rigKey || !picked || n === (picked.n ?? '')) return;
    const { n: _old, ...rest } = picked;
    changeAppPrefs({ gymRigs: rigsPatch(appPrefs.gymRigs, gym!, loadInfo, rigs.map(r => (r.id === picked.id ? { ...rest, ...(n ? { n } : {}) } : r))) });
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
    onSets(reRoundPending(exercise.sets, exercise, next === null ? rounderFor(exercise, gym, undefined, undefined, { gymOverrides }) : withInc(rounder, next)));
  };
  /** 换这一台的片子单位（同一个馆里可以一台 lb、一台 kg）：换算口径见 rigInUnit */
  const setMachineUnit = (u: PlateUnit) => {
    if (!rounder || u === rounder.unit) return;
    editRig(rigInUnit(curSpec(rounder), u));
  };
  /**
   * 改「最轻一格 · 每格」（2026-10-20 用户定：从 12.5 起、每格 +5 的龙门架）。最轻一格也是下限：
   * 和一档对齐（每格 5、最轻 15）照样要存；恰好等于一档也要存——不存就读回成「没设」＝跟着每格走。
   */
  const setStack = (step: number, start: number) => editRig({ v: step, s: start > 0 ? Math.round(start * 100) / 100 : undefined });
  /** 最重一格（2026-11-13 用户定）：null＝不设限。在馆默认上设＝另存一台（馆默认那一格存不了它） */
  const setStackEnd = (end: number | null) => editRig({ e: end !== null && end > 0 ? Math.round(end * 100) / 100 : undefined });
  /** 加片（2026-11-18 用户定）：每块多重、几块；0 块＝没有。在馆默认上设＝另存一种（同最重一格） */
  const setAddons = (each: number, count: number) => editRig({ a: each > 0 && count > 0 ? Array.from({ length: count }, () => Math.round(each * 100) / 100) : undefined });

  /**
   * ⋯「在 X，这台是 插销 / 挂片」（design-plates.md「换馆重量」A2）：库里是配重片或挂片式器械的动作才给。
   * 和动作库一样就写墓碑（恢复动作库），不一样就记住；没做完、没改过的组按新形式重新取整。
   */
  const kindKey = rounder && gymSwitchableKind(loadInfo.libKind) ? gymKey : null;
  /**
   * 挂片时多一行「器械自重」（滑台 / 史密斯杠自重）：器械上标了就填，不知道就空着。
   * 存 appPrefs.gymTares（带单位）。默认只进大图说明；这一台切成「算进记录」才当空杠算进记录和取整
   * （2026-11-08 用户定：杠上标了重量的史密斯算，滑台那种不算，每台自己选）。
   */
  const tareKey = kindKey && loadKind === 'loaded' ? kindKey : null;
  const tareSpec = tareKey ? appPrefs.gymTares[tareKey] : undefined;
  const tareG = tareSpec && rounder ? tareIn(tareSpec, rounder.unit) : undefined;
  const tareCounted = !!tareSpec?.counted;
  /** 写回自重并把算进记录的那部分差值平移到没做完、没改过的组上：挂的片不变，数字跟自重一起增减 */
  const writeTare = (nextG: number | undefined, counted: boolean) => {
    if (!tareKey || !rounder) return;
    changeAppPrefs(keyedPatch('gymTares', tareKey, nextG === undefined ? '' : { v: nextG, u: rounder.unit, ...(counted ? { counted } : {}) }));
    const inLog = counted && nextG !== undefined ? nextG : undefined;
    const shiftG = (inLog ?? 0) - (tareCounted ? tareG ?? 0 : 0);
    onSets(snapUntouched(exercise.sets, exercise, withTare(rounder, inLog), rounder.unit === 'lbs' ? shiftG / KG_TO_LBS : shiftG));
  };
  // 自重：横划 / 打字都行；清空＝不知道（墓碑，算不算也一起清掉）
  const saveTare = (n: number | null) => {
    // 打的数留一位小数（和 tareIn 读回来的精度一样），否则显示单位换过来的长小数每次都「不等于」、白写一遍
    const next = n === null ? undefined : Math.round(n * 10) / 10;
    if (next === tareG) return;
    writeTare(next, next !== undefined && tareCounted);
  };
  const setTareCounted = (on: boolean) => {
    if (on === tareCounted || tareG === undefined) return;
    haptic(H.tap);
    writeTare(tareG, on);
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
    onSets(reRoundPending(exercise.sets, exercise, withOneSide(rounder, on)));
  };
  const setGymKind = (k: 'pin' | 'loaded') => {
    if (!rounder || !kindKey || k === loadKind) return;
    haptic(H.tap);
    changeAppPrefs(keyedPatch('gymKinds', kindKey, k === loadInfo.libKind ? '' : k));
    onSets(reRoundPending(exercise.sets, exercise, withKind(rounder, k)));
  };
  /** 这台能不能设：标了馆、有取整器、至少有一项能改（杠铃按馆的片子算、纯数字动作都没有） */
  const canSet = !!(gym && rounder && (kindKey || incKey));
  /** 给 LoadHero / MachineFace 的控制面；slot＝渲染进动作设置弹窗的挂载点，onOpen＝大图小药丸打开弹窗 */
  const machineCtl = (slot: HTMLElement | null | undefined, onOpen?: () => void): MachineCtl | undefined => {
    slotRef.current = slot;
    return gym && rounder && (kindKey || incKey)
      ? {
          gym,
          canSwitch: !!kindKey,
          libKind: kindKey ? (loadInfo.libKind as 'pin' | 'loaded') : undefined,
          slot,
          onOpen,
          onKind: setGymKind,
          onStack: rigKey && loadKind === 'pin' ? setStack : undefined,
          onStackEnd: rigKey && loadKind === 'pin' ? setStackEnd : undefined,
          onAddons: rigKey && loadKind === 'pin' ? setAddons : undefined,
          inc: rigKey
            ? { onSet: v => editRig({ v }) }
            : signedKey
              ? { onSet: setSignedInc, onReset: appPrefs.gymOverrides[signedKey] ? () => setSignedInc(null) : undefined }
              : undefined,
          rigs: rigKey
            ? {
                list: [...(gymSpec ? [{ ...gymSpec, id: '' }] : []), ...distinctRigs(rigs, picked?.id ?? ''), ...(legacy ? [{ ...legacy, id: OWN_RIG }] : []), ...(altSpec ? [{ ...altSpec, id: ALT_RIG }] : [])],
                sel: picked?.id ?? (legacy ? OWN_RIG : ''),
                shared: sharedPick,
                onPick: pickRig,
                onAdd: addRig,
                onName: picked ? nameRig : undefined,
                onRemove: picked ? removeRig : undefined,
              }
            : undefined,
          tare: tareKey ? { value: tareG ?? null, onSet: saveTare, counted: tareCounted, onCounted: setTareCounted } : undefined,
          oneSide: sideKey ? { on: !!rounder.ctx.oneSide, onSet: setOneSide } : undefined,
          onUnit: rigKey ? setMachineUnit : undefined,
        }
      : undefined;
  };
  return { loadInfo, loadKind, gymKey, rounder, canSet, machineCtl };
}
