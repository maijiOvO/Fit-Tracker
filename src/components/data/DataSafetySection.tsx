/**
 * 首选项「数据」组里的自动备份 / 导出 / 导入（设计见 docs/design-backup.md §4）。
 *
 * 主页只有一行「自动备份」：没开时这一行带全页唯一的实心主按钮（选择文件夹），开了以后主按钮在备份二级页（立即备份）。
 * 导出、导入各是一个二级页，里面一行一件事。
 *
 * 「上次备份」只来自读回核对通过的那一次：时间、位置、份数都是实际值。
 * 失败时红字写原因和下一步，不留「看起来正常」的空隙。
 */
import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { useUserSettingsContext } from '../../contexts/UserSettingsContext';
import { displayPath } from '../../../services/fitlogFolder';
import {
  openDataFlow,
  useBackupNow,
  useBackupState,
  useChooseBackupFolder,
  useExportCsv,
} from '../../hooks/useDataSafety';
import { backupErrorText, needsRepick } from './flash';
import { Go, Group, Name, Primary, Stack } from '../prefsRows';

function ago(iso: string, isCn: boolean): string {
  const d = new Date(iso);
  const now = new Date();
  const hm = d.toLocaleTimeString(isCn ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86400000,
  );
  if (days === 0) return `${isCn ? '今天' : 'Today'} ${hm}`;
  if (days === 1) return `${isCn ? '昨天' : 'Yesterday'} ${hm}`;
  return d.toLocaleDateString(isCn ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }) + ` ${hm}`;
}

function useT() {
  const { lang } = useUserSettingsContext();
  const isCn = lang === Language.CN;
  return { lang, isCn, t: (cn: string, en: string) => (isCn ? cn : en) };
}

/** 清理时因内容没被新备份覆盖而留下的旧备份（BackupStatus.held） */
const heldText = (n: number, t: (cn: string, en: string) => string) =>
  t(`有 ${n} 份旧备份含这台手机没有的记录，已保留`, `${n} older backup${n > 1 ? 's have' : ' has'} records this phone doesn't — kept`);

/** 错误比成功新 → 算失败；否则看最近一次成功 */
function useBackupView() {
  const { supported, folder, status } = useBackupState();
  const errNewer = !!status.lastError && (!status.lastOkAt || status.lastError.at > status.lastOkAt);
  return { supported, folder, status, errNewer };
}

/** 主页「数据」组里的那一行；浏览器里（不支持文件夹）不出 */
export const BackupRow: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const { isCn, t } = useT();
  const { supported, folder, status, errNewer } = useBackupView();
  const choose = useChooseBackupFolder();
  if (!supported) return null;

  if (!folder) {
    // 左半边进二级页（那里有「从备份恢复」），右边是主按钮；两颗并排的按钮，不嵌套
    return (
      <div className="w-full min-h-[52px] py-2.5 flex items-center gap-3">
        <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left" data-testid="prefs-open-backup">
          <Name
            name={t('自动备份', 'Auto backup')}
            sub={<span data-testid="backup-status">{t('未开启 · 卸载会丢全部记录', 'Off · uninstalling loses all records')}</span>}
            bad
          />
        </button>
        <Primary onClick={() => void choose()} testId="backup-choose-folder">
          {t('选择文件夹', 'Choose folder')}
        </Primary>
      </div>
    );
  }
  if (errNewer) {
    return (
      <Go
        name={t('自动备份', 'Auto backup')}
        sub={<span data-testid="backup-status">{backupErrorText(status.lastError!.code, isCn)}</span>}
        bad
        value={
          <span className="flex items-center gap-1 text-danger">
            <AlertCircle size={14} />
            {t('失败', 'Failed')}
          </span>
        }
        onClick={onOpen}
        testId="prefs-open-backup"
      />
    );
  }
  return (
    <Go
      name={t('自动备份', 'Auto backup')}
      sub={status.held?.length ? heldText(status.held.length, t) : undefined}
      bad
      value={<span data-testid="backup-status">{status.lastOkAt ? ago(status.lastOkAt, isCn) : t('还没有备份', 'No backup yet')}</span>}
      onClick={onOpen}
      testId="prefs-open-backup"
    />
  );
};

/**
 * 「我的」页上的一行备份状态（审查 D11 / E2：备份状态要一眼能看到，不藏在首选项第四组）。
 * 正常时是上次备份的时间和位置；没开 / 失败时红字，附上能修好它的那颗按钮（design-backup §4）：
 * 任何失败都给「重新选择」—— 重选本身就是一次核对过的立即备份，权限、目录、写入哪种坏了都修得好或报得出。
 * 时间是上次真正写成的那份：数据没变就不重写，所以很久没练时这里是很久以前，那份仍是最新的。
 * 浏览器里（不支持文件夹）不出。
 */
export const BackupGlance: React.FC = () => {
  const { isCn, t } = useT();
  const { supported, folder, status, errNewer } = useBackupView();
  const choose = useChooseBackupFolder();
  if (!supported) return null;

  const bad = !folder || errNewer;
  const value = !folder
    ? t('未开启', 'Off')
    : errNewer
      ? backupErrorText(status.lastError!.code, isCn)
      : `${status.lastOkAt ? ago(status.lastOkAt, isCn) : t('还没有备份', 'No backup yet')} · ${displayPath(folder, isCn)}`;

  return (
    <div className="ui-card p-4 flex justify-between items-center gap-3" data-testid="profile-backup">
      <span className="font-bold text-primary whitespace-nowrap">{t('自动备份', 'Auto backup')}</span>
      <span className="flex items-center gap-2 min-w-0">
        <span className={`truncate text-xs font-medium flex items-center gap-1 ${bad ? 'text-danger' : 'text-secondary'}`}>
          {bad && <AlertCircle size={14} className="flex-shrink-0" />}
          <span className="truncate">{value}</span>
        </span>
        {bad && (
          <Primary onClick={() => void choose()} testId="profile-backup-choose">
            {folder ? t('重新选择', 'Choose again') : t('选择文件夹', 'Choose folder')}
          </Primary>
        )}
      </span>
    </div>
  );
};

/** 二级页：自动备份 */
export const BackupPage: React.FC = () => {
  const { isCn, t } = useT();
  const { folder, status, errNewer } = useBackupView();
  const choose = useChooseBackupFolder();
  const backup = useBackupNow();

  // 没权限 / 目录没了：「立即备份」只会再失败一次，主按钮换成重选
  const repick = errNewer && needsRepick(status.lastError!.code);
  const head = !folder ? (
    <Name name={t('未开启', 'Off')} sub={t('卸载会丢全部记录', 'Uninstalling loses all records')} bad />
  ) : errNewer ? (
    <Name name={t('上次备份失败', 'Last backup failed')} sub={backupErrorText(status.lastError!.code, isCn)} bad />
  ) : (
    <Name
      name={status.lastOkAt ? `${t('上次备份', 'Last backup')} · ${ago(status.lastOkAt, isCn)}` : t('还没有备份', 'No backup yet')}
      sub={
        displayPath(folder, isCn) +
        (status.lastOkAt && status.fileCount != null ? t(` · 共 ${status.fileCount} 份`, ` · ${status.fileCount} files`) : '')
      }
    />
  );

  return (
    <>
      <Group testId="data-safety">
        <Stack name={<span data-testid="backup-status">{head}</span>}>
          {folder && !!status.held?.length && !errNewer && (
            <p className="text-label text-danger -mt-1" data-testid="backup-held">
              {heldText(status.held.length, t)}
              {t('，可用「从备份恢复」合并回来', ' — "Restore from backup" can merge them back')}
            </p>
          )}
          {!folder || repick ? (
            <Primary wide onClick={() => void choose()} testId={folder ? 'backup-change-folder' : 'backup-choose-folder'}>
              {folder ? t('重新选择文件夹', 'Choose folder again') : t('选择文件夹', 'Choose folder')}
            </Primary>
          ) : (
            <Primary wide onClick={() => void backup()} testId="backup-now">
              {t('立即备份', 'Back up now')}
            </Primary>
          )}
        </Stack>
      </Group>
      <Group>
        {folder && !repick && (
          <Go
            name={t('备份文件夹', 'Backup folder')}
            value={displayPath(folder, isCn)}
            onClick={() => void choose()}
            testId="backup-change-folder"
          />
        )}
        <Go name={t('从备份恢复', 'Restore from backup')} onClick={() => openDataFlow('restore')} testId="backup-restore" />
      </Group>
    </>
  );
};

/** 二级页：导出 */
export const ExportPage: React.FC<{ onExportJson: () => void; busy: boolean }> = ({ onExportJson, busy }) => {
  const { t } = useT();
  const { supported, folder } = useBackupState();
  const exportCsv = useExportCsv();
  return (
    <Group>
      <Go name={t('分享 CSV', 'Share CSV')} onClick={() => void exportCsv('share')} testId="export-csv" />
      {supported && folder && (
        <Go name={t('CSV 存到备份文件夹', 'Save CSV to backup folder')} onClick={() => void exportCsv('folder')} testId="export-csv-folder" />
      )}
      <Go name={t('完整备份（JSON）', 'Full backup (JSON)')} onClick={onExportJson} disabled={busy} testId="export-json" />
    </Group>
  );
};

/**
 * 二级页：导入。想恢复的人先点的是「导入」，所以能合并、有摘要的「从备份恢复」放第一行（和自动备份页那行是同一个弹窗，审查 E8）；
 * 单个 JSON 文件只能整份覆盖，名字直说。副文字是后果，不是说明
 */
export const ImportPage: React.FC<{ onImportJson: () => void; busy: boolean }> = ({ onImportJson, busy }) => {
  const { lang, t } = useT();
  const { supported } = useBackupState();
  return (
    <Group>
      {supported && <Go name={t('从备份恢复', 'Restore from backup')} onClick={() => openDataFlow('restore')} testId="import-restore" />}
      <Go name={t('用备份文件覆盖（JSON）', 'Replace from a backup file (JSON)')} sub={translations.importDesc[lang]} onClick={onImportJson} disabled={busy} testId="import-json" />
      <Go name={t('从 Strong / Hevy 导入', 'Import from Strong / Hevy')} onClick={() => openDataFlow('import-csv')} testId="import-csv" />
    </Group>
  );
};
