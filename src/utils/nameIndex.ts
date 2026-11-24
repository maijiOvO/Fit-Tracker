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
 * 四轮登记、先到先得：现名（覆盖层）→ 原名（中英）→ 已并入动作的全部名字（归并入目标）→ 曾用名。
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
  for (const d of defs) {
    put(d.name.cn, d);
    put(d.name.en, d);
  }
  // 并进来的名字排在还在库里的动作的原名之后：被并入的动作的原名 / 曾用名撞上别人的原名时归还在库里的那个
  //（真实数据：改过名的「曲肘蝴蝶机」原名悍马卧推，并进别处后不能把另一个「悍马卧推」的历史带走）
  const live = new Map(defs.map(d => [d.id, d]));
  for (const d of merged) {
    // 连环并入（A→B 之后 B→C）：A 只记着 B，沿链走到还在库里的那个；成环（数据坏了）就不登记
    let target: ExerciseDefinition | undefined;
    const seen = new Set<string>();
    for (let id = exerciseOverrides[d.id]?.mergedInto; id && !seen.has(id); id = exerciseOverrides[id]?.mergedInto) {
      seen.add(id);
      target = live.get(id);
      if (target) break;
    }
    if (!target) continue;
    const over = exerciseOverrides[d.id];
    for (const n of [over?.name?.cn, over?.name?.en, d.name.cn, d.name.en, ...(d.aliases ?? []), ...(over?.aliases ?? [])]) {
      put(n, target);
    }
  }
  for (const d of defs) {
    for (const a of d.aliases ?? []) put(a, d);
    for (const a of exerciseOverrides[d.id]?.aliases ?? []) put(a, d);
  }
  return m;
}

/**
 * 按名字查的普通对象只认自有键（上架审查 C09）：动作名恰好是 constructor / toString 时，`obj[name]` 读到的是继承来的函数，
 * getActiveMetrics 拿它当数组 .includes 就崩，而且首页、训练页、我的、目标每次打开都崩。
 * 不用 Object.hasOwn：它从 Chrome 93 才有，旧 WebView 上每页都会崩。
 */
export function ownValue<T>(obj: Record<string, T> | undefined, key: string): T | undefined {
  return obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

/**
 * 原键 → 显示名归并（备注 / 收藏 / 记录项三张表）。同一动作有多个原键时，键名正好等于显示名的那个说了算。
 * 结果是没有原型的对象：查 constructor 得到 undefined，名字是 __proto__ 也只是普通的自有键（C09）。
 */
export function byDisplayName<T>(raw: Record<string, T>, resolveName: (name: string) => string): Record<string, T> {
  const out: Record<string, T> = Object.create(null);
  for (const [k, v] of Object.entries(raw)) {
    const d = resolveName(k);
    if (!(d in out) || k === d) out[d] = v;
  }
  return out;
}
