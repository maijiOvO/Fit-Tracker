/**
 * 首选项弹层（审查 2026-10-06 第一节第 3 点；demo 是 docs/demos/prefs-sheet.html，2026-10-26 用户拍板第二版结构）。
 *
 * 入口是「我的」页底部一行「首选项 ›」。外壳照 ExercisePickerSheet：整页高、顶部 22px 圆角、抓手、标题、右上 ×，
 * 整张弹层可下拉关闭（同一套原生非被动 touchmove，见 ExercisePickerSheet 的注释）。
 *
 * 分五组：单位与记录 / 手感 / 外观与地区 / 数据 / 账户，按「这一项管什么」分。行的积木在 prefsRows.tsx。
 * 自动备份 / 导出 / 导入是弹层里的二级页（标题栏左侧返回，安卓返回键先回主页）。
 * 跟数据走的（单位、步长、递减、有氧默认、距离单位、语言、周起始日）记进 appPrefs（打时间戳 + 推送）；
 * 跟设备走的（外观、动效、振动、滑动手感、删组撤销）各自存在本机。
 * 界面里不写说明文字（单人自用），导入的后果说明和导入前副本那行是状态，保留。
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, Moon, RefreshCw, Smartphone, Sun, X, AlertCircle } from 'lucide-react';
import { Language } from '../../types';
import { translations } from '../../translations';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useTheme, ThemePreference, AccentPreference } from '../hooks/useTheme';
import { useMotionPreference, MotionPreference } from '../hooks/useMotionPreference';
import { hapticsEnabled, setHapticsEnabled, haptic, H } from '../utils/haptics';
import { scrubFeel, setScrubFeel, ScrubFeel } from '../utils/scrubFeel';
import { WEIGHT_STEP_OPTIONS, DROP_STEP_OPTIONS } from '../../services/appPrefs';
import { useRollbackImport } from '../hooks/useImportData';
import { readRollback, type RollbackInfo } from '../../services/fitlogBackup';
import type { SyncStatus } from '../hooks/useFitlogSync';
import { isRemoteConfigured } from '../../services/fitlogRemote';
import { useGymSwitch } from '../hooks/useGymSwitch';
import { BackupPage, BackupRow, ExportPage, ImportPage } from './data/DataSafetySection';
import { Go, Group, Line, Seg, Stack, Toggle, type Opt } from './prefsRows';
import { useBackClose } from '../hooks/useBackClose';

interface PrefsSheetProps {
  open: boolean;
  onClose: () => void;
  syncStatus: SyncStatus;
  pushState?: 'synced' | 'pending' | 'failed';
  dataBusy?: boolean;
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

/** 弹层里的页：主页 + 三个二级页（标题栏左侧出返回） */
type View = 'main' | 'backup' | 'export' | 'import';

export const PrefsSheet: React.FC<PrefsSheetProps> = ({
  open,
  onClose,
  syncStatus,
  pushState = 'synced',
  dataBusy = false,
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
  const [view, setView] = useState<View>('main');
  // 安卓返回键关首选项（审查 B11）；在二级页时先回主页（后登记的在上面）
  useBackClose(open, onClose);
  useBackClose(open && view !== 'main', () => setView('main'));
  // 手动切单位只换显示：存的 kg 一个不动，工作台上的组也不重新取整（useGymSwitch，2026-10-21 起）
  const { switchUnit } = useGymSwitch();
  const isCn = lang === Language.CN;
  const t = (cn: string, en: string) => (isCn ? cn : en);
  const titles: Record<View, string> = {
    main: t('首选项', 'Preferences'),
    backup: t('自动备份', 'Auto backup'),
    export: t('导出', 'Export'),
    import: t('导入', 'Import'),
  };

  const theme = useTheme();
  const motion = useMotionPreference();
  const [haptics, setHaptics] = useState(hapticsEnabled);
  const [feel, setFeel] = useState<ScrubFeel>(scrubFeel);

  // 撤销上次导入：有副本才出这一行
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
    if (open) setView('main');
  }, [open]);
  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [open, view]);

  // ===== 选项 =====
  const themeOpts: Opt<ThemePreference>[] = [
    { v: 'auto', label: t('跟随系统', 'System'), icon: <Smartphone size={18} strokeWidth={1.75} /> },
    { v: 'light', label: t('浅色', 'Light'), icon: <Sun size={18} strokeWidth={1.75} /> },
    { v: 'dark', label: t('深色', 'Dark'), icon: <Moon size={18} strokeWidth={1.75} /> },
  ];
  // 色点直接用两套的实色值，不走 --accent（那只反映当前选中的一套）；只有色点，名字给读屏
  const dark = theme.resolved === 'dark';
  const accentOpts: { v: AccentPreference; name: string; c: string }[] = [
    { v: 'teal', name: t('青', 'Teal'), c: dark ? '#2BE0C0' : '#12B39A' },
    { v: 'sky', name: t('浅蓝', 'Sky'), c: dark ? '#38BDF8' : '#0EA5E9' },
    { v: 'violet', name: t('紫', 'Violet'), c: dark ? '#7445F0' : '#7C3AED' },
    { v: 'rose', name: t('玫红', 'Rose'), c: dark ? '#E0245C' : '#E11D5C' },
    { v: 'orange', name: t('橙', 'Orange'), c: dark ? '#FF8A3D' : '#F97316' },
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
    ) : syncStatus === 'error' || pushState === 'failed' ? (
      <span className="text-label font-semibold text-danger flex items-center gap-1.5 whitespace-nowrap">
        <AlertCircle size={14} />
        {t('同步失败 · 只在本机', 'Sync failed · on this device only')}
      </span>
    ) : pushState === 'pending' ? (
      // 有改动还没推上去（审查 B12：原来只要没报错就写「已同步」）
      <span className="text-label font-semibold text-tertiary flex items-center gap-1.5 whitespace-nowrap">
        <RefreshCw size={14} />
        {t('待同步', 'Pending')}
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
          {view !== 'main' && (
            <button
              type="button"
              onClick={() => setView('main')}
              className="-ml-3 -mr-1.5 w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-control text-secondary hover:bg-card-hover active:scale-press-sm transition-ui"
              aria-label={t('返回', 'Back')}
              data-testid="prefs-sheet-back"
            >
              <ChevronLeft size={22} strokeWidth={2} />
            </button>
          )}
          <h2 className="font-display text-lg font-semibold text-primary whitespace-nowrap">{titles[view]}</h2>
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
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar px-4 pt-2 space-y-8"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 40px)' }}
        >
          {view === 'main' && (
            <>
              <Group title={t('单位与记录', 'Units & logging')}>
                <Line name={t('重量单位', 'Weight unit')}>
                  <Seg inline num opts={[{ v: 'kg', label: 'kg' }, { v: 'lbs', label: 'lbs' }]} value={unit} onPick={v => switchUnit(v as 'kg' | 'lbs')} testId="prefs-unit" />
                </Line>
                <Line name={t('距离单位', 'Distance unit')}>
                  <Seg inline num opts={[{ v: 'km', label: 'km' }, { v: 'mi', label: 'mi' }]} value={appPrefs.distUnit} onPick={v => changeAppPrefs({ distUnit: v as 'km' | 'mi' })} testId="prefs-dist-unit" />
                </Line>
                {/* 有器材的动作按馆档案走（选馆弹层里「编辑」）；这两项只管没标器材的动作 */}
                <Stack
                  name={
                    <span className="text-small font-medium text-primary">
                      {t('未标器材的动作', 'No equipment set')}
                      <span className="ml-1.5 font-mono text-small font-semibold text-tertiary">{unit}</span>
                    </span>
                  }
                >
                  <div className="grid grid-cols-[36px_1fr] items-center gap-2">
                    <span className="text-label text-tertiary">±</span>
                    <Seg
                      num
                      opts={WEIGHT_STEP_OPTIONS.map(v => ({ v: v as number, label: String(v) }))}
                      value={appPrefs.weightStep}
                      onPick={v => changeAppPrefs({ weightStep: v })}
                      testId="prefs-weight-step"
                    />
                    <span className="text-label text-tertiary">{t('递减', 'Drop')}</span>
                    <Seg
                      num
                      opts={DROP_STEP_OPTIONS.map(v => ({ v: v as number, label: String(v) }))}
                      value={appPrefs.dropStep}
                      onPick={v => changeAppPrefs({ dropStep: v })}
                      testId="prefs-drop-step"
                    />
                  </div>
                </Stack>
                <Stack name={t('有氧默认记录', 'Cardio records')}>
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
                </Stack>
                <Go name={t('动作库与标签', 'Library & tags')} onClick={onOpenLibrary} testId="prefs-open-library" />
              </Group>

              <Group title={t('手感', 'Feel')}>
                <Line name={t('滑动手感', 'Scrub feel')}>
                  <Seg
                    inline
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
                </Line>
                <Toggle
                  name={t('振动反馈', 'Haptics')}
                  on={haptics}
                  onChange={next => {
                    setHapticsEnabled(next);
                    setHaptics(next);
                    if (next) haptic(H.tap);
                  }}
                  testId="prefs-haptics"
                />
                <Line name={t('动效', 'Motion')}>
                  <Seg inline opts={motionOpts} value={motion.preference} onPick={motion.setPreference} />
                </Line>
              </Group>

              <Group title={t('外观与地区', 'Appearance & region')}>
                <Stack name={t('外观', 'Appearance')}>
                  <Seg opts={themeOpts} value={theme.preference} onPick={theme.setPreference} />
                </Stack>
                <Line name={t('强调色', 'Accent')}>
                  <div className="flex flex-shrink-0 gap-0.5" data-testid="prefs-accent">
                    {accentOpts.map(o => {
                      const on = theme.accent === o.v;
                      return (
                        <button
                          key={o.v}
                          type="button"
                          aria-pressed={on}
                          aria-label={o.name}
                          onClick={() => theme.setAccent(o.v)}
                          className="w-[34px] h-[34px] flex items-center justify-center rounded-full"
                        >
                          <span
                            className={`w-[22px] h-[22px] rounded-full transition-shadow duration-tap ease-paper ${on ? 'ring-2 ring-primary ring-offset-2 ring-offset-card' : ''}`}
                            style={{ background: o.c }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </Line>
                <Line name={t('语言', 'Language')}>
                  <Seg
                    inline
                    // 语言名用它自己的文字写；标上 lang，读屏按中文念，e2e 的英文模式扫雷也认这个标记
                    opts={[{ v: Language.CN, label: <span lang="zh-CN">中文</span> }, { v: Language.EN, label: 'English' }]}
                    value={lang}
                    onPick={v => v !== lang && onToggleLanguage()}
                    testId="language-toggle"
                  />
                </Line>
                <Line name={t('每周开始于', 'Week starts on')}>
                  <Seg
                    inline
                    opts={[{ v: 'mon', label: t('周一', 'Mon') }, { v: 'sun', label: t('周日', 'Sun') }]}
                    value={appPrefs.weekStart}
                    onPick={v => changeAppPrefs({ weekStart: v as 'mon' | 'sun' })}
                    testId="prefs-week-start"
                  />
                </Line>
              </Group>

              <Group title={t('数据', 'Data')}>
                {/* 没有服务器（单机版 / 演示版）就没有同步这回事：整行不出（审查 B12） */}
                {isRemoteConfigured() && (
                  <Go name={t('同步', 'Sync')} value={syncValue} chevron={false} onClick={onSync} testId="prefs-sync" />
                )}
                <BackupRow onOpen={() => setView('backup')} />
                <Go name={t('导出', 'Export')} onClick={() => setView('export')} testId="prefs-open-export" />
                <Go name={t('导入', 'Import')} onClick={() => setView('import')} testId="prefs-open-import" />
                {rollback && (
                  <Go
                    name={translations.undoImport[lang]}
                    tone="accent"
                    sub={t(
                      `导入前的副本 · ${rollback.workouts} 次训练 · ${rollback.createdAt.split('T')[0]} · 留 7 天`,
                      `Pre-import copy · ${rollback.workouts} workouts · ${rollback.createdAt.split('T')[0]} · kept 7 days`,
                    )}
                    chevron={false}
                    onClick={() => { void rollbackImport(rollback.newer); }}
                    testId="prefs-undo-import"
                  />
                )}
              </Group>

              <Group title={t('账户', 'Account')}>
                {onToggleDevMode && (
                  <Go
                    name={t('数据环境', 'Data Environment')}
                    sub={
                      devMode
                        ? t('state-dev · FitLogDB-dev · 与真实数据完全隔离', 'state-dev · FitLogDB-dev · fully isolated')
                        : t('state · FitLogDB · 真实用户数据', 'state · FitLogDB · real user data')
                    }
                    value={
                      <span className={`text-label font-semibold px-2.5 py-0.5 rounded-chip ${devMode ? 'bg-warning/15 text-warning' : 'bg-inset text-secondary'}`}>
                        {devMode ? t('开发', 'Dev') : t('用户', 'User')}
                      </span>
                    }
                    chevron={false}
                    onClick={onToggleDevMode}
                  />
                )}
                {onLogout && <Go name={translations.logout[lang]} tone="danger" onClick={onLogout} />}
                <Go name={translations.resetAccount[lang]} tone="danger" onClick={onResetAccount} testId="prefs-reset-account" />
              </Group>
            </>
          )}
          {view === 'backup' && <BackupPage />}
          {view === 'export' && <ExportPage onExportJson={onExportData} busy={dataBusy} />}
          {view === 'import' && <ImportPage onImportJson={onImportData} busy={dataBusy} />}
        </div>
      </section>
    </div>,
    document.body,
  );
};
