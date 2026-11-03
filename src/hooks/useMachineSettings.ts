/**
 * 「在 X 的这一台」（design-plates.md「换馆重量」）：这个馆这台器械的加重方式 / 每格 / 最轻一格 / 片子单位 / 单边 / 空载，
 * 存 AppPrefs.gymOverrides / gymKinds / gymTares（键：馆|动作|做法），改完把没做完、没改过的组吸到新刻度上（snapUntouched）。
 * 2026-11-02 从 ExerciseCard 抽出来：交替组卡没有重量大图，以前只能先拆开再设（动作设置改版时记下的复议条件）。
 * 单卡传大图的 slot / onOpen 拼成 MachineCtl 给 LoadHero；交替卡只把 MachineFace portal 进动作设置弹窗。
 */
import { KG_TO_LBS } from '../constants';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { keyedPatch } from '../../services/appPrefs';
import type { Exercise, SetLog } from '../../types';
import { gymMachineKey, gymSwitchableKind, useLoadInfoOf } from './useLoadKind';
import { oneSideKey, snapUntouched, useLoadRounder, withInc, withKind, withOneSide, withStack } from './useLoadRounder';
import { incIn, startIn, type IncSpec } from '../utils/loadable';
import type { PlateUnit } from '../utils/plates';
import { haptic, H } from '../utils/haptics';
import type { MachineCtl } from '../components/PlateGlyph';

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
   * ⋯「在 X，这台器械一档多重」（2026-10-18 用户定：馆默认一档，个别器械在这里单独调）。
   * 只给配重片 / 哑铃 / 壶铃 / 固定杠铃 / 带正负的辅助：杠铃和挂片器械的一档就是片子，在馆档案里管。
   * 存 AppPrefs.gymOverrides（键：馆|动作|做法）；没标馆的训练不给（改了也找不到下一次）。
   * 改完把没做完、没改过的组吸到新的一档上。
   */
  const incKey = rounder && gym && (loadKind === 'pin' || loadKind === 'pair' || loadKind === 'bell' || loadKind === 'fixed' || loadKind === 'signed')
    ? gymMachineKey(gym, rounder.info)
    : null;
  const incOverridden = !!(incKey && appPrefs.gymOverrides[incKey]);
  const setIncOverride = (next: number | null) => {
    if (!rounder || !incKey) return;
    haptic(H.tap);
    const ov = { ...appPrefs.gymOverrides };
    let inc: number;
    if (next === null) {
      // 恢复馆默认：格子的单位也回到馆档案里这一类的单位（可能和这一台设的不一样），整个取整器按新设置重造
      delete ov[incKey];
      changeAppPrefs({ gymOverrides: ov });
      const fresh = rounderFor(exercise, gym, undefined, undefined, ov);
      onSets(snapUntouched(exercise.sets, exercise, fresh));
      return;
    } else {
      // 配重片的最轻一格跟着这一台走：只改一档时别把它冲掉；这一台原来存的最轻一格单位一样就原样留着
      // （按 ctx 里换算过的值写回会越存越漂），没设过就把眼下显示的那格（＝旧一档）钉住，免得它跟着一档一起变
      const prev = appPrefs.gymOverrides[incKey];
      const s = loadKind === 'pin'
        ? prev?.s && prev.s > 0 && prev.u === rounder.unit
          ? prev.s
          : rounder.ctx.start && rounder.ctx.start > 0 ? rounder.ctx.start : rounder.ctx.inc
        : 0;
      ov[incKey] = { v: next, u: rounder.unit, ...(s > 0 ? { s } : {}) };
      inc = next;
    }
    changeAppPrefs({ gymOverrides: ov });
    onSets(snapUntouched(exercise.sets, exercise, withInc(rounder, inc)));
  };
  /**
   * 换这一台的片子单位（2026-10-25 用户定：一台器械只有一种片，同一个馆里可以一台 lb、一台 kg）：
   * 每格换成新单位里最接近的档位，最轻一格按实际重量换算；存进这一台的 gymOverrides，没做完、没改过的组吸到新格子上。
   */
  const machineUnitKey = incKey && (loadKind === 'pin' || loadKind === 'pair' || loadKind === 'bell' || loadKind === 'fixed') ? incKey : null;
  const setMachineUnit = (u: PlateUnit) => {
    if (!rounder || !machineUnitKey || u === rounder.unit) return;
    haptic(H.tap);
    const cur: IncSpec = { v: rounder.ctx.inc, u: rounder.unit, ...(rounder.ctx.start ? { s: rounder.ctx.start } : {}) };
    const s = loadKind === 'pin' ? startIn(cur, u) : 0;
    const ov = { ...appPrefs.gymOverrides, [machineUnitKey]: { v: incIn(cur, u), u, ...(s > 0 ? { s } : {}) } };
    changeAppPrefs({ gymOverrides: ov });
    const fresh = rounderFor(exercise, gym, undefined, undefined, ov);
    onSets(snapUntouched(exercise.sets, exercise, fresh));
  };
  /**
   * 大图上改「最轻一格 · 每格」（2026-10-20 用户定：从 12.5 起、每格 +5 的龙门架）：存进这一台的 gymOverrides，
   * 没做完、没改过的组吸到新刻度上。最轻一格也是下限：和一档对齐（每格 5、最轻 15）照样要存；
   * 恰好等于一档也要存——不存就读回成「没设」＝跟着每格走，改每格时最轻一格会被拖着变（2026-10-21 修）。
   */
  const setStack = (step: number, start: number) => {
    if (!rounder || !incKey || loadKind !== 'pin') return;
    haptic(H.tap);
    const s = start > 0 ? Math.round(start * 100) / 100 : 0;
    changeAppPrefs({ gymOverrides: { ...appPrefs.gymOverrides, [incKey]: { v: step, u: rounder.unit, ...(s > 0 ? { s } : {}) } } });
    onSets(snapUntouched(exercise.sets, exercise, withStack(rounder, step, s)));
  };

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
          onStack: incKey && loadKind === 'pin' ? setStack : undefined,
          inc: incKey ? { overridden: incOverridden, onSet: n => setIncOverride(n), onReset: () => setIncOverride(null) } : undefined,
          tare: tareKey ? { value: tareD ?? null, onSet: saveTare } : undefined,
          oneSide: sideKey ? { on: !!rounder.ctx.oneSide, onSet: setOneSide } : undefined,
          onUnit: machineUnitKey ? setMachineUnit : undefined,
        }
      : undefined;
  return { loadInfo, loadKind, gymKey, rounder, tareD, canSet, machineCtl };
}
