import { dbName } from './appEnv';
import { undoJournal } from './undoJournal';
import { noteFreshDb } from './localCensus';

// 库名按数据环境派生：prod = FitLogDB，dev = FitLogDB-dev（见 services/appEnv.ts）。
// 两个库物理独立，开发模式产生的记录不可能出现在真实库里。
const DB_VERSION = 8; // 8: 加 backups（导入前的回滚槽）；7: 曾为助手会话建库（功能已移除，旧库中该 store 闲置无害）

const REQUIRED_STORES = [
  'workouts',
  'prs',
  'customExercises',
  'goals',
  'weightLogs',
  'custom_metrics',
  'scheduledWorkouts',
  // 导入备份前的回滚副本（单行，id='pre-import'）。
  // 放 IndexedDB 而不是下载成文件：`<a download>` 在 Android WebView 里
  // 能否落盘尚未验证，拿没验过的路径当回滚保障等于没有保障。
  'backups',
] as const;

/**
 * 事务的终态：oncomplete 才算写进去了；onerror / onabort 都要 reject。
 * 只挂 request.onerror + oncomplete 时，事务被中止（配额满、约束冲突、连接被 versionchange 关掉）
 * 不一定走到 request.onerror，promise 就永远悬着 —— 调用方的 await 卡死，也不报错。
 */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction error'));
    tx.onabort = () => reject(tx.error ?? new DOMException('IndexedDB transaction aborted', 'AbortError'));
  });
}

/**
 * 写失败要看得见（审查 E4 / F2）：自动落盘是 fire-and-forget，撤销日志的 track 又给 promise 挂了处理器，
 * 失败原本彻底无声 —— 存储写满时界面照常记组，App 被回收后那一段就没了。
 * 只在「好 → 坏」「坏 → 好」翻转时派发，App 据此提示一次、常驻红签亮起 / 撤掉（LocalDataAlert）。
 */
let writeFailing = false;
function reportWrite(ok: boolean, err?: unknown): void {
  if (ok !== writeFailing) return;
  writeFailing = !ok;
  if (!ok) console.error('[db] 写入失败（已重试一次）:', err);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ok ? 'fitlog:db-write-ok' : 'fitlog:db-write-failed'));
}

/**
 * 读失败同理（上架审查 C14）：开库 / 读取报错时首页原来显示成全新用户的空状态，数据其实还在库里。
 * 首页是懒加载的，会错过之前派发的事件，所以另给 getter 读当前状态。
 */
let readFailing = false;
function reportRead(ok: boolean, err?: unknown): void {
  if (ok !== readFailing) return;
  readFailing = !ok;
  if (!ok) console.error('[db] 读取失败:', err);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ok ? 'fitlog:db-read-ok' : 'fitlog:db-read-failed'));
}
export const dbReadFailing = () => readFailing;
export const dbWriteFailing = () => writeFailing;

/** 开库超过这么久不回话（异常关机后 LevelDB 恢复、库被别处占着）就当读不出，界面给「重试」，不一直停在空白 */
const OPEN_TIMEOUT_MS = 10_000;

export class FitLogDB {
  private db: IDBDatabase | null = null;
  /** 当前连接对应的库名；与 dbName() 不一致时说明环境切换了，需要重开 */
  private openedAs: string | null = null;
  /** 进行中的 open：并发的首批读写共用这一个，不各开一条连接 */
  private opening: Promise<void> | null = null;

  private applySchema(db: IDBDatabase): void {
    for (const name of REQUIRED_STORES) {
      if (!db.objectStoreNames.contains(name)) {
        db.createObjectStore(name, { keyPath: 'id' });
      }
    }
  }

  /** 用比当前数据库当前 version 更高的版本重开，强制触发 onupgradeneeded 补 store */
  private async forceUpgrade(): Promise<void> {
    if (!this.db) return;
    const nextVersion = this.db.version + 1;
    const name = this.openedAs ?? dbName();
    this.db.close();
    this.db = null;
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name, nextVersion);
      req.onupgradeneeded = (ev) => {
        this.applySchema((ev.target as IDBOpenDBRequest).result);
      };
      req.onsuccess = (ev) => {
        this.adopt((ev.target as IDBOpenDBRequest).result, name);
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async init(): Promise<void> {
    if (!this.opening) {
      this.opening = this.open().finally(() => {
        this.opening = null;
      });
    }
    return this.opening;
  }

  private open(): Promise<void> {
    const name = dbName();
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(new DOMException('IndexedDB open timed out', 'TimeoutError'));
      }, OPEN_TIMEOUT_MS);
      const request = indexedDB.open(name, DB_VERSION);
      request.onupgradeneeded = (event) => {
        this.applySchema((event.target as IDBOpenDBRequest).result);
        // 库是这次新建的：本机记着有训练的话，就是被系统清掉 / 损坏重建了（上架审查 C12，见 localCensus）
        if ((event as IDBVersionChangeEvent).oldVersion === 0) noteFreshDb();
      };
      request.onsuccess = (event) => {
        const conn = (event.target as IDBOpenDBRequest).result;
        clearTimeout(timer);
        // 超时之后才开好的：调用方已经按失败处理了，这条连接不接管，免得和重试开的那条成了两条
        if (settled) return conn.close();
        settled = true;
        this.adopt(conn, name);
        resolve();
      };
      request.onerror = () => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(request.error);
      };
      request.onblocked = () => console.warn('[db] 开库被别的连接挡住（等它关掉）');
    });
  }

  /**
   * 接管一条新连接。浏览器会在后台单方面关掉 IndexedDB 连接（WebView 切后台被回收存储、磁盘出错、
   * 另一处升级版本），之后 transaction() 同步抛 InvalidStateError —— 这里把连接丢掉，下一次读写在 getStore 里重开。
   * 不处理的话每次自动落盘都静默失败，App 被杀后那一段训练就没了（2026-11-02 排查丢组时补的）。
   */
  private adopt(db: IDBDatabase, name: string): void {
    this.db = db;
    this.openedAs = name;
    const drop = () => {
      if (this.db !== db) return;
      this.db = null;
      this.openedAs = null;
    };
    db.onclose = drop;
    db.onversionchange = () => {
      db.close();
      drop();
    };
  }

  /** 数据环境切换后调用：关掉旧库连接，改开新环境对应的库 */
  async reopen(): Promise<void> {
    // 正在开的那条也要等它落定再关，否则它晚到的 onsuccess 会把旧环境的连接写回 this.db
    if (this.opening) await this.opening.catch(() => {});
    if (this.db) {
      this.db.close();
      this.db = null;
      this.openedAs = null;
    }
    await this.init();
  }

  /** 经撤销日志的写都走这里：失败先重试一次（getStore 会重开被关掉的连接），仍失败报出去并照样 reject */
  private async guarded(write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch {
      try {
        await write();
      } catch (err) {
        reportWrite(false, err);
        throw err;
      }
    }
    reportWrite(true);
  }

  private async getStore(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    if (this.opening) await this.opening;
    // 环境切换后若有代码路径漏掉 reopen()，这里兜底，绝不让读写落到另一个环境的库
    if (this.db && this.openedAs !== dbName()) await this.reopen();
    if (!this.db) await this.init();
    if (!this.db!.objectStoreNames.contains(name)) {
      // 旧版本数据库缺少这个 store —— 自我修复
      await this.forceUpgrade();
    }
    try {
      return this.db!.transaction(name, mode).objectStore(name);
    } catch (err) {
      // 连接已经被关了但 onclose 还没派发到（或者关在 await 的间隙里）：重开一次再试
      if (!(err instanceof DOMException && err.name === 'InvalidStateError')) throw err;
      this.db = null;
      this.openedAs = null;
      await this.init();
      return this.db!.transaction(name, mode).objectStore(name);
    }
  }

  /** 读都走这里：成败翻转时报出去（reportRead），照样 resolve / reject */
  private async readGuarded<T>(read: () => Promise<T>): Promise<T> {
    try {
      const v = await read();
      reportRead(true);
      return v;
    } catch (err) {
      reportRead(false, err);
      throw err;
    }
  }

  getAll<T>(storeName: string): Promise<T[]> {
    return this.readGuarded(async () => {
      const store = await this.getStore(storeName, 'readonly');
      return new Promise<T[]>((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    });
  }

  /** 读一条（撤销日志读「写之前的样子」用） */
  get<T>(storeName: string, id: string): Promise<T | undefined> {
    return this.readGuarded(async () => {
      const store = await this.getStore(storeName, 'readonly');
      return new Promise<T | undefined>((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result as T | undefined);
        request.onerror = () => reject(request.error);
      });
    });
  }

  /** 写入一条并等事务提交（oncomplete）；重试一次仍出错或被中止才 reject。先记进撤销日志（services/undoJournal.ts） */
  save(storeName: string, item: any): Promise<void> {
    return undoJournal.track(
      undoJournal.recordRows(storeName, [{ id: String(item?.id), after: item }]).then(() => this.guarded(() => this.rawPut(storeName, item))),
    );
  }

  /** 不经过撤销日志的写（撤销 / 重做写回用） */
  async rawPut(storeName: string, item: any): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');
    const done = txDone(store.transaction);
    store.put(item);
    return done;
  }

  delete(storeName: string, id: string): Promise<void> {
    return undoJournal.track(
      undoJournal.recordRows(storeName, [{ id: String(id), after: undefined }]).then(() => this.guarded(() => this.rawDelete(storeName, id))),
    );
  }

  async rawDelete(storeName: string, id: string): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');
    const done = txDone(store.transaction);
    store.delete(id);
    return done;
  }

  clear(storeName: string): Promise<void> {
    return undoJournal.track(undoJournal.recordReplace(storeName, []).then(() => this.guarded(() => this.rawClear(storeName))));
  }

  private async rawClear(storeName: string): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');
    const done = txDone(store.transaction);
    store.clear();
    return done;
  }

  /**
   * 整表替换：clear + 全部 put 在同一个 readwrite 事务里。
   * 要么全换成功，要么（任一条失败 → 事务中止）原数据原样保留 —— 不会停在「清空了一半」。
   */
  replaceAll(storeName: string, rows: readonly any[]): Promise<void> {
    return undoJournal.track(undoJournal.recordReplace(storeName, rows).then(() => this.guarded(() => this.rawReplaceAll(storeName, rows))));
  }

  private async rawReplaceAll(storeName: string, rows: readonly any[]): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');
    const tx = store.transaction;
    const done = txDone(tx);
    try {
      store.clear();
      for (const row of rows) store.put(row);
    } catch (err) {
      // put 同步抛（比如某行缺 id）不会自动中止事务 —— 不手动 abort，排在前面的 clear 照样提交
      done.catch(() => {});
      tx.abort();
      throw err;
    }
    return done;
  }
}

export const db = new FitLogDB();

undoJournal.setIo({
  getRow: (store, id) => db.get(store, id),
  getAllRows: store => db.getAll(store),
  putRow: (store, row) => db.rawPut(store, row),
  deleteRow: (store, id) => db.rawDelete(store, id),
});