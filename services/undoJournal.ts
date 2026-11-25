/**
 * 全局撤销 / 重做（2026-10-25 用户定：去掉各处「撤销」弹窗，换成一对全局按钮，能撤销 / 重做所有改动）。
 *
 * 不在每个功能里各写各的撤销：所有数据最后都落到 IndexedDB（db.ts）和 localStorage（appStorage.ts），
 * 这里在两处的写入口记下「写之前的样子」和「写之后的样子」，一个用户动作里的全部写入合成一步。
 * 撤销＝把这一步碰过的每一行 / 每个键写回之前的样子；重做＝写回之后的样子。新加的功能不用写任何撤销代码。
 *
 * 分步：
 *   - 手指按下（pointerdown）开新的一步：一次点击、一次横拖、一次拖书签各是一步。
 *   - 打字：同一个输入框里连续打字是一步，换输入框（focusin）才是下一步。
 *   - 没有打开的步时（启动、撤销 / 重做之后、后台定时）发生的写入不记 —— 它们不是用户动作，
 *     撤销之后界面重读、工作台重新落盘那一串回声也就自然不会被记成新的一步。
 *   - 步开着时系统替换了工作台（接回进行中的那场，rebaseSource）：这一步还没动过工作台就挪基线、不记；
 *     动过（「保存修改」/ 返回退出编辑把草稿换成了空场）就算这一步的结果。
 *
 * 工作台那一场（currentWorkout）是 React 状态，编辑旧训练时不进 workouts 表（草稿槽在 backups 表，不记）：
 * 作为「状态源」登记进来，每一步开头记一份引用（状态不可变，引用就是快照），这一步结束时变了就记下前后两份。
 *
 * 只在本机：步数上限 MAX_STEPS，只存在内存里，重启 App 清空；切到后台超过 10 分钟或跨了天再回来也清空（useUndoGestures）。
 * 从服务器拉进来东西、整份改写（恢复备份 / 导入 / 重置）、切换数据环境之后清空 —— 撤销会把那些改动盖掉。
 * 读不到「写之前的样子」的那一步撤不回，撤销历史也截断在这里：更早的步写回的是绝对值，会盖掉这一步对同一行的改动（和整份改写后清空是同一个理由）。
 *
 * 写回没做成（存储写不进 / 超时）：这一步留在原栈不动，库里的行在一个事务里要么全写要么全不写；写回的是绝对值，再按一次就能写完。
 */

const MAX_STEPS = 50;

/**
 * 撤销 / 重做时等「还在路上的写入」、等前像读回、等写回，各自最多等这么久，超时按没做成处理。
 * 写回期间 App 盖着挡板（state.busy）：db.ts 开库没处理 onblocked，写入可能一直落不了地，不设上限整个 App 会一直点不动。
 */
const APPLY_TIMEOUT_MS = 10_000;

/** 进日志的 localStorage 键（用户数据 / 同步首选项）；各个 *_last_update 时间戳不进，撤销之后统一改成现在 */
const JOURNALED_KEYS = new Set([
  'fitlog_custom_tags',
  'fitlog_custom_exercises',
  'fitlog_exercise_notes',
  'fitlog_exercise_overrides',
  'fitlog_metric_configs',
  'fitlog_metric_auto',
  'fitlog_starred_exercises',
  'fitlog_tag_rename_overrides',
  'fitlog_unit',
  'fitlog_lang',
  'fitlog_avatar_data_url',
  'fitlog_current_user',
  'fitlog_app_prefs',
  'fitlog_tombstones',
  'fitlog_active_workout',
]);

/** 撤销之后改成「现在」的时间戳：同步合并按它们判谁新，撤销回来的那份得赢 */
const PREF_TIMESTAMP_KEYS = [
  'fitlog_prefs_last_update',
  'fitlog_metrics_last_update',
  'fitlog_starred_last_update',
  'fitlog_app_prefs_last_update',
];

type Row = { id: string } & Record<string, unknown>;

/** 一行（或一个键）在这一步里的前后两份；undefined＝不存在 */
interface Change<T> {
  before: T | undefined;
  after: T | undefined;
  /** 前像读完（行要异步读；同一行的后续写入也得等它，免得先写后读把写之后的样子当成前像） */
  ready?: Promise<void>;
  /** pending＝前像还在读；unknown＝读失败（db.ts 已重试过）。before 是 undefined 时只有不带标记才表示「原来没有」 */
  read?: 'pending' | 'unknown';
}

interface Step {
  label: string;
  /** store → id → 前后 */
  rows: Map<string, Map<string, Change<Row>>>;
  /** localStorage 键（不带环境前缀）→ 前后 */
  keys: Map<string, Change<string>>;
  /** 状态源名 → 前后 */
  sources: Map<string, Change<unknown>>;
  /** 开步时各状态源的值（结束时比引用） */
  sourceStart: Map<string, unknown>;
  /** 同一时刻的深拷贝：工作台还有原地改对象的地方（set-update-mutates-shared-objects），引用里的内容会被改掉 */
  sourceCopy: Map<string, unknown>;
}

const copy = <T>(v: T): T => {
  try {
    return structuredClone(v);
  } catch {
    return v;
  }
};

export interface StateSource {
  get: () => unknown;
  set: (value: unknown) => void;
}

/** 写回存储的底层通道（db.ts 注册行、appStorage.ts 注册键，不经过日志） */
export interface RawIo {
  getRow: (store: string, id: string) => Promise<Row | undefined>;
  getAllRows: (store: string) => Promise<Row[]>;
  /** 一批行在一个事务里写完（row＝undefined 表示删掉）：要么全写要么全不写 */
  writeRows: (ops: RowOp[]) => Promise<void>;
  getKey: (key: string) => string | null;
  /** 写不进去返回 false */
  setKey: (key: string, value: string | null) => boolean;
}

export type RowOp = { store: string; id: string; row: Row | undefined };

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  /** 正在写回：界面据此挡住输入，免得写回收尾时把这段时间里的改动盖掉 */
  busy: boolean;
}

/** 撤销 / 重做之后发给界面的消息：重读哪些表、哪些状态源变了 */
export interface UndoApplied {
  direction: 'undo' | 'redo';
  /** done＝做完；failed＝写回没做成，这一步还在原栈；blocked＝读不到前像，整步撤不回，更早的历史已清掉 */
  outcome: 'done' | 'failed' | 'blocked';
  label: string;
  stores: string[];
  keys: string[];
  sources: Record<string, { from: unknown; to: unknown }>;
}

const undoStack: Step[] = [];
const redoStack: Step[] = [];
let current: Step | null = null;
/** 正在写回（撤销 / 重做 / 系统写入）：写入口不记 */
let suppressed = 0;
/** 还在路上的写入：撤销要等它们落下，否则后落下的会把写回的样子又盖掉 */
const inflight = new Set<Promise<unknown>>();
const sources = new Map<string, StateSource>();
const listeners = new Set<() => void>();
let io: RawIo | null = null;
let busy = false;
/** clear() 一次加一：写回期间被清空过，收尾时就不再把这一步挪到另一个栈 */
let generation = 0;

const emptyStep = (label: string): Step => ({
  label,
  rows: new Map(),
  keys: new Map(),
  sources: new Map(),
  sourceStart: new Map([...sources].map(([name, s]) => [name, s.get()])),
  sourceCopy: new Map([...sources].map(([name, s]) => [name, copy(s.get())])),
});

const isEmpty = (s: Step) => !s.rows.size && !s.keys.size && !s.sources.size;

let state: UndoState = { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null, busy: false };

function computeState(): UndoState {
  const live = !!current && !isEmptyLive(current);
  return {
    canUndo: undoStack.length > 0 || live,
    // 开着的这一步有了改动：它收尾时会清掉重做栈，按钮现在就跟着灰（同一步里改了又改回去会暂时灰，下一次开步恢复）
    canRedo: redoStack.length > 0 && !live,
    undoLabel: (live ? current!.label : undoStack[undoStack.length - 1]?.label) || null,
    redoLabel: (live ? null : redoStack[redoStack.length - 1]?.label) || null,
    busy,
  };
}

/** 状态变了才换对象（useSyncExternalStore 要稳定的快照） */
function notify() {
  const next = computeState();
  if (
    next.canUndo === state.canUndo &&
    next.canRedo === state.canRedo &&
    next.undoLabel === state.undoLabel &&
    next.redoLabel === state.redoLabel &&
    next.busy === state.busy
  ) return;
  state = next;
  for (const fn of listeners) fn();
}

/** 结束当前这一步：状态源比一下引用；非空就进撤销栈（同时清掉重做栈） */
function finalize() {
  const s = current;
  current = null;
  if (!s) return;
  for (const [name, src] of sources) {
    if (!s.sourceStart.has(name)) continue;
    const after = src.get();
    if (s.sourceStart.get(name) !== after) s.sources.set(name, { before: s.sourceCopy.get(name), after: copy(after) });
  }
  // 行 / 键写回了原样（改了又改回去）：不算改动。前像还没读回的行留着，到撤销时再判
  prune(s);
  for (const [key, c] of s.keys) if (c.before === c.after) s.keys.delete(key);
  if (isEmpty(s)) return;
  undoStack.push(s);
  if (undoStack.length > MAX_STEPS) undoStack.shift();
  redoStack.length = 0;
  notify();
}

function prune(s: Step) {
  for (const [store, m] of s.rows) {
    for (const [id, c] of m) if (!c.read && sameRow(c.before, c.after)) m.delete(id);
    if (!m.size) s.rows.delete(store);
  }
}

function sameRow(a: Row | undefined, b: Row | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const strip = ({ updatedAt: _u, ...rest }: Row) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

export const undoJournal = {
  /** db.ts / appStorage.ts 启动时注册底层读写 */
  setIo(raw: Partial<RawIo>) {
    io = { ...(io ?? {}), ...raw } as RawIo;
  },

  /** 工作台那一场之类的 React 状态：撤销时直接 set 回去 */
  registerSource(name: string, src: StateSource) {
    sources.set(name, src);
    current?.sourceStart.set(name, src.get());
    current?.sourceCopy.set(name, copy(src.get()));
    return () => {
      sources.delete(name);
    };
  },

  /**
   * 系统刚把状态源从 prev 换成了现值（接回进行中的那场）：这一步开步以来还没动过它（开步时的值就是 prev）就挪基线、不记；
   * 动过就不处理，接回算这一步的结果 —— 撤销回到编辑草稿，重做回到接回后的那场
   */
  rebaseSource(name: string, prev: unknown) {
    const s = current;
    const src = sources.get(name);
    if (!s || !src || s.sourceStart.get(name) !== prev) return;
    s.sourceStart.set(name, src.get());
    s.sourceCopy.set(name, copy(src.get()));
    notify();
  },

  /** 用户动作开始：结束上一步，开新的一步 */
  beginStep(label = '') {
    if (busy) return;
    finalize();
    current = emptyStep(label);
    notify();
  },

  /** 包住系统写入（拉取合并、整份改写）：不进日志 */
  async withoutJournal<T>(fn: () => Promise<T>): Promise<T> {
    suppressed++;
    try {
      return await fn();
    } finally {
      suppressed--;
    }
  },

  /** 清空撤销 / 重做历史（拉进了别处的改动、整份改写、切换环境之后） */
  clear() {
    current = null;
    generation++;
    // 已经在路上的写入还会落下，但不再有步收它们
    undoStack.length = 0;
    redoStack.length = 0;
    notify();
  },

  // ── 写入口（db.ts / appStorage.ts 在真正写之前调） ──

  /**
   * 要写 store 里的这几行（after＝写之后的样子，undefined＝删掉）。
   * 返回的 promise 读完前像才 resolve：调用方（db.ts）必须等它再真正写。
   */
  recordRows(store: string, writes: { id: string; after: Row | undefined }[]): Promise<void> {
    const s = current;
    if (!s || suppressed || !io || store === 'backups') return Promise.resolve();
    const raw = io;
    queueMicrotask(notify);
    let m = s.rows.get(store);
    if (!m) s.rows.set(store, (m = new Map()));
    const waits: Promise<void>[] = [];
    for (const w of writes) {
      let c = m.get(w.id);
      if (c) c.after = w.after;
      else {
        const fresh: Change<Row> = { before: undefined, after: w.after, read: 'pending' };
        fresh.ready = raw.getRow(store, w.id).then(
          r => {
            fresh.before = r;
            delete fresh.read;
          },
          err => {
            fresh.read = 'unknown';
            console.warn('[undo] 读写之前的样子失败（这一步撤不回）:', err);
          },
        );
        m.set(w.id, (c = fresh));
      }
      if (c.ready) waits.push(c.ready);
    }
    return Promise.all(waits).then(() => undefined);
  },

  /** 整表清空 / 替换：先读全表当前样子（返回的 promise 读完才 resolve，调用方等它再写） */
  recordReplace(store: string, rows: readonly Row[]): Promise<void> {
    const s = current;
    if (!s || suppressed || !io || store === 'backups') return Promise.resolve();
    queueMicrotask(notify);
    let m = s.rows.get(store);
    if (!m) s.rows.set(store, (m = new Map()));
    const map = m;
    const prior = [...map.values()].map(c => c.ready).filter(Boolean) as Promise<void>[];
    const afterIds = new Map(rows.map(r => [String(r.id), r] as const));
    const read = Promise.all(prior)
      .then(() => io!.getAllRows(store))
      .then(
        all => {
          const seen = new Set<string>();
          for (const r of all) {
            const id = String(r.id);
            seen.add(id);
            const c = map.get(id);
            if (!c) map.set(id, { before: r, after: afterIds.get(id) });
            else c.after = afterIds.get(id);
          }
          // 这一步里早先写进来、表里此刻已有的行上面处理过了；表里没有的（这一步新建又被清掉）after 也跟着清
          for (const [id, c] of map) if (!seen.has(id)) c.after = afterIds.get(id);
          for (const [id, r] of afterIds) if (!map.has(id)) map.set(id, { before: undefined, after: r });
        },
        err => console.warn('[undo] 读整表失败:', err),
      );
    return read;
  },

  /** db.ts 把每次写入的 promise 交进来：撤销要等还在路上的写入落下 */
  track<T>(p: Promise<T>): Promise<T> {
    inflight.add(p);
    void p.then(
      () => inflight.delete(p),
      () => inflight.delete(p),
    );
    return p;
  },

  /** 要写 localStorage 的这个键（不带环境前缀；value＝null 表示删掉） */
  recordKey(key: string, value: string | null) {
    const s = current;
    if (!s || suppressed || !io || !JOURNALED_KEYS.has(key)) return;
    const c = s.keys.get(key);
    const after = value ?? undefined;
    if (c) c.after = after;
    else s.keys.set(key, { before: io.getKey(key) ?? undefined, after });
    queueMicrotask(notify);
  },

  // ── 撤销 / 重做 ──

  getState(): UndoState {
    return state;
  },

  /** 有没有打开的步（键盘输入时没有就开一步） */
  hasOpenStep() {
    return !!current;
  },

  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  /** 有改动的写入落下之后叫一声，按钮刷新可不可点 */
  touched() {
    notify();
  },

  /** 等还在路上的写入全部落下（撤销写回前、切换数据环境前） */
  async settle() {
    while (inflight.size) await Promise.allSettled([...inflight]);
  },

  async undo(): Promise<UndoApplied | null> {
    return apply('undo');
  },

  async redo(): Promise<UndoApplied | null> {
    return apply('redo');
  },
};

/** 当前这一步有没有东西（状态源只能比引用） */
function isEmptyLive(s: Step): boolean {
  if (s.rows.size || s.keys.size) return false;
  for (const [name, src] of sources) if (s.sourceStart.has(name) && s.sourceStart.get(name) !== src.get()) return false;
  return true;
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DOMException('undo write-back timed out', 'TimeoutError')), APPLY_TIMEOUT_MS);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

const readsOf = (s: Step) => [...s.rows.values()].flatMap(m => [...m.values()].map(c => c.ready));

async function apply(direction: 'undo' | 'redo'): Promise<UndoApplied | null> {
  if (busy || !io) return null;
  busy = true;
  notify();
  const from = direction === 'undo' ? undoStack : redoStack;
  const to = direction === 'undo' ? redoStack : undoStack;
  const gen = generation;
  const out: UndoApplied = { direction, outcome: 'done', label: '', stores: [], keys: [], sources: {} };
  try {
    // 还在路上的写入（刚点的那一下的落盘）：等它们落下再收尾、写回
    try {
      await withTimeout(undoJournal.settle());
    } finally {
      finalize();
    }
    // 只看栈顶，不先弹：没做成时这一步原样留着。前像读回之后才判得出改没改（前后一样的整步丢掉，看下一步）
    let step: Step | undefined;
    while ((step = from[from.length - 1])) {
      out.label = step.label;
      await withTimeout(Promise.all(readsOf(step)));
      if (gen !== generation) return null;
      prune(step);
      if (!isEmpty(step)) break;
      from.pop();
    }
    if (!step) return null;

    // 有行读不到前像：整步不撤（只跳过那一行，「并入上一场」会丢组或出重复），更早的步也作废
    if ([...step.rows.values()].some(m => [...m.values()].some(c => c.read === 'unknown'))) {
      from.length = 0;
      out.outcome = 'blocked';
      return out;
    }

    const pick = <T>(c: Change<T>) => (direction === 'undo' ? c.before : c.after);
    const raw = io;
    const now = new Date().toISOString();
    const ops: RowOp[] = [];
    for (const [store, m] of step.rows) {
      out.stores.push(store);
      for (const [id, c] of m) {
        const v = pick(c);
        // 写回的行盖上现在的时间：同步合并时这一份是新的
        ops.push({ store, id, row: v && ('updatedAt' in v ? { ...v, updatedAt: now } : v) });
      }
    }
    suppressed++;
    try {
      if (ops.length) await withTimeout(raw.writeRows(ops));
      for (const [key, c] of step.keys) {
        out.keys.push(key);
        if (!raw.setKey(key, pick(c) ?? null)) throw new Error(`localStorage 写不进 ${key}`);
      }
      if (step.keys.size) {
        for (const k of PREF_TIMESTAMP_KEYS) {
          if (raw.getKey(k) !== null && !raw.setKey(k, String(Date.now()))) throw new Error(`localStorage 写不进 ${k}`);
        }
      }
      for (const [name, c] of step.sources) {
        const src = sources.get(name);
        // 交出去的是拷贝：工作台之后原地改它，不能改到日志里存的那一份
        const value = copy(pick(c));
        out.sources[name] = { from: direction === 'undo' ? c.after : c.before, to: value };
        src?.set(value);
      }
    } finally {
      suppressed--;
    }
    // 写回期间被 clear() 过（拉进了别处的改动）：历史已作废，不把这一步塞回清空了的栈
    if (gen === generation && from[from.length - 1] === step) {
      from.pop();
      to.push(step);
    }
    return out;
  } catch (err) {
    console.error('[undo] 写回没做成，这一步留在原栈:', err);
    out.outcome = 'failed';
    return out;
  } finally {
    busy = false;
    notify();
  }
}
