/**
 * 首选项弹层（审查 2026-10-06 第一节第 3 点；demo 是 docs/demos/prefs-sheet.html，2026-10-18 用户拍板）。
 *
 * 入口是「我的」页底部一行「首选项 ›」。外壳照 ExercisePickerSheet：整页高、顶部 22px 圆角、抓手、宋体标题、右上 ×，
 * 整张弹层可下拉关闭（同一套原生非被动 touchmove，见 ExercisePickerSheet 的注释）。
 *
 * 分五组：训练 / 动作 / 显示 / 设备 / 数据。行只有两种：「小节名 + 分段块」和「名称 … 值」。
 * 跟数据走的（单位、步长、递减、有氧默认、距离单位、语言、周起始日）记进 appPrefs（打时间戳 + 推送）；
 * 跟设备走的（外观、动效、振动、滑动手感、删组撤销）各自存在本机。
 * 界面里不写说明文字（单人自用），导入的后果说明和导入前副本那行是状态，保留。
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, Download, Moon, RefreshCw, Smartphone, Sun, Undo2, Upload, X, AlertCircle } from 'lucide-react';
import { Language } from '../../types';
import { translations } from '../../translations';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useTheme, ThemePreference } from '../hooks/useTheme';
import { useMotionPreference, MotionPreference } from '../hooks/useMotionPreference';
import { hapticsEnabled, setHapticsEnabled, haptic, H } from '../utils/haptics';
import { scrubFeel, setScrubFeel, ScrubFeel } from '../utils/scrubFeel';
import { WEIGHT_STEP_OPTIONS, DROP_STEP_OPTIONS } from '../../services/appPrefs';
import { useRollbackImport } from '../hooks/useImportData';
import { readRollback, type RollbackInfo } from '../../services/fitlogBackup';
import type { SyncStatus } from '../hooks/useFitlogSync';
import { useGymSwitch } from '../hooks/useGymSwitch';

interface PrefsSheetProps {
  open: boolean;
  onClose: () => void;
  syncStatus: SyncStatus;
  /** 本次启动里上一次完整同步成功的时刻 */
  lastSyncedAt: number | null;
  /** 没配远端 / 正在同步时为 undefined */
  onSync?: () => void;
  onExportData: () => void;
  onImportData: () => void;
  onOpenLibrary: () => void;
  /** 切语言走 App 的 handleToggleLanguage：它顺手把选中的纪录项目换成另一语言的名字 */
  onToggleLanguage: () => void;
  onResetAccount: () => void;
  onLogout?: () => void;
  devMode?: boolean;
  /** 仅未锁定的构建传（手机 APK / release 包永远不渲染数据环境一行） */
  onToggleDevMode?: () => void;
}

type Opt<T> = { v: T; label: React.ReactNode; icon?: React.ReactNode };

/** 分段块（ProfileTab 外观那一排）：单选传 value，多选传 values */
function Seg<T extends string | number>({
  opts,
  value,
  values,
  onPick,
  mono,
  testId,
}: {
  opts: Opt<T>[];
  value?: T;
  values?: T[];
  onPick: (v: T) => void;
  mono?: boolean;
  testId?: string;
}) {
  return (
    <div
      className="grid gap-2 p-1 bg-inset rounded-control border border-divider"
      style={{ gridTemplateColumns: `repeat(${opts.length}, minmax(0, 1fr))` }}
      data-testid={testId}
    >
      {opts.map(o => {
        const on = values ? values.includes(o.v) : value === o.v;
        return (
          <button
            key={String(o.v)}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(o.v)}
            className={`min-h-[40px] py-2 rounded-chip flex flex-col items-center justify-center gap-1 transition-colors duration-tap ease-paper ${
              mono ? 'font-mono text-[13px] font-semibold' : 'text-xs font-medium'
            } ${on ? 'bg-accent text-on-accent' : 'text-secondary hover:text-primary hover:bg-card-hover'}`}
          >
            {o.icon}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const Item: React.FC<{ label: string; aside?: React.ReactNode; children: React.ReactNode }> = ({ label, aside, children }) => (
  <div className="space-y-2">
    <p className="ui-section-label px-1 flex justify-between">
      <span>{label}</span>
      {aside && <span className="font-mono text-micro text-tertiary">{aside}</span>}
    </p>
    {children}
  </div>
);

/** 「名称 … 值」一行（ProfileTab 振动行，去掉图标方块） */
const Row: React.FC<{
  name: React.ReactNode;
  value: React.ReactNode;
  onClick?: () => void;
  role?: string;
  checked?: boolean;
  danger?: boolean;
  testId?: string;
}> = ({ name, value, onClick, role, checked, danger, testId }) => (
  <button
    type="button"
    onClick={onClick}
    role={role}
    aria-checked={role === 'switch' ? checked : undefined}
    data-testid={testId}
    className="w-full min-h-[44px] -my-1 px-1 py-1 flex justify-between items-center gap-3 rounded-control text-left transition-colors duration-tap ease-paper active:bg-inset"
  >
    <span className={`font-bold ${danger ? 'text-danger' : 'text-primary'}`}>{name}</span>
    {value}
  </button>
);

const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-2">
    <h3 className="px-2 text-xs font-semibold text-secondary">{title}</h3>
    <div className="ui-card p-5 space-y-4">{children}</div>
  </section>
);

const Rule = () => <div className="h-px bg-divider -mx-1" />;

export const PrefsSheet: React.FC<PrefsSheetProps> = ({
  open,
  onClose,
  syncStatus,
  lastSyncedAt,
  onSync,
  onExportData,
  onImportData,
  onOpenLibrary,
  onToggleLanguage,
  onResetAccount,
  onLogout,
  devMode,
  onToggleDevMode,
}) => {
  const { lang, unit, appPrefs, changeAppPrefs } = useUserSettingsContext();
  // 手动切单位＝今天换了一套片子：工作台上没做完的组跟着重新取整（useGymSwitch）
  const { switchUnit } = useGymSwitch();
  const isCn = lang === Language.CN;
  const t = (cn: string, en: string) => (isCn ? cn : en);

  const theme = useTheme();
  const motion = useMotionPreference();
  const [haptics, setHaptics] = useState(hapticsEnabled);
  const [feel, setFeel] = useState<ScrubFeel>(scrubFeel);

  // 撤销上次导入（原 BackupCard）：有副本才出这一行
  const rollbackImport = useRollbackImport();
  const [rollback, setRollback] = useState<RollbackInfo | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void readRollback()
      .then(info => { if (alive) setRollback(info); })
      .catch(() => { /* 读不到就是没有 */ });
    return () => { alive = false; };
  }, [open]);

  // 「N 分钟前」每分钟走一次
  const [, tick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => tick(n => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [open]);

  // ===== 整张下拉关闭（ExercisePickerSheet 同一套） =====
  const sheetRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dragRef = useRef<{ startY: number; y: number } | null>(null);

  const endDrag = () => {
    const el = sheetRef.current;
    const d = dragRef.current;
    dragRef.current = null;
    if (!el) return;
    el.style.transition = '';
    el.style.transform = '';
    if (d && d.y > 90) closeRef.current();
  };
  const endDragRef = useRef(endDrag);
  endDragRef.current = endDrag;

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const DECIDE_PX = 4;
    let t: { x0: number; y0: number; mode: 'undecided' | 'drag' | 'pass' } | null = null;
    let swallowClick = false;
    let swallowTimer: number | undefined;
    const onStart = (e: TouchEvent) => {
      swallowClick = false;
      t = openRef.current && e.touches.length === 1
        ? { x0: e.touches[0].clientX, y0: e.touches[0].clientY, mode: 'undecided' }
        : null;
    };
    const onMove = (e: TouchEvent) => {
      if (!t || t.mode === 'pass') return;
      if (e.touches.length !== 1) {
        if (t.mode === 'drag') endDragRef.current();
        t = null;
        return;
      }
      const dx = e.touches[0].clientX - t.x0;
      const dy = e.touches[0].clientY - t.y0;
      if (t.mode === 'undecided') {
        if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return;
        const atTop = (bodyRef.current?.scrollTop ?? 0) <= 0;
        if (dy > 0 && Math.abs(dy) > Math.abs(dx) && atTop) {
          t.mode = 'drag';
          t.y0 = e.touches[0].clientY;
          dragRef.current = { startY: t.y0, y: 0 };
          el.style.transition = 'none';
        } else {
          t.mode = 'pass';
          return;
        }
      }
      e.preventDefault();
      const d = dragRef.current;
      if (!d) return;
      d.y = Math.max(0, e.touches[0].clientY - d.startY);
      el.style.transform = `translateY(${d.y}px)`;
    };
    const onEnd = () => {
      if (t?.mode === 'drag') {
        if ((dragRef.current?.y ?? 0) > DECIDE_PX) {
          swallowClick = true;
          window.clearTimeout(swallowTimer);
          swallowTimer = window.setTimeout(() => (swallowClick = false), 400);
        }
        endDragRef.current();
      }
      t = null;
    };
    const onClickCapture = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    el.addEventListener('click', onClickCapture, true);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('click', onClickCapture, true);
      window.clearTimeout(swallowTimer);
    };
  }, []);

  // 鼠标：只在抓手和头部拖（桌面调试用）
  const mouseDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || (e.target as HTMLElement).closest('button')) return;
    dragRef.current = { startY: e.clientY, y: 0 };
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const mouseMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (e.pointerType !== 'mouse' || !d || !sheetRef.current) return;
    d.y = Math.max(0, e.clientY - d.startY);
    sheetRef.current.style.transform = `translateY(${d.y}px)`;
  };
  const mouseUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && dragRef.current) endDrag();
  };
  const dragHandlers = { onPointerDown: mouseDown, onPointerMove: mouseMove, onPointerUp: mouseUp, onPointerCancel: mouseUp };

  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [open]);

  // ===== 选项 =====
  const themeOpts: Opt<ThemePreference>[] = [
    { v: 'auto', label: t('跟随系统', 'System'), icon: <Smartphone size={18} strokeWidth={1.75} /> },
    { v: 'light', label: t('浅色', 'Light'), icon: <Sun size={18} strokeWidth={1.75} /> },
    { v: 'dark', label: t('深色', 'Dark'), icon: <Moon size={18} strokeWidth={1.75} /> },
  ];
  // 档名自己说清楚（审查 teaching-text-candidates：删掉每档下面那行说明）
  const motionOpts: Opt<MotionPreference>[] = [
    { v: 'auto', label: t('跟系统', 'System') },
    { v: 'off', label: t('总有动效', 'Always') },
    { v: 'on', label: t('减弱', 'Reduce') },
  ];
  const cardioOpts: Opt<string>[] = [
    { v: 'duration', label: t('时长', 'Time') },
    { v: 'distance', label: t('距离', 'Distance') },
    { v: 'speed', label: t('速度', 'Speed') },
    { v: 'reps', label: t('次数', 'Reps') },
  ];

  const onOff = (on: boolean) => (
    <span className={`text-label font-semibold ${on ? 'text-accent' : 'text-tertiary'}`}>
      {on ? t('开', 'On') : t('关', 'Off')}
    </span>
  );
  const chevron = <ChevronRight size={16} strokeWidth={2} className="text-tertiary flex-shrink-0" />;

  const ago = (ms: number) => {
    const m = Math.floor((Date.now() - ms) / 60_000);
    if (m < 1) return t('刚刚', 'just now');
    if (m < 60) return t(`${m} 分钟前`, `${m} min ago`);
    const h = Math.floor(m / 60);
    return t(`${h} 小时前`, `${h} h ago`);
  };
  const syncValue =
    syncStatus === 'syncing' ? (
      <span className="text-label font-semibold text-tertiary flex items-center gap-1.5 whitespace-nowrap">
        <RefreshCw size={14} className="animate-spin" />
        {t('同步中', 'Syncing')}
      </span>
    ) : syncStatus === 'error' ? (
      <span className="text-label font-semibold text-danger flex items-center gap-1.5 whitespace-nowrap">
        <AlertCircle size={14} />
        {t('同步失败', 'Sync failed')}
      </span>
    ) : (
      <span className="text-label font-semibold text-success flex items-center gap-1.5 whitespace-nowrap">
        <Check size={14} strokeWidth={2.5} />
        {lastSyncedAt ? `${t('已同步', 'Synced')} · ${ago(lastSyncedAt)}` : t('已同步', 'Synced')}
      </span>
    );

  return createPortal(
    <div className={`fixed inset-0 z-sheet ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div
        className={`absolute inset-0 bg-scrim transition-opacity duration-base ease-paper ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <section
        ref={sheetRef}
        className={`absolute inset-x-0 bottom-0 mx-auto max-w-2xl bg-base border-t border-divider rounded-t-[22px] shadow-elevated flex flex-col transition-transform duration-300 ease-out ${
          open ? 'translate-y-0' : 'translate-y-[103%]'
        }`}
        style={{ height: '92dvh' }}
        role="dialog"
        aria-label={t('首选项', 'Preferences')}
        data-testid="prefs-sheet"
      >
        <div
          className="flex-shrink-0 pt-2.5 pb-1.5 cursor-grab active:cursor-grabbing select-none"
          style={{ touchAction: 'none' }}
          {...dragHandlers}
        >
          <div className="w-12 h-1.5 rounded-full bg-divider mx-auto" />
        </div>
        <div
          className="flex items-center gap-2.5 px-4 pt-1.5 pb-0.5 flex-shrink-0 select-none cursor-grab active:cursor-grabbing min-h-[52px]"
          style={{ touchAction: 'none' }}
          {...dragHandlers}
        >
          <h2 className="font-display text-lg font-semibold text-primary whitespace-nowrap">{t('首选项', 'Preferences')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto -mr-2.5 w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-control text-secondary hover:bg-card-hover active:scale-press-sm transition-ui"
            aria-label={t('关闭', 'Close')}
            data-testid="prefs-sheet-close"
          >
            <X size={21} />
          </button>
        </div>

        <div
          ref={bodyRef}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar px-4 pt-2 space-y-4"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 40px)' }}
        >
          <Group title={t('训练', 'Training')}>
            <Item label={t('重量单位', 'Weight unit')}>
              <Seg mono opts={[{ v: 'kg', label: 'kg' }, { v: 'lbs', label: 'lbs' }]} value={unit} onPick={v => switchUnit(v as 'kg' | 'lbs')} testId="prefs-unit" />
            </Item>
            {/* 有器材的动作按馆档案走（选馆弹层里「编辑」）；这两项只管没标器材的动作 */}
            <Item label={t('没标器材时 ±', '± (no equipment)')} aside={unit}>
              <Seg
                mono
                opts={WEIGHT_STEP_OPTIONS.map(v => ({ v: v as number, label: String(v) }))}
                value={appPrefs.weightStep}
                onPick={v => changeAppPrefs({ weightStep: v })}
                testId="prefs-weight-step"
              />
            </Item>
            <Item label={t('没标器材时递减', 'Drop (no equipment)')} aside={unit}>
              <Seg
                mono
                opts={DROP_STEP_OPTIONS.map(v => ({ v: v as number, label: String(v) }))}
                value={appPrefs.dropStep}
                onPick={v => changeAppPrefs({ dropStep: v })}
                testId="prefs-drop-step"
              />
            </Item>
            <Item label={t('滑动手感', 'Scrub feel')}>
              <Seg
                opts={[
                  { v: 'fine' as ScrubFeel, label: t('细', 'Fine') },
                  { v: 'mid' as ScrubFeel, label: t('中', 'Medium') },
                  { v: 'coarse' as ScrubFeel, label: t('粗', 'Coarse') },
                ]}
                value={feel}
                onPick={v => {
                  setScrubFeel(v);
                  setFeel(v);
                }}
              />
            </Item>
          </Group>

          <Group title={t('动作', 'Exercises')}>
            <Item label={t('有氧默认记录', 'Cardio records')}>
              <Seg
                opts={cardioOpts}
                values={appPrefs.cardioMetrics}
                onPick={v => {
                  const cur = appPrefs.cardioMetrics;
                  const has = cur.includes(v);
                  if (has && cur.length === 1) return; // 至少留一项
                  changeAppPrefs({ cardioMetrics: has ? cur.filter(x => x !== v) : cardioOpts.map(o => o.v).filter(x => x === v || cur.includes(x)) });
                }}
                testId="prefs-cardio"
              />
            </Item>
            <Item label={t('距离单位', 'Distance unit')}>
              <Seg mono opts={[{ v: 'km', label: 'km' }, { v: 'mi', label: 'mi' }]} value={appPrefs.distUnit} onPick={v => changeAppPrefs({ distUnit: v as 'km' | 'mi' })} testId="prefs-dist-unit" />
            </Item>
            <Row name={t('动作库与标签', 'Library & tags')} value={chevron} onClick={onOpenLibrary} testId="prefs-open-library" />
          </Group>

          <Group title={t('显示', 'Display')}>
            <Item label={t('外观', 'Appearance')}>
              <Seg opts={themeOpts} value={theme.preference} onPick={theme.setPreference} />
            </Item>
            <Item label={t('动效', 'Motion')}>
              <Seg opts={motionOpts} value={motion.preference} onPick={motion.setPreference} />
            </Item>
            <Item label={t('语言', 'Language')}>
              <Seg
                // 语言名用它自己的文字写；标上 lang，读屏按中文念，e2e 的英文模式扫雷也认这个标记
                opts={[{ v: Language.CN, label: <span lang="zh-CN">中文</span> }, { v: Language.EN, label: 'English' }]}
                value={lang}
                onPick={v => v !== lang && onToggleLanguage()}
                testId="language-toggle"
              />
            </Item>
            <Item label={t('每周开始于', 'Week starts on')}>
              <Seg
                opts={[{ v: 'mon', label: t('周一', 'Monday') }, { v: 'sun', label: t('周日', 'Sunday') }]}
                value={appPrefs.weekStart}
                onPick={v => changeAppPrefs({ weekStart: v as 'mon' | 'sun' })}
                testId="prefs-week-start"
              />
            </Item>
          </Group>

          <Group title={t('设备', 'Device')}>
            <Row
              name={t('振动反馈', 'Haptics')}
              value={onOff(haptics)}
              role="switch"
              checked={haptics}
              onClick={() => {
                const next = !haptics;
                setHapticsEnabled(next);
                setHaptics(next);
                if (next) haptic(H.tap);
              }}
            />
          </Group>

          <Group title={t('数据', 'Data')}>
            <Row name={t('同步', 'Sync')} value={syncValue} onClick={onSync} testId="prefs-sync" />
            <Rule />
            <button type="button" onClick={onExportData} className="ui-btn-secondary w-full flex items-center justify-center gap-2 py-3.5">
              <Download size={18} strokeWidth={1.75} className="text-accent" />
              {t('立即导出备份', 'Export backup')}
            </button>
            <button type="button" onClick={onImportData} className="ui-btn-secondary w-full flex items-center justify-center gap-2 py-3.5">
              <Upload size={18} strokeWidth={1.75} className="text-accent" />
              {translations.importData[lang]}
            </button>
            <p className="text-[10px] text-tertiary leading-relaxed text-center px-3 -mt-2">{translations.importDesc[lang]}</p>
            {rollback && (
              <>
                <button
                  type="button"
                  onClick={() => { void rollbackImport(); }}
                  className="ui-btn-secondary w-full flex items-center justify-center gap-2 py-3"
                >
                  <Undo2 size={18} strokeWidth={1.75} className="text-accent" />
                  {translations.undoImport[lang]}
                </button>
                <p className="text-[10px] text-tertiary text-center -mt-2">
                  {t(
                    `导入前的副本 · ${rollback.workouts} 次训练 · ${rollback.createdAt.split('T')[0]}`,
                    `Pre-import copy · ${rollback.workouts} workouts · ${rollback.createdAt.split('T')[0]}`,
                  )}
                </p>
              </>
            )}
            {onToggleDevMode && (
              <>
                <Rule />
                <Row
                  name={
                    <span className="block">
                      {t('数据环境', 'Data Environment')}
                      <span className="block text-[10px] font-normal text-tertiary mt-0.5">
                        {devMode
                          ? t('state-dev · FitLogDB-dev · 与真实数据完全隔离', 'state-dev · FitLogDB-dev · fully isolated')
                          : t('state · FitLogDB · 真实用户数据', 'state · FitLogDB · real user data')}
                      </span>
                    </span>
                  }
                  value={
                    <span className={`text-xs font-semibold px-3 py-1 rounded-chip shrink-0 ${devMode ? 'bg-warning/15 text-warning' : 'bg-card text-secondary'}`}>
                      {devMode ? t('开发', 'Dev') : t('用户', 'User')}
                    </span>
                  }
                  onClick={onToggleDevMode}
                />
              </>
            )}
            {onLogout && (
              <>
                <Rule />
                <Row name={translations.logout[lang]} value={chevron} danger onClick={onLogout} />
              </>
            )}
            <Rule />
            <Row name={translations.resetAccount[lang]} value={chevron} danger onClick={onResetAccount} testId="prefs-reset-account" />
          </Group>
        </div>
      </section>
    </div>,
    document.body,
  );
};

export default PrefsSheet;
