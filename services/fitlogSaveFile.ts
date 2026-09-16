/**
 * 「把一段文本交给用户」的唯一出口 —— 按平台分叉。
 *
 * 为什么不能只用 `<a download>`：**在 Capacitor 的 Android WebView 里它什么都不做。**
 * 没有注册 DownloadListener，blob URL 的下载被静默丢弃 —— 不报错、不抛异常，
 * 于是调用方照常弹「导出成功」。2026-09-15 真机实测：界面提示成功、
 * 全盘 find 不到文件、logcat 里连一条下载事件都没有。
 *
 * 浏览器里、e2e 里、代码审查里这条路全是绿的。只有装到手机上才看得出来。
 *
 * 原生侧改走 Filesystem 写文件 + Share 调起系统分享面板：
 * 用户在分享面板里选「保存到文件」/ 网盘 / 聊天工具，文件是真的落到了他选的地方。
 * 写进 Cache 目录是刻意的 —— 不需要任何存储权限（单机发行版连 INTERNET 都没有，
 * 不应该为了导出去要读写外部存储的权限），分享出去之后系统自己会清。
 */
import { Capacitor } from '@capacitor/core';

/** 用户最终拿到文件了没有 —— 调用方必须按它决定提示什么，不能一律报成功 */
export type SaveOutcome =
  | { kind: 'downloaded' }          // 浏览器触发了下载
  | { kind: 'shared' }              // 原生：用户在分享面板里完成了选择
  | { kind: 'cancelled' };          // 原生：用户关掉了分享面板，什么都没保存

export async function saveTextFile(
  filename: string,
  text: string,
  mimeType = 'application/json',
): Promise<SaveOutcome> {
  if (!Capacitor.isNativePlatform()) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return { kind: 'downloaded' };
  }

  // 动态 import：浏览器构建里这两个插件不该被打进主 chunk
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');

  await Filesystem.writeFile({
    path: filename,
    data: text,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });

  try {
    await Share.share({ title: filename, files: [uri] });
    return { kind: 'shared' };
  } catch (error) {
    // 用户关掉分享面板走的是 reject。这**不是**错误，但也绝不能当成功报 ——
    // 分不清这两者，就等于又造了一个「提示成功但文件不存在」的信号。
    const msg = String((error as Error)?.message ?? error).toLowerCase();
    if (msg.includes('cancel') || msg.includes('abort')) return { kind: 'cancelled' };
    throw error;
  }
}
