/**
 * 动作属性（2026-10-20 重构，原「标签」）：部位 → 细分 → 器材 → 阻力类型，每一项单选。
 *
 * - 器材（equipment）：拿什么练。内置一套 + 自建（customTags 里 category='equipment'）。'' = 无器材。
 * - 阻力（resistance）：重量从哪来，决定「一格多少、画什么」（馆档案的颗粒度）。固定枚举，不能自建。
 *   大多数器材自带阻力（哑铃 → 哑铃、龙门架 → 配重片…），锁定不让改；
 *   「固定器械」、自建器材、无器材要选（器械分配重片 / 挂片两种）；
 *   杠铃在「杠铃片」和「固定杠铃」（焊死的成品杠，2026-10-21 用户定）之间选。
 *   动作上 resistance 不写 = 跟器材的默认。
 *
 * 旧数据只有 tags: string[]（多选、混着场地标签）。读的时候按 legacyAttrs 换算，画法与换算前一致；
 * 写的时候 equipment / resistance 之外仍镜像一份 tags: [equipment]，没升级的旧版 APK 读到也不丢器材。
 */
import type { ExerciseDefinition, ExerciseVariant } from '../../types';

export type Resistance = 'plates' | 'fixedBar' | 'dumbbell' | 'kettlebell' | 'stack' | 'bodyweight' | 'band' | 'none';

/** 阻力类型，按选项顺序 */
export const RESISTANCES: Resistance[] = ['plates', 'fixedBar', 'stack', 'dumbbell', 'kettlebell', 'bodyweight', 'band', 'none'];

export const RESISTANCE_NAMES: Record<Resistance, { cn: string; en: string }> = {
  plates: { cn: '杠铃片', en: 'Plates' },
  fixedBar: { cn: '固定杠铃', en: 'Fixed barbell' },
  stack: { cn: '配重片', en: 'Weight stack' },
  dumbbell: { cn: '哑铃', en: 'Dumbbell' },
  kettlebell: { cn: '壶铃', en: 'Kettlebell' },
  bodyweight: { cn: '自重', en: 'Bodyweight' },
  band: { cn: '弹力带', en: 'Band' },
  none: { cn: '不计重', en: 'Not weighed' },
};

export const EQ_BARBELL = 'tagBarbell';
export const EQ_DUMBBELL = 'tagDumbbell';
export const EQ_KETTLEBELL = 'tagKettlebell';
export const EQ_MACHINE = 'tagMachine';
export const EQ_CABLE = 'tagCable';
export const EQ_BODYWEIGHT = 'tagBodyweight';
export const EQ_BAND = 'tagBand';

/** 内置器材（id 沿用旧标签 id：改名覆盖、旧数据都认它） */
export const BUILTIN_EQUIPMENT = [EQ_BARBELL, EQ_DUMBBELL, EQ_KETTLEBELL, EQ_MACHINE, EQ_CABLE, EQ_BODYWEIGHT, EQ_BAND];

/** 内置器材自带的阻力；固定器械只是默认（可改挂片） */
const BUILTIN_DEFAULT: Record<string, Resistance> = {
  [EQ_BARBELL]: 'plates',
  [EQ_DUMBBELL]: 'dumbbell',
  [EQ_KETTLEBELL]: 'kettlebell',
  [EQ_MACHINE]: 'stack',
  [EQ_CABLE]: 'stack',
  [EQ_BODYWEIGHT]: 'bodyweight',
  [EQ_BAND]: 'band',
};

/** 退役的旧标签：场地 / 球类，不是器材（2026-10-20 用户定：删掉） */
const RETIRED_TAGS = new Set(['tagoutdoor', 'tagindoor', 'tagballgame', 'taggym']);

/** 自建器材上的阻力（CustomTag.resistance）。传 customTags 里 equipment 那几条即可 */
export type EquipmentDefs = readonly { id: string; category: string; resistance?: Resistance }[];

const lc = (s: string | undefined) => (s || '').toLowerCase();

function builtinId(id: string): string | undefined {
  const l = lc(id);
  return BUILTIN_EQUIPMENT.find(b => lc(b) === l);
}

/** 阻力能不能在动作上改：固定器械、杠铃、自建器材、无器材可以；其余器材锁定 */
export function resistanceSelectable(equipment: string): boolean {
  const b = builtinId(equipment);
  return !b || b === EQ_MACHINE || b === EQ_BARBELL;
}

/** 杠铃只在「挂片 / 固定杠铃」之间选：焊死的成品杠也是杠铃，没有别的阻力 */
const BARBELL_CHOICES: Resistance[] = ['plates', 'fixedBar'];

/** 这件器材在动作上能选的阻力（按选项顺序） */
export function resistanceChoices(equipment: string): Resistance[] {
  return builtinId(equipment) === EQ_BARBELL ? BARBELL_CHOICES : RESISTANCES;
}

/** 器材的默认阻力。自建器材看它自己设的，没设 / 已删 → 不计重 */
export function defaultResistance(equipment: string, defs: EquipmentDefs): Resistance {
  if (!equipment) return 'none';
  const b = builtinId(equipment);
  if (b) return BUILTIN_DEFAULT[b];
  const ct = defs.find(t => t.category === 'equipment' && lc(t.id) === lc(equipment));
  return ct?.resistance ?? 'none';
}

/** 实际生效的阻力：锁定的器材一律用器材的；可选的用动作上写的，没写用默认 */
export function effectiveResistance(
  equipment: string,
  resistance: Resistance | undefined,
  defs: EquipmentDefs,
): Resistance {
  if (!resistanceSelectable(equipment)) return defaultResistance(equipment, defs);
  if (resistance && !resistanceChoices(equipment).includes(resistance)) return defaultResistance(equipment, defs);
  return resistance ?? defaultResistance(equipment, defs);
}

/* ── 旧数据换算 ── */

/** 旧的「挂片式器械」名单：标签是器械 / 杠铃，实际往上挂片。只在换算旧 tags 时用 */
const LEGACY_PLATE_LOADED = new Set(['bp_smith', 'bp_incline_smith', 'ohp_smith', 'leg_press', 'hack_squat', 'tbar_row']);

/**
 * 旧 tags（多选）→ 单个器材 + 阻力。规则保证画法与旧的 loadKindFromTags 一致：
 * - 带「自重」的：阻力 = 自重（旧逻辑里自重标签默认开带正负负荷）；器材取器械（罗马椅、提踵机），否则自重
 * - 其余按「杠铃 > 绳索 > 器械 > 哑铃 > 自建」取第一个（旧逻辑带绳索就按龙门架那一档）；
 *   旧挂片器械名单上的 → 器械 + 杠铃片
 * - 场地 / 球类丢掉
 */
export function legacyAttrs(tags: readonly string[] | undefined, defId?: string): { equipment: string; resistance?: Resistance } {
  const t = (tags ?? []).filter(x => x && !RETIRED_TAGS.has(lc(x)));
  const has = (id: string) => t.some(x => lc(x) === lc(id));
  const custom = t.find(x => !builtinId(x));
  if (has(EQ_BODYWEIGHT)) {
    if (has(EQ_MACHINE)) return { equipment: EQ_MACHINE, resistance: 'bodyweight' };
    return { equipment: EQ_BODYWEIGHT };
  }
  // 旧规则里名单上的动作不管标签写什么都按挂片器械画
  if (defId && LEGACY_PLATE_LOADED.has(defId)) return { equipment: EQ_MACHINE, resistance: 'plates' };
  for (const id of [EQ_BARBELL, EQ_CABLE, EQ_MACHINE, EQ_DUMBBELL]) if (has(id)) return { equipment: id };
  return { equipment: custom ?? '' };
}

type AttrLayer = Pick<ExerciseDefinition, 'equipment' | 'resistance' | 'tags'>;

/** 一层数据（定义 / 覆盖层）上的器材与阻力；这一层没写过 → null（跟下一层） */
export function layerAttrs(layer: Partial<AttrLayer> | undefined, defId?: string): { equipment: string; resistance?: Resistance } | null {
  if (!layer) return null;
  if (layer.equipment !== undefined) return { equipment: layer.equipment, resistance: layer.resistance };
  if (layer.tags !== undefined) return legacyAttrs(layer.tags, defId);
  return null;
}

/** 做法的器材：写了用自己的（新字段或旧 tags），'' / 没写 = 跟动作走 */
export function variantAttrs(v: ExerciseVariant | undefined): { equipment: string; resistance?: Resistance } | null {
  if (!v) return null;
  if (v.equipment) return { equipment: v.equipment, resistance: v.resistance };
  if (v.equipment === undefined && v.tags?.length) {
    const a = legacyAttrs(v.tags);
    return a.equipment ? a : null;
  }
  return null;
}

/**
 * 动作的做法表 = 覆盖层 / 自建定义里写的 + 内置做法（读时合并，不写迁移）。
 *
 * 多器材的内置动作拆出了内置做法（罗马尼亚硬拉 · 哑铃）。用户给内置动作建过做法时，覆盖层里那张表
 * 会把定义上的整张盖住，所以这里补回来：
 * - 覆盖层里已有同 id 的：用覆盖层的（改过名 / 细分）
 * - 已有同名做法（早先按 10-18 的规则自己拆过「哑铃」）：认它，没设器材的补上内置的器材，不再加一个
 * - 用户删掉过的（removed 里有）：不补
 * 不写迁移，是因为迁移要么推进时间戳（偏好落后的设备会把旧内容当新的推上去），要么每台设备各自写，
 * 读时合并两头都没有这些问题（同 cableTagMigration.ts 的取舍）。
 */
export function combineVariants(
  builtin: ExerciseVariant[] | undefined,
  own: ExerciseVariant[] | undefined,
  removed: readonly string[] | undefined,
  nameOf: (equipment: string) => string[],
): ExerciseVariant[] | undefined {
  if (!own) return builtin;
  if (!builtin?.length) return own;
  let list = own;
  for (const b of builtin) {
    if (list.some(v => v.id === b.id) || removed?.includes(b.id)) continue;
    const names = nameOf(b.equipment ?? '');
    const same = list.findIndex(v => names.includes((v.name || '').trim()));
    if (same >= 0) {
      if (!variantAttrs(list[same])) {
        list = list.map((v, i) => (i === same ? { ...v, equipment: b.equipment } : v));
      }
      continue;
    }
    list = [...list, b];
  }
  return list;
}

/* ── 细分（2026-10-21 起多选，次要细分可以跨部位）── */

/**
 * 一个动作 / 做法的全部细分，主细分在前。主细分以 region 为准（旧字段，拖到细分只改它），
 * regions 里别的当次要细分；没有 region 就是未细分。
 * 主细分属于动作自己的部位（决定细分格里摆在哪一列）；次要细分可以是别的部位的
 * （硬拉：下背 + 臀 + 腿后侧，2026-10-21 用户定）。
 */
export function regionList(x: { region?: string; regions?: string[] } | undefined): string[] {
  const p = x?.region;
  if (!p) return [];
  return [p, ...new Set((x.regions ?? []).filter(r => r && r !== p))];
}

/**
 * 细分选择器里点一下：没选的加上，选着的去掉。own＝动作自己部位下的细分（不传＝全算自己的）。
 * - 自己部位的永远排在别的部位前面，所以第一个（主细分）一定是自己部位的
 * - 还没选自己部位的细分时，别的部位的点不上（没有主细分，次要的挂不住）
 * - 自己部位的最后一个去不掉（要清空点「未细分」，别的部位的一起清）
 */
export function toggleRegion(list: readonly string[], id: string, own?: readonly string[]): string[] {
  const isOwn = (r: string) => !own || own.includes(r);
  const mine = list.filter(isOwn);
  const other = list.filter(r => !isOwn(r));
  if (!list.includes(id)) {
    if (isOwn(id)) return [...mine, id, ...other];
    return mine.length ? [...mine, ...other, id] : [...list];
  }
  if (isOwn(id) && mine.length <= 1) return [...list];
  return list.filter(r => r !== id);
}

/** 写入用：主细分 + 全部（空表＝未细分） */
export function regionsPatch(list: readonly string[]): { region: string; regions: string[] } {
  const l = [...new Set(list.filter(Boolean))];
  return { region: l[0] ?? '', regions: l };
}

/**
 * 拖到另一列（换主细分）：原来就是次要细分的提到最前；不是的顶替原来的主细分（拖走＝不在那一列了），
 * 次要的留着。拖回未细分＝全清。
 */
export function movePrimary(list: readonly string[], target: string): string[] {
  if (!target) return [];
  if (list.includes(target)) return [target, ...list.filter(r => r !== target)];
  return [target, ...list.slice(1)];
}

/** 写入用：新字段 + 给旧版 APK 的镜像 */
export function attrsPatch(equipment: string, resistance: Resistance | undefined) {
  return {
    equipment,
    // 锁定的器材不存；能选的也只存这件器材选得到的（杠铃只有杠铃片 / 固定杠铃）
    resistance: resistanceSelectable(equipment) && (!resistance || resistanceChoices(equipment).includes(resistance)) ? resistance : undefined,
    tags: equipment ? [equipment] : [],
  };
}
