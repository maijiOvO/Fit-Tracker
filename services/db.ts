
import { WorkoutSession, PRRecord, ExerciseDefinition, Goal, WeightEntry } from '../types';

const DB_NAME = 'FitLogDB';
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
    this.db.close();
    this.db = null;
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, nextVersion);
      req.onupgradeneeded = (ev) => {
        this.applySchema((ev.target as IDBOpenDBRequest).result);
      };
      req.onsuccess = (ev) => {
        this.db = (ev.target as IDBOpenDBRequest).result;
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        this.applySchema((event.target as IDBOpenDBRequest).result);
      };
      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async getStore(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
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

  async save(storeName: string, item: any): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(item);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /** Context 等均名使用 put，与 save 等价 */
  async upsert(storeName: string, item: any): Promise<void> {
    return this.save(storeName, item);
  }

  async delete(storeName: string, id: string): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clear(storeName: string): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

export const db = new FitLogDB();
