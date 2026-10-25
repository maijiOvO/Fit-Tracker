import { dbName } from './appEnv';
import { undoJournal } from './undoJournal';

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
        this.db = (ev.target as IDBOpenDBRequest).result;
        this.openedAs = name;
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
      const request = indexedDB.open(name, DB_VERSION);
      request.onupgradeneeded = (event) => {
        this.applySchema((event.target as IDBOpenDBRequest).result);
      };
      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        this.openedAs = name;
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
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

  private async getStore(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    if (this.opening) await this.opening;
    // 环境切换后若有代码路径漏掉 reopen()，这里兜底，绝不让读写落到另一个环境的库
    if (this.db && this.openedAs !== dbName()) await this.reopen();
    if (!this.db) await this.init();
    if (!this.db!.objectStoreNames.contains(name)) {
      // 旧版本数据库缺少这个 store —— 自我修复
      await this.forceUpgrade();
    }
    const transaction = this.db!.transaction(name, mode);
    return transaction.objectStore(name);
  }

  async getAll<T>(storeName: string): Promise<T[]> {
    const store = await this.getStore(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /** 读一条（撤销日志读「写之前的样子」用） */
  async get<T>(storeName: string, id: string): Promise<T | undefined> {
    const store = await this.getStore(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  }

  /** 写入一条并等事务提交（oncomplete）；事务出错或被中止都会 reject。先记进撤销日志（services/undoJournal.ts） */
  save(storeName: string, item: any): Promise<void> {
    return undoJournal.track(
      undoJournal.recordRows(storeName, [{ id: String(item?.id), after: item }]).then(() => this.rawPut(storeName, item)),
    );
  }

  /** 不经过撤销日志的写（撤销 / 重做写回用） */
  async rawPut(storeName: string, item: any): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');
    const done = txDone(store.transaction);
    store.put(item);
    return done;
  }

  /** Context 等均名使用 put，与 save 等价 */
  async upsert(storeName: string, item: any): Promise<void> {
    return this.save(storeName, item);
  }

  delete(storeName: string, id: string): Promise<void> {
    return undoJournal.track(
      undoJournal.recordRows(storeName, [{ id: String(id), after: undefined }]).then(() => this.rawDelete(storeName, id)),
    );
  }

  async rawDelete(storeName: string, id: string): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');
    const done = txDone(store.transaction);
    store.delete(id);
    return done;
  }

  clear(storeName: string): Promise<void> {
    return undoJournal.track(undoJournal.recordReplace(storeName, []).then(() => this.rawClear(storeName)));
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
    return undoJournal.track(undoJournal.recordReplace(storeName, rows).then(() => this.rawReplaceAll(storeName, rows)));
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