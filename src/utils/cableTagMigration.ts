/**
 * 「健身房器材」→「龙门架」的一次性纠正（2026-10-20 用户定），可以反复跑。
 *
 * 来历：`tagGym`（健身房器材）原本是给跑步机、单车这类有氧器械的通用标签。用户把它的显示名改成了
 * 「龙门架」，之后自建的龙门架动作、以及在动作设置里改过器材的内置龙门架动作，都标成了 `tagGym`。
 * 而负荷判断（useLoadKind 的 loadKindFromTags）只认 `tagCable`，于是这些动作全被当成纯数字：
 * 馆档案取整、一档多重、插销 / 挂片、按馆比纪录统统不生效，界面上也看不出原因。
 *
 * 规则（只动力量动作，有氧的 `tagGym` 是它本来的用法，不碰）：
 * - 标签里有 `tagGym`：去掉它；去掉后没有别的器材标签（杠铃 / 哑铃 / 器械 / 龙门架 / 自重）就补 `tagCable`。
 *   所以「器械 + 健身房器材」（高位下拉、蝴蝶机）只是去掉多余的那个，仍按器械算。
 * - 做法自己的标签同样处理；空数组（跟随动作）保持空。
 * - 标签改名里把 `tagGym` 改成「龙门架」的那条删掉：「健身房器材」恢复原名，龙门架由 `tagCable` 自己叫。
 *
 * 不改任何时间戳。迁移在每台设备读到偏好时就地做（本机启动、拉远端），所以哪一份旧数据先到都一样；
 * 若在这里推进时间戳，一台偏好落后的设备迁移完反而会以「更新」的身份把旧内容推上去。
 */
import { DEFAULT_EXERCISES } from '../constants/exercises';
import type { ExerciseDefinition } from '../../types';

const GYM = 'tagGym';
const CABLE = 'tagCable';
/** 能说明「这个动作用什么器材」的标签；有其中之一就不需要补龙门架 */
const GEAR = new Set(['tagBarbell', 'tagDumbbell', 'tagMachine', 'tagCable', 'tagBodyweight']);

type Def = Partial<ExerciseDefinition>;

export interface CableTagPrefs {
  customExercises?: ExerciseDefinition[];
  exerciseOverrides?: Record<string, Def>;
  tagRenameOverrides?: Record<string, string>;
}

function fixTags(tags: string[] | undefined): string[] | undefined {
  if (!Array.isArray(tags) || !tags.includes(GYM)) return tags;
  const rest = tags.filter(t => t !== GYM);
  return rest.some(t => GEAR.has(t)) ? rest : [...rest, CABLE];
}

function fixVariants<V extends { tags?: string[] }>(variants: V[] | undefined): V[] | undefined {
  if (!Array.isArray(variants)) return variants;
  let changed = false;
  const next = variants.map(v => {
    const t = fixTags(v.tags);
    if (t === v.tags) return v;
    changed = true;
    return { ...v, tags: t };
  });
  return changed ? next : variants;
}

/** 覆盖层 / 自建定义里的类别优先，其次内置定义；都没写按力量算（和全站的默认一致） */
function isCardioLike(category: string | undefined): boolean {
  return !!category && category !== 'STRENGTH';
}

function fixDef<D extends Def>(d: D, cardio: boolean): D {
  if (cardio) return d;
  const tags = fixTags(d.tags);
  const variants = fixVariants(d.variants as { tags?: string[] }[] | undefined);
  if (tags === d.tags && variants === d.variants) return d;
  return { ...d, ...(tags !== d.tags ? { tags } : {}), ...(variants !== d.variants ? { variants } : {}) };
}

/**
 * 返回纠正后的偏好；没有要改的返回同一个对象（调用方用 `!==` 判断要不要写回）。
 * 只看 customExercises / exerciseOverrides / tagRenameOverrides 三项，其余字段原样带过。
 */
export function migrateCableTags<P extends CableTagPrefs>(p: P): P {
  const builtinCat = new Map(DEFAULT_EXERCISES.map(d => [d.id, d.category]));
  const customs = Array.isArray(p.customExercises) ? p.customExercises : undefined;
  const customCat = new Map((customs ?? []).map(d => [d.id, d.category]));

  let changed = false;

  let nextCustoms = customs;
  if (customs) {
    const mapped = customs.map(d => {
      const ov = p.exerciseOverrides?.[d.id];
      const f = fixDef(d, isCardioLike(ov?.category ?? d.category));
      if (f !== d) changed = true;
      return f;
    });
    if (changed) nextCustoms = mapped;
  }

  let nextOverrides = p.exerciseOverrides;
  if (p.exerciseOverrides && typeof p.exerciseOverrides === 'object') {
    let ovChanged = false;
    const out: Record<string, Def> = {};
    for (const [id, ov] of Object.entries(p.exerciseOverrides)) {
      const cat = ov?.category ?? builtinCat.get(id) ?? customCat.get(id);
      const f = ov && typeof ov === 'object' ? fixDef(ov, isCardioLike(cat)) : ov;
      if (f !== ov) ovChanged = true;
      out[id] = f;
    }
    if (ovChanged) {
      nextOverrides = out;
      changed = true;
    }
  }

  let nextRenames = p.tagRenameOverrides;
  if (p.tagRenameOverrides && typeof p.tagRenameOverrides === 'object' && GYM in p.tagRenameOverrides) {
    const v = (p.tagRenameOverrides[GYM] || '').trim();
    if (v === '龙门架' || /^cable/i.test(v)) {
      const { [GYM]: _drop, ...rest } = p.tagRenameOverrides;
      nextRenames = rest;
      changed = true;
    }
  }

  if (!changed) return p;
  return {
    ...p,
    ...(nextCustoms !== p.customExercises ? { customExercises: nextCustoms } : {}),
    ...(nextOverrides !== p.exerciseOverrides ? { exerciseOverrides: nextOverrides } : {}),
    ...(nextRenames !== p.tagRenameOverrides ? { tagRenameOverrides: nextRenames } : {}),
  };
}
