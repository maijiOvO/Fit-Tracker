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
 *
 * 工作台那一场（currentWorkout）是 React 状态，编辑旧训练时只在内存里，不落盘：
 * 作为「状态源」登记进来，每一步开头记一份引用（状态不可变，引用就是快照），这一步结束时变了就记下前后两份。
 *
 * 只在本机：步数上限 MAX_STEPS，只存在内存里，重启 App 清空。
 * 从服务器拉进来东西、整份改写（恢复备份 / 导入 / 重置）、切换数据环境之后清空 —— 撤销会把那些改动盖掉。
 */

export const MAX_STEPS = 50;

/** 进日志的 localStorage 键（用户数据 / 同步首选项）；各个 *_last_update 时间戳不进，撤销之后统一改成现在 */
const JOURNALED_KEYS = new Set([
  'fitlog_custom_tags',
  'fitlog_custom_exercises',
  'fitlog_exercise_notes',
  'fitlog_exercise_overrides',
  'fitlog_metric_configs',
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
export const PREF_TIMESTAMP_KEYS = [
  'fitlog_prefs_last_update',
  'fitlog_metrics_last_update',
  'fitlog_starred_last_update',
  'fitlog_app_prefs_last_update',
];

export const isJournaledKey = (key: string) => JOURNALED_KEYS.has(key);

type Row = { id: string } & Record<string, unknown>;

/** 一行（或一个键）在这一步里的前后两份；undefined＝不存在 */
interface Change<T> {
  before: T | undefined;
  after: T | undefined;
  /** 前像读完（行要异步读；同一行的后续写入也得等它，免得先写后读把写之后的样子当成前像） */
  ready?: Promise<void>;
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
  putRow: (store: string, row: Row) => Promise<void>;
  deleteRow: (store: string, id: string) => Promise<void>;
  getKey: (key: string) => string | null;
  setKey: (key: string, value: string | null) => void;
}

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

/** 撤销 / 重做完成后发给界面的消息：重读哪些表、哪些状态源变了 */
export interface UndoApplied {
  direction: 'undo' | 'redo';
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

const emptyStep = (label: string): Step => ({
  label,
  rows: new Map(),
  keys: new Map(),
  sources: new Map(),
  sourceStart: new Map([...sources].map(([name, s]) => [name, s.get()])),
  sourceCopy: new Map([...sources].map(([name, s]) => [name, copy(s.get())])),
});

const isEmpty = (s: Step) => !s.rows.size && !s.keys.size && !s.sources.size;

let state: UndoState = { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null };

function computeState(): UndoState {
  const live = !!current && !isEmptyLive(current);
  return {
    canUndo: undoStack.length > 0 || live,
    canRedo: redoStack.length > 0,
    undoLabel: (live ? current!.label : undoStack[undoStack.length - 1]?.label) || null,
    redoLabel: redoStack[redoStack.length - 1]?.label || null,
  };
}

/** 状态变了才换对象（useSyncExternalStore 要稳定的快照） */
function notify() {
  const next = computeState();
  if (
    next.canUndo === state.canUndo &&
    next.canRedo === state.canRedo &&
    next.undoLabel === state.undoLabel &&
    next.redoLabel === state.redoLabel
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
  // 行 / 键写回了原样（改了又改回去）：不算改动
  for (const [store, m] of s.rows) {
    for (const [id, c] of m) if (sameRow(c.before, c.after)) m.delete(id);
    if (!m.size) s.rows.delete(store);
  }
  for (const [key, c] of s.keys) if (c.before === c.after) s.keys.delete(key);
  if (isEmpty(s)) return;
  undoStack.push(s);
  if (undoStack.length > MAX_STEPS) undoStack.shift();
  redoStack.length = 0;
  notify();
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

  /** 用户动作开始：结束上一步，开新的一步 */
  beginStep(label = '') {
    if (busy) return;
    finalize();
    current = emptyStep(label);
    notify();
  },

  /** 换了这一步的名字（按钮文字等；拿不到时留空） */
  labelStep(label: string) {
    if (current && label) current.label = label;
  },

  /** 不开新步，只把当前这一步收尾（撤销按钮按下时先调） */
  closeStep() {
    finalize();
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
        const fresh: Change<Row> = { before: undefined, after: w.after };
        fresh.ready = raw.getRow(store, w.id).then(
          r => {
            fresh.before = r;
          },
          err => console.warn('[undo] 读写之前的样子失败:', err),
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

async function apply(direction: 'undo' | 'redo'): Promise<UndoApplied | null> {
  if (busy || !io) return null;
  busy = true;
  try {
    // 还在路上的写入（刚点的那一下的落盘）：等它们落下再收尾、写回
    while (inflight.size) await Promise.allSettled([...inflight]);
    finalize();
    const from = direction === 'undo' ? undoStack : redoStack;
    const to = direction === 'undo' ? redoStack : undoStack;
    const step = from.pop();
    if (!step) {
      notify();
      return null;
    }
    const pick = <T>(c: Change<T>) => (direction === 'undo' ? c.before : c.after);
    const raw = io;
    const out: UndoApplied = { direction, label: step.label, stores: [], keys: [], sources: {} };
    suppressed++;
    try {
      const now = new Date().toISOString();
      for (const [store, m] of step.rows) {
        out.stores.push(store);
        for (const [id, c] of m) {
          const v = pick(c);
          // 写回的行盖上现在的时间：同步合并时这一份是新的
          if (v) await raw.putRow(store, 'updatedAt' in v ? { ...v, updatedAt: now } : v);
          else await raw.deleteRow(store, id);
        }
      }
      for (const [key, c] of step.keys) {
        out.keys.push(key);
        raw.setKey(key, pick(c) ?? null);
      }
      if (step.keys.size) for (const k of PREF_TIMESTAMP_KEYS) if (raw.getKey(k) !== null) raw.setKey(k, String(Date.now()));
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
    to.push(step);
    notify();
    return out;
  } finally {
    busy = false;
  }
}
