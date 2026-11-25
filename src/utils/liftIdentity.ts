/**
 * 读取时的动作身份（上架审查第 17 批）：一条记录算哪个动作、哪个做法。
 *
 * 「并入」只在读的时候起作用（历史一条不改）：名字索引把源动作的名字交给目标（nameIndex），
 * variantAliases 把源的名字指到并入生成的那个做法。凡是绕开这两步、另存一份身份的地方都会失联，
 * 所以纪录、liftKey、stableId、馆设置键、底稿、目标和特别关注都从这里取口径。
 * 全是纯函数，ExercisePrefsContext 只负责把当前的动作库绑进来。
 */
import type { Exercise, ExerciseVariant } from '../../types';
import { ownValue } from './nameIndex';
import type { LastHit } from './prefillSource';

/**
 * 源动作自己的做法在并入之后的 id：「并入做法 id/源做法 id」。
 * 不拆开的话，源的「宽握」和目标自己的「宽握」拼出同一个 liftKey，纪录混算（审查 C33#5）。
 * 做法 id 是 `v_时间戳` 或内置的 `eq_xx`，不含「/」；馆设置键按「|」切，也不受它影响。
 */
const NS = '/';

/** 命名空间 id 的前半段（并入做法）；普通 id 原样返回 */
export function variantHead(vid: string): string {
  const i = vid.indexOf(NS);
  return i < 0 ? vid : vid.slice(0, i);
}

/**
 * 一条记录的做法 id。aliases：记录名所属动作的 variantAliases；known：那个动作认得的做法 id（现有的 + 墓碑）。
 * 记录名是并入别名又自带一个目标不认得的 variantId（源自己的做法）→ 命名空间 id；其余照旧：
 * 记录上写了就用，没写按别名认，标准返回 undefined。
 */
export function variantIdIn(
  ex: { name: string; variantId?: string },
  aliases: Record<string, string> | undefined,
  known: readonly { id: string }[],
): string | undefined {
  const alias = (aliases && ownValue(aliases, (ex.name || '').trim())) || undefined;
  if (!ex.variantId) return alias;
  if (alias && !known.some(v => v.id === ex.variantId)) return `${alias}${NS}${ex.variantId}`;
  return ex.variantId;
}

/**
 * 做法 id → 显示名。variants：现有的做法（已补好内置做法的名字）；deleted：做法墓碑。
 * 现有的优先，被删的取墓碑里删时的名字，再退回记录上当时的名字（老数据没有墓碑）。
 * 命名空间 id 显示「并入做法名 · 记录上的做法名」。
 */
export function variantLabelIn(
  ex: { variantName?: string },
  vid: string | undefined,
  variants: readonly ExerciseVariant[],
  deleted: readonly ExerciseVariant[] | undefined,
): string {
  if (!vid) return '';
  const nameOf = (id: string) => variants.find(v => v.id === id)?.name || deleted?.find(v => v.id === id)?.name || '';
  const head = variantHead(vid);
  if (head !== vid) return [nameOf(head), ex.variantName || ''].filter(Boolean).join(' · ');
  return nameOf(vid) || ex.variantName || '';
}

/** 做法 id 对应的那一条（取器材 / 阻力用）：命名空间 id 按前半段的并入做法；被删的从墓碑里找 */
export function variantEntryIn(
  vid: string | undefined,
  variants: readonly ExerciseVariant[] | undefined,
  deleted: readonly ExerciseVariant[] | undefined,
): ExerciseVariant | undefined {
  if (!vid) return undefined;
  const id = variantHead(vid);
  return variants?.find(v => v.id === id) ?? deleted?.find(v => v.id === id);
}

/** 稳定键「定义 id|做法 id」；库里没有的名字退回「name:项目键」 */
export function stableIdIn(defId: string | undefined, vid: string | undefined, liftKey: string): string {
  return defId ? `${defId}|${vid ?? ''}` : `name:${liftKey}`;
}

/**
 * 目标 / 特别关注里存的旧稳定键 → 现在的稳定键（审查 C30）。读时规范化，不改写存的值：
 *   - 「name:X」：X 后来进了动作库（补建成自建动作）→ 按 X 现算；
 *   - 「源 id|v」：源已并入别处 → 拿源的一个并入别名当记录名现算（连环并入沿链找目标，名字索引已经做了）；
 *   - 其余原样。
 * mergedOf：已并入别处的动作的全部名字（没并入返回 undefined）；isAlias：这个名字现在是不是并入别名。
 */
export function canonicalLiftIdIn(
  key: string,
  o: {
    stableIdOf: (ex: { name: string; variantId?: string }) => string;
    known: (name: string) => boolean;
    mergedNamesOf: (defId: string) => string[] | undefined;
    isAlias: (name: string) => boolean;
  },
): string {
  if (key.startsWith('name:')) {
    const n = key.slice('name:'.length);
    return o.known(n) ? o.stableIdOf({ name: n }) : key;
  }
  const i = key.indexOf('|');
  if (i < 0) return key;
  const names = o.mergedNamesOf(key.slice(0, i));
  const n = names?.find(o.isAlias);
  if (!n) return key;
  const v = key.slice(i + 1);
  return o.stableIdOf(v ? { name: n, variantId: v } : { name: n });
}

/**
 * 新卡的名字、做法和底稿来源（审查 gap-2#1、gap-2#4）。加动作、计划开练、交替搭档、复制为今天同一个口径：
 *   - 名字是并入别名：卡名换成目标现名，做法显式写成别名推出的那个，底稿按这个做法找；
 *   - 上一条的做法已经不在做法表里（被删，或是命名空间 id）：按标准铺，底稿改抄标准的上一次。
 * 底稿仍按做法 id 找、不借别的做法的数（useWorkoutMutations 的既定规则）。
 */
export function cardSourceFor(o: {
  name: string;
  /** 调用方指定的做法（弹层里点的那个，'' = 标准）；不指定按上一次 */
  variantId?: string;
  aliasOf: (name: string) => string | undefined;
  resolveName: (name: string) => string;
  /** 这个做法 id 还在做法表里 */
  live: (vid: string) => boolean;
  /** null＝不分做法，''＝标准 */
  findLast: (vid: string | null) => LastHit | null;
  variantIdOf: (ex: Exercise) => string | undefined;
}): { name: string; variantId?: string; last: LastHit | null } {
  const alias = o.aliasOf(o.name);
  const name = alias ? o.resolveName(o.name) : o.name;
  // 指定的做法（'' = 标准）不查表：弹层里刚建的做法这一刻还没进状态
  if (o.variantId !== undefined) return { name, ...(o.variantId ? { variantId: o.variantId } : {}), last: o.findLast(o.variantId) };
  if (alias) return o.live(alias) ? { name, variantId: alias, last: o.findLast(alias) } : { name, last: o.findLast('') };
  const last = o.findLast(null);
  const vid = last ? o.variantIdOf(last.ex) : undefined;
  if (vid && !o.live(vid)) return { name, last: o.findLast('') };
  return { name, ...(vid ? { variantId: vid } : {}), last };
}

/**
 * 换做法时卡片自己的身份（switchExerciseVariant 抽出来的那一段）：卡名是并入别名时一并换成目标现名，
 * 不然选「标准」也会被别名认回并入的那个做法（审查 gap-2#1①）。
 */
export function switchedCardIdentity(
  ex: { name: string },
  variantId: string | undefined,
  aliasOf: (name: string) => string | undefined,
  resolveName: (name: string) => string,
): { name: string; variantId?: string } {
  const name = aliasOf(ex.name) ? resolveName(ex.name) : ex.name;
  return variantId ? { name, variantId } : { name };
}

/**
 * 改名查重（审查 gap-2#1③）：和别的动作的现名 / 曾用名重名；或者是并进自己的旧动作的名字
 * —— 名字索引认它是自己，可改过去以后拆回，那个旧动作就和它同名了。
 */
export function renameClashIn(
  next: string,
  exerciseId: string,
  clashId: string | undefined,
  ownAliases: Record<string, string> | undefined,
): boolean {
  if (clashId && clashId !== exerciseId) return true;
  return !!(ownAliases && ownValue(ownAliases, next));
}
