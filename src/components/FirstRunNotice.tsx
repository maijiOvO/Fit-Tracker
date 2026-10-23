/**
 * 单机发行版的首次启动提示。**只在 solo 构建里出现**。
 *
 * 与「界面里不写教学文字」那条约定不冲突 —— 那条的前提是单人自用、
 * 使用者知道全部功能，而它本身也写着「删教学、留后果与状态」。
 * 这里说的正是后果：数据在哪、什么情况下会没、怎么带走。
 * 自用版（personal）永远不会渲染到这个组件。
 *
 * 只弹一次，标记存在 solo: 前缀下（services/appStorage 自动加前缀），
 * 所以它跟着这个构建的命名空间走，不会污染自用版的 localStorage。
 */
import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Language } from '../../types';
import { Modal } from './Modal';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { isSolo } from '../../services/appEnv';
import { storage } from '../../services/appStorage';
import { folderSupported } from '../../services/fitlogFolder';
import { openDataFlow } from '../hooks/useDataSafety';

const SEEN_KEY = 'fitlog_first_run_notice_seen';

export const FirstRunNotice: React.FC = () => {
  const { lang } = useUserSettingsContext();
  const isCn = lang === Language.CN;
  // 初值只算一次：算在 render 里会让「点了知道了」之后立刻又被判定为未读
  const [open, setOpen] = useState(() => isSolo() && storage.getItem(SEEN_KEY) !== '1');

  if (!isSolo()) return null;

  const dismiss = (): void => {
    storage.setItem(SEEN_KEY, '1');
    setOpen(false);
  };

  return (
    <Modal
      isOpen={open}
      onClose={dismiss}
      variant="center"
      size="sm"
      showCloseButton={false}
      dismissOnScrim={false}
      title={isCn ? '你的数据在你手里' : 'Your data stays with you'}
      footer={
        <div className="space-y-2">
          <button onClick={dismiss} className="ui-btn-primary w-full py-3.5">
            {isCn ? '知道了' : 'Got it'}
          </button>
          {/* 重装后第一眼看到的就是这个弹窗：恢复入口放这里，省得用户以为记录没了 */}
          {folderSupported() && (
            <button
              onClick={() => {
                dismiss();
                openDataFlow('restore');
              }}
              className="w-full py-2 text-secondary text-small"
              data-testid="first-run-restore"
            >
              {isCn ? '以前用过 fitlog？从备份恢复' : 'Used fitlog before? Restore from backup'}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4 text-small leading-relaxed text-secondary">
        <div className="flex justify-center">
          <div className="p-3 bg-accent-soft text-accent rounded-control">
            <ShieldCheck size={26} strokeWidth={1.75} />
          </div>
        </div>

        <p>
          {isCn
            ? '没有账号、没有联网权限（可在系统权限页核实），记录只存在这台手机上。'
            : 'No account, no network permission (check system app permissions). Your logs stay on this phone.'}
        </p>
        <p className="text-primary font-medium">
          {isCn
            ? '卸载或换手机，数据不会跟过去。'
            : 'Uninstalling or switching phones will not carry your data over.'}
        </p>
        <p>
          {isCn
            ? '所以第一次练完会请你选一个备份文件夹，之后每次练完自动备份，重装后可恢复。也可在首选项导出 CSV。'
            : 'So after your first workout you will pick a backup folder; every workout is backed up there and can be restored after reinstalling. CSV export is in Preferences.'}
        </p>
      </div>
    </Modal>
  );
};

export default FirstRunNotice;
