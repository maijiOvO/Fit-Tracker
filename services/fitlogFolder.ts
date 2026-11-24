/**
 * 备份文件夹的 JS 侧：原生插件 FitlogFolder（android/.../FitlogFolderPlugin.java）的包装。
 *
 * 用户用系统选择器选一次文件夹，拿到长期授权，之后 App 自己往里写备份、读备份。
 * 卸载 App 文件还在；重装后授权没了，要再选一次（Android 11+ 的规矩）。
 *
 * 浏览器里没有这套东西。为了让 e2e 能把「选文件夹 → 写 → 读回核对 → 清理 → 恢复」整条链跑一遍，
 * 这里带一个 mock：localStorage 里 `fitlog_mock_folder` = '1' 时启用，文件存在裸 localStorage
 * （不走按环境加前缀的 storage —— 它模拟的是 App 之外的公共目录，清 App 数据也不该清掉它）。
 * mock 只在非原生平台、且被显式打开时生效，正式用户碰不到。
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface FolderRef {
  treeUri: string;
  dirUri: string;
  /** 例：primary:Documents/fitlog —— 用来给用户显示位置 */
  dirDocId: string;
}

export interface FolderFile {
  uri: string;
  name: string;
  /** 字节；-1 = provider 没报（未知） */
  size: number;
  /** 毫秒时间戳；拿不到时为 0 */
  modified: number;
}

/** 插件 reject 时带的 code，UI 只按它出文案（reject 的 message 是英文诊断，只进 console） */
const FOLDER_ERROR_CODES = [
  'no-access',
  /** 目录被删、改名、存储卡拔了：授权还在，目录没了 */
  'folder-missing',
  'persist-failed',
  'mkdir-failed',
  'open-failed',
  'list-failed',
  'create-failed',
  'write-failed',
  'read-failed',
  'delete-failed',
  'bad-args',
  'unsupported',
  'unknown',
] as const;
export type FolderErrorCode = (typeof FOLDER_ERROR_CODES)[number];

/** 选文件夹是为了哪条流程：选择器开着时进程被回收，结果靠它分流（routeRestoredPick） */
export type PickPurpose = 'setup' | 'restore';

export class FolderError extends Error {
  constructor(public code: FolderErrorCode, message: string) {
    super(message);
  }
}

interface FitlogFolderPlugin {
  pickFolder(o: { initial?: string; subfolder?: string; purpose: PickPurpose }): Promise<{ cancelled?: boolean } & Partial<FolderRef>>;
  hasAccess(o: { treeUri: string }): Promise<{ ok: boolean }>;
  list(o: { treeUri: string; dirUri: string }): Promise<{ files: FolderFile[] }>;
  writeText(o: { dirUri: string; name: string; text: string; mimeType?: string }): Promise<{ uri: string; name: string | null }>;
  readText(o: { uri: string }): Promise<{ text: string }>;
  delete(o: { uri: string }): Promise<{ ok: boolean }>;
}

const Native = registerPlugin<FitlogFolderPlugin>('FitlogFolder');

// ============ mock（仅浏览器 + 显式打开） ============

const MOCK_FLAG = 'fitlog_mock_folder';
const MOCK_FS = 'fitlog_mock_folder_fs';
/** e2e 控制：'cancel' 取消选择 / 'corrupt-write' 写进去的内容和给的不一样（模拟读回不一致） / 'deny' 没权限 / 'missing' 目录没了（授权还在） */
const MOCK_FAULT = 'fitlog_mock_folder_fault';

function mockOn(): boolean {
  try {
    return !Capacitor.isNativePlatform() && localStorage.getItem(MOCK_FLAG) === '1';
  } catch {
    return false;
  }
}

type MockFs = Record<string, { text: string; modified: number }>;
const readMock = (): MockFs => {
  try {
    return JSON.parse(localStorage.getItem(MOCK_FS) || '{}');
  } catch {
    return {};
  }
};
const writeMock = (fs: MockFs) => localStorage.setItem(MOCK_FS, JSON.stringify(fs));
const fault = (): string => localStorage.getItem(MOCK_FAULT) || '';
const MOCK_DIR = 'mock://primary:Documents/fitlog';

const Mock: FitlogFolderPlugin = {
  async pickFolder() {
    if (fault() === 'cancel') return { cancelled: true };
    return { treeUri: 'mock://tree', dirUri: MOCK_DIR, dirDocId: 'primary:Documents/fitlog' };
  },
  async hasAccess() {
    return { ok: fault() !== 'deny' };
  },
  async list() {
    if (fault() === 'deny') throw new FolderError('no-access', 'mock deny');
    if (fault() === 'missing') throw new FolderError('folder-missing', 'mock missing');
    const fs = readMock();
    return {
      files: Object.entries(fs).map(([name, f]) => ({
        uri: `${MOCK_DIR}/${name}`,
        name,
        size: f.text.length,
        modified: f.modified,
      })),
    };
  },
  async writeText({ name, text }) {
    if (fault() === 'deny') throw new FolderError('no-access', 'mock deny');
    if (fault() === 'missing') throw new FolderError('folder-missing', 'mock missing');
    const fs = readMock();
    let actual = name;
    for (let i = 1; fs[actual]; i++) actual = name.replace(/(\.\w+)$/, ` (${i})$1`);
    fs[actual] = { text: fault() === 'corrupt-write' ? text.slice(0, Math.floor(text.length / 2)) : text, modified: Date.now() };
    writeMock(fs);
    return { uri: `${MOCK_DIR}/${actual}`, name: actual };
  },
  async readText({ uri }) {
    const name = uri.slice(MOCK_DIR.length + 1);
    const f = readMock()[name];
    if (!f) throw new FolderError('read-failed', 'mock missing');
    return { text: f.text };
  },
  async delete({ uri }) {
    const fs = readMock();
    delete fs[uri.slice(MOCK_DIR.length + 1)];
    writeMock(fs);
    return { ok: true };
  },
};

// ============ 对外 ============

/** 这台设备能不能用「备份文件夹」：安卓原生，或者浏览器里打开了 mock */
export function folderSupported(): boolean {
  return Capacitor.getPlatform() === 'android' || mockOn();
}

function impl(): FitlogFolderPlugin {
  if (mockOn()) return Mock;
  if (Capacitor.getPlatform() === 'android') return Native;
  throw new FolderError('unsupported', 'folder not supported on this platform');
}

/** 原生给的 code 认得就保住，认不得（插件以外的异常、以后新加的）归 unknown */
const folderCode = (c: unknown): FolderErrorCode =>
  (FOLDER_ERROR_CODES as readonly unknown[]).includes(c) ? (c as FolderErrorCode) : 'unknown';

/** 把插件的 reject 统一成 FolderError，code 保住 */
async function wrap<T>(p: () => Promise<T>): Promise<T> {
  try {
    return await p();
  } catch (e) {
    if (e instanceof FolderError) throw e;
    throw new FolderError(folderCode((e as { code?: unknown })?.code), String((e as Error)?.message ?? e));
  }
}

const toRef = (r: Partial<FolderRef>): FolderRef | null =>
  r.treeUri && r.dirUri ? { treeUri: r.treeUri, dirUri: r.dirUri, dirDocId: r.dirDocId ?? '' } : null;

/**
 * 弹系统选择器。initial 是打开的位置（只是提示），subfolder 规则见原生侧：
 * 选中的文件夹叫这个名字、或里面已有备份 → 直接用；否则在里面建 / 复用这个子目录。
 * purpose 原样带回，进程被回收后靠它把结果补给对的流程。用户取消返回 null。
 */
export async function pickFolder(initial: 'Documents' | 'Documents/fitlog', purpose: PickPurpose): Promise<FolderRef | null> {
  const r = await wrap(() => impl().pickFolder({ initial, subfolder: 'fitlog', purpose }));
  return r.cancelled ? null : toRef(r);
}

/** @capacitor/app 的 appRestoredResult 事件里用得到的几项 */
export interface RestoredPick {
  pluginId: string;
  methodName: string;
  success: boolean;
  data?: { cancelled?: boolean; purpose?: string } & Partial<FolderRef>;
  error?: { code?: string; message?: string };
}

/**
 * 选择器开着时进程被回收，选好的结果由 appRestoredResult 补回来（原来等着的 Promise 早没了）。
 * 只认 FitlogFolder.pickFolder：成功 → 按 purpose 分给开启备份 / 恢复；失败 → code；取消、别的插件、认不出 purpose → null。
 */
export function routeRestoredPick(e: RestoredPick): { purpose: PickPurpose; folder: FolderRef } | { code: FolderErrorCode } | null {
  if (e.pluginId !== 'FitlogFolder' || e.methodName !== 'pickFolder') return null;
  if (!e.success) return { code: folderCode(e.error?.code) };
  const d = e.data ?? {};
  const purpose = d.purpose;
  if (d.cancelled || (purpose !== 'setup' && purpose !== 'restore')) return null;
  const folder = toRef(d);
  return folder && { purpose, folder };
}

export async function hasAccess(f: FolderRef): Promise<boolean> {
  try {
    return (await impl().hasAccess({ treeUri: f.treeUri })).ok;
  } catch {
    return false;
  }
}

export const listFiles = (f: FolderRef) => wrap(async () => (await impl().list(f)).files);

export const writeText = (f: FolderRef, name: string, text: string, mimeType = 'application/json') =>
  wrap(() => impl().writeText({ dirUri: f.dirUri, name, text, mimeType }));

/** 去掉开头的 BOM：外部工具存过的 .json 带它，JSON.parse 会判读不出（上架审查 C65）。File.text() 本来就去，这里管文件夹那条路 */
export const readText = (uri: string) => wrap(async () => (await impl().readText({ uri })).text.replace(/^﻿/, ''));

export const deleteFile = (uri: string) => wrap(async () => (await impl().delete({ uri })).ok);

/** primary:Documents/fitlog → 「文档/fitlog」；SD 卡等其它卷标成「SD 卡/…」 */
export function displayPath(f: FolderRef, isCn: boolean): string {
  const id = f.dirDocId || '';
  const colon = id.indexOf(':');
  const vol = colon >= 0 ? id.slice(0, colon) : '';
  let path = colon >= 0 ? id.slice(colon + 1) : id;
  if (isCn) path = path.replace(/^Documents(?=\/|$)/, '文档').replace(/^Download(?=\/|$)/, '下载');
  if (vol && vol !== 'primary') return `${isCn ? 'SD 卡' : 'SD card'}/${path}`;
  return path || (isCn ? '所选文件夹' : 'selected folder');
}
