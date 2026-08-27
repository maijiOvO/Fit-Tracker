import { WorkoutSession, PRRecord, ExerciseDefinition, Goal, WeightEntry } from '../types';
import { dbName } from './appEnv';

// 库名按数据环境派生：prod = FitLogDB，dev = FitLogDB-dev（见 services/appEnv.ts）。
// 两个库物理独立，开发模式产生的记录不可能出现在真实库里。
const DB_VERSION = 7; // bump: 强制创建 assistantConversations store

const REQUIRED_STORES = [
  'workouts',
  'prs',
  'customExercises',
  'goals',
  'weightLogs',
  'custom_metrics',
  'scheduledWorkouts',
  'assistantConversations',
] as const;

export class FitLogDB {
  private db: IDBDatabase | null = null;
  /** 当前连接对应的库名；与 dbName() 不一致时说明环境切换了，需要重开 */
  private openedAs: string | null = null;

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
    if (this.db) {
      this.db.close();
      this.db = null;
      this.openedAs = null;
    }
    await this.init();
  }

  private async getStore(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
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

  /**
   * 写入记录并等待事务完成。
   * 使用 request.onsuccess + setTimeout(0) 而非 transaction.oncomplete，
   * 因为某些浏览器中 oncomplete 的触发时机不可靠（可能在后续 readonly 事务之后）。
   * setTimeout(0) 将 resolve 推迟到下一个 macrotask，
   * 确保 IndexedDB 写事务已完全提交后再返回。
   */
  async save(storeName: string, item: any): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');
    const transaction = store.transaction;
    return new Promise((resolve, reject) => {
      const request = store.put(item);
      request.onerror = () => reject(request.error);
      // 使用 transaction.oncomplete 确保事务已物理提交
      transaction.oncomplete = () => resolve();
    });
  }

  /** Context 等均名使用 put，与 save 等价 */
  async upsert(storeName: string, item: any): Promise<void> {
    return this.save(storeName, item);
  }

  async delete(storeName: string, id: string): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');
    const transaction = store.transaction;
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
    });
  }

  async clear(storeName: string): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => {
        setTimeout(() => resolve(), 0);
      };
      request.onerror = () => reject(request.error);
    });
  }
}

export const db = new FitLogDB();