/**
 * 数据安全这块的提示文案，和跨一次 reload 的提示：恢复 / 导入之后要重载页面让各个 context 重新水化，
 * 重载前弹的 toast 会被冲掉 —— 先存下来，新页面起来由 DataSafetyHost 弹出。
 */
import { storage } from '../../../services/appStorage';
import type { BackupErrorCode } from '../../../services/fitlogAutoBackup';
import type { SaveOutcome } from '../../../services/fitlogSaveFile';

const KEY = 'fitlog_flash';

/** 按 code 逐个给（原生 reject 的 message 是英文诊断，不进界面）；漏了哪个 code 编译不过 */
const BACKUP_ERROR_TEXT: Record<BackupErrorCode, [cn: string, en: string]> = {
  'no-access': ['文件夹权限已失效，重新选择', 'Folder access was lost — choose it again'],
  'folder-missing': ['备份文件夹找不到了（被删、改名或存储卡拔出）', 'The backup folder is gone (deleted, renamed or the SD card removed)'],
  'persist-failed': ['系统没给这个文件夹长期授权，再选一次', "The system didn't grant lasting access to that folder — choose it again"],
  'mkdir-failed': ['没能在选中的文件夹里建 fitlog 子文件夹', "Couldn't create the fitlog subfolder in that folder"],
  'open-failed': ['没能打开选中的文件夹', "Couldn't open the chosen folder"],
  'list-failed': ['读不出文件夹里有哪些文件', "Couldn't list the files in the folder"],
  'create-failed': ['没能在文件夹里新建文件', "Couldn't create a file in the folder"],
  'write-failed': ['写入失败', 'Write failed'],
  'read-failed': ['读取失败', 'Read failed'],
  'delete-failed': ['删除文件失败', "Couldn't delete a file"],
  'bad-args': ['内部参数出错', 'Internal error (bad arguments)'],
  unsupported: ['这台设备不支持备份文件夹', 'Backup folder is not supported here'],
  unknown: ['出了没预料到的错误', 'Something unexpected went wrong'],
  'verify-failed': ['备份校验失败，这份备份不可用', 'Backup failed verification and cannot be used'],
  'no-folder': ['还没有选备份文件夹', 'No backup folder chosen'],
};

export function backupErrorText(code: BackupErrorCode, isCn: boolean): string {
  return BACKUP_ERROR_TEXT[code][isCn ? 0 : 1];
}

/** 这几种失败只有重选文件夹修得好：主按钮换成「重新选择文件夹」 */
export const needsRepick = (code: BackupErrorCode): boolean => code === 'no-access' || code === 'folder-missing';

/**
 * 导出 / 分享之后那一句（导出 JSON、分享 CSV、崩溃页导出共用）。downloaded 是浏览器下载，说法由调用方给；
 * 原生分享最多只能说「已交给」：那个应用存没存下来不知道（docs/release-signing.md「已知的产品缺口」）
 */
const SAVE_OUTCOME: Record<Exclude<SaveOutcome['kind'], 'downloaded'>, { cn: string; en: string; variant: 'success' | 'info' }> = {
  handed: { cn: '已交给所选应用', en: 'Handed to the app you picked', variant: 'success' },
  unconfirmed: { cn: '没能确认文件已交出', en: "Couldn't confirm the file was handed over", variant: 'info' },
  cancelled: { cn: '已取消', en: 'Cancelled', variant: 'info' },
};

export function saveOutcomeText(kind: SaveOutcome['kind'], isCn: boolean, downloaded: string): { message: string; variant: 'success' | 'info' } {
  if (kind === 'downloaded') return { message: downloaded, variant: 'success' };
  const o = SAVE_OUTCOME[kind];
  return { message: isCn ? o.cn : o.en, variant: o.variant };
}

/** 备份文件解析不了时那一句（「用备份文件覆盖」和恢复弹窗的「选一个备份文件」共用）；code 是 BackupParseError 的 message */
export function backupParseErrorText(code: string, isCn: boolean): string {
  if (code === 'not-json') return isCn ? '这不是一个 JSON 文件' : 'Not a JSON file';
  if (code === 'newer-version') return isCn ? '这份备份来自更新的版本，先升级 App' : 'This backup is from a newer version of the app — update first';
  return isCn ? '这不是 Fit Tracker 的备份文件' : 'Not a Fit Tracker backup';
}

/**
 * 整份改写本机之后那一句（恢复 / 导入 / 撤销导入 / 重置共用）：推上去了就只报成功；
 * 没推上去如实说「服务器还是旧的，联网后自动补推」——不说的话，人会以为另一端已经是新的了
 */
export function overwriteNote(pushed: 'pushed' | 'not-configured' | 'failed', isCn: boolean): string {
  if (pushed !== 'failed') return '';
  return isCn ? '（服务器暂时没连上，联网后会自动补推）' : ' (server unreachable — it will sync once online)';
}

/** 写回本机失败的那一句：自动换回去了才说「数据未改动」，没换回去如实说并指向「撤销上次恢复、导入或重置」 */
export function overwriteFailedText(e: unknown, isCn: boolean, what: { cn: string; en: string }): string {
  const rolledBack = !(e && typeof e === 'object' && 'rolledBack' in e) || (e as { rolledBack: boolean }).rolledBack;
  return rolledBack
    ? isCn ? `${what.cn}失败，数据未改动` : `${what.en} failed, nothing changed`
    : isCn
      ? `${what.cn}失败，部分数据可能已改动，可在首选项「撤销上次恢复、导入或重置」换回去`
      : `${what.en} failed and some data may have changed — "Undo last restore, import or reset" in Preferences puts it back`;
}

/** 覆盖恢复 / 重置的确认里那一句：工作台上有没结束的训练（或编辑旧训练没保存的改动）才说，它会跟着丢（2026-11-14 用户定） */
export function workbenchDropNote(isCn: boolean): string {
  return isCn
    ? '训练页上没结束的训练、没保存的修改也会一起清掉。'
    : 'The unfinished workout on the Workout tab (and any unsaved edits) will be cleared too.';
}

/** 撤销恢复 / 导入 / 重置的确认文案（首选项那一行和崩溃兜底页共用）；newer＝之后新记的训练数，会一起丢 */
export function undoImportWarning(newer: number, isCn: boolean): string {
  return (
    (isCn ? '回到恢复 / 导入 / 重置之前的样子，只能撤销一次。' : 'Go back to how things were before the restore / import / reset. Works only once.') +
    (newer > 0
      ? isCn
        ? `\n\n之后新记的 ${newer} 场训练也会一起丢掉。`
        : `\n\nThe ${newer} workout${newer > 1 ? 's' : ''} logged since then will be lost too.`
      : '')
  );
}

export function setFlash(message: string, variant: 'success' | 'error' | 'info'): void {
  storage.setItem(KEY, JSON.stringify({ message, variant }));
}

export function takeFlash(): { message: string; variant: 'success' | 'error' | 'info' } | null {
  const raw = storage.getItem(KEY);
  if (!raw) return null;
  storage.removeItem(KEY);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
