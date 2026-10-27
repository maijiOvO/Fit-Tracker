/**
 * 热身从「各部位的第一个细分」改成动作自己的「热身用途」（2026-10-27 用户定），幂等、可以反复跑。
 *
 * 来历：2.4 起每个部位第一列是热身细分（chestWarm …）。热身放在细分层有两个毛病：大多数部位这一列是空的，
 * 白占一列；同一个热身动作（手臂绕环）挂不到几个部位上。现在热身是动作上的 warmParts（出现在哪几个部位的
 * 热身里）+ warmOnly（只当热身、不是训练动作），热身细分整个删掉。
 *
 * 规则：
 * - 动作的细分里有热身细分：摘掉，它所属的部位并进 warmParts。
 * - 主细分就是热身细分：剩下的细分里第一个属于自己部位的顶上来当主；没有就只当热身（warmOnly），细分清空。
 * - 做法自己的热身细分直接摘掉（做法不单独当热身，跟动作走）。
 * - 细分布局（regionLayout 的 order / hidden）和改名里的热身细分 id 一并删掉。
 *
 * 不改任何时间戳，理由同 cableTagMigration：每台设备读到偏好时就地做，哪一份旧数据先到都一样。
 */
import { BODY_REGIONS, DEFAULT_EXERCISES } from '../constants/exercises';
import type { ExerciseDefinition, ExerciseVariant } from '../../types';
import type { CustomTag } from '../contexts/ExercisePrefsContext';

/** 删掉的热身细分 → 它所属的部位 */
export const WARM_REGION_PART: Record<string, string> = {
  chestWarm: 'subChest',
  shWarm: 'subShoulder',
  backWarm: 'subBack',
  armWarm: 'subArms',
  legWarm: 'subLegs',
  coreWarm: 'subCore',
};
const isWarm = (r: string | undefined) => !!r && r in WARM_REGION_PART;

type Def = Partial<ExerciseDefinition>;

export interface WarmRegionPrefs {
  customExercises?: ExerciseDefinition[];
  exerciseOverrides?: Record<string, Def>;
  customTags?: CustomTag[];
  tagRenameOverrides?: Record<string, string>;
}

function fixVariants(vs: ExerciseVariant[] | undefined): ExerciseVariant[] | undefined {
  if (!Array.isArray(vs)) return vs;
  let changed = false;
  const next = vs.map(v => {
    if (!isWarm(v.region) && !(v.regions ?? []).some(isWarm)) return v;
    changed = true;
    const regions = (v.regions ?? []).filter(r => !isWarm(r));
    return { ...v, region: isWarm(v.region) ? regions[0] ?? '' : v.region, regions };
  });
  return changed ? next : vs;
}

/** ownRegion：这个动作自己部位下的细分（主细分只能是它们） */
function fixDef<D extends Def>(d: D, ownRegion: (r: string) => boolean): D {
  const all = [d.region, ...(d.regions ?? [])].filter((r): r is string => !!r);
  const warmIds = all.filter(isWarm);
  const variants = fixVariants(d.variants);
  if (!warmIds.length) return variants === d.variants ? d : { ...d, variants };

  const parts = [...new Set([...(d.warmParts ?? []), ...warmIds.map(r => WARM_REGION_PART[r])])];
  const rest = [...new Set((d.regions ?? (d.region ? [d.region] : [])).filter(r => r && !isWarm(r)))];
  const out: D = { ...d, warmParts: parts };
  if (isWarm(d.region)) {
    const primary = rest.find(ownRegion);
    out.region = primary ?? '';
    out.regions = primary ? [primary, ...rest.filter(r => r !== primary)] : [];
    if (!primary) out.warmOnly = true;
  } else {
    out.regions = rest;
  }
  if (variants !== d.variants) out.variants = variants;
  return out;
}

/**
 * 返回迁移后的偏好；没有要改的返回同一个对象（调用方用 `!==` 判断要不要写回）。
 * 只看 customExercises / exerciseOverrides / customTags / tagRenameOverrides，其余字段原样带过。
 */
export function migrateWarmRegions<P extends WarmRegionPrefs>(p: P): P {
  const tags = Array.isArray(p.customTags) ? p.customTags : [];
  const customRegionsOf = (part: string) => tags.filter(t => t.category === 'region' && t.parentPart === part).map(t => t.id);
  const ownOf = (part: string | undefined) => {
    const own = new Set([...(BODY_REGIONS[part ?? ''] ?? []), ...customRegionsOf(part ?? '')]);
    return (r: string) => own.has(r);
  };
  const builtinPart = new Map(DEFAULT_EXERCISES.map(d => [d.id, d.bodyPart]));
  const customs = Array.isArray(p.customExercises) ? p.customExercises : undefined;
  const customPart = new Map((customs ?? []).map(d => [d.id, d.bodyPart]));
  let changed = false;

  let nextCustoms = customs;
  if (customs) {
    const mapped = customs.map(d => fixDef(d, ownOf(p.exerciseOverrides?.[d.id]?.bodyPart ?? d.bodyPart)));
    if (mapped.some((d, i) => d !== customs[i])) {
      nextCustoms = mapped;
      changed = true;
    }
  }

  let nextOverrides = p.exerciseOverrides;
  if (p.exerciseOverrides && typeof p.exerciseOverrides === 'object') {
    let ovChanged = false;
    const out: Record<string, Def> = {};
    for (const [id, ov] of Object.entries(p.exerciseOverrides)) {
      const f = ov && typeof ov === 'object' ? fixDef(ov, ownOf(ov.bodyPart ?? builtinPart.get(id) ?? customPart.get(id))) : ov;
      if (f !== ov) ovChanged = true;
      out[id] = f;
    }
    if (ovChanged) {
      nextOverrides = out;
      changed = true;
    }
  }

  let nextTags = p.customTags;
  if (tags.some(t => t.category === 'regionLayout' && [...(t.order ?? []), ...(t.hidden ?? [])].some(isWarm))) {
    nextTags = tags.map(t =>
      t.category === 'regionLayout'
        ? { ...t, ...(t.order ? { order: t.order.filter(r => !isWarm(r)) } : {}), ...(t.hidden ? { hidden: t.hidden.filter(r => !isWarm(r)) } : {}) }
        : t,
    );
    changed = true;
  }

  let nextRenames = p.tagRenameOverrides;
  if (p.tagRenameOverrides && typeof p.tagRenameOverrides === 'object' && Object.keys(p.tagRenameOverrides).some(isWarm)) {
    nextRenames = Object.fromEntries(Object.entries(p.tagRenameOverrides).filter(([k]) => !isWarm(k)));
    changed = true;
  }

  if (!changed) return p;
  return {
    ...p,
    ...(nextCustoms !== p.customExercises ? { customExercises: nextCustoms } : {}),
    ...(nextOverrides !== p.exerciseOverrides ? { exerciseOverrides: nextOverrides } : {}),
    ...(nextTags !== p.customTags ? { customTags: nextTags } : {}),
    ...(nextRenames !== p.tagRenameOverrides ? { tagRenameOverrides: nextRenames } : {}),
  };
}
