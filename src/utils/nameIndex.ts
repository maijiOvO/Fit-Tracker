/**
 * 动作名字索引：一个动作认得的全部名字 → 定义（ExercisePrefsContext 的 findExerciseDef / resolveName 都查它）。
 */
import type { ExerciseDefinition } from '../../types';

/**
 * 自建动作的稳定次序：id 从新到旧。id 是 Date.now() 的十进制串，按数值比；
 * 不是纯数字的（理论上没有）退到字符串比较，保证次序只由 id 决定、与数组顺序无关。
 */
function newestCustomFirst(a: ExerciseDefinition, b: ExerciseDefinition): number {
  const na = /^\d+$/.test(a.id) ? Number(a.id) : NaN;
  const nb = /^\d+$/.test(b.id) ? Number(b.id) : NaN;
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return nb - na;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * 三轮登记、先到先得：现名（覆盖层）→ 原名（中英）→ 曾用名。
 * 现名优先，是为了曾用名和别的动作现名撞车时，以现名为准。
 *
 * 同一轮里撞名（name-index-order-dependent：真实数据里两个自建动作原名都是「悍马卧推」）
 * 不能看自建列表的数组顺序 —— 「从动作库删除再撤销」会改顺序，历史就整批换了主人。
 * 规则写死：内置在前（常量顺序），自建按 id 从新到旧（id 是创建时刻）。
 * 选「新到旧」是因为自建列表一直是新建插在最前，现存数据的解析结果因此一个都不变。
 */
export function buildNameIndex(
  builtins: ExerciseDefinition[],
  customExercises: ExerciseDefinition[],
  exerciseOverrides: Record<string, Partial<ExerciseDefinition>>,
): Map<string, ExerciseDefinition> {
  const m = new Map<string, ExerciseDefinition>();
  const all = [...builtins, ...[...customExercises].sort(newestCustomFirst)];
  // 已并入别的动作的：名字全交给那个动作（mergeExerciseInto），自己不再登记
  const merged = all.filter(d => exerciseOverrides[d.id]?.mergedInto);
  const defs = all.filter(d => !exerciseOverrides[d.id]?.mergedInto);
  const put = (n: string | undefined, d: ExerciseDefinition) => {
    const k = (n || '').trim();
    if (k && !m.has(k)) m.set(k, d);
  };
  for (const d of defs) {
    const over = exerciseOverrides[d.id];
    put(over?.name?.cn, d);
    put(over?.name?.en, d);
  }
  for (const d of merged) {
    const target = defs.find(x => x.id === exerciseOverrides[d.id]?.mergedInto);
    if (!target) continue;
    const over = exerciseOverrides[d.id];
    for (const n of [over?.name?.cn, over?.name?.en, d.name.cn, d.name.en, ...(d.aliases ?? []), ...(over?.aliases ?? [])]) {
      put(n, target);
    }
  }
  for (const d of defs) {
    put(d.name.cn, d);
    put(d.name.en, d);
  }
  for (const d of defs) {
    for (const a of d.aliases ?? []) put(a, d);
    for (const a of exerciseOverrides[d.id]?.aliases ?? []) put(a, d);
  }
  return m;
}
