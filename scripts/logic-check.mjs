#!/usr/bin/env node
/**
 * 散在各处的纯逻辑自检：体重 30 天基线 / 变化、PR 判定（刊末页 / 训练中 / 历史同一份口径）与印章换单位、
 * 底稿抄哪一场、龙门架标签迁移、递减档取整保持方向、按馆的片子单位取整、单边挂片、动作属性的器材 ⇄ 阻力联动、
 * 覆盖层合并、交替组改记到别的动作、搜索归一化、热力图按本地日期归日、撞名动作的解析、配重片拖动的下限、文案表的英文不缺不漏。
 *
 * 这些规则原先只有 e2e 里一个数据点在守（一条用例造一次夹具、看一个数），边界情况（都在 30 天内、
 * 本馆没练过、带器材标签的 tagGym、有氧……）一条都没测。这里照 workbench-check / prefs-check 的写法：
 * esbuild 打成临时 ESM、node:assert 直接跑，不起浏览器，一秒内跑完。e2e 留着那个数据点当「接线接上了」的证明。
 *
 * 用法：node scripts/logic-check.mjs
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'logic-check-'));
const out = join(dir, 'logic.mjs');

// useLoadRounder / useLoadKind 顶上引了 React context：这里只用它们导出的纯函数，context 换成空壳
const stubContexts = {
  name: 'stub-contexts',
  setup(b) {
    b.onResolve({ filter: /\/contexts\// }, a => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'const no = () => { throw new Error("context used in logic-check"); }; export const useExercisePrefs = no; export const useUserSettingsContext = no; export const useWorkoutContext = no;',
      loader: 'js',
    }));
  },
};

await build({
  stdin: {
    contents: [
      "export * from './src/utils/weightSummary.ts';",
      "export { stampsInUnit } from './src/utils/prDetect.ts';",
      "export { findLastIn, findLastAltGroup, altCombosByName, altPartners, planRowPicks, vsLastSession, sourceCards, prefillSourceLookup } from './src/utils/prefillSource.ts';",
      "export { migrateCableTags } from './src/utils/cableTagMigration.ts';",
      "export { migrateWarmRegions } from './src/utils/warmRegionMigration.ts';",
      "export { makeRounder, ownUnitOf, cardUnitOf, roundPrefill, reRoundPending, snapUntouched } from './src/hooks/useLoadRounder.ts';",
      "export * as A from './src/utils/exerciseAttrs.ts';",
      "export { mergeOverride, mergedName } from './src/utils/exerciseOverride.ts';",
      "export { detectPRs } from './src/utils/prDetect.ts';",
      "export * as R from './src/utils/prRecords.ts';",
      "export * as LDS from './src/utils/liftDisplay.ts';",
      "export { buildLiftSummaries, trendPoints, prSessionIds, gymChoices, inGym, latestGymView } from './src/utils/liftHistory.ts';",
      "export { doneWorkoutsOf, liftSummariesFor } from './src/hooks/useLiftSummaries.ts';",
      "export * as G from './src/utils/goalProgress.ts';",
      "export { moveSetToExercise, stripWorkbenchSet, toRecorded, hasUserInput, editKey } from './src/utils/workbench.ts';",
      "export * as S from './src/utils/exerciseSearch.ts';",
      "export { trackScrub, scrubGate, ENGAGE_PX } from './src/utils/scrubFeel.ts';",
      "export { buildHeatmapDays, heatmapCells } from './src/utils/heatmapDays.ts';",
      "export { buildNameIndex, byDisplayName, ownValue, rawKeysIn } from './src/utils/nameIndex.ts';",
      "export * as LI from './src/utils/liftIdentity.ts';",
      "export * as EM from './src/utils/exerciseMerge.ts';",
      "export { DEFAULT_EXERCISES } from './src/constants/exercises.ts';",
      "export * as GY from './src/utils/gyms.ts';",
      "export { rowLastSession, browseRank, liveEquips } from './src/hooks/useExercisePickerData.ts';",
      "export { translations } from './translations.ts';",
      "export { sessionDurationMin } from './src/utils/sessionDuration.ts';",
      "export { sessionsBefore, redateLiveSession, redateEdited, isBackdated, undoLogExpired } from './src/utils/sessionDate.ts';",
      "export { resolvePickedDate, stepMinute, msToNextLocalMidnight, monthDay } from './src/utils/dateUtils.ts';",
      "export { nextKeyboardGuess } from './src/utils/keyboardGuess.ts';",
      "export { isDefaultTitle, retitleForDate } from './src/utils/workbench.ts';",
      "export { handleHardwareBack } from './src/hooks/useBackClose.ts';",
      "export { planMergeIntoPrevious, mergeableIds, absorbIntoResumed } from './src/utils/sessionMerge.ts';",
      "export * as SS from './src/utils/setStep.ts';",
      "export * as SW from './src/utils/setWrite.ts';",
      "export * as MD from './src/utils/metricDefaults.ts';",
      "export { parseTypedNum } from './src/utils/format.ts';",
      "export * as LD from './src/utils/load.ts';",
      "export * as LB from './src/utils/loadable.ts';",
      "export { boundDetent, heroFocus, scrubTier, ACCEL_VELOCITY, SCRUB_FEEL_PX } from './src/utils/scrubFeel.ts';",
      "export * as TAP from './src/utils/tap.ts';",
      "export { cardToRevisit } from './src/utils/pickerRevisit.ts';",
      "export { FitLogDB, dbReadFailing, dbWriteFailing } from './services/db.ts';",
      "export * as LC from './services/localCensus.ts';",
      "export * as WP from './services/workbenchPersist.ts';",
      "export * as PD from './src/utils/planDrafts.ts';",
      "export * as FR from './services/fitlogRemote.ts';",
      "export * as FB from './services/fitlogBackup.ts';",
      "export * as FS from './services/fitlogSyncScheduler.ts';",
      "export * as ML from './src/utils/measurementLog.ts';",
      "export * as AP from './services/appPrefs.ts';",
      "export { storage } from './services/appStorage.ts';",
      "export { undoJournal } from './services/undoJournal.ts';",
      "export { PREFS_SENTINEL } from './scripts/prefsSentinel.ts';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'silent',
  plugins: [stubContexts],
  define: { 'import.meta.env': '{}' },
});

/** 内存版 localStorage（appPrefs 顶层会读） */
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  clear: () => mem.clear(),
  key: i => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};

const L = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 21, 12);
const ago = d => new Date(NOW - d * DAY).toISOString();
const K = 2.20462;
const LB = 0.45359237;

// ── 体重 30 天基线（Dashboard 的「-4.4 lbs · 30天」）────────────────────
t('体重基线：取截止点之前最近的一次，不是最早那条；顺序打乱也一样', () => {
  const w = (d, kg) => ({ date: ago(d), weight: kg });
  const s = L.weightBaseline([w(90, 90), w(1, 80), w(35, 82), w(20, 81)], NOW);
  assert.equal(s.latest.weight, 80);
  assert.equal(s.baseline.weight, 82, '35 天前那次（82）才是 30 天前那一刻最近的一次，不是 90 天前的 90');
  assert.equal(s.count, 4);
});
t('体重基线：都在 30 天内退到最早一条；正好 30 天算在截止点之前；只有一条时基线就是它自己', () => {
  const w = (d, kg) => ({ date: ago(d), weight: kg });
  assert.equal(L.weightBaseline([w(3, 79), w(10, 81), w(29, 83)], NOW).baseline.weight, 83);
  assert.equal(L.weightBaseline([w(1, 79), w(30, 84), w(31, 85)], NOW).baseline.weight, 84);
  const one = L.weightBaseline([w(5, 70)], NOW);
  assert.equal(one.baseline, one.latest);
  assert.equal(one.count, 1);
  assert.equal(L.weightBaseline([], NOW), null);
});

// ── PR 印章换单位（pr-stamp-kg-labeled-lbs）──────────────────────────
t('印章换单位：lbs 下重量 / 容量换算，次数不换；kg 下原样返回', () => {
  const stamps = [
    { kind: 'weight', exercise: '卧推', prev: 185 / K, next: 200 / K, delta: 15 / K, unitLabel: '' },
    { kind: 'volume', exercise: '卧推', prev: 1000, next: 1200, delta: 200, unitLabel: '' },
    { kind: 'reps', exercise: '引体', prev: 8, next: 10, delta: 2, unitLabel: '' },
  ];
  assert.equal(L.stampsInUnit(stamps, 'kg', K), stamps);
  const lb = L.stampsInUnit(stamps, 'lbs', K);
  assert.deepEqual([lb[0].prev, lb[0].next, lb[0].delta].map(v => Math.round(v * 10) / 10), [185, 200, 15]);
  assert.equal(Math.round(lb[1].next), Math.round(1200 * K));
  assert.deepEqual(lb[2], stamps[2], 'reps are not a weight');
});

// ── 底稿抄哪一场（换馆重量 A）────────────────────────────────────────
t('底稿来源：本馆优先，本馆没练过退回最近一次；没标馆取最近；跳过只有底稿的、跳过指定那场', () => {
  const ex = (name, sets, variantId) => ({ id: `${name}${variantId ?? ''}`, name, category: 'STRENGTH', variantId, sets });
  const done = w => ({ id: 's', weight: w, reps: 10 });
  const ghost = w => ({ id: 'g', weight: w, reps: 10, ghost: true });
  const W = (id, gym, exs) => ({ id, gym, date: '', exercises: exs });
  // 新的在前
  const ws = [
    W('w_ghost', 'A', [ex('推肩', [ghost(99)])]),
    W('w_b', 'B', [ex('推肩', [done(23)])]),
    W('w_a', 'A', [ex('推肩', [done(40)])]),
    W('w_a_old', 'A', [ex('推肩', [done(35)])]),
  ];
  const id = s => s;
  // 交替成员的标签：不同名的只按名字（这几条防不同名搭配的口径被同名组的修法带偏）
  const nm = e => e.name;
  const vOf = e => e.variantId;
  assert.equal(L.findLastIn(ws, id, vOf, '推肩', null, undefined, 'A').workout.id, 'w_a', 'same gym first');
  assert.equal(L.findLastIn(ws, id, vOf, '推肩', null, undefined, 'B').workout.id, 'w_b');
  assert.equal(L.findLastIn(ws, id, vOf, '推肩', null, undefined, 'C').workout.id, 'w_b', 'never trained at C → latest anywhere');
  assert.equal(L.findLastIn(ws, id, vOf, '推肩').workout.id, 'w_b', 'no gym → latest');
  assert.equal(L.findLastIn(ws, id, vOf, '推肩', null, 'w_a', 'A').workout.id, 'w_a_old', 'skipWorkoutId');
  assert.equal(L.findLastIn(ws, id, vOf, '深蹲'), null);
  // 连带交替搭档：上一次单练了，也要找到更早那次交替做的那场（2026-11-02 用户指出）；只在组里但没搭档的、只有底稿的不算
  const alt = (name, g, sets) => ({ ...ex(name, sets), altGroup: g });
  const wa = [
    W('solo_last', 'A', [ex('举腿', [done(0)])]),
    W('alt_ghost', 'A', [alt('举腿', 'g2', [ghost(0)]), alt('卷腹', 'g2', [done(0)])]),
    W('alt_ok', 'A', [alt('卷腹', 'g1', [done(0)]), alt('举腿', 'g1', [done(0)])]),
    W('lonely', 'A', [alt('举腿', 'g0', [done(0)])]),
  ];
  assert.equal(L.findLastAltGroup(wa, id, nm, '举腿').workout.id, 'alt_ok', 'skip the solo session and the ghost-only one');
  assert.equal(L.findLastAltGroup(wa, id, nm, '举腿', 'alt_ok'), null, 'a group with no other member does not count');
  assert.equal(L.findLastAltGroup(wa, id, nm, '深蹲'), null);
  // 同一个动作的几种搭配都要列得出来（2026-11-10 用户指出）：最近的在前（第 0 个＝点动作行带的），成员相同的不管先后只留最近一次
  const wc = [
    W('c_now', 'A', [alt('磕头机', 'n', [done(0)]), alt('举腿', 'n', [done(0)])]),
    W('c_13', 'A', [alt('磕头机', 'g3', [done(0)]), alt('举腿', 'g3', [done(0)])]),
    W('c_123', 'B', [alt('磕头机', 'g2', [done(0)]), alt('卷腹', 'g2', [done(0)]), alt('举腿', 'g2', [done(0)])]),
    W('c_31', 'A', [alt('举腿', 'g1', [done(0)]), alt('磕头机', 'g1', [done(0)])]),
  ];
  const combos = L.altCombosByName(wc, id, nm, 'c_now');
  assert.deepEqual(combos.get('磕头机').map(c => c.workout.id), ['c_13', 'c_123'], 'newest first, same members once');
  assert.deepEqual(combos.get('磕头机')[1].mates, ['卷腹', '举腿'], 'mates keep the order of that session');
  assert.deepEqual(combos.get('卷腹').map(c => c.workout.id), ['c_123'], 'each exercise only sees its own groups');
  assert.equal(L.findLastAltGroup(wc, id, nm, '磕头机', 'c_now').workout.id, 'c_13', 'row tap brings combo 0');
  // 做法：'' = 标准做法，别的做法不算
  const wv = [W('v1', 'A', [ex('推肩', [done(30)], 'wide')]), W('v0', 'A', [ex('推肩', [done(20)])])];
  assert.equal(L.findLastIn(wv, id, vOf, '推肩', '', undefined, 'A').workout.id, 'v0');
  assert.equal(L.findLastIn(wv, id, vOf, '推肩', 'wide', undefined, 'A').workout.id, 'v1');
  assert.equal(L.findLastIn(wv, id, vOf, '推肩', null, undefined, 'A').workout.id, 'v1', 'null = any variant');
  // 名字按 resolveName 认（改过名的动作）
  assert.equal(L.findLastIn([W('r', 'A', [ex('旧名', [done(10)])])], n => (n === '旧名' ? '新名' : n), vOf, '新名').workout.id, 'r');
});

// ── 左右分记（§12.10：同一动作的两个做法 + 交替组）：成员按「名字（做法）」认（审查 C103 / gap-4#2 / gap-4#3）──────────
const lrFixture = () => {
  const id = s => s;
  const vOf = e => e.variantId;
  const lbl = e => (e.variantName ? `${e.name}（${e.variantName}）` : e.name);
  const S = (w, r) => ({ id: `${w}x${r}`, weight: w, reps: r });
  const C = (cid, name, v, vn, sets, g) => ({ id: cid, name, category: 'STRENGTH', ...(v ? { variantId: v, variantName: vn } : {}), sets, ...(g ? { altGroup: g } : {}) });
  const W = (wid, days, exs) => ({ id: wid, gym: '', date: ago(days), exercises: exs });
  const curl = (cid, v, sets, g) => C(cid, '哑铃弯举', v, v === 'L' ? '左' : v === 'R' ? '右' : '中', sets, g);
  const w_lr = W('w_lr', 10, [curl('lr_l', 'L', [S(12, 10)], 'g1'), curl('lr_r', 'R', [S(14, 8)], 'g1')]);
  const w_r = W('w_r', 2, [curl('r_solo', 'R', [S(15, 8)])]);
  const w_bf = W('w_bf', 5, [C('bf_b', '卧推', 'wide', '宽握', [S(30, 10)], 'g2'), C('bf_f', '哑铃飞鸟', '', '', [S(10, 12)], 'g2')]);
  const w_bench = W('w_bench', 1, [C('bench', '卧推', '', '', [S(60, 5)])]);
  return { id, vOf, lbl, S, C, W, curl, w_lr, w_r, w_bf, w_bench };
};

t('连带交替搭档：同名成员按做法占位，「左 ⇄ 右」不塌成「右 ⇄ 右」；不同名组照旧（审查 C103）', () => {
  // 防的错：搭档只按名字认，点「右」时搭档也按名字找底稿、本场已有也按名字判，连带进来是「右 ⇄ 右」
  const { id, vOf, lbl, w_lr, w_r, w_bf, w_bench } = lrFixture();
  const ws = [w_bench, w_r, w_bf, w_lr];
  const hit = L.findLastAltGroup(ws, id, lbl, '哑铃弯举');
  const shape = ps => ps.map(p => [p.member.id, p.self, p.byVariant]);
  const R = { name: '哑铃弯举', variantId: 'R', variantName: '右' };
  const Lf = { name: '哑铃弯举', variantId: 'L', variantName: '左' };
  assert.deepEqual(shape(L.altPartners(hit, R, id, lbl)), [['lr_l', false, true], ['lr_r', true, true]]);
  assert.equal(L.findLastIn(ws, id, vOf, '哑铃弯举', 'L').ex.sets[0].weight, 12, '搭档「左」抄左自己的数');
  assert.equal(L.findLastIn(ws, id, vOf, '哑铃弯举', 'R').ex.sets[0].weight, 15, '交替之后单练过右：右抄 15');
  assert.deepEqual(shape(L.altPartners(hit, Lf, id, lbl)), [['lr_l', true, true], ['lr_r', false, true]]);
  const M = { name: '哑铃弯举', variantId: 'M', variantName: '中' };
  assert.deepEqual(L.altPartners(hit, M, id, lbl).filter(p => p.self).map(p => p.member), [hit.ex], '做法不在组里：占 altHit.ex 的位置');
  const bh = L.findLastAltGroup(ws, id, lbl, '卧推');
  assert.deepEqual(shape(L.altPartners(bh, { name: '卧推' }, id, lbl)), [['bf_b', true, false], ['bf_f', false, false]], '不同名组：标准卧推占宽握那张，飞鸟不按做法');
});

t('交替搭配列表：同名组只出一种、mates 带做法；[左,右] 和 [左,中] 是两种（审查 gap-4#2）', () => {
  // 防的错：同名组的 sig 只按名字，[左,右] 和 [左,中] 被当成同一种去重；或同名组在这个名字下列两遍
  const { id, lbl, S, W, curl, w_lr } = lrFixture();
  const one = L.altCombosByName([w_lr], id, lbl).get('哑铃弯举');
  assert.equal(one.length, 1);
  assert.deepEqual(one[0].mates, ['哑铃弯举（右）']);
  const w_lm = W('w_lm', 20, [curl('lm_l', 'L', [S(11, 10)], 'g9'), curl('lm_m', 'M', [S(13, 8)], 'g9')]);
  assert.deepEqual(L.altCombosByName([w_lr, w_lm], id, lbl).get('哑铃弯举').map(c => c.workout.id), ['w_lr', 'w_lm']);
});

t('计划开练：同名两行对上次的左 / 右；「卧推、深蹲、卧推」不把两段卧推并成一组；单行和不同名组同现状（审查 gap-4#3）', () => {
  // 防的错：每行都取上一场第一张同名卡、同名的几行拿到同一个组键 —— 情形 A 开出来是「左 ⇄ 左」，情形 B 两段卧推被并成交替组、计划顺序丢了
  const { id, vOf, lbl, S, W, curl, w_lr, w_bf, w_bench } = lrFixture();
  const picks = (names, ws, inherit = true) => L.planRowPicks(names, ws, id, lbl, vOf, n => L.findLastIn(ws, id, vOf, n, null), inherit);
  const groupsOf = ps => ps.map(p => (p.group ? 'G' : '-')).join('');
  const lr = ['哑铃弯举', '哑铃弯举'];
  const a = picks(lr, [w_lr]);
  assert.deepEqual(a.map(p => p.variantId), ['L', 'R']);
  assert.equal(groupsOf(a), 'GG');
  assert.equal(a[0].group, a[1].group);
  const wl = W('w_l', 1, [curl('l_solo', 'L', [S(13, 10)])]);
  const a2 = picks(lr, [wl, w_lr]);
  assert.deepEqual([a2.map(p => p.variantId), groupsOf(a2)], [['L', 'R'], 'GG'], '交替之后单练过左');
  const sep = W('w_sep', 1, [curl('s_l', 'L', [S(12, 10)]), curl('s_r', 'R', [S(14, 8)])]);
  const a3 = picks(lr, [sep], false);
  assert.deepEqual([a3.map(p => p.variantId), groupsOf(a3)], [['L', 'R'], '--'], '连带关、上一场左右两张卡');
  const a4 = picks([...lr, '哑铃弯举'], [w_lr]);
  assert.deepEqual([a4.map(p => p.variantId), groupsOf(a4)], [['L', 'R', 'R'], 'GG-'], '三行：第三行对到同一张旧卡，不进组');
  assert.equal(groupsOf(picks(['卧推', '深蹲', '卧推'], [w_bf])), '---', '情形 B');
  assert.equal(groupsOf(picks(['卧推', '哑铃飞鸟', '卧推'], [w_bf])), 'GG-', '计划里带飞鸟');
  assert.deepEqual(picks(['卧推'], [w_bench, w_bf]), [{}], '单行：不指定做法、不成组，同现状');
});

t('底稿来源：命中那场同项目的几张卡按卡序都收进来（别的做法不收）；只铺一张抄合起来的，铺几张一一对应', () => {
  // 防的错：gap-4#1 只抄第一张（并入后热身卡 40×10、60×8 顶掉正式组 80×5×3）；
  // 也防本批修法自己的回归：计划排两行开练时每行各铺出全部组、行数翻倍
  const C = (id, sets, variantId) => ({ id, name: '卧推', category: 'STRENGTH', sets, ...(variantId ? { variantId } : {}) });
  const S = (w, r) => ({ id: `${w}x${r}`, weight: w, reps: r });
  const w = { id: 'p', date: ago(2), gym: '', exercises: [
    C('a', [S(40, 10), S(60, 8)]), C('x', [S(30, 12)], '哑铃'), C('b', [S(80, 5), S(80, 5), S(80, 5)]), C('g', [{ ...S(90, 1), ghost: true }]),
  ] };
  const vOf = e => e.variantId;
  const ids = xs => xs.map(e => e.id);
  const std = L.findLastIn([w], n => n, vOf, '卧推', '');
  assert.deepEqual([std.ex.id, ids(std.exs)], ['a', ['a', 'b']], 'ghost-only card not collected');
  assert.deepEqual(ids(L.findLastIn([w], n => n, vOf, '卧推', null).exs), ['a', 'b'], 'any variant: only the hit card\'s variant');
  assert.deepEqual(ids(L.findLastIn([w], n => n, vOf, '卧推', '哑铃').exs), ['x']);
  assert.deepEqual(ids(L.sourceCards(std, 0, 1)), ['a', 'b']);
  assert.deepEqual([0, 1].map(k => ids(L.sourceCards(std, k, 2))), [['a'], ['b']]);
  const one = L.findLastIn([{ ...w, exercises: [C('a', [S(100, 5)])] }], n => n, vOf, '卧推', '');
  assert.deepEqual([0, 1].map(k => ids(L.sourceCards(one, k, 2))), [['a'], ['a']], 'last time one card: both rows copy it (as before)');
});

t('刊末页「比上次」：每个动作这场与上一场的最好一组（最重，同重比次数，递减档也算）；底稿、全零、没上一场的不列', () => {
  // 防的错：拿第一组或最后一组比（热身 / 递减把对比带偏），把底稿行当成做过，带正负的动作按绝对值比（辅助 20 比辅助 10「重」）
  const S = (w, r, extra = {}) => ({ id: `${w}x${r}`, weight: w, reps: r, ...extra });
  const bench = { id: 'b', name: '卧推', category: 'STRENGTH', sets: [S(60, 10), S(80, 8), S(80, 6), S(90, 1, { ghost: true })] };
  const pull = { id: 'p', name: '引体', category: 'STRENGTH', sets: [S(10, 8, { bodyweightMode: 'assisted' }), S(5, 6, { bodyweightMode: 'assisted' })] };
  const fresh = { id: 'f', name: '新动作', category: 'STRENGTH', sets: [S(20, 10)] };
  const empty = { id: 'e', name: '空', category: 'STRENGTH', sets: [S(0, 0)] };
  const last = {
    卧推: { id: 'lb', name: '卧推', category: 'STRENGTH', sets: [S(80, 7), S(70, 10, { subSets: [{ id: 's', weight: 82.5, reps: 2 }] })] },
    引体: { id: 'lp', name: '引体', category: 'STRENGTH', sets: [S(10, 8, { bodyweightMode: 'assisted' })] },
    空: { id: 'le', name: '空', category: 'STRENGTH', sets: [S(50, 5)] },
  };
  const findLast = e => (last[e.name] ? { ex: last[e.name], workout: { id: 'w0', date: '', exercises: [] } } : null);
  const got = L.vsLastSession([bench, pull, fresh, empty], {
    keyOf: e => e.name, findLast, ruleOf: e => L.R.prRuleFor(['weight', 'reps'], e.name === '引体', false), gym: undefined,
  });
  assert.deepEqual(got, [
    { exId: 'b', key: '卧推', now: { kg: 80, reps: 8 }, last: { kg: 82.5, reps: 2 } },
    { exId: 'p', key: '引体', now: { kg: -5, reps: 6 }, last: { kg: -10, reps: 8 } },
  ]);
});

t('刊末页「比上次」：一个项目一行，同场同项目的几张卡合起来比；标签带做法；器械退回别的馆比时带出馆名', () => {
  // 防的错：gap-4#1 / gap-6#5 只拿第一张卡比（并入后的热身卡 60×8 当成上次、退阶卡单列一行去比上次的正式组）；
  // gap-6#6 器械本馆没练过退回 A馆 比，却不写是哪个馆
  const S = (w, r) => ({ id: `${w}x${r}`, weight: w, reps: r });
  const C = (id, name, sets, variantId) => ({ id, name, category: 'STRENGTH', sets, ...(variantId ? { variantId } : {}) });
  const W = (id, d, gym, exs) => ({ id, date: ago(d), gym, exercises: exs });
  const vOf = e => e.variantId;
  const keyOf = e => (e.variantId ? `${e.name}（${e.variantId}）` : e.name);
  const run = (ws, now, extra = {}) => L.vsLastSession(now, {
    keyOf, ruleOf: () => L.R.prRuleFor(['weight', 'reps'], false, false), gym: '',
    findLast: e => L.findLastIn(ws, n => n, vOf, e.name, vOf(e) ?? '', 'now', extra.prefer?.(e)), ...extra,
  }).map(r => [r.key, `${r.now.kg}x${r.now.reps}`, `${r.last.kg}x${r.last.reps}`, r.lastGym ?? null]);
  // a：上一场并入后有两张卧推（热身卡 + 正式卡）
  const merged = W('p', 2, '', [C('a', '卧推', [S(40, 10), S(60, 8)]), C('b', '卧推', [S(80, 5), S(80, 5), S(80, 5)])]);
  assert.deepEqual(run([merged], [C('n', '卧推', [S(80, 5)])]), [['卧推', '80x5', '80x5', null]]);
  // b：两场都是正式 + 退阶（同做法）
  const prev = W('p2', 3, '', [C('a2', '卧推', [S(100, 5)]), C('b2', '卧推', [S(60, 10)])]);
  assert.deepEqual(run([prev], [C('n1', '卧推', [S(100, 5)]), C('n2', '卧推', [S(60, 10)])]), [['卧推', '100x5', '100x5', null]]);
  // c：标准、哑铃各一张 → 两行，标签带做法
  const p3 = W('p3', 3, '', [C('x', '罗马尼亚硬拉', [S(100, 8)]), C('y', '罗马尼亚硬拉', [S(30, 12)], '哑铃')]);
  assert.deepEqual(run([p3], [C('m', '罗马尼亚硬拉', [S(90, 8)]), C('k', '罗马尼亚硬拉', [S(25, 12)], '哑铃')]), [
    ['罗马尼亚硬拉', '90x8', '100x8', null],
    ['罗马尼亚硬拉（哑铃）', '25x12', '30x12', null],
  ]);
  // d：器械上一场只在 A馆、今天在 B馆 → 写 A馆；杠铃不写；同馆的器械也不写
  const a = W('a', 5, 'A馆', [C('x', '腿举', [S(200, 10)]), C('z', '卧推', [S(100, 5)])]);
  const machine = { ruleOf: e => L.R.prRuleFor(['weight', 'reps'], false, e.name === '腿举'), prefer: e => (e.name === '腿举' ? 'B馆' : undefined) };
  assert.deepEqual(run([a], [C('y', '腿举', [S(100, 10)]), C('q', '卧推', [S(100, 5)])], { ...machine, gym: 'B馆' }), [
    ['腿举', '100x10', '200x10', 'A馆'],
    ['卧推', '100x5', '100x5', null],
  ]);
  assert.deepEqual(run([a], [C('y', '腿举', [S(100, 10)])], { ...machine, gym: 'A馆', prefer: () => 'A馆' }), [['腿举', '100x10', '200x10', null]]);
});

t('卡头「上次」：按底稿记下的来源卡列组；没记来源卡的旧草稿按做法取那场全部同项目卡；同一键回同一个对象', () => {
  // 防的错（gap-6#3）：按「日期 + 名字」取那场第一张同名卡 —— 哑铃做法的底稿点开写的是杠铃那张 100×8；复制为今天的第二张卡列的是第一张的组
  const S = (w, r) => ({ id: `${w}x${r}`, weight: w, reps: r });
  const prev = { id: 'p', date: ago(2), exercises: [
    { id: 'bb', name: '罗马尼亚硬拉', category: 'STRENGTH', sets: [S(100, 8), S(100, 8)] },
    { id: 'db', name: '罗马尼亚硬拉', category: 'STRENGTH', variantId: '哑铃', sets: [S(30, 12), S(30, 12)] },
  ] };
  const copy = { id: 'c', date: ago(3), exercises: [
    { id: 'm1', name: '卧推', category: 'STRENGTH', sets: [S(100, 5)] },
    { id: 'm2', name: '卧推', category: 'STRENGTH', sets: [S(60, 10)] },
  ] };
  const look = L.prefillSourceLookup([prev, copy], n => n, e => e.variantId);
  const kgs = h => h?.sets.map(s => s.weight);
  assert.deepEqual(kgs(look({ name: '罗马尼亚硬拉', variantId: '哑铃', prefillFrom: prev.date, prefillIds: ['db'] })), [30, 30]);
  assert.deepEqual(kgs(look({ name: '罗马尼亚硬拉', variantId: '哑铃', prefillFrom: prev.date })), [30, 30], 'old draft without prefillIds: by variant');
  assert.deepEqual(kgs(look({ name: '卧推', prefillFrom: copy.date, prefillIds: ['m2'] })), [60], 'second copied card sees its own source card');
  const a = { name: '卧推', prefillFrom: copy.date, prefillIds: ['m1', 'm2'] };
  assert.deepEqual(kgs(look(a)), [100, 60], 'several source cards: in card order');
  assert.equal(look(a), look({ ...a }), 'same key → same object (F4: card memo)');
  // 并入上一场后那场日期变了：按 id 还找得到
  assert.deepEqual(kgs(look({ name: '卧推', prefillFrom: ago(9), prefillIds: ['m2'] })), [60], 'merged session moved date: fall back to ids');
});

// ── 龙门架标签迁移（cableTagMigration）──────────────────────────────
t('龙门架迁移：tagGym → tagCable；已有器材标签只摘掉 tagGym；有氧不动；「龙门架」改名摘掉', () => {
  const p = {
    customExercises: [
      { id: 'c1', name: { cn: '下压', en: '下压' }, bodyPart: 'subArms', tags: ['tagGym'], category: 'STRENGTH' },
      { id: 'c2', name: { cn: '杠铃X', en: '杠铃X' }, bodyPart: 'subArms', tags: ['tagGym', 'tagBarbell'], category: 'STRENGTH' },
      { id: 'c3', name: { cn: '椭圆机', en: '椭圆机' }, bodyPart: 'subLegs', tags: ['tagGym'], category: 'CARDIO' },
    ],
    exerciseOverrides: { face_pull_cable: { tags: ['tagGym'] }, run_tread: { tags: ['tagGym'] } },
    tagRenameOverrides: { tagGym: '龙门架', tagBarbell: '杠' },
    other: 1,
  };
  const m = L.migrateCableTags(p);
  assert.notEqual(m, p);
  assert.deepEqual(m.customExercises.map(d => d.tags), [['tagCable'], ['tagBarbell'], ['tagGym']]);
  assert.deepEqual(m.exerciseOverrides.face_pull_cable.tags, ['tagCable']);
  assert.deepEqual(m.exerciseOverrides.run_tread.tags, ['tagGym'], 'built-in cardio (treadmill) stays');
  assert.deepEqual(m.tagRenameOverrides, { tagBarbell: '杠' });
  assert.equal(m.other, 1);
  // 别的改名不算龙门架：留着；cable 开头的英文名也摘
  assert.deepEqual(L.migrateCableTags({ tagRenameOverrides: { tagGym: '健身房' } }).tagRenameOverrides, { tagGym: '健身房' });
  assert.deepEqual(L.migrateCableTags({ tagRenameOverrides: { tagGym: 'Cable station' } }).tagRenameOverrides, {});
  // 做法里的标签也纠正
  const v = L.migrateCableTags({ customExercises: [{ id: 'v', name: { cn: 'v', en: 'v' }, tags: ['tagCable'], variants: [{ id: 'x', tags: ['tagGym'] }], category: 'STRENGTH' }] });
  assert.deepEqual(v.customExercises[0].variants[0].tags, ['tagCable']);
  // 没有要改的：原样返回同一个对象（调用方靠 !== 决定写不写回）
  const clean = { customExercises: [p.customExercises[1]].map(d => ({ ...d, tags: ['tagBarbell'] })), tagRenameOverrides: {} };
  assert.equal(L.migrateCableTags(clean), clean);
});

// ── 热身细分 → 热身用途（warmRegionMigration）────────────────────────
t('热身迁移：主细分是热身＝只当热身；兼着热身＝训练 + 热身；做法 / 布局里的热身细分摘掉；可反复跑', () => {
  const p = {
    customExercises: [
      // 只放在热身列：只当热身，热身部位＝胸
      { id: 'c1', name: { cn: '扩胸', en: '扩胸' }, bodyPart: 'subChest', region: 'chestWarm', regions: ['chestWarm'], category: 'STRENGTH' },
      // 主细分热身、还兼内侧：内侧顶上来当主，训练 + 热身
      { id: 'c2', name: { cn: '蝴蝶机', en: '蝴蝶机' }, bodyPart: 'subChest', region: 'chestWarm', regions: ['chestWarm', 'chestInner', 'shFront'], category: 'STRENGTH' },
      // 主细分正常、兼着背的热身：训练 + 热身（背）
      { id: 'c3', name: { cn: '划船', en: '划船' }, bodyPart: 'subBack', region: 'backMid', regions: ['backMid', 'backWarm'], category: 'STRENGTH', variants: [{ id: 'v1', name: '宽', region: 'backWarm', regions: ['backWarm'] }] },
    ],
    // 内置动作的覆盖层：拖进过热身列
    exerciseOverrides: { pushup: { region: 'chestWarm', regions: ['chestWarm'] }, bp_barbell: { bar: 'std' } },
    customTags: [{ id: 'regionLayout:subChest', name: '', category: 'regionLayout', parentPart: 'subChest', order: ['chestWarm', 'chestMid'], hidden: ['chestWarm', 'chestOuter'] }],
    tagRenameOverrides: { chestWarm: '热身活动', chestMid: '胸中' },
    other: 1,
  };
  const m = L.migrateWarmRegions(p);
  const [c1, c2, c3] = m.customExercises;
  assert.deepEqual([c1.region, c1.regions, c1.warmParts, c1.warmOnly], ['', [], ['subChest'], true]);
  assert.deepEqual([c2.region, c2.regions, c2.warmParts, c2.warmOnly], ['chestInner', ['chestInner', 'shFront'], ['subChest'], undefined]);
  assert.deepEqual([c3.region, c3.regions, c3.warmParts, c3.warmOnly], ['backMid', ['backMid'], ['subBack'], undefined]);
  assert.deepEqual([c3.variants[0].region, c3.variants[0].regions], ['', []], 'variant falls back to the exercise');
  assert.deepEqual(m.exerciseOverrides.pushup, { region: '', regions: [], warmParts: ['subChest'], warmOnly: true });
  assert.equal(m.exerciseOverrides.bp_barbell, p.exerciseOverrides.bp_barbell, 'untouched override keeps identity');
  assert.deepEqual([m.customTags[0].order, m.customTags[0].hidden], [['chestMid'], ['chestOuter']]);
  assert.deepEqual(m.tagRenameOverrides, { chestMid: '胸中' });
  assert.equal(m.other, 1);
  // 已经是热身用途的再跑一遍：原样返回同一个对象
  assert.equal(L.migrateWarmRegions(m), m);
  // 已有 warmParts 的并上去、不重复
  const u = L.migrateWarmRegions({ customExercises: [{ id: 'u', name: { cn: 'u', en: 'u' }, bodyPart: 'subChest', region: 'chestMid', regions: ['chestMid', 'shWarm'], warmParts: ['subChest'] }] });
  assert.deepEqual(u.customExercises[0].warmParts, ['subChest', 'subShoulder']);
  // 什么都没有：同一个对象
  const clean = { customExercises: [p.customExercises[2]].map(d => ({ ...d, regions: ['backMid'], variants: [] })) };
  assert.equal(L.migrateWarmRegions(clean), clean);
});

// ── 递减档取整保持方向（useLoadRounder.keepSubOrder）─────────────────
const pinInfo = { kind: 'pin', stack: 'machine', libKind: 'pin', defId: 'press_machine_shoulder' };
const lbCtx = (inc, start = 0) => ({ unit: 'lbs', plates: [45, 35, 25, 10, 5, 2.5], bar: 45, inc, start });
const ex1 = { id: 'e', name: '器械推肩', category: 'STRENGTH', sets: [] };
const dropSet = (main, drop) => ({ id: 's', weight: main * LB, reps: 9, ghost: true, subSets: [{ weight: drop * LB, reps: 6 }] });
const lbsOf = s => [s.weight, ...(s.subSets ?? []).map(x => x.weight)].map(kg => Math.round(kg * K * 100) / 100);

t('递减档保持方向：22 → 16.6 lb 在每格 10 的插销上两档都会吸成 20，递减必须仍然更轻（→ 10）', () => {
  const r = L.makeRounder(pinInfo, 'lbs', lbCtx(10), false);
  const [s] = L.roundPrefill([dropSet(22, 16.6)], ex1, r);
  assert.deepEqual(lbsOf(s), [20, 10]);
  assert.ok(s.draftAuto && s.subSets[0].draftAuto);
});
t('递减档保持方向：最轻 12.5 · 每格 5 —— 从原值铺 22 / 16.6 → 22.5 / 17.5；卡上的 20 / 10 再吸 → 17.5 / 12.5（等距取轻）；挪不动（已到最轻）的照原样；改过的递减档不管', () => {
  const r = L.makeRounder(pinInfo, 'lbs', lbCtx(5, 12.5), false);
  assert.deepEqual(lbsOf(L.roundPrefill([dropSet(22, 16.6)], ex1, r)[0]), [22.5, 17.5]);
  assert.deepEqual(lbsOf(L.snapUntouched([dropSet(20, 10)], ex1, r)[0]), [17.5, 12.5]);
  // 没动过的底稿换刻度：从上一次的原值（prefillRef）重算，不从已经取整过的数再换
  const [drafted] = L.roundPrefill([dropSet(22, 16.6)], ex1, L.makeRounder(pinInfo, 'lbs', lbCtx(10), false));
  assert.deepEqual(lbsOf(L.reRoundPending([drafted], ex1, r)[0]), [22.5, 17.5]);
  // 母组本来就在最轻一格：递减档挪不到更轻，留在 12.5（不能吸到格子外面）
  assert.deepEqual(lbsOf(L.roundPrefill([dropSet(12.5, 10)], ex1, r)[0]), [12.5, 12.5]);
  // 改过的递减档：snapUntouched 不碰它
  const touched = { ...dropSet(22, 16.6) };
  touched.subSets = [{ ...touched.subSets[0], touched: { weight: true } }];
  const [u] = L.snapUntouched([touched], ex1, r);
  assert.equal(u.subSets[0], touched.subSets[0]);
});
// ── 选中组操作条的 ± / 递减一档（固定在底栏上方，和组行上原来那一行同一套算法）────────
t('± 一档：纯数字走首选项步长、换算残留不取整、普通重量下限 0、带正负的跨过 0；有馆档案先吸到那个方向最近能挂的', () => {
  assert.equal(L.SS.bumpShown(61.24, 1, null, 5, false), 66.24);
  assert.equal(L.SS.bumpShown(3, -1, null, 5, false), 0);
  assert.equal(L.SS.bumpShown(3, -1, null, 5, true), -2);
  const r = L.makeRounder(pinInfo, 'lbs', lbCtx(10), false);
  assert.equal(L.SS.bumpShown(22, 1, r, 5, false), 30);
  assert.equal(L.SS.bumpShown(22, -1, r, 5, false), 20);
  // 键上的数：在格子上写一档；不在格子上（换算残留）也写一档，不写「离格子还差多少」
  assert.equal(L.SS.stepShown(20, 1, r, 5), 10);
  assert.equal(L.SS.stepShown(22, 1, r, 5), 10);
  assert.equal(L.SS.stepShown(61.24, 1, null, 5), 5);
});
t('递减一档：纯数字 ∓ 递减步长（残留先取整）、下限 0、带正负可降进辅助；有馆档案 ∓ 一格，吸回原处按能挂的下一个走，最轻一格不动', () => {
  assert.equal(L.SS.nextDropShown(61.24, -1, null, 5, false), 56);
  assert.equal(L.SS.nextDropShown(61.24, 1, null, 5, false), 67);
  assert.equal(L.SS.nextDropShown(2, -1, null, 5, false), 0);
  assert.equal(L.SS.nextDropShown(2, -1, null, 5, true), -3);
  assert.equal(L.SS.nextDropShown(20, -1, L.makeRounder(pinInfo, 'lbs', lbCtx(10), false), 5, false), 10);
  // 2026-11-18 用户定：有馆档案的器材也减「递减每档」（卡的单位下的 5），再吸到能挂的；不是只减一格（每格 2.5 时只降 2.5）
  assert.equal(L.SS.nextDropShown(20, -1, L.makeRounder(pinInfo, 'lbs', lbCtx(2.5), false), 5, false), 15);
  assert.equal(L.SS.nextDropShown(20, 1, L.makeRounder(pinInfo, 'lbs', lbCtx(2.5), false), 5, false), 25);
  assert.equal(L.SS.nextDropShown(12.5, -1, L.makeRounder(pinInfo, 'lbs', lbCtx(5, 12.5), false), 5, false), 12.5);
});

// ── 显示值写回一组（setWrite）：组行、底栏操作条、大图三处共用，防一处改了另两处还是旧口径 ──
t('写回一组：显示值 ⇄ 存储 kg（两位小数去尾零；lb 换回 kg；有取整器存格子的精确 kg；带正负写号；按显示单位夹上限）', () => {
  assert.equal(L.SW.formatLoad(62.25, 'kg'), '62.25');
  assert.equal(L.SW.formatLoad(20, 'kg'), '20');
  assert.equal(L.SW.formatLoad(100 * LB, 'lbs'), '100');
  assert.equal(L.SW.shownWeight(10, -1, 'kg'), -10);
  // 不带正负写的是普通重量：bodyweightMode 写成 undefined，清掉底稿抄来的旧号（gap-2#5）
  assert.deepEqual(L.SW.weightFromShown(62.5, 'kg', null, false), { weight: 62.5, plateUnit: 'kg', bodyweightMode: undefined });
  const lb = L.SW.weightFromShown(100, 'lbs', null, false);
  assert.equal(lb.plateUnit, 'lbs');
  assert.ok(Math.abs(lb.weight - 100 / 2.20462) < 1e-9);
  assert.deepEqual(L.SW.weightFromShown(-10, 'kg', null, true), { weight: 10, plateUnit: 'kg', bodyweightMode: 'assisted' });
  assert.equal(L.SW.weightFromShown(0, 'kg', null, true).bodyweightMode, 'normal');
  assert.equal(L.SW.weightFromShown(5, 'kg', null, true).bodyweightMode, 'weighted');
  assert.equal(L.SW.weightFromShown(9999, 'kg', null, false).weight, 500);
  const r = L.makeRounder(pinInfo, 'lbs', lbCtx(10), false);
  const w = L.SW.weightFromShown(30, 'lbs', r, false);
  assert.deepEqual([w.weight, w.plateUnit], [r.kgOfD(30), r.unit]);
});
// 防 gap-2#5 修法自带的回退：改器材后不带正负的卡上打 / 改回的重量还挂着旧辅助号，新记的组一直按 0 比，再也不出纪录
t('写回一组：不带正负的卡写重量（打字、改回上次）时清掉组上旧的辅助号', () => {
  const old = { id: 's', weight: 30, reps: 8, bodyweightMode: 'assisted' };
  const typed = { ...old, ...L.SW.weightFromShown(45, 'kg', null, false) };
  assert.equal(typed.weight, 45);
  assert.equal(typed.bodyweightMode, undefined);
  const back = { ...old, ...L.SW.restoreUpdate(old, 40, false) };
  assert.equal(back.weight, 40);
  assert.equal(back.bodyweightMode, undefined);
  // 带正负的照旧写号
  assert.equal(L.SW.restoreUpdate(old, -40, true).bodyweightMode, 'assisted');
});
t('换算预览：卡按器械单位写、顶栏是另一种单位时给一位小数的换算；同单位、空重量不给', () => {
  assert.equal(L.SW.altLoadLabel(50, 'kg', 'lbs'), '= 110.2 lb');
  assert.equal(L.SW.altLoadLabel(100 * LB, 'lbs', 'kg'), '= 45.4 kg');
  assert.equal(L.SW.altLoadLabel(20, 'lbs', 'kg'), '= 20 kg');
  assert.equal(L.SW.altLoadLabel(50, 'kg', 'kg'), '');
  assert.equal(L.SW.altLoadLabel(50, 'lbs', 'lbs'), '');
  assert.equal(L.SW.altLoadLabel(0, 'kg', 'lbs'), '');
});
t('写回一组：待做组改了哪个值字段就记进 touched（含号），plateUnit 不算；做完的组原样不记', () => {
  const ghost = { id: 'g', weight: 20, reps: 8, ghost: true, touched: { reps: true } };
  assert.deepEqual(L.SW.markTouched(ghost, { weight: 10, plateUnit: 'kg', bodyweightMode: 'assisted' }).touched, { reps: true, weight: true, bodyweightMode: true });
  assert.deepEqual(L.SW.markTouched(ghost, { subSets: [] }).touched, { reps: true, subSets: true });
  const u = { plateUnit: 'kg' };
  assert.equal(L.SW.markTouched(ghost, u), u);
  const done = { id: 'd', weight: 20, reps: 8 };
  const u2 = { weight: 10 };
  assert.equal(L.SW.markTouched(done, u2), u2);
});

t('递减档保持方向：递增档（比上一档重）吸到同一格时往重的方向挪', () => {
  const r = L.makeRounder(pinInfo, 'lbs', lbCtx(10), false);
  const s = { id: 's', weight: 18 * LB, reps: 9, ghost: true, subSets: [{ weight: 23.4 * LB, reps: 6 }] };
  assert.deepEqual(lbsOf(L.reRoundPending([s], ex1, r)[0]), [20, 30]);
});
// 防 C50：挪一格的探针按显示单位探 0.001，片子单位和显示单位不同时探不出下一格；写回用 fromD 存成近似 kg
t('递减档保持方向：片子单位 ≠ 显示单位时照样挪一格 —— kg 片显示 lb 的 62.5 / 60 → 60 / 55，lb 插销显示 kg 的 22 / 16.6 lb → 20 / 10 lb；存格子的精确 kg（上架审查 C50）', () => {
  const kgPlates = L.LB.profileIn(L.LB.defaultProfile('kg'), 'kg').plates;
  const bar = L.makeRounder({ kind: 'plates' }, 'kg', { unit: 'kg', plates: kgPlates, bar: 20, inc: 5 }, false, 'lbs');
  const [s] = L.roundPrefill([{ id: 's', weight: 62.5, reps: 5, plateUnit: 'kg', subSets: [{ id: 'd', weight: 60, reps: 5 }] }], ex1, bar);
  assert.deepEqual([s.weight, s.subSets[0].weight], [60, 55], '存的是格子本身的 kg，不是 lb 显示值换回来的 54.9997');
  const pin = L.makeRounder(pinInfo, 'lbs', lbCtx(10), false, 'kg');
  const [p] = L.roundPrefill([{ ...dropSet(22, 16.6), ghost: undefined, plateUnit: 'lbs' }], ex1, pin);
  assert.deepEqual(lbsOf(p), [20, 10]);
  assert.equal(p.subSets[0].weight, 10 / K, '10 lb 那一格的精确 kg');
});

// 防 C45：同馆同片的底稿被吸到格子上（手打的 14 变 15 入册、出假纪录）；以及原样抄漏到别的馆 / 别的片子 / 没标馆
const kgProf = () => L.LB.profileIn(L.LB.defaultProfile('kg'), 'kg');
const kgRounders = () => {
  const prof = kgProf();
  const c = inc => ({ unit: 'kg', plates: prof.plates, bar: 20, inc });
  return {
    db: L.makeRounder({ kind: 'pair' }, 'kg', c(prof.dumbbell), false),
    bar: L.makeRounder({ kind: 'plates' }, 'kg', c(5), false),
    cable: L.makeRounder({ kind: 'pin', stack: 'cable' }, 'kg', { ...c(prof.cable), start: 0 }, false),
  };
};
const exAtA = { id: 'e', name: 'x', category: 'STRENGTH', sets: [], prefillGym: 'A' };
const lastSet = (kg, u = 'kg') => [{ id: 's', weight: kg, reps: 8, plateUnit: u }];
t('底稿同馆同片原样抄：默认 kg 档案下上次的 14 / 62.5 / 32.5 不取整、带 keep，递减档一起；别的馆、上次挂磅片、没标馆照旧取整（上架审查 C45）', () => {
  const { db, bar, cable } = kgRounders();
  const [d] = L.roundPrefill(lastSet(14), exAtA, db, 'A');
  assert.deepEqual([d.weight, d.prefillRef.keep], [14, true]);
  assert.equal(L.roundPrefill(lastSet(62.5), exAtA, bar, 'A')[0].weight, 62.5);
  assert.equal(L.roundPrefill(lastSet(32.5), exAtA, cable, 'A')[0].weight, 32.5);
  const [dd] = L.roundPrefill([{ ...lastSet(14)[0], subSets: [{ id: 'd', weight: 11, reps: 6 }] }], exAtA, db, 'A');
  assert.deepEqual([dd.weight, dd.subSets[0].weight, dd.subSets[0].prefillRef.keep], [14, 11, true]);
  const [b] = L.roundPrefill(lastSet(14), exAtA, db, 'B');
  assert.deepEqual([b.weight, b.prefillRef.keep], [15, undefined], '别的馆');
  assert.equal(L.roundPrefill(lastSet(62.5), exAtA, bar, 'B')[0].weight, 60);
  assert.equal(L.roundPrefill(lastSet(32.5), exAtA, cable, 'B')[0].weight, 30);
  assert.equal(L.roundPrefill(lastSet(30 / K, 'lbs'), exAtA, db, 'A')[0].weight, 12.5, '上次挂的是磅片，今天是 kg 格子');
  assert.equal(L.roundPrefill(lastSet(14), { ...exAtA, prefillGym: undefined }, db, undefined)[0].weight, 15, '没标馆');
});
t('底稿重新取整的三种来路：换馆按新馆算、回来源馆又是原数；换台（gym=null）吸到新刻度并记 keep:false，之后同馆也不回原数（上架审查 C45）', () => {
  const { db } = kgRounders();
  const [s] = L.roundPrefill(lastSet(14), exAtA, db, 'A');
  const g = { ...s, ghost: true };
  assert.equal(L.reRoundPending([g], exAtA, db, 'A')[0].weight, 14, '同馆（存档案 / 开练切单位）');
  const atB = L.reRoundPending([g], exAtA, db, 'B')[0];
  assert.deepEqual([atB.weight, atB.prefillRef.keep], [15, undefined]);
  assert.equal(L.reRoundPending([atB], exAtA, db, 'A')[0].weight, 14, '回到来源馆');
  const rig4 = L.makeRounder({ kind: 'pair' }, 'kg', { unit: 'kg', plates: kgProf().plates, bar: 20, inc: 4 }, false);
  const regrid = L.reRoundPending([g], exAtA, rig4, null)[0];
  assert.deepEqual([regrid.weight, regrid.prefillRef.keep], [12, false], '14 在每格 4 上 → 12（等距取轻）');
  const back = L.reRoundPending([regrid], exAtA, rig4, 'A')[0];
  assert.deepEqual([back.weight, back.prefillRef.keep], [12, false], '换过台的同馆再重算也按格子');
});
t('改算进记录的器械自重（snapUntouched）也是这一台的刻度变了：原样抄的底稿记 keep:false，之后存同馆档案不跳回原数；手打过的只摘 keep（D1 审查）', () => {
  const prof = kgProf();
  const loaded = tare => L.makeRounder({ kind: 'loaded' }, 'kg', { unit: 'kg', plates: prof.plates, bar: 0, inc: 0, ...(tare ? { tare } : {}) }, false);
  const [s] = L.roundPrefill(lastSet(63), exAtA, loaded(), 'A');
  assert.deepEqual([s.weight, s.prefillRef.keep], [63, true], '前提：同馆原样抄');
  const [a] = L.snapUntouched([{ ...s, ghost: true }], exAtA, loaded(25), 25);
  assert.equal(a.prefillRef.keep, false, '吸过格子就不再按原数');
  assert.equal(L.reRoundPending([a], exAtA, loaded(25), 'A')[0].prefillRef.keep, false, '之后存甲馆档案也不跳回原数');
  const [t2] = L.snapUntouched([{ ...s, ghost: true, weight: 70, touched: { weight: true } }], exAtA, loaded(25), 25);
  assert.deepEqual([t2.weight, t2.prefillRef.keep], [70, false]);
});

// ── 热力图按本地日期归日（heatmap-utc-day）────────────────────────────
t('热力图：多伦多昨晚 21:15 练的归在昨天（UTC 已经是今天）；只有底稿的场、还在练的那一场不算', () => {
  const tz = process.env.TZ;
  process.env.TZ = 'America/Toronto';
  try {
    // 2026-10-20 21:15 EDT = 2026-10-21 01:15Z
    const w = (id, iso, sets, extra = {}) => ({ id, date: iso, exercises: [{ name: 'x', sets }], ...extra });
    const done = [{ weight: 80, reps: 5 }, { weight: 80, reps: 5 }];
    const days = L.buildHeatmapDays([
      w('a', '2026-10-21T01:15:00.000Z', done, { finishedAt: '2026-10-21T02:00:00.000Z' }),
      w('g', '2026-10-21T15:00:00.000Z', [{ weight: 80, reps: 5, ghost: true }], { finishedAt: '2026-10-21T16:00:00.000Z' }),
      w('cur', '2026-10-21T16:00:00.000Z', done),
    ], 'cur');
    assert.deepEqual(days, [{ date: '2026-10-20', sets: 2, sessions: 1 }]);
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
});

// ── 撤销日志的寿命（上架审查 C97）：切后台再回来，离开超过 10 分钟或跨了本地日期就清空 ────────
t('撤销寿命：离开 9:59 不清、10:01 清；多伦多 23:55 → 次日 00:02 跨了本地日期要清；18:58 → 19:03 跨 UTC 零点但本地同一天不清', () => {
  const tz = process.env.TZ;
  process.env.TZ = 'America/Toronto';
  try {
    const at = iso => Date.parse(iso);
    const base = at('2026-11-24T12:00:00-05:00');
    assert.equal(L.undoLogExpired(base, base + 9 * 60_000 + 59_000), false);
    assert.equal(L.undoLogExpired(base, base + 10 * 60_000 + 1_000), true);
    assert.equal(L.undoLogExpired(at('2026-11-23T23:55:00-05:00'), at('2026-11-24T00:02:00-05:00')), true, '按本地日期：跨了午夜');
    assert.equal(L.undoLogExpired(at('2026-11-24T18:58:00-05:00'), at('2026-11-24T19:03:00-05:00')), false, '不按 UTC 日期');
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
});

// ── 撞名动作的解析（name-index-order-dependent）────────────────────────
t('名字索引：两个自建动作原名都是「悍马卧推」、一个改名成「曲肘蝴蝶机」—— 历史归现名还叫悍马卧推的那个，与自建列表顺序无关', () => {
  const def = (id, cn) => ({ id, name: { cn, en: cn }, bodyPart: 'subChest', tags: [], category: 'STRENGTH' });
  const A = def('1781149667255', '悍马卧推'); // 后建的
  const B = def('1779420343792', '悍马卧推'); // 早年建的，后来改名
  const over = { [B.id]: { name: { cn: '曲肘蝴蝶机', en: '曲肘蝴蝶机' } } };
  for (const order of [[B, A], [A, B]]) {
    const idx = L.buildNameIndex([], order, over);
    assert.equal(idx.get('悍马卧推')?.id, A.id);
    assert.equal(idx.get('曲肘蝴蝶机')?.id, B.id);
  }
  // 都没改名：同名按 id 从新到旧，先到的是后建的那个
  assert.equal(L.buildNameIndex([], [B, A], {}).get('悍马卧推')?.id, A.id);
});
t('名字索引：把改过名的那个（原名悍马卧推）并进别的动作，「悍马卧推」仍归还在库里的 A，不被并入目标认走', () => {
  const def = (id, cn) => ({ id, name: { cn, en: cn }, bodyPart: 'subChest', tags: [], category: 'STRENGTH' });
  const A = def('1781149667255', '悍马卧推');
  const B = def('1779420343792', '悍马卧推');
  const T = def('1770000000000', '蝴蝶机夹胸');
  const over = { [B.id]: { name: { cn: '曲肘蝴蝶机', en: '曲肘蝴蝶机' }, mergedInto: T.id, hidden: true } };
  const idx = L.buildNameIndex([], [A, B, T], over);
  assert.equal(idx.get('悍马卧推')?.id, A.id);
  assert.equal(idx.get('曲肘蝴蝶机')?.id, T.id);
});
t('名字索引：连环并入 A→B→C 之后，A 的名字沿链解析到 C（不成孤儿）；成环时不登记、不死循环', () => {
  const def = (id, cn) => ({ id, name: { cn, en: cn }, bodyPart: 'subBack', tags: [], category: 'STRENGTH' });
  const A = def('3', '窄距高位下拉');
  const B = def('2', '宽握高位下拉');
  const C = def('1', '高位下拉');
  const over = { [A.id]: { mergedInto: B.id, hidden: true }, [B.id]: { mergedInto: C.id, hidden: true } };
  const idx = L.buildNameIndex([], [A, B, C], over);
  assert.equal(idx.get('窄距高位下拉')?.id, C.id);
  assert.equal(idx.get('宽握高位下拉')?.id, C.id);
  const loop = { [A.id]: { mergedInto: B.id }, [B.id]: { mergedInto: A.id } };
  assert.equal(L.buildNameIndex([], [A, B, C], loop).get('窄距高位下拉'), undefined);
});

// ── 添加动作行的「上次」与点行铺的底稿同一场（审查 C1）─────────────────────
t('添加动作行：小灰字的来源场次 = 点行铺底稿的来源（不分做法取最近、带出做法；器械本馆优先）', () => {
  const ex = (id, sets, variantId) => ({ id, name: '高位下拉', category: 'STRENGTH', sets, ...(variantId ? { variantId } : {}) });
  const w = (id, d, gym, e) => ({ id, date: ago(d), gym, exercises: [e] });
  // 新的在前（WorkoutContext 的顺序）：B 馆 3 天前宽握、A 馆 10 天前宽握、A 馆 20 天前标准
  const ws = [
    w('b-wide', 3, 'B', ex('e1', [{ weight: 70, reps: 8 }], 'v_wide')),
    w('a-wide', 10, 'A', ex('e2', [{ weight: 60, reps: 10 }], 'v_wide')),
    w('a-std', 20, 'A', ex('e3', [{ weight: 50, reps: 12 }])),
  ];
  const vidOf = e => e.variantId;
  const lifts = L.buildLiftSummaries({
    workouts: ws,
    stableIdOf: e => `def|${e.variantId ?? ''}`,
    liftKey: e => `${e.name}|${e.variantId ?? ''}`,
    resolveName: n => n,
    signedLoadOf: () => false,
    getActiveMetrics: () => ['weight', 'reps'],
  });
  const byId = new Map(lifts.map(l => [l.stableId, l]));
  for (const [vid, gym] of [[undefined, 'A'], [undefined, undefined], ['v_wide', 'A'], ['', 'A']]) {
    const prefill = L.findLastIn(ws, n => n, vidOf, '高位下拉', vid ?? null, undefined, gym);
    const row = L.rowLastSession(ws, byId, n => n, vidOf, v => v === 'v_wide', { id: 'def', name: '高位下拉' }, vid, undefined, gym);
    assert.equal(row?.session.workoutId, prefill?.workout.id, `vid=${vid} gym=${gym}`);
    assert.equal(row?.variantId, prefill && (vidOf(prefill.ex) || undefined));
  }
  // 母行在 A 馆：写的是 A 馆 10 天前的宽握 60×10，不是标准做法 20 天前、也不是 B 馆 3 天前
  const r = L.rowLastSession(ws, byId, n => n, vidOf, v => v === 'v_wide', { id: 'def', name: '高位下拉' }, undefined, undefined, 'A');
  assert.deepEqual([r.session.workoutId, r.variantId, r.session.top.kg], ['a-wide', 'v_wide', 60]);
});

t('添加动作行：补记旧训练时「上次」截到那一场之前，和点行铺的底稿同一场；上一场同项目两张卡时照样找得到、top 合起来算', () => {
  // 防的错：C102 行上不收 before，补记 20 天前那场时写的是 2 天前的深蹲，点下去铺的却是 30 天前的；
  // 逐场数据合卡后 exerciseId 只是第一张，按 exerciseId 匹配会把第二张命中的那场漏掉
  const C = (id, name, sets) => ({ id, name, category: 'STRENGTH', sets });
  const S = (w, r) => ({ id: `${w}x${r}`, weight: w, reps: r });
  const ws = [
    { id: 'w2', date: ago(2), exercises: [C('d2', '深蹲', [S(120, 5)]), C('h2', '硬拉', [S(150, 3)])] },
    { id: 'w20', date: ago(20), exercises: [C('b20', '卧推', [S(50, 5)])] },
    { id: 'w30', date: ago(30), exercises: [C('d30', '深蹲', [S(60, 5)])] },
  ];
  const P = { stableIdOf: e => `${e.name}|`, liftKey: e => e.name, resolveName: n => n, signedLoadOf: () => false, getActiveMetrics: () => ['weight', 'reps'] };
  const byId = new Map(L.buildLiftSummaries({ workouts: ws, ...P }).map(l => [l.stableId, l]));
  const row = (name, before) =>
    L.rowLastSession(ws, byId, n => n, e => e.variantId, () => false, { id: name, name }, undefined, 'w20', undefined, before)?.session.workoutId ?? null;
  const prefill = (name, before) => L.findLastIn(ws, n => n, e => e.variantId, name, null, 'w20', undefined, before)?.workout.id ?? null;
  assert.deepEqual([row('深蹲', ws[1].date), row('硬拉', ws[1].date)], ['w30', null]);
  assert.deepEqual([row('深蹲', ws[1].date), row('硬拉', ws[1].date)], [prefill('深蹲', ws[1].date), prefill('硬拉', ws[1].date)]);
  assert.equal(row('深蹲'), 'w2', 'no before: latest');
  // 上一场两张卧推（热身 + 正式）
  const wm = [{ id: 'm', date: ago(3), exercises: [C('a', '卧推', [S(40, 10), S(60, 8)]), C('b', '卧推', [S(80, 5), S(80, 5)])] }];
  const byM = new Map(L.buildLiftSummaries({ workouts: wm, ...P }).map(l => [l.stableId, l]));
  const r = L.rowLastSession(wm, byM, n => n, e => e.variantId, () => false, { id: '卧推', name: '卧推' }, undefined, undefined, undefined);
  assert.deepEqual([r.session.workoutId, r.session.top], ['m', { kg: 80, reps: 5 }]);
});

// ── 配重片拖动的下限（用户报：改了最轻一格还能拖到更轻）────────────────────
t('配重片：一路往轻拖不会轻过最轻一格；最轻一格和每格对齐（15 / 每格 5）照样是下限', () => {
  for (const [start, from] of [[12.5, 22.5], [15, 30]]) {
    const r = L.makeRounder(pinInfo, 'lbs', lbCtx(5, start), false);
    let v = from;
    for (let i = 0; i < 12; i++) v = r.stepToD(v, -1);
    assert.equal(v, start);
    assert.equal(r.snapD(start - 5), start);
  }
});

// ── 文案表的英文（英文界面漏翻：结束确认框的单位、弹窗关闭按钮的 aria-label 都漏过）────────
t('translations.ts：每个 key 都有英文，英文里没有汉字（组件里写死的中文不在这里，归真机手测）', () => {
  const CJK = /[一-鿿]/;
  const bad = Object.entries(L.translations).filter(([, v]) => {
    const en = [].concat(v?.en ?? []);
    return !en.length || en.some(x => typeof x !== 'string' || !x.trim() || CJK.test(x));
  });
  assert.deepEqual(bad.map(([k]) => k), []);
});

// ── 动作属性：器材 ⇄ 阻力联动（exercise-attrs-gear-and-load 那条 e2e 的规则）────
t('动作属性：固定器械默认配重片、可改成杠铃片；杠铃只在杠铃片 / 固定杠铃之间选；写入时选不到的阻力不存', () => {
  const { A } = L;
  assert.equal(A.defaultResistance(A.EQ_MACHINE, []), 'stack');
  assert.ok(A.resistanceSelectable(A.EQ_MACHINE));
  assert.equal(A.effectiveResistance(A.EQ_MACHINE, 'plates', []), 'plates');
  assert.equal(A.effectiveResistance(A.EQ_MACHINE, undefined, []), 'stack');
  // 2026-10-21 起杠铃可选「固定杠铃」（原来锁定杠铃片）：只在这两种之间选，别的阻力读写都不认
  assert.ok(A.resistanceSelectable(A.EQ_BARBELL));
  assert.deepEqual(A.resistanceChoices(A.EQ_BARBELL), ['plates', 'fixedBar']);
  assert.equal(A.effectiveResistance(A.EQ_BARBELL, 'stack', []), 'plates', 'barbell cannot be a weight stack');
  assert.equal(A.effectiveResistance(A.EQ_BARBELL, 'fixedBar', []), 'fixedBar');
  assert.deepEqual(A.attrsPatch(A.EQ_BARBELL, 'stack'), { equipment: A.EQ_BARBELL, resistance: undefined, tags: [A.EQ_BARBELL] });
  assert.deepEqual(A.attrsPatch(A.EQ_BARBELL, 'fixedBar'), { equipment: A.EQ_BARBELL, resistance: 'fixedBar', tags: [A.EQ_BARBELL] });
  assert.deepEqual(A.attrsPatch(A.EQ_DUMBBELL, 'stack'), { equipment: A.EQ_DUMBBELL, resistance: undefined, tags: [A.EQ_DUMBBELL] });
  assert.deepEqual(A.attrsPatch(A.EQ_MACHINE, 'plates'), { equipment: A.EQ_MACHINE, resistance: 'plates', tags: [A.EQ_MACHINE] });
  // 自建器材：看它自己设的阻力，没设按不计重；可以在动作上改
  const defs = [{ id: 'myRack', category: 'equipment', resistance: 'plates' }];
  assert.equal(A.defaultResistance('myRack', defs), 'plates');
  assert.equal(A.defaultResistance('gone', defs), 'none');
  assert.ok(A.resistanceSelectable('myRack'));
  assert.equal(A.defaultResistance('', defs), 'none');
});

// ── 覆盖层合并：名字按语言合并、曾用名取并集 ─────────────────────────
t('覆盖层合并：只改了中文名时英文名留着；曾用名两边取并集；没有覆盖层时原样', () => {
  const def = { id: 'd', name: { cn: '卧推', en: 'Bench' }, aliases: ['平板卧推'], equipment: 'tagBarbell', category: 'STRENGTH' };
  const m = L.mergeOverride(def, { name: { cn: '杠铃卧推' }, aliases: ['卧推', '平板卧推'] });
  assert.deepEqual(m.name, { cn: '杠铃卧推', en: 'Bench' });
  assert.deepEqual(m.aliases.sort(), ['卧推', '平板卧推']);
  assert.equal(m.equipment, 'tagBarbell');
  assert.equal(L.mergeOverride(def, undefined), def);
});

t('en-duplicate-renamed：中英原名相同的自建动作，旧覆盖层只写了中文 —— 英文也用新名，不再和另一个同名动作撞', () => {
  const def = { id: '1779420343792', name: { cn: '悍马卧推', en: '悍马卧推' }, category: 'STRENGTH' };
  const over = { name: { cn: '曲肘蝴蝶机' } };
  assert.deepEqual(L.mergedName(def, over), { cn: '曲肘蝴蝶机', en: '曲肘蝴蝶机' });
  assert.deepEqual(L.mergeOverride(def, over).name, { cn: '曲肘蝴蝶机', en: '曲肘蝴蝶机' });
  // 只写了英文的也一样
  assert.deepEqual(L.mergedName(def, { name: { en: 'Pec deck' } }), { cn: 'Pec deck', en: 'Pec deck' });
  // 两种都写过：各用各的
  assert.deepEqual(L.mergedName(def, { name: { cn: '夹胸', en: 'Pec deck' } }), { cn: '夹胸', en: 'Pec deck' });
  // 内置（中英原名不同）：只改中文时英文照旧
  const builtin = { id: 'b', name: { cn: '卧推', en: 'Bench' } };
  assert.deepEqual(L.mergedName(builtin, { name: { cn: '杠铃卧推' } }), { cn: '杠铃卧推', en: 'Bench' });
});

// ── PR 判定（2026-10-22 重做，utils/prRecords：刊末页 / 训练中 PB 标 / 历史纪录点同一份）─────────
{
  const exOf = (name, sets, extra = {}) => ({ id: `e_${name}_${Math.random()}`, name, category: 'STRENGTH', sets, ...extra });
  const st = (weight, reps, extra = {}) => ({ id: `s${Math.random()}`, weight, reps, ...extra });
  const W = (id, date, gym, exs) => ({ id, userId: 'u', date, title: '', gym, exercises: exs });
  const id = x => x;
  const base = {
    editingWorkoutId: null,
    resolveName: id,
    getActiveMetrics: () => ['weight', 'reps'],
    unitLabel: 'kg',
  };
  const pr = (history, session, opts = {}) => L.detectPRs({ ...base, history, session, ...opts });

  t('PR：硬拉 260 → 262.5 就算（不再要 1%）；最大重量优先于其他几种', () => {
    const h = [W('h', ago(7), 'A', [exOf('硬拉', [st(260, 1)])])];
    const r = pr(h, W('n', ago(0), 'A', [exOf('硬拉', [st(262.5, 1)])]));
    assert.equal(r.stamps.length, 1);
    assert.equal(r.stamps[0].kind, 'weight');
    assert.equal(r.stamps[0].next, 262.5);
    // 只多 0.005 kg（换算噪声）不算
    assert.equal(pr(h, W('n', ago(0), 'A', [exOf('硬拉', [st(260.005, 1)])])).stamps.length, 0);
  });

  t('PR：估算 1RM —— 105×1 之后做 100×5 是 1RM 纪录；反过来 100×5 之后 105×1 是最大重量', () => {
    const a = pr([W('h', ago(7), '', [exOf('卧推', [st(105, 1)])])], W('n', ago(0), '', [exOf('卧推', [st(100, 5)])]));
    assert.equal(a.stamps[0].kind, 'e1rm');
    assert.equal(Math.round(a.stamps[0].next * 10) / 10, 116.7);
    const b = pr([W('h', ago(7), '', [exOf('卧推', [st(100, 5)])])], W('n', ago(0), '', [exOf('卧推', [st(105, 1)])]));
    assert.equal(b.stamps[0].kind, 'weight');
    // 11 次以上不估 1RM
    assert.equal(L.R.e1rmOf(100, 11), null);
    assert.equal(L.R.e1rmOf(100, 1), 100);
  });

  t('PR：次数纪录 —— 同样重量做得更多；被历史上更重更多的组盖住就不算', () => {
    const h = [W('h', ago(7), '', [exOf('深蹲', [st(100, 5), st(80, 12)])])];
    // 80 × 14：最大重量没破、14 次不估 1RM，次数纪录比单组容量硬
    const r = pr(h, W('n', ago(0), '', [exOf('深蹲', [st(80, 14)])]));
    assert.equal(r.stamps[0].kind, 'reps');
    assert.equal(r.stamps[0].prev, 12);
    assert.equal(r.stamps[0].next, 14);
    assert.equal(r.stamps[0].atKg, 80);
    // 90 × 5：被 100 × 5 盖住，什么都不算
    assert.equal(pr(h, W('n', ago(0), '', [exOf('深蹲', [st(90, 5)])])).stamps.length, 0);
  });

  t('PR：自重引体（没有重量这一项）8 → 12 次就是纪录；带正负的按 0 kg 记也一样', () => {
    const bw = { getActiveMetrics: () => ['reps'] };
    const r = pr([W('h', ago(7), '', [exOf('引体', [st(0, 8)])])], W('n', ago(0), '', [exOf('引体', [st(0, 12)])]), bw);
    assert.equal(r.stamps[0].kind, 'reps');
    assert.equal(r.stamps[0].unitLabel, '');
    const signed = { isSigned: () => true };
    const r2 = pr(
      [W('h', ago(7), '', [exOf('引体', [st(0, 8, { bodyweightMode: 'normal' })])])],
      W('n', ago(0), '', [exOf('引体', [st(0, 12, { bodyweightMode: 'normal' })])]),
      signed,
    );
    assert.equal(r2.stamps[0].kind, 'reps');
    assert.equal(r2.stamps[0].atKg, 0);
  });

  t('PR：辅助引体 −30×8 → −30×12 是次数纪录；少用辅助（−20×8）也算；别的馆的辅助量不拿来比', () => {
    const signed = { isSigned: () => true };
    const h = [W('h', ago(7), 'A', [exOf('辅助引体', [st(30, 8, { bodyweightMode: 'assisted' })])])];
    const r = pr(h, W('n', ago(0), 'A', [exOf('辅助引体', [st(30, 12, { bodyweightMode: 'assisted' })])]), signed);
    assert.equal(r.stamps[0].kind, 'reps');
    assert.equal(r.stamps[0].atKg, -30);
    assert.equal(pr(h, W('n', ago(0), 'A', [exOf('辅助引体', [st(20, 8, { bodyweightMode: 'assisted' })])]), signed).stamps[0].kind, 'reps');
    // B 馆第一次练辅助：A 馆的辅助量不能比 → 等于没有历史
    assert.equal(pr(h, W('n', ago(0), 'B', [exOf('辅助引体', [st(30, 12, { bodyweightMode: 'assisted' })])]), signed).stamps.length, 0);
    // 第一次挂上负重（之前只有辅助）就是最大重量纪录
    const w = pr(h, W('n', ago(0), 'A', [exOf('辅助引体', [st(5, 5, { bodyweightMode: 'weighted' })])]), signed);
    assert.equal(w.stamps[0].kind, 'weight');
  });

  t('PR：器械只在同一个馆里比 —— A 馆 80，B 馆 50 → 60 在 B 馆算纪录；历史纪录点同一口径', () => {
    const machine = { gymScoped: () => true };
    const ws = [
      W('a1', ago(30), 'A', [exOf('腿举', [st(80, 10)])]),
      W('b1', ago(20), 'B', [exOf('腿举', [st(50, 10)])]),
    ];
    // B 馆第一次：没有 B 馆的历史，不算
    assert.equal(pr([ws[0]], ws[1], machine).stamps.length, 0);
    const b2 = W('b2', ago(10), 'B', [exOf('腿举', [st(60, 10)])]);
    const r = pr(ws, b2, machine);
    assert.equal(r.stamps[0].kind, 'weight');
    assert.equal(r.stamps[0].prev, 50);
    // 历史里（Dashboard / 详情 / 特别关注）同一口径：b2 那一场有纪录点，b1 没有
    const lifts = L.buildLiftSummaries({
      workouts: [...ws, b2],
      stableIdOf: e => e.name,
      liftKey: e => e.name,
      resolveName: id,
      signedLoadOf: () => false,
      getActiveMetrics: () => ['weight', 'reps'],
      gymScoped: () => true,
    });
    const pts = L.trendPoints(lifts[0].sessions, 'weight');
    assert.deepEqual(pts.map(p => [p.workoutId, p.pr]), [['a1', false], ['b1', false], ['b2', true]]);
  });

  // 防 gap-2#5：改器材后不带正负了，组上还记着辅助号 —— 辅助 40 被当成 40 kg 比，出假 PB、1RM 和趋势反着走
  t('PR：不带正负的动作里，组上记着辅助的按 0 kg 比；负重照算', () => {
    const asst = kg => st(kg, 8, { bodyweightMode: 'assisted' });
    const ws = [
      W('h1', ago(30), '', [exOf('引体', [asst(40)])]),
      W('h2', ago(20), '', [exOf('引体', [asst(35)])]),
      W('h3', ago(10), '', [exOf('引体', [asst(30)])]),
    ];
    const today = W('n', ago(0), '', [exOf('引体', [asst(45)])]);
    assert.deepEqual(pr(ws, today, { isSigned: () => false }).stamps, []);
    const lifts = L.buildLiftSummaries({
      workouts: [...ws, today],
      stableIdOf: e => e.name,
      liftKey: e => e.name,
      resolveName: id,
      signedLoadOf: () => false,
      getActiveMetrics: () => ['weight', 'reps'],
    });
    assert.equal(lifts[0].best.weight.value, 0);
    assert.equal(lifts[0].best.e1rm, null);
    assert.deepEqual(lifts[0].sessions.map(s => s.records), [[], [], [], []]);
    // 负重的组照样按它的重量比：负重 5×5 之后负重 10×5 是重量纪录 5 → 10
    const wt = kg => st(kg, 5, { bodyweightMode: 'weighted' });
    const withWt = [...ws, W('h4', ago(5), '', [exOf('引体', [wt(5)])])];
    const hit = pr(withWt, W('n2', ago(0), '', [exOf('引体', [wt(10)])]), { isSigned: () => false }).stamps[0];
    assert.deepEqual([hit?.kind, hit?.prev, hit?.next], ['weight', 5, 10]);
  });

  // 审查 G4：判定按馆，展示也得按馆 —— 否则 B 馆破的纪录点落在 A 馆 200 的纪录线下面
  t('按馆比的器械：A 馆 200、B 馆 120 → 130 —— B 馆视图的最好是 130、阶梯线不含 A 馆；列表取最近的馆；牌上带馆', () => {
    const ws = [
      W('a1', ago(40), 'A', [exOf('腿举', [st(200, 8)])]),
      W('u1', ago(30), '', [exOf('腿举', [st(90, 8)])]),
      W('b1', ago(20), 'B', [exOf('腿举', [st(120, 8)])]),
      W('b2', ago(10), 'B', [exOf('腿举', [st(130, 8)])]),
    ];
    const summaries = gymScoped => L.buildLiftSummaries({
      workouts: ws,
      stableIdOf: e => e.name,
      liftKey: e => e.name,
      resolveName: id,
      signedLoadOf: () => false,
      getActiveMetrics: () => ['weight', 'reps'],
      gymScoped,
    })[0];
    const lift = summaries(() => true);
    // 最近练的馆在前；没标馆的旧训练也是一项，否则这些场次从视图里消失
    assert.deepEqual(L.gymChoices(lift), ['B', '', 'A']);
    const b = L.inGym(lift, 'B');
    assert.equal(b.best.weight.value, 130);
    assert.deepEqual(b.sessions.map(s => s.workoutId), ['b1', 'b2']);
    assert.deepEqual(L.trendPoints(b.sessions, 'weight').map(p => p.best), [120, 130]);
    assert.equal(L.inGym(lift, '').best.weight.value, 90);
    assert.equal(L.latestGymView(lift).best.weight.value, 130);
    // 跨馆比的动作不分馆
    const free = summaries(() => false);
    assert.deepEqual(L.gymChoices(free), []);
    assert.equal(L.latestGymView(free).best.weight.value, 200);
    const machine = { gymScoped: () => true };
    assert.equal(pr(ws.slice(0, 3), ws[3], machine).stamps[0].gym, 'B');
    assert.equal(pr(ws.slice(0, 3), ws[3]).stamps.length, 0, '跨馆比：130 没过 200');
  });

  // 审查 Gm0：逐场「最好一组」和纪录判定同一份组（递减 / 递增档也算）
  t('逐场最好一组含递增档；次数图只在全场最多次数真涨了才标 PR', () => {
    const build = workouts => L.buildLiftSummaries({
      workouts,
      stableIdOf: e => e.name,
      liftKey: e => e.name,
      resolveName: id,
      signedLoadOf: () => false,
      getActiveMetrics: () => ['weight', 'reps'],
    })[0];
    const up = build([
      W('h', ago(9), '', [exOf('卧推', [st(100, 5)])]),
      W('n', ago(0), '', [exOf('卧推', [st(100, 5, { subSets: [{ id: 'x', weight: 105, reps: 2 }] })])]),
    ]);
    const n = up.sessions[1];
    assert.deepEqual(n.records.includes('weight'), true);
    assert.equal(n.top.kg, 105, '破纪录的是递增档，逐场行写的也得是它');
    assert.equal(up.best.weight.value, 105);
    // 历史 40×15、80×8，本场 80×9：是次数纪录，但全场最多次数（15）没涨 —— 次数图上不标
    const reps = build([
      W('h', ago(9), '', [exOf('深蹲', [st(40, 15), st(80, 8)])]),
      W('n', ago(0), '', [exOf('深蹲', [st(80, 9)])]),
    ]);
    assert.equal(reps.sessions[1].records.includes('reps'), true);
    assert.deepEqual(L.trendPoints(reps.sessions, 'reps').map(p => p.pr), [false, false]);
  });

  t('PR：自由重量跨馆比 —— A 馆 100，B 馆 95 不算、102.5 算；没历史不算；编辑旧训练不算；最多 2 枚牌', () => {
    const h = [W('a', ago(9), 'A', [exOf('卧推', [st(100, 5)])])];
    assert.equal(pr(h, W('n', ago(0), 'B', [exOf('卧推', [st(95, 5)])])).stamps.length, 0);
    assert.equal(pr(h, W('n', ago(0), 'B', [exOf('卧推', [st(102.5, 5)])])).stamps[0].kind, 'weight');
    assert.equal(pr([], W('n', ago(0), 'B', [exOf('卧推', [st(102.5, 5)])])).stamps.length, 0);
    assert.equal(pr(h, W('n', ago(0), 'B', [exOf('卧推', [st(102.5, 5)])]), { editingWorkoutId: 'n' }).stamps.length, 0);
    const many = ['甲', '乙', '丙'];
    const hh = [W('h', ago(9), '', many.map(n => exOf(n, [st(50, 5)])))];
    const r = pr(hh, W('n', ago(0), '', many.map(n => exOf(n, [st(55, 5)]))));
    assert.equal(r.stamps.length, 1);
    assert.equal(r.extraCount, 2);
  });

  t('PR：底稿行不算；训练中的 PB 标指向破纪录的那一组（同一个 findRecords）', () => {
    const h = [W('h', ago(9), '', [exOf('卧推', [st(100, 5), st(120, 1, { ghost: true })])])];
    const rule = L.R.prRuleFor(['weight', 'reps'], false, false);
    const hist = L.R.prSetsOf(h[0].exercises[0], '', false);
    assert.equal(hist.length, 1, 'ghost row is not a fact');
    const cur = exOf('卧推', [st(95, 5), st(102.5, 3), st(105, 1, { ghost: true })]);
    const top = L.R.findRecords(rule, hist, L.R.prSetsOf(cur, '', false), '')[0];
    assert.equal(top.kind, 'weight');
    assert.equal(top.at, 1);
  });

  // 同一场里同一项目有几张卡（计划排两行、并入上一场、复制为今天）：按场合起来，不按卡（审查 C84 / gap-4#1）
  const C = (id, name, sets, extra = {}) => ({ id, name, category: 'STRENGTH', sets, ...extra });
  const multi = () => {
    const h = W('h', ago(9), '', [C('h1', '卧推', [st(100, 5)])]);
    const w1 = W('w1', ago(1), '', [C('a', '卧推', [st(105, 3)]), C('b', '卧推', [st(102.5, 5)]), C('c', '卧推', [st(20, 10)], { variantId: '哑铃' })]);
    return { h, w1 };
  };
  const buildMulti = workouts => L.buildLiftSummaries({
    workouts,
    stableIdOf: e => `${e.name}|${e.variantId ?? ''}`,
    liftKey: e => (e.variantId ? `${e.name}（${e.variantId}）` : e.name),
    resolveName: id,
    signedLoadOf: () => false,
    getActiveMetrics: () => ['weight', 'reps'],
  });

  t('按动作历史：同场同项目两张卡合成一场（场数、纪录点、PR 标按场）；别的做法不并进来；首场就排两行没有纪录', () => {
    // 防的错：C84 / gap-4#1 按卡算场 —— 「N 场」多算、同一天两个点、同场两行都标 PR、首场第二张卡拿第一张当历史「破纪录」
    const { h, w1 } = multi();
    const lifts = buildMulti([w1, h]);
    const bench = lifts.find(l => l.key === '卧推');
    assert.deepEqual(bench.sessions.map(s => [s.workoutId, s.exerciseIds, s.records[0] ?? null]), [['h', ['h1'], null], ['w1', ['a', 'b'], 'weight']]);
    assert.equal(bench.sessions[1].sets.length, 2);
    assert.deepEqual(bench.sessions[1].top, { kg: 105, reps: 3 });
    assert.deepEqual([...L.prSessionIds(bench.sessions, 'weight')], ['w1']);
    assert.deepEqual(lifts.find(l => l.key === '卧推（哑铃）').sessions.map(s => s.exerciseIds), [['c']]);
    const w0 = W('w0', ago(1), '', [C('a', '卧推', [st(100, 5), st(100, 5)]), C('b', '卧推', [st(105, 3)])]);
    const first = buildMulti([w0])[0];
    assert.equal(first.sessions.length, 1);
    assert.deepEqual(first.sessions[0].records, []);
    assert.equal(L.trendPoints(first.sessions, 'weight').some(p => p.pr), false);
  });

  t('刊末页：同一项目两张卡只出一枚牌，和按动作历史那场的纪录同一种', () => {
    // 防的错：C84 刊末页同一动作出两枚牌（105 一枚、102.5×5 的 1RM 又一枚）
    const { h, w1 } = multi();
    const r = pr([h], w1, { keyOf: e => (e.variantId ? `${e.name}（${e.variantId}）` : e.name) });
    assert.deepEqual(r.stamps.map(s => [s.exercise, s.kind, s.prev, s.next]), [['卧推', 'weight', 100, 105]]);
    assert.equal(r.extraCount, 0);
    assert.equal(r.stamps[0].kind, buildMulti([w1, h]).find(l => l.key === '卧推').sessions[1].records[0]);
  });

  t('训练中 PB 标：同一项目几张卡合起来只标一行（纪录在别的卡上就不标这张；并列标卡序在前的）', () => {
    // 防的错：C84 训练中两张卡各自和历史比，两张都亮 PB
    const pool = { rule: L.R.prRuleFor(['weight', 'reps'], false, false), history: [{ kg: 100, reps: 5, gym: '' }], gym: '' };
    const strip = c => L.R.prSetsOf(c, '', false).map(({ at: _a, ...x }) => x);
    const at = (own, before, after) => L.R.recordAtAmong(pool.rule, pool.history, L.R.prSetsOf(own, '', false), { before: before.flatMap(strip), after: after.flatMap(strip) }, '');
    const A = C('a', '卧推', [st(105, 3)]);
    const B = C('b', '卧推', [st(102.5, 5)]);
    assert.deepEqual([at(A, [], [B]), at(B, [A], [])], [0, -1]);
    const B2 = C('b', '卧推', [st(60, 10), st(107.5, 1)]);
    assert.deepEqual([at(A, [], [B2]), at(B2, [A], [])], [-1, 1]);
    const B3 = C('b', '卧推', [st(105, 3)]);
    assert.deepEqual([at(A, [], [B3]), at(B3, [A], [])], [0, -1]);
    assert.equal(L.R.recordAtAmong(pool.rule, pool.history, L.R.prSetsOf(B, '', false), undefined, ''), 0, 'no peers: as before');
  });

  t('PR：记次数的动作里次数为 0 的组不算举起来了（120×0 不落牌、不当「最重」、不压住之后的 105×5）；不记次数的负重平板照按重量比', () => {
    // 防的错：C81 有数就入册的 120×0 被判成最大重量纪录，列表 / 目标的「最重」写 120，之后真正的 105×5 反而不算；
    // 修过头：一律要求次数 > 0，「重量 + 时长」的负重平板（次数本来就是 0）从此不出纪录
    const h = [W('h', ago(9), '', [exOf('卧推', [st(100, 5)])])];
    const zero = W('z', ago(5), '', [exOf('卧推', [st(120, 0)])]);
    assert.equal(pr(h, zero).stamps.length, 0);
    const lift = L.buildLiftSummaries({
      workouts: [...h, zero], stableIdOf: e => e.name, liftKey: e => e.name, resolveName: id, signedLoadOf: () => false, getActiveMetrics: () => ['weight', 'reps'],
    })[0];
    assert.equal(lift.best.weight.value, 100);
    assert.equal(lift.sessions[1].top, null);
    const r = pr([...h, zero], W('n', ago(0), '', [exOf('卧推', [st(105, 5)])]));
    assert.deepEqual([r.stamps[0]?.kind, r.stamps[0]?.prev], ['weight', 100]);
    const plank = { getActiveMetrics: () => ['weight', 'duration'] };
    const p = pr([W('h', ago(9), '', [exOf('负重平板', [st(30, 0, { duration: 60 })])])], W('n', ago(0), '', [exOf('负重平板', [st(35, 0, { duration: 60 })])]), plank);
    assert.equal(p.stamps[0]?.kind, 'weight');
  });

  t('刊末页「比上次」：记次数的动作不拿次数为 0 的组当这场最好的一组', () => {
    // 防的错：C81 在「比上次」里重现 —— 本场 [120×0, 100×6] 写成「120×0 比上次 100×5」
    const last = exOf('卧推', [st(100, 5)]);
    const got = L.vsLastSession([exOf('卧推', [st(120, 0), st(100, 6)])], {
      keyOf: e => e.name, findLast: () => ({ ex: last, workout: { id: 'w0', date: '', exercises: [] } }),
      ruleOf: () => L.R.prRuleFor(['weight', 'reps'], false, false), gym: '',
    });
    assert.deepEqual(got[0].now, { kg: 100, reps: 6 });
  });

  t('PR：kg、lb 各打一位小数，跨单位手打同一个重量不算纪录；单边加一片 0.25 lb 小片照算', () => {
    // 防的错：C83 容差 0.01 kg 比一位小数的换算差小 —— 换个单位把上次的重量原样打一遍，就落最大重量 / 单组容量的牌；
    // 修过头：容差放到挡掉真实的最小加重
    const rule = L.R.prRuleFor(['weight', 'reps'], false, false);
    const P = (kg, reps) => ({ kg, reps, gym: '' });
    const kinds = (h, c) => L.R.findRecords(rule, h, c, '').map(x => x.kind);
    assert.deepEqual(kinds([P(100, 5)], [P(220.5 / K, 5)]), []);
    assert.deepEqual(kinds([P(225 / K, 10)], [P(102.06, 10)]), []);
    assert.deepEqual(kinds([P(225 / K, 5)], [P(102.1, 5)]), []);
    assert.deepEqual(kinds([P(102.0, 5)], [P(225 / K, 5)]), []);
    assert.equal(kinds([P(260, 1)], [P(262.5, 1)])[0], 'weight');
    assert.equal(kinds([P(10, 10)], [P(10 + 0.25 / K, 10)])[0], 'weight');
  });
}

// ── 指标的写法（审查 gap-5#9 / C83 / gap-5#6）────────────────────────
t('显示：距离 / 速度留两位小数、重量仍一位；按写出来的精度取整再算增量，不出「+0 lbs」', () => {
  // 防的错：gap-5#9 0.05 km 写成 0.1、0.025 写成 0、1.25 写成 1.3；C83 特别关注 lbs 下 100.0172 比起步 100 写「+0 lbs」
  const F = (m, v) => L.LDS.formatMetric(m, v, 'kg');
  assert.deepEqual([F('distance', 0.05), F('distance', 0.025), F('distance', 1.25), F('speed', 11.538), F('weight', 1.25)], ['0.05', '0.03', '1.25', '11.54', '1.3']);
  const R = L.LDS.roundShown;
  assert.equal(R('weight', 100.0172) - R('weight', 100), 0);
  assert.equal(R('weight', 102.5) - R('weight', 100), 2.5);
  assert.equal(R('duration', 89.6), 90);
});

t('卡头「上次」：只写记录项里有的 —— 有氧写「30:00 5 km」不写 0×0，重量 + 时长不出 ×0', () => {
  // 防的错：gap-5#6 ExerciseCard / AlternatingCard 固定拼「重量×次数」，跑步机的上次写成「0×0 kg」
  const line = (load, set, metrics) => L.LDS.lastSetLine(load, set, metrics, 'kg', 'cn');
  assert.equal(line('0', { id: 'a', duration: 1800, distance: 5 }, ['duration', 'distance']), '30:00 5 km');
  assert.equal(line('100', { id: 'b', weight: 100, reps: 5 }, ['weight', 'reps']), '100×5');
  assert.equal(line('30', { id: 'c', weight: 30, duration: 60 }, ['weight', 'duration']), '30 1:00');
});

// ── 目标进度（审查 D7）：按起点算，减重也成立；力量 / 频率从训练记录现算 ─────────
t('目标进度：体重 80 → 75 刚建是 0、到 77.5 是一半、过了封顶；增重同理；起点不明不画', () => {
  assert.equal(L.G.goalProgress(80, 80, 75), 0);
  assert.equal(L.G.goalProgress(77.5, 80, 75), 0.5);
  assert.equal(L.G.goalProgress(74, 80, 75), 1);
  assert.equal(L.G.goalProgress(82, 80, 75), 0, '反方向不出负数');
  assert.equal(L.G.goalProgress(110, 100, 120), 0.5);
  assert.equal(L.G.goalProgress(80, null, 75), null);
});
t('目标起点：体重取建目标那一刻之前最近的一次（换成目标单位），之前没有就取之后最早的一次', () => {
  const e = (d, kg) => ({ id: String(d), userId: 'u', date: ago(d), weight: kg, unit: 'kg' });
  const entries = [e(1, 78), e(20, 80), e(40, 85)];
  assert.equal(L.G.weightAtStart(entries, ago(10), 'kg'), 80);
  assert.equal(Math.round(L.G.weightAtStart(entries, ago(10), 'lbs') * 10) / 10, 176.4);
  assert.equal(L.G.weightAtStart(entries, ago(60), 'kg'), 85);
  assert.equal(L.G.weightAtStart([], ago(10), 'kg'), null);
});
// 防 C71：体重目标的当前值原来是建目标 / 记最新体重时写回的副本，留空就是 0 / 75 满格、删了体重还停在旧值
t('目标卡：体重目标的当前值从体重记录现算（最新日期那条、换成目标单位）；没记录才用手填的，手填 0 ＝ 不知道', () => {
  const e = (d, kg) => ({ id: String(d), userId: 'u', date: ago(d), weight: kg, unit: 'kg' });
  const goal = over => ({ id: 'g', type: 'weight', unit: 'kg', currentValue: 0, targetValue: 75, startDate: ago(10), ...over });
  const card = (g, entries) => L.G.goalCardValues(g, [], [], entries, k => k);
  const a = card(goal({}), [e(20, 80), e(1, 78)]);
  assert.equal(a.current, 78);
  assert.equal(L.G.goalProgress(a.current, a.start, 75), 0.4);
  assert.equal(card(goal({ currentValue: 300 }), [e(20, 80), e(1, 78.5)]).current, 78.5, '删掉的那条留下的副本不算');
  assert.equal(card(goal({ unit: 'lbs' }), [e(1, 80)]).current, 176.4);
  assert.equal(card(goal({}), [e(1, 78), e(30, 90), e(5, 79)]).current, 78, '乱序也取日期最新的');
  assert.equal(card(goal({ currentValue: 80 }), []).current, 80);
  assert.equal(card(goal({}), []).current, null);
});
// 防 C72 / C75：编辑切类型不跟着改单位、类别、绑定；藏起来的当前值照样入库；空标题、0 目标存得进去
t('目标规整：单位 / 类别跟类型走，绑定只留给力量，藏起来的当前值存 0，标题去空白；存得下的条件', () => {
  const rule = { sourceType: 'workouts', calculation: 'max', exerciseName: 'S|' };
  const norm = (g, unit = 'kg', hasWeightLog = false) => L.G.normalizeGoal(g, { unit, hasWeightLog });
  const a = norm({ type: 'weight', category: 'frequency', unit: 'times/week', label: 'x' }, 'lbs');
  assert.equal(a.unit, 'lbs');
  assert.equal(a.category, 'weight');
  const b = norm({ type: 'frequency', unit: 'kg', currentValue: 80, label: 'x' });
  assert.equal(b.unit, 'times/week');
  assert.equal(b.currentValue, 0);
  const c = norm({ type: 'weight', unit: 'kg', autoUpdateRule: rule, dataSource: 'auto', label: 'x' }, 'lbs');
  assert.equal(c.unit, 'kg', '目标跟建立时的单位');
  assert.equal(c.autoUpdateRule, undefined);
  assert.equal(c.dataSource, 'manual');
  assert.equal(norm({ type: 'strength', unit: 'kg', autoUpdateRule: rule, currentValue: 80, label: 'x' }).currentValue, 0);
  assert.equal(norm({ type: 'strength', unit: 'kg', autoUpdateRule: rule, label: 'x' }).dataSource, 'auto');
  assert.equal(norm({ type: 'weight', unit: 'kg', currentValue: 80, label: 'x' }, 'kg', true).currentValue, 0);
  assert.equal(norm({ type: 'weight', unit: 'kg', currentValue: 80, label: 'x' }).currentValue, 80);
  const d = norm({ type: 'strength', unit: 'kg', title: '  卧推 100 ', label: '  卧推 100 ' });
  assert.equal(d.title, '卧推 100');
  assert.equal(d.label, '卧推 100');
  for (const bad of [{ label: '  ', targetValue: 3 }, { label: 'a', targetValue: 0 }, { label: 'a', targetValue: NaN }, { label: 'a', targetValue: -5 }]) {
    assert.equal(L.G.canSaveGoal(bad), false, JSON.stringify(bad));
  }
  assert.equal(L.G.canSaveGoal({ label: 'a', targetValue: 3 }), true);
  assert.equal(L.G.canSaveGoal({ title: 'a', label: '', targetValue: 3 }), true, '编辑弹窗只写 title 也算');
});
t('频率目标：本周（周一起）练了几场，上周日那场不算', () => {
  // NOW 是 2026-10-21（周三）
  const w = d => ({ id: d, date: d, exercises: [] });
  const n = L.G.workoutsThisWeek(
    [w('2026-10-18T10:00:00'), w('2026-10-19T08:00:00'), w('2026-10-21T08:00:00'), w('2026-10-21T18:00:00')],
    new Date('2026-10-21T20:00:00'),
  );
  assert.equal(n, 3);
});

// ── 体重变化那一行（审查 A22）──────────────────────────────────────
t('体重变化：最新一次超过 30 天不显示；基线就是最新那条不显示；跨度按实际天数（30 天以上也是）；先取整再定号', () => {
  const w = (d, kg) => ({ date: ago(d), weight: kg });
  assert.equal(L.weightDelta([w(40, 80), w(70, 82)], 'kg', NOW), null);
  assert.equal(L.weightDelta([w(3, 80)], 'kg', NOW), null);
  const d = L.weightDelta([w(2, 80), w(14, 81)], 'kg', NOW);
  assert.equal(d.text, '-1');
  assert.equal(d.days, 12);
  assert.equal(L.weightDelta([w(1, 80), w(40, 82)], 'lbs', NOW).text, '-4.4');
  assert.equal(L.weightDelta([w(1, 80.02), w(10, 80)], 'kg', NOW).text, '0', 'no -0.0 / +0.0');
  // 防 C86：30 天前的基线离得再远也被夹成「· 30天」，398 天的变化写成 30 天
  assert.equal(L.weightDelta([w(400, 80), w(2, 75)], 'kg', NOW).days, 398);
  assert.equal(L.weightDelta([w(33, 80), w(2, 79)], 'kg', NOW).days, 31);
});

// ── 底稿：给旧训练补加动作只抄那一场之前的（审查 A11）────────────────
t('底稿来源：before 之后练的不算', () => {
  const ws = [
    { id: 'new', gym: 'A', date: ago(1), exercises: [{ id: 'x', name: '推肩', sets: [{ id: 's', weight: 40, reps: 8 }] }] },
    { id: 'old', gym: 'A', date: ago(20), exercises: [{ id: 'y', name: '推肩', sets: [{ id: 's', weight: 30, reps: 8 }] }] },
  ];
  assert.equal(L.findLastIn(ws, x => x, () => undefined, '推肩', null, undefined, undefined, ago(10)).workout.id, 'old');
  assert.equal(L.findLastIn(ws, x => x, () => undefined, '推肩').workout.id, 'new');
});

// ── 按馆的片子单位取整（审查 A9）、换馆不重新取整手打的数（A10）、单边挂片 ─────────
t('取整：kg 馆显示 lb —— 格子按公斤片算，进出换成 lb；手打过的组换馆时不动', () => {
  const ctx = { unit: 'kg', plates: [20, 15, 10, 5, 2.5], bar: 20, inc: 5 };
  const r = L.makeRounder({ kind: 'plates' }, 'kg', ctx, false, 'lbs');
  assert.equal(r.unit, 'kg');
  assert.equal(r.display, 'lbs');
  // 135 lb = 61.2 kg → 最近能挂的 60 kg = 132.28 lb（不是磅片的 135）
  assert.equal(r.snapD(135), 132.28);
  // 60 kg 往上一下＝ +5 kg（最小一对 2.5）= 65 kg = 143.3 lb
  assert.equal(r.stepToD(132.28, 1), 143.3);
  assert.ok(r.loadableD(132.28));
  assert.equal(r.snapKg(61.2), 60);
  const ex = { id: 'e', name: '卧推', category: 'STRENGTH', sets: [] };
  const sets = [
    { id: 'a', weight: 61, reps: 5, ghost: true, touched: { weight: true } },
    { id: 'b', weight: 61, reps: 5, ghost: true },
  ];
  const out = L.reRoundPending(sets, ex, L.makeRounder({ kind: 'plates' }, 'kg', ctx, false));
  assert.equal(out[0].weight, 61, 'typed value is kept');
  assert.equal(out[1].weight, 60);
});
t('lb 馆显示 kg：组行 / 大图拿到的是两位小数的显示值，连着拖每一下都要走一格、落在磅片格上（2026-10-25 用户报：切 kg 后拖不动 / 只能走一下）', () => {
  // 照 SetCapsule：存 kg → 显示两位小数 → stepToD → 写回
  const walk = (r, kg, dir, n) => {
    const seen = [];
    for (let i = 0; i < n; i++) {
      const d = Math.round(kg * 100) / 100;
      const next = r.stepToD(d, dir);
      assert.notEqual(next, d, `第 ${i + 1} 下没动（${d} kg）`);
      kg = r.kgOfD(next);
      seen.push(Math.round(kg * K * 1000) / 1000);
    }
    return { kg, seen };
  };
  const pin = L.makeRounder(pinInfo, 'lbs', lbCtx(10, 10), false, 'kg');
  const up = walk(pin, 100 / K, 1, 8);
  assert.deepEqual(up.seen, [110, 120, 130, 140, 150, 160, 170, 180]);
  assert.deepEqual(walk(pin, up.kg, -1, 8).seen, [170, 160, 150, 140, 130, 120, 110, 100]);
  // 走到的格子在 kg 显示下也认得出「挂得出」（大图不弹两档）
  assert.ok(pin.loadableD(Math.round((150 / K) * 100) / 100));
  // 杠铃（磅片，最小一对 2.5）、哑铃（每对 5 lb）同理
  const bar = L.makeRounder({ kind: 'plates' }, 'lbs', lbCtx(5), false, 'kg');
  assert.deepEqual(walk(bar, 135 / K, 1, 4).seen, [140, 145, 150, 155]);
  assert.deepEqual(walk(bar, 225 / K, -1, 4).seen, [220, 215, 210, 205]);
  const db = L.makeRounder({ kind: 'pair' }, 'lbs', lbCtx(5), false, 'kg');
  assert.deepEqual(walk(db, 50 / K, -1, 4).seen, [45, 40, 35, 30]);
});
t('kgOfD：格子上的显示值存成格子的精确 kg；不在格子上的（手打的）照打的存', () => {
  const pin = L.makeRounder(pinInfo, 'lbs', lbCtx(10, 10), false, 'kg');
  assert.equal(pin.kgOfD(49.9), 110 / K);
  assert.equal(pin.kgOfD(50), 50);
  const same = L.makeRounder(pinInfo, 'lbs', lbCtx(10, 10), false, 'lbs');
  assert.equal(same.kgOfD(110), 110 / K);
  assert.equal(same.kgOfD(112.5), 112.5 / K);
});
t('一台器械一种片：配重片 / 哑铃按这一台（或馆档案里这一类）自己的单位定格子；杠铃 / 挂片按馆的片子', () => {
  const lbGym = { plateUnit: 'lbs', plates: [45, 25, 10, 5, 2.5], cable: { v: 5, u: 'kg', s: 5 }, machine: { v: 10, u: 'lbs' }, dumbbell: { v: 5, u: 'lbs' } };
  const cable = { kind: 'pin', stack: 'cable' };
  assert.equal(L.ownUnitOf(cable, lbGym, undefined), 'kg', '馆档案里龙门架设的是 kg');
  assert.equal(L.ownUnitOf({ kind: 'pin', stack: 'machine' }, lbGym, undefined), 'lbs');
  assert.equal(L.ownUnitOf(cable, lbGym, { v: 10, u: 'lbs' }), 'lbs', '这一台单独设的单位优先');
  assert.equal(L.ownUnitOf({ kind: 'plates' }, lbGym, undefined), null);
  assert.equal(L.ownUnitOf({ kind: 'loaded' }, lbGym, undefined), null);
  assert.equal(L.ownUnitOf(cable, undefined, undefined), null, '没设档案跟显示单位走');
  // lb 馆里一台 kg 的龙门架（5 起、每格 5 kg），显示 lb：走的是 kg 格子，不是被近似成 10 lb 一格
  const r = L.makeRounder(cable, 'kg', { unit: 'kg', plates: [20, 10, 5, 2.5], bar: 20, inc: 5, start: 5 }, false, 'lbs');
  const d = r.stepToD(r.toD(20), 1);
  assert.equal(d, 55.12);
  assert.equal(r.kgOfD(d), 25);
  assert.equal(r.stepToD(55.12, -1), 44.09);
});
t('器械整卡按器械单位（D1）：lb 器械在 kg 显示下整卡写 lb，± 键一档恒为 5 lb；杠铃照旧跟顶栏', () => {
  const kgGym = { plateUnit: 'kg', plates: [20, 10, 5, 2.5], cable: { v: 5, u: 'kg' }, machine: { v: 5, u: 'kg' } };
  const cable = { kind: 'pin', stack: 'cable' };
  assert.equal(L.cardUnitOf(cable, kgGym, { v: 5, u: 'lbs' }, 'kg'), 'lbs', '这一台设的是 lb');
  assert.equal(L.cardUnitOf(cable, kgGym, undefined, 'lbs'), 'kg', 'kg 器械在 lb 显示下同理');
  assert.equal(L.cardUnitOf({ kind: 'plates' }, kgGym, undefined, 'lbs'), 'lbs', '杠铃挂馆的片子，跟顶栏');
  assert.equal(L.cardUnitOf({ kind: 'signed' }, kgGym, undefined, 'lbs'), 'lbs');
  assert.equal(L.cardUnitOf(cable, undefined, undefined, 'lbs'), 'lbs', '没设档案跟顶栏');
  // 换成 kg 显示时键上在 2.26 / 2.27 之间跳（审查 B9 核实）；按器械单位就是整数
  const r = L.makeRounder(cable, 'lbs', lbCtx(5, 10), false, L.cardUnitOf(cable, kgGym, { v: 5, u: 'lbs' }, 'kg'));
  let d = 110;
  for (let i = 0; i < 4; i++) {
    assert.equal(L.SS.stepShown(d, 1, r, 5), 5, `${d} lb 上键写 5`);
    d = L.SS.bumpShown(d, 1, r, 5, false);
  }
  assert.equal(d, 130);
  assert.equal(r.kgOfD(130), 130 / K, '存的仍是精确 kg');
});
t('单边挂片：总重＝一边的片，一档＝最小一片', () => {
  const ctx = { unit: 'kg', plates: [20, 10, 5, 2.5], bar: 0, inc: 5 };
  const two = L.makeRounder({ kind: 'loaded' }, 'kg', ctx, false);
  const one = L.makeRounder({ kind: 'loaded' }, 'kg', { ...ctx, oneSide: true }, false);
  assert.equal(two.snapD(26), 25, 'both sides: pairs of 2.5 → 25');
  assert.equal(one.snapD(26), 25);
  assert.equal(one.snapD(23.5), 22.5, 'one side: 20 + 2.5');
  assert.equal(two.stepD(25), 5);
  assert.equal(one.stepD(25), 2.5);
  assert.equal(one.stepToD(25, 1), 27.5);
});
t('挂片器械填了自重：当空杠算进总重（记的数＝自重 + 片子），比空杠轻的吸到空杠；没填只算片子（2026-11-08 用户定）', () => {
  const ctx = { unit: 'lbs', plates: [45, 35, 25, 10, 5, 2.5], bar: 45, inc: 10 };
  const bare = L.makeRounder({ kind: 'loaded' }, 'lbs', ctx, false);
  const smith = L.makeRounder({ kind: 'loaded' }, 'lbs', { ...ctx, tare: 25 }, false);
  assert.equal(bare.snapD(70), 70, '没填：35 + 35');
  assert.equal(smith.snapD(95), 95, '25 的杠 + 35 + 35');
  assert.ok(smith.loadableD(70), '25 + 22.5 × 2 也挂得出');
  assert.equal(smith.snapD(20), 25, '比空杠轻的吸到空杠');
  assert.equal(smith.stepToD(0, 1), 25, '空着往上第一下是空杠');
  assert.equal(smith.stepToD(25, -1), 25, '空杠往下不动');
  assert.equal(smith.stepToD(25, 1), 30);
  assert.deepEqual(smith.bracketD(96), { lo: 95, hi: 100 });
  // 带配重平衡的史密斯：自重可以是负数
  const cb = L.makeRounder({ kind: 'loaded' }, 'lbs', { ...ctx, tare: -5 }, false);
  assert.equal(cb.snapD(65), 65, '-5 + 35 + 35');
  // 自重不影响别的画法
  assert.equal(L.makeRounder({ kind: 'plates' }, 'lbs', { ...ctx, tare: 25 }, false).snapD(135), 135, '杠铃还是按空杠 45');
});
t('填 / 改 / 清空自重：没做完、没改过的组挂的片不变、数字连自重一起增减（递减档一起）；做完的、改过的、空着的不动', () => {
  const ctx = { unit: 'kg', plates: [20, 10, 5, 2.5], bar: 20, inc: 5 };
  const ex = { id: 'e', name: '史密斯推肩', sets: [] };
  const sets = [
    { id: 'a', weight: 40, reps: 8 },
    { id: 'b', weight: 40, reps: 8, ghost: true },
    { id: 'c', weight: 42, reps: 8, ghost: true, touched: { weight: true } },
    { id: 'd', weight: 0, reps: 8, ghost: true },
    { id: 'e', weight: 40, reps: 8, ghost: true, subSets: [{ id: 'e1', weight: 30, reps: 8 }] },
  ];
  const withTare = L.makeRounder({ kind: 'loaded' }, 'kg', { ...ctx, tare: 15 }, false);
  const out = L.snapUntouched(sets, ex, withTare, 15);
  assert.deepEqual(out.map(s => s.weight), [40, 55, 42, 0, 55]);
  assert.equal(out[4].subSets[0].weight, 45);
  const bare = L.makeRounder({ kind: 'loaded' }, 'kg', ctx, false);
  assert.deepEqual(L.snapUntouched(out, ex, bare, -15).map(s => s.weight), [40, 40, 42, 0, 40], '清空：减回去');
  assert.equal(L.snapUntouched(out, ex, bare, -15)[4].subSets[0].weight, 30);
});

// ── 交替组改记到别的动作：剥掉原动作的「上次」参考、号按目标动作重写（审查 A7）──────────
t('改记到别的动作：prefillRef / draftAuto 剥掉；目标不带正负时辅助的组变成 0', () => {
  const exs = [
    { id: 'A', name: '辅助引体', sets: [{ id: 's1', weight: 30, reps: 8, bodyweightMode: 'assisted', prefillRef: { kg: -30, unit: 'kg' }, draftAuto: true }] },
    { id: 'B', name: '高位下拉', sets: [] },
  ];
  const out = L.moveSetToExercise(exs, { exId: 'A', setId: 's1' }, 'B', ex => ex.id === 'A');
  const moved = out[1].sets[0];
  assert.equal(out[0].sets.length, 0);
  assert.equal(moved.prefillRef, undefined);
  assert.equal(moved.draftAuto, undefined);
  assert.equal(moved.weight, 0);
  assert.equal(moved.bodyweightMode, undefined);
});

t('改记往返：辅助 20 改到不带正负的动作写 0，改回来还是辅助 20；那边改过数就不还原；入册剥掉暂存的号（审查 gap-4#4）', () => {
  // 防的错：记错边改过去再改回来，辅助 20 变成 0（普通），号丢了
  const signed = ex => ex.id === 'A';
  const exs = [
    { id: 'A', name: '辅助引体', sets: [{ id: 's1', weight: 20, reps: 8, bodyweightMode: 'assisted', subSets: [{ id: 'd1', weight: 30, reps: 5, bodyweightMode: 'assisted' }] }] },
    { id: 'B', name: '高位下拉', sets: [] },
  ];
  const there = L.moveSetToExercise(exs, { exId: 'A', setId: 's1' }, 'B', signed);
  const m = there[1].sets[0];
  assert.deepEqual([m.weight, m.bodyweightMode, m.subSets[0].weight], [0, undefined, 0], 'A7 原规则不动');
  const back = L.moveSetToExercise(there, { exId: 'B', setId: 's1' }, 'A', signed)[0].sets[0];
  assert.deepEqual([back.weight, back.bodyweightMode, back.movedKg], [20, 'assisted', undefined]);
  assert.deepEqual([back.subSets[0].weight, back.subSets[0].bodyweightMode, back.subSets[0].movedKg], [30, 'assisted', undefined], '递减档同样还原');
  const edited = there.map(e => (e.id === 'B' ? { ...e, sets: [{ ...m, weight: 5 }] } : e));
  const back5 = L.moveSetToExercise(edited, { exId: 'B', setId: 's1' }, 'A', signed)[0].sets[0];
  assert.deepEqual([back5.weight, back5.bodyweightMode, back5.movedKg], [5, 'weighted', undefined], '在那边改成 5 就按 5（负重），不还原');
  const rec = L.stripWorkbenchSet(m);
  assert.equal(rec.movedKg, undefined);
  assert.equal(rec.subSets[0].movedKg, undefined);
});

// ── 搜索归一化（审查 C）───────────────────────────────────────────
t('搜索：pushup / pull up / dips / rdl / ohp / bss 都找得到；中文照旧', () => {
  const e = (cn, en) => L.S.buildSearchEntry(cn, en, []);
  const hit = (entry, q) => L.S.scoreEntry(entry, L.S.tokenize(q)) > 0;
  assert.ok(hit(e('俯卧撑', 'Push-ups'), 'pushup'));
  assert.ok(hit(e('加重引体向上', 'Weighted Pull-up'), 'pullup'));
  assert.ok(hit(e('加重引体向上', 'Weighted Pull-up'), 'pull up'));
  assert.ok(hit(e('胸部双杠臂屈伸', 'Chest Dip'), 'dips'));
  assert.ok(hit(e('罗马尼亚硬拉', 'Romanian Deadlift'), 'rdl'));
  assert.ok(hit(e('杠铃推举', 'Overhead Press'), 'ohp'));
  assert.ok(hit(e('保加利亚分腿蹲', 'Bulgarian Split Squat'), 'bss'));
  assert.ok(hit(e('杠铃推举', 'Overhead Press'), '推举'));
  assert.ok(!hit(e('杠铃推举', 'Overhead Press'), 'squat'));
});

// ── 拼音字典不进首屏（审查 F11）：载入前拼音字段留空、不缓存，载入后重建就有 ─────────────
t('搜索：拼音字典载入前中文照样命中、拼音不命中且不把空结果缓存住', () => {
  const hit = (q, tags = []) => L.S.scoreEntry(L.S.buildSearchEntry('杠铃卧推', 'Bench Press', tags), L.S.tokenize(q)) > 0;
  assert.ok(hit('卧推'));
  assert.ok(hit('bench'));
  assert.ok(!hit('wotui'));
});
await L.S.loadPinyin();
t('搜索：拼音字典载入后全拼 / 首字母 / 标签拼音都命中（载入前那次没缓存空拼音）', () => {
  const hit = (q, tags = []) => L.S.scoreEntry(L.S.buildSearchEntry('杠铃卧推', 'Bench Press', tags), L.S.tokenize(q)) > 0;
  assert.ok(hit('wotui'));
  assert.ok(hit('glwt'));
  assert.ok(hit('xiongbu', ['胸部']));
});

t('搜索归一化（上架审查 C104）：全角字母、带撇号的拼音组字、英文撇号都能命中', () => {
  const hit = (q, cn = '杠铃卧推', en = 'Bench Press', tags = []) => L.S.scoreEntry(L.S.buildSearchEntry(cn, en, tags), L.S.tokenize(q)) > 0;
  for (const q of ["wo'tui", 'ｗｏｔｕｉ', 'ＷＴ', 'ｂｅｎｃｈ', 'gang’ling']) assert.ok(hit(q), q);
  assert.ok(hit("xiong'bu", '杠铃卧推', 'Bench Press', ['胸部']));
  for (const q of ["farmer's", 'farmers', 'fw']) assert.ok(hit(q, '农夫行走', "Farmer's Walk"), q);
  assert.ok(hit('rdl', 'ＲＤＬ', ''), '全角自建名');
});

// ── 分部位浏览的组内顺序（审查 C2）─────────────────────────────────
t('浏览排序：收藏（星多在前）→ 练过的按上次练的时间倒序 → 没练过的照库序', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id }));
  const star = { e: 2, c: 1 };
  const last = { b: 100, d: 300, c: 999 };
  const rank = L.browseRank(items, x => star[x.id], x => last[x.id] ?? 0);
  const order = [...items].sort((x, y) => rank.get(x.id) - rank.get(y.id)).map(x => x.id);
  assert.deepEqual(order, ['e', 'c', 'd', 'b', 'a', 'f']);
});

// ── 旧覆盖层只有 region（审查 A15）──────────────────────────────────
t('覆盖层合并：旧覆盖层只改了主细分，定义原来的主细分不再混成次要细分', () => {
  const def = { id: 'sq', name: { cn: '深蹲', en: 'Squat' }, region: 'legQuad', regions: ['legQuad', 'legGlute'], category: 'STRENGTH' };
  const m = L.mergeOverride(def, { region: 'legGlute' });
  assert.equal(m.region, 'legGlute');
  assert.deepEqual(m.regions, ['legGlute']);
  const m2 = L.mergeOverride(def, { region: 'legHam', regions: ['legHam', 'legQuad'] });
  assert.deepEqual(m2.regions, ['legHam', 'legQuad'], 'new-style override keeps its own list');
});

// ── 横划计步：接管那一刻从当前位置起算（2026-10-22，原来接管那一下就连走两档）─────────────
t('横划：走够 20px 才接管、接管那一下不算档；之后每 10px 一档；斜着划放手；竖拖（配重片大图）同一套', () => {
  const px = 10;
  const start = { x0: 100, c0: 50, x: 100, acc: 0, engaged: false };
  const run = moves => {
    let tr = start;
    const out = [];
    for (const [p, c] of moves) {
      const r = L.trackScrub(tr, p, c, px);
      if (r.go === 'release') return { released: true, out };
      tr = r.t;
      out.push(...r.detents);
    }
    return { released: false, out, tr };
  };
  assert.equal(L.ENGAGE_PX, 20);
  // 一下拖 22px：原来 22 / 10 = 两档，现在只接管、不走档
  assert.deepEqual(run([[122, 50]]).out, []);
  // 接着再走 10px：一档
  assert.deepEqual(run([[122, 50], [132, 50]]).out, [1]);
  // 手指的真实样子（每次 4px）：在 20 接管，之后 30、40 各一档，48 还差 2px
  const slow = Array.from({ length: 12 }, (_, i) => [100 + (i + 1) * 4, 50]);
  assert.deepEqual(run(slow).out, [1, 1]);
  // 往回拖：负方向
  assert.deepEqual(run([[78, 50], [68, 50], [58, 50]]).out, [-1, -1]);
  // 没过阈值：不接管
  assert.equal(run([[115, 50]]).tr.engaged, false);
  // 斜着划（垂直方向更多）：放手
  assert.equal(run([[110, 75]]).released, true);
});

// 防的是：拖动状态又只有一份、不分手指（审查 C41）。按 useValueScrub 的顺序驱动 scrubGate + trackScrub
t('横划多指：两指同压 / 捏合不走档；起拖后第二指乱动、先抬起不接管也不收尾；丢了 up 下一次主指针照样接上', () => {
  const px = 10;
  const run = (events, d = null) => {
    let net = 0;
    for (const ev of events) {
      const g = L.scrubGate(d && { pid: d.pid, engaged: d.engaged }, ev);
      if (g === 'abort' || g === 'end') d = null;
      else if (g === 'start') d = { pid: ev.pid, x0: ev.x, c0: 50, x: ev.x, acc: 0, engaged: false };
      else if (g === 'track') {
        const r = L.trackScrub(d, ev.x, 50, px);
        if (r.go === 'release') d = null;
        else if (r.go === 'move') {
          d = { ...d, ...r.t };
          net += r.detents.reduce((a, b) => a + b, 0);
        }
      }
    }
    return { net, d };
  };
  const down = (pid, x, primary = pid === 1) => ({ type: 'down', pid, x, primary });
  const move = (pid, x) => ({ type: 'move', pid, x, primary: pid === 1 });
  const up = pid => ({ type: 'up', pid, x: 0, primary: pid === 1 });
  // a. 两指同压一格、原地各自 ±1px 抖动，先抬第二指：一档都不走，抬完没有活动拖动
  const jitter = [];
  for (let i = 0; i < 10; i++) jitter.push(move(1, 100 + (i % 2 ? 1 : -1)), move(2, 160 + (i % 2 ? -1 : 1)));
  const a = run([down(1, 100), down(2, 160), ...jitter, up(2), up(1)]);
  assert.equal(a.net, 0);
  assert.equal(a.d, null);
  // b. 捏合：两指各往外走 8px/步，共 8 步
  const pinch = [];
  for (let i = 1; i <= 8; i++) pinch.push(move(1, 100 - i * 8), move(2, 140 + i * 8));
  assert.equal(run([down(1, 100), down(2, 140), ...pinch, up(1), up(2)]).net, 0);
  // c. 起拖后第二指落下乱动、先抬起：只算第一指的 2 档，第二指抬起不收掉拖动
  const c = run([down(1, 100), move(1, 125), move(1, 135), down(2, 300), move(2, 250), move(1, 145), move(2, 330), up(2)]);
  assert.equal(c.net, 2);
  assert.ok(c.d && c.d.engaged, '第二指抬起后拖动还在');
  // d. 单指对照：3 档
  assert.equal(run([down(1, 100), move(1, 120), move(1, 130), move(1, 140), move(1, 150), up(1)]).net, 3);
  // e. 丢了 up 的旧状态：下一次主指针按下重新开始，从新的按下点起算
  const stale = run([down(1, 100), move(1, 130)]).d;
  const e = run([down(3, 200, true), move(3, 220), move(3, 230), move(1, 400)], stale);
  assert.equal(e.net, 1);
  assert.equal(e.d.pid, 3);
});

// ── 训练时长（刊末页 / 时间线 / CSV 同一口径）──────────────────────────
t('训练时长：finishedAt − startTime 按整分截断（计时器的读法，不四舍五入）；不到 1 分（补记）和超过 12 小时（忘了结束）都不显示；没 finishedAt 的退回导入写的 duration 秒；什么都没有就没有', () => {
  const T0 = '2026-10-21T18:00:00.000Z';
  const plus = (min, sec = 0) => new Date(Date.parse(T0) + min * 60000 + sec * 1000).toISOString();
  assert.equal(L.sessionDurationMin({ startTime: T0, finishedAt: plus(47, 20) }), 47);
  assert.equal(L.sessionDurationMin({ startTime: T0, finishedAt: plus(47, 40) }), 47);
  assert.equal(L.sessionDurationMin({ startTime: T0, finishedAt: plus(0, 50) }), null);
  assert.equal(L.sessionDurationMin({ startTime: T0, finishedAt: plus(12 * 60 + 1) }), null);
  assert.equal(L.sessionDurationMin({ startTime: T0, finishedAt: plus(12 * 60) }), 720);
  // finishedAt 在 startTime 之前（改过日期的脏数据）：不编
  assert.equal(L.sessionDurationMin({ startTime: plus(10), finishedAt: T0 }), null);
  // Strong / Hevy 导入只有 duration（秒），没有 finishedAt 时用它；有 finishedAt 时以时间差为准
  assert.equal(L.sessionDurationMin({ startTime: T0, duration: 65 * 60 }), 65);
  assert.equal(L.sessionDurationMin({ startTime: T0, finishedAt: plus(47), duration: 65 * 60 }), 47);
  assert.equal(L.sessionDurationMin({ duration: 30 }), null);
  assert.equal(L.sessionDurationMin({ startTime: T0 }), null);
  assert.equal(L.sessionDurationMin({}), null);
});

// ── 日期 / 时刻（上架审查 C23–C27 / C78 / C95）──────────────────────────
const withTZ = (tz, fn) => {
  const was = process.env.TZ;
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
};

t('不带年的短日期：英文写月份缩写，中文保持 3/4（i18n-settings#7）', () => {
  // 防的错：英文写成「3/4」，美式和欧式读者读成两个不同的日子；或有人把中文「统一」成「3月4日」，破了 design-plates 的规格
  const d = new Date(2026, 2, 4);
  assert.equal(L.monthDay(d, false), 'Mar 4');
  assert.ok(!L.monthDay(d, false).includes('/'));
  assert.equal(L.monthDay(d, true), '3/4');
});

t('软键盘判定：分屏 / 拉矮窗口不算键盘，系统收起键盘后焦点还在也能判收起（navigation-overlays#4 / A9）', () => {
  // 防的错：只看「比见过的最高矮了 150」，分屏把窗口变矮也当成键盘弹起，训练页操作条一直藏着；
  // 反过来若改成「有焦点才算键盘在」，系统收起键盘后焦点不走，操作条又回不来（A9）
  const run = (steps, w0, h0) => {
    let base = { tallest: h0, width: w0 };
    return steps.map(([w, h, typing]) => {
      const r = L.nextKeyboardGuess(base, { width: w, height: h }, typing);
      base = r.next;
      return r.up;
    });
  };
  assert.deepEqual(run([[393, 420, false], [393, 851, false]], 393, 851), [false, false], '① 不打字进分屏、再退出');
  assert.deepEqual(run([[393, 420, false], [393, 160, true], [393, 160, false]], 393, 851), [false, true, false], '② 分屏后打字、再失焦');
  assert.deepEqual(run([[393, 520, true], [393, 851, true], [393, 520, true]], 393, 851), [true, false, true], '③ A9：焦点不走，高度回升即收起');
  assert.deepEqual(run([[851, 393, false], [851, 200, true]], 393, 851), [false, true], '④ 转屏后重新记');
});

t('日期选择器的确定值：同一分钟原样确定不算改；选到未来夹到现在；夹完和初值同一分钟也不算改（C26 / C25）', () => {
  const initial = new Date(2026, 10, 24, 10, 3, 27, 384);
  const at = (mo, d, h, mi, s = 0) => new Date(2026, mo, d, h, mi, s);
  assert.equal(L.resolvePickedDate(initial, at(10, 24, 10, 3), at(10, 24, 12, 0)), null, '原样确定');
  assert.equal(L.resolvePickedDate(initial, at(10, 24, 18, 0), at(10, 24, 10, 3, 50)), null, '夹到 now 后与初值同一分钟');
  const now = at(10, 24, 10, 30, 12);
  assert.equal(L.resolvePickedDate(initial, at(10, 24, 18, 0), now)?.getTime(), now.getTime(), '今天晚些时候 → now');
  assert.equal(L.resolvePickedDate(initial, at(11, 15, 9, 0), now)?.getTime(), now.getTime(), '下个月 → now');
  assert.equal(L.resolvePickedDate(initial, at(10, 20, 8, 0), now)?.getTime(), at(10, 20, 8, 0).getTime(), '过去的原样');
});

t('编辑态改日期整场平移：date / startTime 同一分钟不漂、finishedAt / 动作时间同一平移量、时长不变、兜底标题换日期；选「现在」整场不晚于现在（C23 / C25 / C95）', () => {
  const w = {
    id: 'w', title: '训练 2026/11/20',
    date: '2026-11-20T10:03:27.120Z', startTime: '2026-11-20T10:03:27.118Z',
    finishedAt: '2026-11-20T11:15:59.000Z', endTime: '2026-11-20T11:15:59.000Z',
    exercises: [{ id: 'e1', exerciseTime: '2026-11-20T10:05:00.000Z', sets: [] }, { id: 'e2', sets: [] }],
  };
  const now = new Date('2026-11-24T12:00:00.000Z');
  assert.equal(L.sessionDurationMin(w), 72);
  const picked = new Date(2026, 9, 15, 18, 3);
  const m = L.redateEdited(w, picked, now);
  const hm = iso => { const d = new Date(iso); return `${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`; };
  assert.equal(hm(m.date), '10-15 18:3');
  assert.equal(hm(m.startTime), '10-15 18:3', 'startTime 不显示成早一分钟');
  const delta = Date.parse(m.date) - Date.parse(w.date);
  assert.equal(Date.parse(m.finishedAt) - Date.parse(w.finishedAt), delta);
  assert.equal(Date.parse(m.endTime) - Date.parse(w.endTime), delta);
  assert.equal(Date.parse(m.exercises[0].exerciseTime) - Date.parse(w.exercises[0].exerciseTime), delta);
  assert.equal(m.exercises[1].exerciseTime, undefined);
  assert.equal(L.sessionDurationMin(m), 72);
  assert.equal(m.title, '训练 2026/10/15');
  const toNow = L.redateEdited(w, now, now);
  assert.ok(Date.parse(toNow.finishedAt) <= now.getTime(), 'finishedAt 不落在未来');
  assert.ok(Date.parse(toNow.date) <= now.getTime());
  assert.equal(L.sessionDurationMin(toNow), 72);
  assert.equal(L.redateEdited({ ...w, title: '练胸' }, picked, now).title, '练胸');
});

t('编辑态改日期：离 date 超过 12 小时的时刻（补录的 finishedAt、旧版改过日期分叉的 startTime）不拖住平移，选的日期照样生效（C25 审查）', () => {
  const L0 = (mo, d, h, mi = 0) => new Date(2026, mo - 1, d, h, mi);
  const iso = (...a) => L0(...a).toISOString();
  const hm = s => { const d = new Date(s); return `${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`; };
  const now = L0(11, 24, 21);
  // 11-24 20:00 训练中补录到 11-10 18:00：没有 startTime，结束时 finishedAt 写成录入那一刻
  const backfill = {
    id: 'b', title: '练腿', date: iso(11, 10, 18), finishedAt: iso(11, 24, 20), endTime: iso(11, 24, 20),
    exercises: [{ id: 'e', exerciseTime: iso(11, 10, 18, 5), sets: [] }],
  };
  const b = L.redateEdited(backfill, L0(11, 15, 18), now);
  assert.equal(hm(b.date), '11-15 18:0', '选的日期生效');
  assert.equal(hm(b.exercises[0].exerciseTime), '11-15 18:5');
  assert.ok(Date.parse(b.finishedAt) <= now.getTime(), 'finishedAt 不落在未来');
  // 往前挪：同一段一起平移
  const back = L.redateEdited(backfill, L0(11, 5, 18), now);
  assert.equal(hm(back.date), '11-5 18:0');
  assert.equal(Date.parse(back.finishedAt), Date.parse(backfill.finishedAt) - 5 * 86_400_000);
  // 实际 11-20 练、旧版只把 date 改到了 10-15：现在改到 11-22
  const forked = {
    id: 'f', title: '练背', date: iso(10, 15, 18), startTime: iso(11, 20, 18), finishedAt: iso(11, 20, 19, 12),
    exercises: [{ id: 'e', exerciseTime: iso(11, 20, 18, 5), sets: [] }],
  };
  const f = L.redateEdited(forked, L0(11, 22, 18), now);
  assert.equal(hm(f.date), '11-22 18:0', '选的日期生效');
  assert.ok(Date.parse(f.startTime) <= now.getTime() && Date.parse(f.finishedAt) <= now.getTime());
  assert.equal(L.sessionDurationMin(f), 72, '时长不变');
  // 选「现在」：整场贴着 date 的时刻照样不晚于现在
  const toNow = L.redateEdited(backfill, now, now);
  assert.ok(Date.parse(toNow.exercises[0].exerciseTime) <= now.getTime());
});

t('兜底标题：中英两种格式都认、不看当前语言，自定义标题不认；换日期保持原来的语言（C95）', () => {
  assert.equal(L.isDefaultTitle('训练 2026/11/23'), true);
  assert.equal(L.isDefaultTitle('Workout Nov 23, 2026'), true);
  for (const s of ['练胸', '训练 A', '', undefined, 'Workout A']) assert.equal(L.isDefaultTitle(s), false, String(s));
  const d = new Date(2026, 9, 15, 18, 0);
  assert.equal(L.retitleForDate('Workout Nov 23, 2026', d), 'Workout Oct 15, 2026');
  assert.equal(L.retitleForDate('训练 2026/11/23', d), '训练 2026/10/15');
  assert.equal(L.retitleForDate('练胸', d), '练胸');
});

t('热力图网格按日期键：午夜拨夏令时的时区里今天那格在、一行不缺；上海照旧 98 格从 08-24 起（C24）', () => {
  const nextKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10); };
  for (const [tz, today] of [['America/Santiago', '2026-11-24'], ['Africa/Cairo', '2026-04-27']]) {
    withTZ(tz, () => {
      const cells = L.heatmapCells([], today);
      const past = cells.filter(c => !c.future);
      assert.equal(past[past.length - 1].date, today, `${tz} 最后一个非未来格是今天`);
      assert.equal(cells.filter(c => c.isToday).length, 1, `${tz} 恰好一个今天`);
      assert.equal(cells.length % 7, 0, `${tz} 整行`);
      for (let i = 1; i < cells.length; i++) assert.equal(cells[i].date, nextKey(cells[i - 1].date), `${tz} 第 ${i} 格连续`);
    });
  }
  withTZ('Asia/Shanghai', () => {
    const cells = L.heatmapCells([{ date: '2026-11-20', sets: 10, sessions: 1 }], '2026-11-24');
    assert.equal(cells.length, 98);
    assert.equal(cells[0].date, '2026-08-24');
    assert.equal(cells.find(c => c.date === '2026-11-20').level, 2);
  });
});

t('到下一个本地零点：圣地亚哥那天的零点不存在也是 30 分钟；上海 23:59:30 是 30 秒（C78 的定时器）', () => {
  withTZ('America/Santiago', () => assert.equal(L.msToNextLocalMidnight(new Date(2026, 8, 5, 23, 30)), 30 * 60_000));
  withTZ('Asia/Shanghai', () => assert.equal(L.msToNextLocalMidnight(new Date(2026, 10, 24, 23, 59, 30)), 30_000));
});

t('分钟吸格：0..59 往上 / 往下都落在 5 分钟的格子上；3↓0、0↓55、58↑0（C27）', () => {
  for (let m = 0; m < 60; m++) for (const dir of [1, -1]) {
    const r = L.stepMinute(m, dir);
    assert.ok(r >= 0 && r < 60 && r % 5 === 0, `${m} ${dir} → ${r}`);
  }
  assert.equal(L.stepMinute(3, -1), 0);
  assert.equal(L.stepMinute(0, -1), 55);
  assert.equal(L.stepMinute(58, 1), 0);
  assert.equal(L.stepMinute(55, 1), 0);
});

// ── 补录（训练中把这场改到过去）──────────────────────────
t('补录：挪到过去后不显示时长（结束时刻减录入时刻不是练了多久）、动作时间跟着平移；判纪录 / 期号 / 上次只看这场日期之前的', () => {
  const live = {
    id: 'now', date: '2026-11-13T10:00:00.000Z', startTime: '2026-11-13T10:00:00.000Z',
    exercises: [{ id: 'e1', exerciseTime: '2026-11-13T10:05:00.000Z', sets: [] }, { id: 'e2', sets: [] }],
  };
  assert.equal(L.isBackdated(live), false);
  const moved = L.redateLiveSession(live, new Date('2026-11-12T18:00:00.000Z'));
  assert.equal(moved.date, '2026-11-12T18:00:00.000Z');
  assert.equal(moved.exercises[0].exerciseTime, '2026-11-12T18:05:00.000Z');
  assert.equal(moved.exercises[1].exerciseTime, undefined);
  assert.equal(L.isBackdated(moved), true);
  assert.equal(L.sessionDurationMin({ ...moved, finishedAt: '2026-11-13T10:12:00.000Z' }), null);
  // 再挪一次：从挪过的时刻接着平移
  assert.equal(L.redateLiveSession(moved, new Date('2026-11-11T18:00:00.000Z')).exercises[0].exerciseTime, '2026-11-11T18:05:00.000Z');
  // 没分到 id 的空工作台不算补录
  assert.equal(L.isBackdated({ id: '', date: live.date, exercises: [] }), false);
  const ws = [
    { id: 'later', date: '2026-11-12T20:00:00.000Z' },
    { id: 'moved', date: '2026-11-12T18:00:00.000Z' },
    { id: 'earlier', date: '2026-11-10T18:00:00.000Z' },
  ];
  assert.deepEqual(L.sessionsBefore(ws, { id: 'moved', date: '2026-11-12T18:00:00.000Z' }).map(w => w.id), ['earlier']);
});

// ── 器械与重量（2026-11-13）：上限、最重一格、大图只写待做 / 选中的组、换台不漂、固定器械按动作分台 ──────────
t('重量上限按显示单位夹：500 kg / 1100 lb，带正负 ±300 kg（660 lb），普通重量不低于 0；体重 20~300 kg（44~660 lb）', () => {
  assert.equal(L.LD.clampLoadD(1000, 'kg', false), 500);
  assert.equal(L.LD.clampLoadD(2000, 'lbs', false), 1100);
  assert.equal(L.LD.clampLoadD(137.5, 'kg', false), 137.5);
  assert.equal(L.LD.clampLoadD(-5, 'kg', false), 0);
  assert.equal(L.LD.clampLoadD(-400, 'kg', true), -300);
  assert.equal(L.LD.clampLoadD(700, 'lbs', true), 660);
  assert.equal(L.LD.clampBodyweightD(0, 'kg'), 20);
  assert.equal(L.LD.clampBodyweightD(750, 'kg'), 300);
  assert.equal(L.LD.clampBodyweightD(181.5, 'lbs'), 181.5);
  assert.equal(L.LD.clampBodyweightD(7, 'lbs'), 44);
});
t('拖动到顶 / 到底：落在边界上，已经在边界就原地（不震不回调）；超限的旧数据往回拖照常走、往外拖不动', () => {
  assert.equal(L.boundDetent(495, 505, 1, 0, 500), 500);
  assert.equal(L.boundDetent(500, 505, 1, 0, 500), 500);
  assert.equal(L.boundDetent(600, 602.5, 1, 0, 500), 600);
  assert.equal(L.boundDetent(600, 597.5, -1, 0, 500), 597.5);
  assert.equal(L.boundDetent(2.5, -2.5, -1, 0, 500), 0);
  assert.equal(L.boundDetent(0, -2.5, -1, 0, 500), 0);
});
t('配重片最重一格：± / 拖动到它为止，自动取整吸到它；不在格子上的最重一格按它以下最近的一格算', () => {
  const r = L.makeRounder(pinInfo, 'lbs', { ...lbCtx(5, 12.5), end: 52.5 }, false);
  assert.equal(r.stepToD(47.5, 1), 52.5);
  assert.equal(r.stepToD(52.5, 1), 52.5);
  assert.equal(r.stepToD(42.5, 1, 4), 52.5);
  assert.equal(r.snapD(60), 52.5);
  assert.equal(r.stepToD(52.5, -1), 47.5);
  const odd = L.makeRounder(pinInfo, 'lbs', { ...lbCtx(5, 12.5), end: 50 }, false);
  assert.equal(odd.stepToD(47.5, 1), 47.5);
  // 手打的超过最重一格照原样记（不是自动生成的）
  assert.equal(r.loadableD(60), false);
});
t('大图画哪一组、能不能写：选中的组 → 第一组待做（能写）；全做完又没选中画最后一组但不能写；选中做完的组能写', () => {
  const done = [{ id: 'a' }, { id: 'b' }];
  const half = [{ id: 'a' }, { id: 'b', ghost: true }, { id: 'c', ghost: true }];
  assert.deepEqual(L.heroFocus(done, null), { idx: 1, live: false });
  assert.deepEqual(L.heroFocus(done, 'a'), { idx: 0, live: true });
  assert.deepEqual(L.heroFocus(half, null), { idx: 1, live: true });
  assert.deepEqual(L.heroFocus(half, 'zz'), { idx: 1, live: true });
  assert.deepEqual(L.heroFocus([], null), { idx: -1, live: false });
});
t('换台：没动过的底稿从上一次的原值重取整，lb 台 ⇄ kg 台来回切回到原值；填过自重平移过的底稿之后从当前值算', () => {
  const ex = { id: 'e', name: '器械推肩', sets: [] };
  const lbRig = L.makeRounder(pinInfo, 'lbs', lbCtx(5, 12.5), false);
  const kgRig = L.makeRounder(pinInfo, 'kg', { unit: 'kg', plates: [20, 10, 5, 2.5], bar: 20, inc: 5, start: 0 }, false, 'lbs');
  const [s0] = L.roundPrefill([{ id: 's', weight: 17.5 * LB, reps: 8, ghost: true }], ex, lbRig);
  const back = L.reRoundPending(L.reRoundPending([s0], ex, kgRig), ex, lbRig);
  assert.equal(Math.round(back[0].weight * K * 100) / 100, 17.5);
  // 自重平移过：不再是从上一次纯换算来的
  const ctx = { unit: 'kg', plates: [20, 10, 5, 2.5], bar: 20, inc: 5 };
  const loaded = { id: 'e', name: '史密斯推肩', sets: [] };
  const bare = L.makeRounder({ kind: 'loaded' }, 'kg', ctx, false);
  const [p] = L.roundPrefill([{ id: 'p', weight: 40, reps: 8, ghost: true }], loaded, bare);
  const shifted = L.snapUntouched([p], loaded, L.makeRounder({ kind: 'loaded' }, 'kg', { ...ctx, tare: 15 }, false), 15);
  assert.equal(shifted[0].draftAuto, false);
  assert.equal(L.reRoundPending(shifted, loaded, L.makeRounder({ kind: 'loaded' }, 'kg', { ...ctx, tare: 15, oneSide: true }, false))[0].weight, 55);
});
t('配重片形式全馆一份（馆|~stack）：龙门架和固定器械看到同一份；旧键里的读的时候折进来；第一次存就整份落进新键、旧键清空', () => {
  const mach = { kind: 'pin', equipment: 'tagMachine', defId: 'leg_ext' };
  const cable = { kind: 'pin', equipment: 'tagCable', defId: 'pulldown' };
  assert.equal(L.LB.rigListKey('A', mach), 'A|~stack');
  assert.equal(L.LB.rigListKey('A', cable), 'A|~stack');
  assert.equal(L.LB.rigListKey('A', { kind: 'pair', equipment: 'tagDumbbell', defId: 'db_press' }), 'A|tagDumbbell');
  const r1 = { id: 'r1', v: 5, u: 'lbs', s: 12.5 };
  const r2 = { id: 'r2', v: 10, u: 'kg' };
  const r3 = { id: 'r3', v: 5, u: 'lbs', s: 2.5 };
  const db = { id: 'd1', v: 2.5, u: 'kg' };
  // 升级前的样子：龙门架共用一份、腿屈伸自己一份、11-13 前固定器械共用的一份；哑铃、别的馆不相干
  const old = { 'A|tagCable': [r1], 'A|tagMachine|leg_ext': [r3], 'A|tagMachine': [r2, r1], 'A|tagDumbbell': [db], 'B|tagCable': [{ id: 'x', v: 1, u: 'kg' }] };
  const ids = list => list.map(r => r.id).sort();
  // 新动作（没选过台）在哪种器材上都看到全馆的三种，同一个 id 只算一次
  assert.deepEqual(ids(L.LB.rigsOf(old, 'A', mach, undefined)), ['r1', 'r2', 'r3']);
  assert.deepEqual(ids(L.LB.rigsOf(old, 'A', cable, undefined)), ['r1', 'r2', 'r3']);
  assert.deepEqual(L.LB.rigsOf(old, 'A', { kind: 'pair', equipment: 'tagDumbbell' }, undefined), [db]);
  // 自定义器材的旧键认不出是不是配重片：只接这个动作选着的那一台
  const custom = { kind: 'pin', equipment: 'tag_custom', defId: 'c' };
  const withCustom = { ...old, 'A|tag_custom': [{ id: 'c1', v: 4, u: 'kg' }, { id: 'c2', v: 6, u: 'kg' }] };
  assert.deepEqual(ids(L.LB.rigsOf(withCustom, 'A', custom, 'c2')), ['c2', 'r1', 'r2', 'r3']);
  assert.deepEqual(ids(L.LB.rigsOf(withCustom, 'A', mach, undefined)), ['r1', 'r2', 'r3']);
  // 删掉 r2 存一次：新键只有剩下的两种，旧的配重片键清空（不清的话 r2 下次读又从旧键折回来）；哑铃、别的馆不动
  const saved = L.LB.rigsPatch(old, 'A', mach, [r1, r3]);
  assert.deepEqual(saved['A|~stack'], [r1, r3]);
  assert.deepEqual([saved['A|tagCable'], saved['A|tagMachine|leg_ext'], saved['A|tagMachine']], [[], [], []]);
  assert.deepEqual(saved['A|tagDumbbell'], [db]);
  assert.equal(saved['B|tagCable'].length, 1);
  assert.deepEqual(ids(L.LB.rigsOf(saved, 'A', cable, undefined)), ['r1', 'r3']);
  // 哑铃照旧只写自己的键
  assert.deepEqual(L.LB.rigsPatch(old, 'A', { kind: 'pair', equipment: 'tagDumbbell' }, []), { ...old, 'A|tagDumbbell': [] });
  // 各动作各建过一份同样刻度的：药丸排只出一枚，选着的那枚优先；起了名的各算各的
  const twin = { id: 't', v: 5, u: 'lbs', s: 12.5 };
  const named = { id: 'n', v: 5, u: 'lbs', s: 12.5, n: '高位下拉' };
  assert.deepEqual(ids(L.LB.distinctRigs([r1, twin, named, r2], '')), ['n', 'r1', 'r2']);
  assert.deepEqual(ids(L.LB.distinctRigs([r1, twin, named, r2], 't')), ['n', 'r2', 't']);
});

t('固定器械上挂哑铃 / 壶铃的台存在「馆|tagMachine~画法」：不再被当成配重片旧键折进配重片、也不被存配重片清掉（上架审查 gap-3#2）', () => {
  const db = { id: 'd1', v: 2, u: 'kg' };
  const st = { id: 's1', v: 5, u: 'kg', s: 5 };
  const pairM = { kind: 'pair', equipment: 'tagMachine' };
  const bellM = { kind: 'bell', equipment: 'tagMachine' };
  const pinC = { kind: 'pin', equipment: 'tagCable' };
  const all = L.LB.rigsPatch({ 'A|~stack': [st] }, 'A', pairM, [db]);
  assert.equal(L.LB.rigListKey('A', pairM), 'A|tagMachine~pair');
  assert.deepEqual(L.LB.rigsOf(all, 'A', pinC, undefined).map(r => r.id), ['s1']);
  const after = L.LB.rigsPatch(all, 'A', pinC, [st]);
  assert.deepEqual(L.LB.rigsOf(after, 'A', pairM, 'd1'), [db]);
  assert.deepEqual(L.LB.rigsOf(all, 'A', bellM, undefined), []);
});

t('名字作键的表只认自有键（上架审查 C09）：动作名是 constructor / toString 查不到继承来的函数，__proto__ 是普通的键', () => {
  const resolveMap = new Map([['Bench Press', '卧推']]);
  const resolveName = n => resolveMap.get(n) ?? n;
  const raw = JSON.parse('{"__proto__":["reps"],"卧推":["weight"],"Bench Press":["weight","reps"]}');
  const t2 = L.byDisplayName(raw, resolveName, () => false);
  for (const k of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', '__defineGetter__']) assert.equal(t2[k], undefined, k);
  assert.deepEqual(t2['__proto__'], ['reps']);
  assert.ok(Object.keys(t2).includes('__proto__'));
  assert.deepEqual(t2['卧推'], ['weight'], '键名正好等于显示名的那个说了算');
  assert.equal(L.ownValue(JSON.parse('{}'), 'constructor'), undefined);
  assert.equal(L.ownValue(JSON.parse('{"__proto__":"v1"}'), '__proto__'), 'v1');
});

t('馆名不能新带半角「|」（上架审查 C51：「力健」和「力健|二楼」的键前缀分不开）；全角放行，存量名字不改时照样能存', () => {
  assert.equal(L.GY.gymNameIssue('力健|二楼', '', ['力健']), 'pipe');
  assert.equal(L.GY.gymNameIssue('新|名', '老馆', ['老馆']), 'pipe');
  assert.equal(L.GY.gymNameIssue('力健｜二楼', '', []), null);
  assert.equal(L.GY.gymNameIssue('老馆|A', '老馆|A', ['老馆|A']), null);
  assert.equal(L.GY.gymNameIssue('  ', '', []), 'empty');
  assert.equal(L.GY.gymNameIssue('力健', '', ['力健']), 'taken');
});

t('配重片加片：能到的重量＝插销格子 + 任选几块；± 一下走到紧挨着的下一个；到顶以后只能靠加片；大图拆成插销 + 加片', () => {
  const base = { unit: 'lbs', plates: [], bar: 0, inc: 5, start: 5 };
  const one = { ...base, addons: [2.5] };
  // 一块 2.5：5、7.5、10、12.5…
  assert.deepEqual(L.LB.bracket('pin', 11, one), { lo: 10, hi: 12.5 });
  assert.deepEqual(L.LB.bracket('pin', 12.5, one), { lo: 12.5, hi: 12.5 });
  assert.equal(L.LB.isLoadable('pin', 17.5, one), true);
  assert.equal(L.LB.isLoadable('pin', 17.5, base), false, '没有加片时 17.5 挂不出来');
  assert.equal(L.LB.stepTo('pin', 15, 1, 1, one), 17.5);
  assert.equal(L.LB.stepTo('pin', 15, -1, 1, one), 12.5);
  assert.equal(L.LB.nearest('pin', 16, one), 15);
  // 插销至少插在最轻一格：只挂加片（2.5）不算一个重量
  assert.deepEqual(L.LB.bracket('pin', 3, one), { lo: 5, hi: 5 });
  assert.equal(L.LB.stepTo('pin', 5, -1, 1, one), 5);
  // 一档 10、两块 2.5：10、12.5、15、20…（17.5 到不了）
  const two = { unit: 'lbs', plates: [], bar: 0, inc: 10, start: 10, addons: [2.5, 2.5] };
  assert.deepEqual(L.LB.addonSums(two.addons), [0, 2.5, 5]);
  assert.deepEqual(L.LB.bracket('pin', 17, two), { lo: 15, hi: 20 });
  // 最重一格 50：往上还有 52.5、55，再往上没有了
  const capped = { ...two, end: 50 };
  assert.deepEqual(L.LB.bracket('pin', 51, capped), { lo: 50, hi: 52.5 });
  assert.deepEqual(L.LB.bracket('pin', 80, capped), { lo: 55, hi: 55 });
  assert.equal(L.LB.stepTo('pin', 55, 1, 1, capped), 55);
  assert.deepEqual(L.LB.splitStack(15, two), { pin: 10, add: [2.5, 2.5] });
  assert.deepEqual(L.LB.splitStack(12.5, two), { pin: 10, add: [2.5] });
  assert.deepEqual(L.LB.splitStack(20, two), { pin: 20, add: [] }, '格子上的重量不挂加片');
  assert.deepEqual(L.LB.splitStack(17, two), { pin: 17, add: [] }, '拆不出来就全算插销');
  // 加片不一样就不是同一种形式；换单位按实重换算
  assert.ok(!L.LB.sameSpec({ v: 5, u: 'lbs' }, { v: 5, u: 'lbs', a: [2.5] }));
  assert.ok(L.LB.sameSpec({ v: 5, u: 'lbs', a: [2.5, 1] }, { v: 5, u: 'lbs', a: [1, 2.5] }));
  assert.deepEqual(L.LB.rigInUnit({ v: 5, u: 'kg', a: [1.25] }, 'lbs').a, [2.75]);
});

const ta = async (name, fn) => {
  await fn();
  n++;
  console.log(`  ✓ ${name}`);
};

// ── 落盘失败要看得见（审查 E4 / F2）：db 写路径自己重试一次，仍失败派发事件；之后任意一次写成功复位 ──────
await ta('db 写入：rawPut 抛错先重试一次；两次都失败派发 db-write-failed 并照样 reject；之后写成功派发一次 db-write-ok，再成功不重复派发', async () => {
  const events = [];
  globalThis.window = new EventTarget();
  for (const e of ['fitlog:db-write-failed', 'fitlog:db-write-ok']) window.addEventListener(e, () => events.push(e));
  const d = new L.FitLogDB();
  let failures = 1;
  d.rawPut = async () => {
    if (failures-- > 0) throw new Error('QuotaExceededError');
  };
  await d.save('workouts', { id: 'w1' }); // 第一次失败、重试成功：不算失败
  assert.deepEqual(events, []);
  failures = 2;
  await assert.rejects(d.save('workouts', { id: 'w1' }));
  assert.deepEqual(events, ['fitlog:db-write-failed']);
  failures = 2;
  await assert.rejects(d.save('workouts', { id: 'w1' })); // 连着失败：不再派发（只提示一次）
  assert.deepEqual(events, ['fitlog:db-write-failed']);
  await d.save('workouts', { id: 'w1' });
  await d.save('workouts', { id: 'w2' });
  assert.deepEqual(events, ['fitlog:db-write-failed', 'fitlog:db-write-ok']);
  assert.equal(L.dbWriteFailing(), false, '晚挂载的组件靠 getter 读当前状态');
  delete globalThis.window;
});

// ── 本机库读不出 / 被清空要看得见（上架审查 C14 / C12）──────────────────
/** 假 indexedDB：open 的行为由 mode 定；store 只有 getAll */
function fakeIdb(mode, { oldVersion = 8 } = {}) {
  const store = { getAll: () => { const r = {}; setTimeout(() => { r.result = []; r.onsuccess?.(); }); return r; } };
  const db = { version: 8, objectStoreNames: { contains: () => true }, transaction: () => ({ objectStore: () => store }), close() {} };
  return {
    open: () => {
      const req = {};
      setTimeout(() => {
        if (mode === 'error') { req.error = new DOMException('backing store', 'UnknownError'); req.onerror?.(); }
        else if (mode === 'ok') {
          if (oldVersion === 0) req.onupgradeneeded?.({ oldVersion: 0, target: { result: db } });
          req.result = db;
          req.onsuccess?.({ target: { result: db } });
        }
        // 'hang'：永不回调
      });
      return req;
    },
  };
}

await ta('读库：开库报错时读 reject、只派发一次 db-read-failed，getter 跟着翻转；之后读成功派发 db-read-ok', async () => {
  const events = [];
  globalThis.window = new EventTarget();
  for (const e of ['fitlog:db-read-failed', 'fitlog:db-read-ok']) window.addEventListener(e, () => events.push(e));
  globalThis.indexedDB = fakeIdb('error');
  const d = new L.FitLogDB();
  await assert.rejects(d.getAll('workouts'));
  await assert.rejects(d.getAll('workouts'));
  assert.deepEqual(events, ['fitlog:db-read-failed']);
  assert.equal(L.dbReadFailing(), true);
  globalThis.indexedDB = fakeIdb('ok');
  assert.deepEqual(await d.getAll('workouts'), []);
  assert.deepEqual(events, ['fitlog:db-read-failed', 'fitlog:db-read-ok']);
  assert.equal(L.dbReadFailing(), false);
  delete globalThis.window;
  delete globalThis.indexedDB;
});

await ta('开库挂住：超时后读以 TimeoutError reject，下一次读重新开库（不卡在同一个 open 上）', async () => {
  globalThis.window = new EventTarget();
  const realTimeout = globalThis.setTimeout;
  let opens = 0;
  const idb = fakeIdb('hang');
  globalThis.indexedDB = { open: (...a) => { opens++; return idb.open(...a); } };
  // 计时器立即到点（只缩短超时，fake 自己的回调照常）
  globalThis.setTimeout = (fn, ms, ...rest) => realTimeout(fn, ms >= 1000 ? 0 : ms, ...rest);
  try {
    const d = new L.FitLogDB();
    await assert.rejects(d.getAll('workouts'), e => e?.name === 'TimeoutError');
    await assert.rejects(d.getAll('workouts'), e => e?.name === 'TimeoutError');
    assert.equal(opens, 2);
  } finally {
    globalThis.setTimeout = realTimeout;
    delete globalThis.window;
    delete globalThis.indexedDB;
  }
});

await ta('库是这次新建的（被系统清掉 / 数据损坏重建）而本机记着有训练：记下丢失标记；新装、重置过（水位 0）、正常升级都不记', async () => {
  globalThis.window = new EventTarget();
  const lost = [];
  window.addEventListener('fitlog:local-loss', () => lost.push(1));
  const run = async (watermark, oldVersion) => {
    localStorage.clear();
    if (watermark != null) L.storage.setItem('fitlog_local_workouts', String(watermark));
    globalThis.indexedDB = fakeIdb('ok', { oldVersion });
    await new L.FitLogDB().getAll('workouts');
    return L.LC.readLocalLoss();
  };
  try {
    assert.equal((await run(5, 0))?.expected, 5);
    assert.equal(lost.length, 1);
    assert.equal(await run(null, 0), null, '新装');
    assert.equal(await run(0, 0), null, '重置过');
    assert.equal(await run(5, 8), null, '正常打开');
  } finally {
    localStorage.clear();
    delete globalThis.window;
    delete globalThis.indexedDB;
  }
});

// ── 编辑旧训练的草稿槽（上架审查 C28）：被杀后重开只接回「还对得上原记录、真改过」的草稿，坏槽不让启动崩 ──────────
t('编辑草稿槽：对得上原记录且改过才接回；原记录被改 / 没了 / 槽坏了 / 没改动都不接回；删光动作的草稿也接回', () => {
  // 防的错：不校验就接回，会把启动迁移改过的原记录盖回旧样子（旧数据复活）、坏行让启动抛错、没改动也停在编辑页
  const orig = {
    id: 'w1', title: '腿日', date: '2026-11-20T09:00:00.000Z', gym: '甲馆', notes: '备注', tags: [],
    exercises: [{ id: 'e1', name: '深蹲', sets: [{ id: 's1', weight: 100, reps: 5 }] }],
  };
  const draft = structuredClone(orig);
  draft.exercises[0].sets[0].reps = 6;
  const row = { id: L.WP.EDIT_DRAFT_ID, base: L.editKey(orig), draft };
  assert.equal(L.WP.resumableEditDraft(row, orig)?.draft.exercises[0].sets[0].reps, 6);
  const changed = structuredClone(orig);
  changed.exercises[0].sets[0].reps = 7;
  assert.equal(L.WP.resumableEditDraft(row, changed), null, '原记录后来被改过');
  assert.equal(L.WP.resumableEditDraft(row, undefined), null, '原记录没了');
  for (const bad of [null, 'x', { draft }, { base: 1, draft }, { base: row.base, draft: { ...draft, exercises: 'x' } }, { base: row.base, draft: { exercises: [] } }]) {
    assert.equal(L.WP.resumableEditDraft(bad, orig), null, `坏槽 ${JSON.stringify(bad)?.slice(0, 40)}`);
  }
  assert.equal(L.WP.resumableEditDraft({ ...row, draft: structuredClone(orig) }, orig), null, '草稿没改动');
  assert.ok(L.WP.resumableEditDraft({ ...row, draft: { ...draft, exercises: [] } }, orig), '删光动作的草稿');
  // 槽要经过 IndexedDB 的结构化克隆 / JSON 往返，比较键不能因此变
  assert.equal(L.editKey(JSON.parse(JSON.stringify(orig))), row.base);
  assert.equal(L.editKey(structuredClone(orig)), row.base);
});

t('计划编辑器草稿：坏 JSON、单位不对、exercises 不是数组的条目跳过，不抛；写一条不动别的，删到空就移除键', () => {
  // 防的错：草稿从 localStorage 读回来，一条坏的让计划编辑器打不开，或者把错单位的目标重量当成现在单位的数
  const ok = { unit: 'kg', title: 't', date: '2026-11-24', exercises: [{ id: 'x', name: '深蹲' }], notes: '' };
  assert.deepEqual(L.PD.parsePlanDrafts('{bad'), {});
  assert.deepEqual(L.PD.parsePlanDrafts(null), {});
  assert.deepEqual(L.PD.parsePlanDrafts('[1]'), {});
  const got = L.PD.parsePlanDrafts(JSON.stringify({ a: ok, b: { ...ok, unit: 'st' }, c: { ...ok, exercises: 'x' }, d: { ...ok, exercises: [null] }, e: 3 }));
  assert.deepEqual(Object.keys(got), ['a']);
  localStorage.clear();
  L.PD.writePlanDraft('a', ok);
  L.PD.writePlanDraft('new', { ...ok, title: 'n' });
  L.PD.writePlanDraft('a', null);
  assert.equal(L.PD.readPlanDraft('new')?.title, 'n');
  assert.equal(L.PD.readPlanDraft('a'), undefined);
  L.PD.writePlanDraft('new', null);
  assert.equal(localStorage.getItem(L.PD.PLAN_DRAFTS_KEY), null);
});

// ── 忘了结束的训练要真的过期（审查 Fm0）：内容没变的自动落盘不重写、不刷新 updatedAt ──────────
await ta('工作台落盘：接回来的那场只切后台 / 列表刷新不重写；改了内容才写并刷新 updatedAt；写失败下次同一份照原 updatedAt 重写；13 小时没改过的不再接回', async () => {
  const H = 3600000;
  const at = h => new Date(Date.now() - h * H).toISOString();
  const writes = [];
  let fail = false;
  const saver = L.WP.createWorkbenchSaver(async w => {
    writes.push(w);
    if (fail) throw new Error('quota');
  });
  const ex = [{ id: 'e', name: '深蹲', sets: [] }];
  const old = { id: 'w_old', date: at(14), startTime: at(14), updatedAt: at(11), exercises: ex };
  saver.adopt(old);
  saver.save(old); // 切后台
  saver.save(old); // 列表刷新让 App 的落盘 effect 再跑一次
  assert.equal(writes.length, 0, '内容没变不该写');
  // 库里那份因此停在 13 小时前：不再接回（哪怕它是记着的 activeId）
  assert.equal(L.WP.findInProgress([{ ...old, updatedAt: at(13) }], 'w_old'), null);
  assert.equal(L.WP.findInProgress([old], 'w_old')?.id, 'w_old');

  const edited = { ...old, notes: '改了' };
  saver.save(edited);
  assert.equal(writes.length, 1);
  assert.ok(Date.now() - Date.parse(writes[0].updatedAt) < 1000, '改了内容 → updatedAt 是现在');
  await Promise.resolve();
  saver.save(edited);
  assert.equal(writes.length, 1, '同一份写成功后不再写');

  fail = true;
  const edited2 = { ...edited, notes: '又改' };
  saver.save(edited2);
  await new Promise(r => setTimeout(r, 0));
  fail = false;
  saver.save(edited2); // 上次没写进去：重写，updatedAt 不变
  assert.equal(writes.length, 3);
  assert.equal(writes[2].updatedAt, writes[1].updatedAt);
  // 过期按保存器记下的最后改动判（内存那份的 updatedAt 不随落盘刷新）
  assert.equal(saver.lastChange('w_old'), Date.parse(writes[2].updatedAt));
  assert.equal(saver.lastChange('别的'), null);
});

// ── 未结束的训练没人收尾（上架审查 C01 / C02 / C03）──────────────────
t('接回只认工作台上那一场：被顶下来的另一场哪怕刚改过也不接；没记过 activeId（旧版升级）才认 12 小时内开练的', () => {
  const H = 3600000;
  const at = h => new Date(Date.now() - h * H).toISOString();
  const ex = [{ id: 'e', name: '深蹲', sets: [{ id: 's', weight: 60, reps: 5 }] }];
  const A = { id: 'A', date: at(3), startTime: at(3), updatedAt: at(0), exercises: ex };
  const B = { id: 'B', date: at(1), startTime: at(1), updatedAt: at(0.5), exercises: ex };
  assert.equal(L.WP.findInProgress([A, B], 'B')?.id, 'B');
  assert.equal(L.WP.findInProgress([A], 'B'), null);
  assert.equal(L.WP.findInProgress([A], null)?.id, 'A');
});

t('该自动收尾的：没结束、有动作、不是工作台那场、闲置满 12 小时；11 小时 59 分的不算；2026-11-14 之前的旧行不碰', () => {
  const H = 3600000;
  const now = Date.now();
  const at = h => new Date(now - h * H).toISOString();
  const ex = [{ id: 'e', name: '深蹲', sets: [{ id: 's', weight: 60, reps: 5, ghost: true }] }];
  const rows = [
    { id: 'old13', date: at(14), updatedAt: at(13), exercises: ex },
    { id: 'edge', date: at(14), updatedAt: new Date(now - 12 * H + 60000).toISOString(), exercises: ex },
    { id: 'bench', date: at(14), updatedAt: at(13), exercises: ex },
    { id: 'done', date: at(14), updatedAt: at(13), finishedAt: at(13), exercises: ex },
    { id: 'empty', date: at(14), updatedAt: at(13), exercises: [] },
    { id: 'legacy', date: '2026-10-31T10:00:00Z', updatedAt: '2026-10-31T11:00:00Z', exercises: ex },
  ];
  assert.deepEqual(L.WP.staleRows(rows, 'bench', now).map(w => w.id), ['old13']);
  assert.equal(L.WP.isStale(now - 12 * H + 60000, now), false);
  assert.equal(L.WP.isStale(now - 12 * H, now), true);
});

t('入册口径手动结束和自动收尾共用：全零行丢掉、工作台标记剥掉、空标题拿缺省；一组可入册的都没有是 null；只有原样底稿的场算没动过', () => {
  const typed = { id: 's1', weight: 60, reps: 5, ghost: true, touched: { weight: true }, prefillRef: { kg: 55, unit: 'kg' }, draftAuto: false };
  const zero = { id: 's2', weight: 0, reps: 0, ghost: true };
  const draft = { id: 's3', weight: 50, reps: 8, ghost: true, prefillRef: { kg: 50, unit: 'kg' }, draftAuto: true };
  const w = { id: 'w', title: '', date: '2026-11-20T10:00:00.000Z', exercises: [{ id: 'e', name: '深蹲', sets: [typed, zero, draft] }] };
  const r = L.toRecorded(w, { isCn: true, scheduleId: 'p1' });
  assert.equal(r.exercises[0].sets.length, 2);
  for (const s of r.exercises[0].sets) {
    assert.equal(s.ghost, false);
    for (const k of ['touched', 'prefillRef', 'draftAuto']) assert.ok(!(k in s), k + ' 该剥掉');
  }
  assert.match(r.title, /^训练 /);
  assert.deepEqual(r.fromSchedule, { scheduleId: 'p1' });
  assert.equal(L.toRecorded({ ...w, exercises: [{ id: 'e', name: '深蹲', sets: [zero] }] }, { isCn: true }), null);
  assert.equal(L.hasUserInput(w.exercises), true);
  assert.equal(L.hasUserInput([{ id: 'e', name: '深蹲', sets: [draft, zero] }]), false);
  assert.equal(L.hasUserInput([{ id: 'e', name: '深蹲', sets: [{ ...draft, toFailure: true }] }]), true);
  assert.equal(L.hasUserInput([{ id: 'e', name: '深蹲', sets: [{ ...draft, ghost: false }] }]), true);
});

// ── 一台器械换单位 / 关设置时收掉白加的台（审查 B4、B5）──────────────────
/** 去掉换单位前那份（IncSpec.was）：换算值照旧比，记没记 was 由 C48 那条管 */
const noWas = ({ was: _w, ...rest }) => rest;
t('换这一台的单位：最轻一格没单独设过（＝一档）跟新的一档走，不出现「11 + 10 lb」；设过的按实重换算；最重一格照换', () => {
  assert.deepEqual(noWas(L.LB.rigInUnit({ v: 5, u: 'kg', s: 5 }, 'lbs')), { v: 10, u: 'lbs', s: undefined, e: undefined, a: undefined });
  assert.deepEqual(noWas(L.LB.rigInUnit({ v: 5, u: 'kg' }, 'lbs')), { v: 10, u: 'lbs', s: undefined, e: undefined, a: undefined });
  assert.deepEqual(noWas(L.LB.rigInUnit({ v: 2.5, u: 'kg', s: 5, e: 50 }, 'lbs')), { v: 5, u: 'lbs', s: 11, e: 110.25, a: undefined });
  assert.deepEqual(noWas(L.LB.rigInUnit({ v: 5, u: 'lbs', s: 12.5 }, 'kg')), { v: 2.5, u: 'kg', s: 5.65, e: undefined, a: undefined });
});
// 防 C48：换单位只做单向换算（吸到最近的档位），换过去再换回来回不到原值
t('换这一台的单位再换回：中间没改过就原样还原（12.5 起每格 5、每格 15、最重 200、加片 2.5……）；改过的按改过的换算（上架审查 C48）', () => {
  const clean = x => Object.fromEntries(Object.entries(noWas(x)).filter(([, v]) => v !== undefined));
  const specs = [
    { v: 5, u: 'lbs', s: 12.5 }, { v: 15, u: 'lbs' }, { v: 5, u: 'lbs', s: 12.5, e: 200, a: [2.5] },
    { v: 15, u: 'kg' }, { v: 20, u: 'kg' }, { v: 1, u: 'kg', s: 3 }, { v: 2.5, u: 'kg', s: 5, e: 50 },
  ];
  for (const c of specs) {
    const back = L.LB.rigInUnit(L.LB.rigInUnit(c, c.u === 'kg' ? 'lbs' : 'kg'), c.u);
    assert.deepEqual(clean(back), c, JSON.stringify(c));
    assert.equal(back.was, undefined, '还原出来的不再挂着 was');
  }
  // 记下的只有刻度字段：台的 id / 名字不能进 was（馆档案「存的形式」会把补丁铺到每一台刻度一样的上）
  assert.deepEqual(L.LB.rigInUnit({ id: 'r1', n: '左边', v: 15, u: 'lbs' }, 'kg').was, { v: 15, u: 'lbs' });
  // 换过去之后把每格改成 10 kg 再换回：按改过的换算（20 lb、起始按实重），不拿旧的那份盖掉
  const edited = { ...L.LB.rigInUnit({ v: 5, u: 'lbs', s: 12.5 }, 'kg'), v: 10 };
  const back = L.LB.rigInUnit(edited, 'lbs');
  assert.equal(back.v, 20);
  assert.notEqual(back.s, 12.5);
});

t('关设置时收台：只收「＋」出来、没起名、和默认或前面某台一模一样的；选着它的改指那一台；配重片没设最轻一格按一档比', () => {
  const def = { v: 5, u: 'kg' };
  const a = { id: 'a', v: 5, u: 'kg', s: 5 };
  const b = { id: 'b', v: 10, u: 'lbs' };
  const b2 = { id: 'b2', v: 10, u: 'lbs', s: 10 };
  const named = { id: 'n', v: 5, u: 'kg', s: 5, n: '左边' };
  const fresh = new Set(['a', 'b2', 'n']);
  assert.deepEqual(L.LB.dropTwins([a, b, b2, named], fresh, def, 'b2', true), { list: [b, named], pick: 'b' });
  assert.deepEqual(L.LB.dropTwins([a], fresh, def, 'a', true), { list: [], pick: '' });
  // 不是这次加的（别的动作可能选着它）不动
  assert.deepEqual(L.LB.dropTwins([a, b, b2], new Set(), def, 'a', true), { list: [a, b, b2], pick: 'a' });
  // 改过刻度的留着
  const a2 = { ...a, v: 2.5 };
  assert.deepEqual(L.LB.dropTwins([a2], fresh, def, 'a', true), { list: [a2], pick: 'a' });
  // 不是配重片：没有最轻一格，s 不补
  assert.deepEqual(L.LB.dropTwins([{ id: 'a', v: 2.5, u: 'kg' }], fresh, { v: 2.5, u: 'kg' }, 'a', false), { list: [], pick: '' });
});

// ── 拉取合并有没有改动本机（审查 E7 / D9）：判错成「没变」远端改动落不了地，判错成「变了」撤销历史白丢 ──
t('拉取合并：本机已含远端一切判「没变」；远端多一行 / 新一版 / 墓碑 / 首选项更新判「变了」；合并本身不写本机', () => {
  const w = (id, updatedAt = '2026-10-01T00:00:00.000Z', title = id) => ({ id, date: updatedAt, updatedAt, title, exercises: [] });
  // 本机首选项的形状照 readPrefsFromLocalStorage：每个键都在
  const P = {
    customTags: [], customExercises: [], exerciseNotes: { a: 'x' }, starredExercises: { s: true }, exerciseMetricConfigs: {}, tagRenameOverrides: {}, exerciseOverrides: {},
    starredLastUpdateMs: 100, metricsLastUpdateMs: 100, prefsLastUpdateMs: 100, lang: undefined, unit: 'kg', avatarDataUrl: null,
    appPrefs: { gyms: { A: {} }, unit: 'kg' }, appPrefsUpdatedMs: 100,
  };
  const snap = (workouts, tombstones = {}, prefs = P) => ({
    schemaVersion: 2, workouts, goals: [], weightLogs: [], customMetrics: [], prs: [], customExerciseDefsFromDb: [], scheduledWorkouts: [],
    prefs, tombstones,
  });
  const changed = (local, remote) => L.FR.mergeChangesLocal(local, L.FR.mergeLocalWithRemote(local, remote));
  localStorage.removeItem('fitlog_tombstones');
  const local = snap([w('a'), w('b'), w('c')], { workouts: ['gone'] });
  // 远端是本机的旧子集；首选项内容相同、键顺序不同、头像缺省 vs null
  assert.equal(changed(local, snap([w('a'), w('b')], {}, { appPrefsUpdatedMs: 100, appPrefs: { unit: 'kg', gyms: { A: {} } }, exerciseNotes: { a: 'x' }, prefsLastUpdateMs: 50 })), false);
  assert.equal(changed(local, snap([w('a'), w('b'), w('c'), w('d')])), true, 'remote row');
  assert.equal(changed(local, snap([w('a', '2026-10-02T00:00:00.000Z', '改过')])), true, 'newer remote version');
  assert.equal(changed(local, snap([], { workouts: ['a'] })), true, 'remote tombstone hides a local row');
  assert.equal(changed(local, snap([], { goals: ['g_x'] })), true, 'tombstone set grows');
  assert.equal(changed(local, snap([], {}, { ...P, prefsLastUpdateMs: 200, exerciseNotes: { a: 'y' } })), true, 'newer remote prefs');
  assert.equal(changed(local, snap([], {}, { ...P, appPrefs: { gyms: { A: {}, B: {} }, unit: 'kg' }, appPrefsUpdatedMs: 50 })), true, 'older remote still adds a gym');
  assert.equal(localStorage.getItem('fitlog_tombstones'), null, 'mergeLocalWithRemote must not write tombstones itself');
});

// ── 备份文件版本（审查 E10）：更新版本 App 写的备份不能被半懂地接受 ──
t('备份解析：formatVersion / schemaVersion 比本版新的拒绝（newer-version）；本版和缺 schemaVersion 的照收', () => {
  const file = (fv, sv) => JSON.stringify({ app: 'Fit Tracker', formatVersion: fv, exportedAt: 'x', snapshot: { ...(sv == null ? {} : { schemaVersion: sv }), workouts: [] } });
  assert.equal(L.FB.parseBackupFile(file(2, 2)).legacy, false);
  assert.equal(L.FB.parseBackupFile(file(2, null)).legacy, false);
  assert.throws(() => L.FB.parseBackupFile(file(3, 2)), e => e instanceof L.FB.BackupParseError && e.message === 'newer-version');
  assert.throws(() => L.FB.parseBackupFile(file(2, 3)), e => e instanceof L.FB.BackupParseError && e.message === 'newer-version');
});

// ── 恢复的入口逐行规整（上架审查 C08 / i18n-settings#1）：坏行进了库，App 每次启动都停在错误页 ──
const v2File = snapshot => JSON.stringify({ app: 'Fit Tracker', formatVersion: 2, exportedAt: '2026-11-20T10:00:00.000Z', snapshot });
t('备份解析：坏行逐行规整或跳过，组 id 补得确定，单位语言只认合法值，跳过几条如实报', () => {
  const snap = {
    schemaVersion: 2,
    workouts: [
      { id: 'w1', date: '2026-11-01T10:00:00.000Z', title: 'ok', exercises: [{ id: 'e1', name: '深蹲', sets: [{ id: 's1', weight: 60, reps: 5 }] }] },
      { id: 'w2', date: '2026-11-02T10:00:00.000Z', title: 'a', exercises: null },
      { id: 'w3', date: '2026-11-03T10:00:00.000Z', title: 'b' },
      {
        id: 'w4', date: '2026-11-04T10:00:00.000Z', title: 'c',
        exercises: [
          { id: 'e4a', name: 5, sets: [null, { weight: '60', reps: 'x', subSets: [null, { weight: 10 }] }] },
          { id: 'e4b', sets: [] },
          { id: 'e4c', name: '卧推', sets: { a: 1 } },
        ],
      },
      { id: 'w5', date: 'not-a-date', exercises: [] },
      { id: 'w6', date: '', exercises: [] },
      { date: '2026-11-05T10:00:00.000Z', exercises: [] },
      null,
    ],
    goals: [], prs: [], scheduledWorkouts: [], customExerciseDefsFromDb: [],
    weightLogs: [{ id: 'b1', date: '2026-11-01T00:00:00.000Z', weight: 70, unit: 'LB' }, { id: 'b2', date: '2026-11-01T00:00:00.000Z' }],
    customMetrics: [{ id: 'm1', name: '腰围', value: null, unit: 'cm', date: '2026-11-01T00:00:00.000Z' }],
    prefs: { customTags: { a: 1 }, customExercises: [{ id: 'd1', name: { cn: '自建', en: '' } }, { id: 'd2' }], unit: 'lb', lang: 'EN', appPrefs: { unit: 'LBS', lang: 'fr' } },
  };
  const p = L.FB.parseBackupFile(v2File(snap));
  const s = p.snapshot;
  assert.deepEqual(s.workouts.map(w => w.id), ['w1', 'w2', 'w3', 'w4']);
  for (const w of s.workouts) {
    assert.ok(Array.isArray(w.exercises), w.id);
    for (const ex of w.exercises) for (const set of ex.sets) assert.equal(typeof set.id, 'string');
  }
  const w4 = s.workouts[3];
  assert.deepEqual(w4.exercises.map(e => e.name), ['5', '卧推']);
  assert.deepEqual(w4.exercises[0].sets, [{ id: 'e4a_s1', weight: 60, subSets: [{ id: 'e4a_s1_d1', weight: 10 }] }]);
  assert.deepEqual(w4.exercises[1].sets, []);
  assert.deepEqual(L.FB.parseBackupFile(v2File(snap)).snapshot.workouts, s.workouts, '同一份文件解析两遍，补的 id 一样（合并时不出重复）');
  assert.deepEqual(s.weightLogs.map(b => [b.id, b.unit]), [['b1', 'lbs']]);
  assert.deepEqual(s.customMetrics, []);
  assert.deepEqual(s.prefs.customTags, []);
  assert.deepEqual(s.prefs.customExercises.map(d => d.name), [{ cn: '自建', en: '自建' }]);
  assert.equal(s.prefs.unit, 'lbs');
  assert.equal(s.prefs.lang, 'en');
  assert.deepEqual(s.prefs.appPrefs, { unit: 'lbs' });
  // 跳过：w5、w6、没 id 的、null（4）+ 没名字的动作（1）+ b2、m1（2）+ d2（1）
  assert.equal(p.skipped, 8);
  assert.equal(p.counts.workouts, 4);
});

t('备份解析：合法的完整快照原样通过（展开后只覆盖个别键，不按白名单重拼；未知字段留着），一条不跳', () => {
  const w = {
    id: 'w', date: '2026-11-01T10:00:00.000Z', title: 't', gym: 'G', focusPart: 'x', fromSchedule: { scheduleId: 'p' }, extra: 1,
    exercises: [{
      id: 'e', name: '深蹲', variantId: 'v', altGroup: 'g', exerciseTime: '2026-11-01T10:00:00.000Z',
      sets: [{ id: 's', weight: 60, reps: 5, toFailure: true, plateUnit: 'kg', subSets: [{ id: 'd', weight: 50, reps: 3 }] }],
    }],
  };
  const snap = {
    schemaVersion: 2, clientExportedAt: 'x', topUnknown: { a: 1 }, workouts: [w], goals: [{ id: 'g1', title: 'x' }],
    weightLogs: [{ id: 'b', weight: 70, date: '2026-11-01T00:00:00.000Z', unit: 'kg' }],
    customMetrics: [{ id: 'm', name: '腰围', value: 80, unit: 'cm', date: '2026-11-01T00:00:00.000Z' }],
    prs: [{ id: 'pr' }], scheduledWorkouts: [{ id: 'sc', exercises: [], bodyParts: [] }], customExerciseDefsFromDb: [],
    prefs: L.PREFS_SENTINEL, tombstones: { workouts: ['old'] },
  };
  const p = L.FB.parseBackupFile(v2File(snap));
  assert.deepEqual(p.snapshot, snap);
  assert.equal(p.skipped, 0);
  assert.equal(p.exportedAt, '2026-11-20T10:00:00.000Z');
});

t('备份解析：旧格式要带本 App 的标记（改名前导出的 FitLog AI 也认），单位归一', () => {
  const legacy = app => JSON.stringify({ ...(app ? { app } : {}), exportDate: 'x', data: { workouts: [] }, settings: { unit: 'LB', language: 'cn' } });
  assert.throws(() => L.FB.parseBackupFile(legacy(null)), e => e instanceof L.FB.BackupParseError && e.message === 'not-a-backup');
  assert.equal(L.FB.parseBackupFile(legacy('FitLog AI')).legacy, true);
  const p = L.FB.parseBackupFile(legacy('Fit Tracker'));
  assert.equal(p.snapshot.prefs.unit, 'lbs');
  assert.equal(p.snapshot.prefs.appPrefs.unit, 'lbs');
});

t('单位、语言只认合法值：存储里已有的坏值读出来自愈，写首选项时认不出的不写；兜底页和首帧用同一个语言判断', () => {
  assert.equal(L.AP.unitOf('LB'), 'lbs');
  assert.equal(L.AP.unitOf('kgs'), 'kg');
  assert.equal(L.AP.unitOf('stone'), undefined);
  assert.equal(L.AP.langOf('EN'), 'en');
  assert.equal(L.AP.langOf('zh-CN'), 'cn');
  assert.equal(L.AP.langOf('fr'), undefined);
  localStorage.clear();
  L.storage.setItem('fitlog_unit', 'lb');
  L.storage.setItem('fitlog_lang', 'fr');
  const r = L.FR.readPrefsFromLocalStorage();
  assert.equal(r.unit, 'lbs');
  assert.equal(r.lang, undefined);
  assert.equal(L.AP.resolveLang(), 'cn', '存的语言认不出：按默认（自用版中文）');
  L.storage.setItem('fitlog_lang', 'EN');
  assert.equal(L.AP.resolveLang(), 'en');
  L.storage.setItem('fitlog_lang', 'cn');
  L.FR.writePrefsToLocalStorage({ ...L.PREFS_SENTINEL, unit: 'LBS', lang: 'fr' });
  assert.equal(L.storage.getItem('fitlog_unit'), 'lbs');
  assert.equal(L.storage.getItem('fitlog_lang'), 'cn', '认不出的语言不写，沿用当前值');
  localStorage.clear();
});

// ── 后台推送失败的提示（审查 E1）：没网时一次离线期间只报一次，推上去之后再失败才再报；配置错误每次都报 ──
t('推送失败提示：网络类失败在推成功前只报一次；403 / 409 / env-guard 每次都报', () => {
  const R = L.FS.shouldAnnouncePushFailure;
  L.FS.notePushSucceeded();
  assert.equal(R('unreachable'), true);
  assert.equal(R('unreachable'), false);
  assert.equal(R('http'), false);
  assert.equal(R('forbidden-endpoint'), true);
  assert.equal(R('env-mismatch'), true);
  assert.equal(R('env-guard'), true);
  L.FS.notePushSucceeded();
  assert.equal(R('http'), true);
});

// ── 弹层点「×N」跳到本场的卡（审查 C12）：跳的那张要和 ×N 数的是同一批 ──
t('选动作点已有的行：做法行只认同做法；母行跳过有自己一行的做法；多张取最后一张；没有＝照常加', () => {
  const R = L.cardToRevisit;
  const cards = [
    { id: 'a', key: '高位下拉' },
    { id: 'b', key: '高位下拉', vid: 'wide' },
    { id: 'c', key: '卧推' },
    { id: 'd', key: '高位下拉', vid: 'close' },
    { id: 'e', key: '高位下拉' },
  ];
  assert.equal(R(cards, '高位下拉', 'wide', []), 'b');
  assert.equal(R(cards, '高位下拉', undefined, ['wide', 'close']), 'e');
  // 搜索里母行照总数写（不跳过做法）
  assert.equal(R(cards.slice(0, 4), '高位下拉', undefined, []), 'd');
  assert.equal(R(cards, '高位下拉', 'narrow', []), null);
  assert.equal(R(cards, '深蹲', undefined, []), null);
  // 母行的 ×N 全来自做法行（行上显示 ＋）：照常加，不跳
  assert.equal(R(cards.filter(c => c.key !== '高位下拉' || c.vid), '高位下拉', undefined, ['wide', 'close']), null);
});

t('身体指标改日期：同一天原样返回（不动钟点、不改写原串）；换一天落在那天、钟点照旧', () => {
  const base = new Date(2026, 10, 16, 0, 49, 9, 434).toISOString();
  assert.equal(L.ML.moveToLocalDay(base, '2026-11-16'), base);
  const moved = new Date(L.ML.moveToLocalDay(base, '2026-06-11'));
  assert.deepEqual(
    [moved.getFullYear(), moved.getMonth(), moved.getDate(), moved.getHours(), moved.getMinutes(), moved.getSeconds()],
    [2026, 5, 11, 0, 49, 9],
  );
});

t('身体指标卡面：按记录日期取最新，后补记的旧日期不顶上来；变化量对上一条；单位不同 / 只有一条不出', () => {
  const m = (id, name, value, unit, date) => ({ id, userId: 'u', name, value, unit, date });
  // 39 先录、37 是后来补记到 6 月的（id 更大）：卡面仍是 39
  const out = L.ML.latestByMetric([
    m('3', '臂围', 39, 'cm', '2026-11-16T05:49:09.434Z'),
    m('9', '臂围', 37, 'cm', '2026-06-11T10:31:50.495Z'),
    m('1', '身高', 184, 'cm', '2026-05-22T07:40:19.466Z'),
    m('4', '腰围', 31.5, 'in', '2026-07-01T00:00:00.000Z'),
    m('5', '腰围', 80.3, 'cm', '2026-08-01T00:00:00.000Z'),
    m('6', '体脂', 15.2, '%', '2026-08-01T00:00:00.000Z'),
    m('7', '体脂', 14.9, '%', '2026-09-01T00:00:00.000Z'),
  ]);
  assert.deepEqual(out.map(x => [x.name, x.value, x.delta]), [
    ['身高', 184, null],
    ['臂围', 39, 2],
    ['腰围', 80.3, null],
    ['体脂', 14.9, -0.3],
  ]);
});

// 防 C76：图表把 cm 和 in 的点画在同一根线上（38、15.2、39 连成锯齿），和卡面的 delta 规则不一致
t('身体指标图表：按日期排，只留和最新一条同单位的点；全部同单位时全留', () => {
  const m = (id, value, unit, date) => ({ id, userId: 'u', name: '臂围', value, unit, date });
  const mixed = [m('a', 38, 'cm', '2026-06-01T00:00:00Z'), m('b', 15.2, 'in', '2026-08-01T00:00:00Z'), m('c', 39, 'cm', '2026-07-01T00:00:00Z')];
  const s1 = L.ML.metricSeries(mixed, '臂围');
  assert.equal(s1.unit, 'in');
  assert.deepEqual(s1.points.map(p => p.value), [15.2]);
  const s2 = L.ML.metricSeries([...mixed, m('d', 15.4, 'in', '2026-09-01T00:00:00Z')], '臂围');
  assert.deepEqual(s2.points.map(p => p.value), [15.2, 15.4]);
  const same = [m('a', 38, 'cm', '2026-06-01T00:00:00Z'), m('c', 39, 'cm', '2026-07-01T00:00:00Z'), m('b', 37, 'cm', '2026-05-01T00:00:00Z')];
  assert.deepEqual(L.ML.metricSeries(same, '臂围').points.map(p => p.value), [37, 38, 39]);
});

// 防 C79：输入 waist 另起一项、和已有的 Waist 分成两张卡；整项改名没有入口
t('身体指标名字：只差大小写 / 空白的并到已有那项；整项改名只动那一项的行、id 不变；改成同名不写库', () => {
  const m = (id, name) => ({ id, userId: 'u', name, value: 1, unit: 'cm', date: '2026-06-01T00:00:00Z' });
  const ms = [m('1', 'Waist'), m('2', '腰围'), m('3', 'waist'), m('4', 'waist'), m('5', '臂围')];
  assert.equal(L.ML.canonicalMetricName(ms, ' WAIST '), 'Waist');
  assert.equal(L.ML.canonicalMetricName(ms, '臂围 '), '臂围');
  assert.equal(L.ML.canonicalMetricName(ms, '小腿'), '小腿');
  const now = '2026-11-24T00:00:00.000Z';
  const out = L.ML.renameMetricRows(ms, 'waist', 'WAIST', now);
  assert.deepEqual(out.map(r => [r.id, r.name, r.updatedAt]), [['3', 'Waist', now], ['4', 'Waist', now]]);
  assert.deepEqual(L.ML.renameMetricRows(ms, '腰围', '腰围 ', now), []);
  assert.deepEqual(L.ML.renameMetricRows(ms, '腰围', '   ', now), [], '空名字不写');
});

t('自判点击：随手点带出的几像素滑动仍算点击；滑远了、按到长按那么久不算', () => {
  const { judgeTap, TAP_SLOP_PX, isLostTap } = L.TAP;
  assert.equal(judgeTap(0, 0, 80, 500), 'tap');
  // 浏览器的触摸容差约 8dp：滑了 10px 它不发 click，这里要接住
  assert.equal(judgeTap(6, 8, 120, 500), 'tap');
  assert.equal(judgeTap(TAP_SLOP_PX + 1, 0, 120, 500), 'moved');
  assert.equal(judgeTap(0, 40, 120, 500), 'moved');
  // 按满长按的时长归长按，哪怕没动
  assert.equal(judgeTap(0, 0, 500, 500), 'held');
  const rec = (o) => ({ at: 0, label: '1', kind: 'touch', move: 3, ms: 90, click: false, saved: false, ...o });
  assert.equal(isLostTap(rec({}), 500), true);
  assert.equal(isLostTap(rec({ click: true }), 500), false);
  assert.equal(isLostTap(rec({ saved: true }), 500), false);
  // 一划翻页 / 长按没发 click 是正常的，不算丢
  assert.equal(isLostTap(rec({ move: 60 }), 500), false);
  assert.equal(isLostTap(rec({ ms: 800 }), 500), false);
});

// 防的是：删除键连点的阈值被改松（误拦故意删相邻行），或改回按 setId / 按组件判（审查 C40）
t('连点删除：同一点 400ms 内的第二下算连点；相邻一行（隔 44px+）、超时、没有上一下都不算', () => {
  const { isRepeatTap } = L.TAP;
  const prev = { t: 0, x: 100, y: 200 };
  assert.equal(isRepeatTap(prev, { t: 120, x: 100, y: 205 }), true);
  assert.equal(isRepeatTap(prev, { t: 399, x: 100, y: 200 }), true);
  assert.equal(isRepeatTap(prev, { t: 400, x: 100, y: 200 }), false);
  assert.equal(isRepeatTap(prev, { t: 120, x: 100, y: 148 }), false);
  assert.equal(isRepeatTap(null, { t: 120, x: 100, y: 200 }), false);
});

// 防的是：吞补发 click 的闸又变回只看时限（安卓不补发时吃掉第一下真点按）或吞过不作废（审查 navigation-overlays#5）
t('吞补发 click：只吞一次；下一次按下作废；过了时限不吞', () => {
  const { newClickSwallow, armSwallow, disarmSwallow, takeSwallow } = L.TAP;
  const s = newClickSwallow();
  assert.equal(takeSwallow(s, 100, 350), false, '没武装不吞');
  armSwallow(s, 0);
  assert.equal(takeSwallow(s, 100, 350), true);
  assert.equal(takeSwallow(s, 150, 350), false, '只吞一次');
  armSwallow(s, 0);
  disarmSwallow(s);
  assert.equal(takeSwallow(s, 100, 350), false, '真点击先有 pointerdown');
  armSwallow(s, 0);
  assert.equal(takeSwallow(s, 351, 350), false, '限时兜底');
});

t('横拖加速：正常手速永远一格；甩过门槛才两格；关掉后多快都一格；门槛跟每格宽度同比例', () => {
  const px = L.SCRUB_FEEL_PX.mid;
  // 0.55 px/ms 是改之前的第二档门槛：正常手速就会跳，现在必须还是一格
  assert.equal(L.scrubTier(0.55, [1, 2], px, true), 1);
  assert.equal(L.scrubTier(L.ACCEL_VELOCITY - 0.01, [1, 2], px, true), 1);
  assert.equal(L.scrubTier(L.ACCEL_VELOCITY, [1, 2], px, true), 2);
  assert.equal(L.scrubTier(9, [1, 2], px, false), 1);
  // 配重片刻度轨只给一档：不跳
  assert.equal(L.scrubTier(9, [1], px, true), 1);
  assert.equal(L.scrubTier(L.ACCEL_VELOCITY, [1, 2], L.SCRUB_FEEL_PX.fine, true), 1);
});

// ── 组行打字（上架审查 C37 / C38 / live-walkthrough#1）────────────────
t('打字解析：全角、逗号做小数点、全角负号都认；打到一半不是完整的数给 null（这一键不写）', () => {
  const ok = { '5.05': 5.05, '0.05': 0.05, '5,05': 5.05, '62，5': 62.5, '５．０５': 5.05, '－5': -5, '22.': 22, '.5': 0.5, ' 12 ': 12 };
  for (const [k, v] of Object.entries(ok)) assert.equal(L.parseTypedNum(k), v, k);
  for (const k of ['', '-', '.', '1.2.3', '1e3', 'abc']) assert.equal(L.parseTypedNum(k), null, k);
});

t('重量格打字按聚焦时的号写（C37）：辅助的组清空再打 25 还是辅助 25；打负数是辅助；空串是 0；残串不写；多打一个 0 夹到上限', () => {
  const w = (text, sign, signed = true) => L.SW.typedWeight(text, sign, 'kg', null, signed);
  assert.deepEqual(w('', -1), { weight: 0, plateUnit: 'kg', bodyweightMode: 'normal' });
  assert.deepEqual(w('25', -1), { weight: 25, plateUnit: 'kg', bodyweightMode: 'assisted' });
  assert.deepEqual(w('-20', 1), { weight: 20, plateUnit: 'kg', bodyweightMode: 'assisted' });
  assert.equal(w('-', -1), null);
  assert.deepEqual(w('62,5', 1, false), { weight: 62.5, plateUnit: 'kg', bodyweightMode: undefined });
  assert.deepEqual(w('600', 1, false), { weight: 500, plateUnit: 'kg', bodyweightMode: undefined });
});

t('计划目标值规整（上架审查 C77）：组数 / 次数取整、小于 1 当没写，组数最多 30，次数不设上限；目标重量夹到 500 kg，非正数 / 非数当没写', () => {
  const c = pe => L.LD.cleanPlanExercise(pe);
  assert.equal(c({ targetSets: 0.7 }).targetSets, 1);
  assert.equal(c({ targetSets: 2.5 }).targetSets, 3);
  assert.equal(c({ targetSets: 3000 }).targetSets, L.LD.PLAN_SETS_MAX);
  assert.ok(!('targetSets' in c({ targetSets: 0.4 })));
  assert.equal(c({ targetReps: 9.6 }).targetReps, 10);
  assert.equal(c({ targetReps: 9999 }).targetReps, 9999);
  assert.equal(c({ targetWeight: 1000 }).targetWeight, 500);
  for (const w of [-5, NaN, '12']) assert.ok(!('targetWeight' in c({ targetWeight: w })), String(w));
  assert.deepEqual(c({ name: '卧推', targetSets: 3, targetReps: 8, targetWeight: 60 }), { name: '卧推', targetSets: 3, targetReps: 8, targetWeight: 60 });
});

t('器材筛选只认还在器材格里的（上架审查 C98）：删掉的器材不再暗中筛人；都还在就原样返回', () => {
  assert.deepEqual([...L.liveEquips(new Set(['barbell', 'gone']), ['Barbell', 'Dumbbell'])], ['barbell']);
  const all = new Set(['barbell']);
  assert.equal(L.liveEquips(all, ['Barbell']), all);
  assert.equal(L.liveEquips(new Set(['gone']), ['Barbell']).size, 0);
});

t('并入上一场（上架审查 C04）：前一场是工作台那场时并进工作台那份（不是库里的旧副本），不拷结束时刻；只有待做行也算前一场', () => {
  const day = (d, hm) => new Date(`2026-11-${d}T${hm}:00`).toISOString();
  const done = id => ({ id, weight: 60, reps: 5 });
  const ghost = id => ({ id, weight: 60, reps: 5, ghost: true });
  const ex = (id, sets) => ({ id, name: id, category: 'STRENGTH', sets });
  const OLD = { id: 'OLD', date: day(15, '10:00'), finishedAt: day(15, '11:00'), exercises: [ex('o', [done('o1')])] };
  const P_db = { id: 'P', title: '今天', date: day(20, '10:00'), exercises: [ex('a', [done('a1')])] };
  const Z = { id: 'Z', date: day(20, '10:20'), finishedAt: day(20, '10:40'), endTime: day(20, '10:40'), exercises: [ex('z', [done('z1'), done('z2')])] };
  const live = { ...P_db, exercises: [ex('a', [done('a1'), done('a2')])] };
  const all = [Z, P_db, OLD];

  const r = L.planMergeIntoPrevious(all, Z, live);
  assert.equal(r.live, true);
  assert.equal(r.merged.id, 'P');
  const ids = r.merged.exercises.flatMap(e => e.sets.map(s => s.id));
  assert.deepEqual(ids.sort(), ['a1', 'a2', 'z1', 'z2'], '取的是工作台那份（a2 只在工作台上）');
  assert.ok(!('finishedAt' in r.merged) && !('endTime' in r.merged), '进行中的那场合并后仍未结束');

  // 工作台那场只有待做行：目标仍是它，不能跳到 5 天前那场
  const idle = { ...P_db, exercises: [ex('a', [ghost('a1')])] };
  const r2 = L.planMergeIntoPrevious(all, Z, idle);
  assert.equal(r2.live, true);
  assert.equal(r2.into.id, 'P');

  // 没有工作台那场：照旧并进库里的前一场，结束时刻取两场里较晚的
  const r3 = L.planMergeIntoPrevious(all, Z, null);
  assert.equal(r3.live, false);
  assert.equal(r3.merged.id, 'P');
  assert.equal(r3.merged.finishedAt, Z.finishedAt);
  assert.deepEqual(r3.merged.exercises.map(e => e.id), ['a', 'z']);
  // 前面什么都没有
  assert.equal(L.planMergeIntoPrevious([OLD], OLD, null), null);
});

// 防 C92：并入只拼动作，被并那场的整场备注、「按计划」标记、馆丢掉；隔天 / 跨馆的两场也给并
t('并入上一场（上架审查 C92）：被并那场的备注接在后面、计划标记和馆前一场没有就带过来；隔 12 小时以上或跨馆不给并', () => {
  const at = (d, hm) => new Date(`2026-11-${d}T${hm}:00`).toISOString();
  const ex = id => ({ id, name: id, category: 'STRENGTH', sets: [{ id: id + '1', weight: 60, reps: 5 }] });
  const P = { id: 'P', title: '六天前', gym: '甲', notes: '前一场备注', date: at(10, '09:00'), startTime: '09:00', finishedAt: at(10, '10:00'), exercises: [ex('a')] };
  const W = { id: 'W', title: '另一个', notes: '被并那场的备注', fromSchedule: { scheduleId: 'plan1' }, date: at(10, '10:02'), finishedAt: at(10, '10:40'), exercises: [ex('b')] };
  const m = L.planMergeIntoPrevious([P, W], W, null).merged;
  assert.equal(m.notes, '前一场备注\n被并那场的备注');
  assert.equal(m.fromSchedule.scheduleId, 'plan1');
  assert.equal(m.gym, '甲');
  assert.deepEqual(m.exercises.map(e => e.id), ['a', 'b'], '前一场的动作在前');
  assert.equal(m.finishedAt, W.finishedAt);
  assert.deepEqual([m.id, m.date, m.title, m.startTime], ['P', P.date, '六天前', '09:00'], '日期、标题、开练时刻是前一场的（本意）');
  const mg = (p, w) => L.planMergeIntoPrevious([p, w], w, null).merged;
  assert.equal(mg({ ...P, notes: undefined }, W).notes, '被并那场的备注', '前一场没备注取被并那场的');
  assert.equal(mg(P, { ...W, notes: '  \n ' }).notes, '前一场备注', '被并那场备注全空白：前一场原样');
  assert.equal(mg({ ...P, fromSchedule: { scheduleId: 'own' } }, W).fromSchedule.scheduleId, 'own', '前一场自己有计划标记就留它的');
  assert.equal(mg({ ...P, gym: undefined }, { ...W, gym: '乙' }).gym, '乙', '前一场没标馆取被并那场的');
  // 工作台那场同样带上
  const live = { ...P, finishedAt: undefined, notes: undefined };
  assert.equal(L.planMergeIntoPrevious([live, W], W, live).merged.notes, '被并那场的备注');

  // 能不能并：同馆 62 分钟 ✓；同馆 3 天 ✗；跨馆 1 小时 ✗；一边没标馆 ✓；跨零点 15 分钟 ✓
  const ok = (pd, wd, pg, wg) => {
    const p = { ...P, gym: pg, date: pd };
    const w = { ...W, gym: wg, date: wd };
    return L.planMergeIntoPrevious([p, w], w, null) !== null;
  };
  assert.equal(ok(at(10, '09:00'), at(10, '10:02'), '甲', '甲'), true);
  assert.equal(ok(at(10, '09:00'), at(13, '09:00'), '甲', '甲'), false);
  assert.equal(ok(at(10, '09:00'), at(10, '10:00'), '甲', '乙'), false);
  assert.equal(ok(at(10, '09:00'), at(10, '10:00'), '甲', undefined), true);
  assert.equal(ok(at(10, '23:50'), at(11, '00:05'), '甲', '甲'), true);
  // 补录的前一场：date 是 20 号、finishedAt 是 23 号 → 和 21 号那场仍不给并（按 date 比，不按 finishedAt）
  const backfill = { ...P, id: 'B', date: at(20, '09:00'), finishedAt: at(23, '12:00') };
  const next = { ...W, id: 'N', date: at(21, '09:00') };
  assert.equal(L.planMergeIntoPrevious([backfill, next], next, null), null);

  // 时间线给不给这一项：和上面同一个挑法；最早那场没有；没练过的场不算前一场
  const Q = { ...W, id: 'Q', date: at(13, '09:00') };
  const G = { id: 'G', date: at(13, '08:30'), exercises: [{ ...ex('g'), sets: [{ id: 'g1', ghost: true }] }] };
  const ids = L.mergeableIds([Q, W, P, G, backfill, next]);
  assert.deepEqual([...ids].sort(), ['W'], 'W 紧跟 P；Q 前面只有没练过的 G 和三天前的 W；N 前一场是隔一天的补录场 B');
});

// 防 C05：「继续这场」把误结束后新开的那场拆成单独一场（或吸收的条件放宽到补录 / 更早的场，把别的训练吞进来）
t('继续这场（上架审查 C05）：工作台上是误结束后新开的那场就并进被接回的那场；补录的、开得更早的不并', () => {
  const at = hm => new Date(`2026-11-20T${hm}:00`).toISOString();
  const ex = (id, sets) => ({ id, name: id, category: 'STRENGTH', sets });
  const w = {
    id: 'W', title: '腿', gym: '甲', date: at('10:00'), startTime: at('10:00'), finishedAt: at('10:40'), status: 'completed',
    exercises: [ex('w', [{ id: 'w1', weight: 60, reps: 5 }, { id: 'w2', weight: 60, reps: 5 }])],
  };
  const live = {
    id: 'L', title: '新的一场', gym: '甲', notes: '新开那场的备注', fromSchedule: { scheduleId: 'plan-live' },
    date: at('10:43'), startTime: at('10:43'),
    exercises: [ex('l', [{ id: 'l1', weight: 40, reps: 8 }, { id: 'l2', weight: 40, reps: 8, ghost: true }])],
  };
  const r = L.absorbIntoResumed(w, live);
  assert.equal(r.id, 'W');
  assert.ok(!('finishedAt' in r) && !('status' in r), '接回后不再是已结束的');
  assert.deepEqual(r.exercises.flatMap(e => e.sets.map(s => s.id)), ['w1', 'w2', 'l1', 'l2'], '被接回那场的组在前，新开那场的接在后面');
  assert.equal(r.exercises[1].sets[1].ghost, true, '新开那场的待做行仍是待做');
  assert.deepEqual([r.date, r.startTime, r.title], [w.date, w.startTime, '腿'], '开练时刻、标题是被接回那场的');
  assert.equal(r.notes, '新开那场的备注');
  assert.equal(r.fromSchedule.scheduleId, 'plan-live', '被接回那场没有计划标记：取新开那场的');
  assert.equal(L.absorbIntoResumed({ ...w, fromSchedule: { scheduleId: 'own' } }, live).fromSchedule.scheduleId, 'own', '被接回那场自己有就留它的');

  // 不并：新开那场是补录的（没有开练时刻）；开得比被接回那场还早
  assert.equal(L.absorbIntoResumed(w, { ...live, startTime: undefined }), null);
  assert.equal(L.absorbIntoResumed(w, { ...live, date: at('09:30'), startTime: at('09:30') }), null);
  // 同一时刻开的仍算「之后」（date 不早于）
  assert.ok(L.absorbIntoResumed(w, { ...live, date: w.date }));
});

// ── 全局撤销的读写失败（上架审查 C17 / C18 / C19）：services/undoJournal.ts 的前像标记、写回失败留步、写回期间 busy ──────
const J = L.undoJournal;
const tickMs = (ms = 0) => new Promise(r => setTimeout(r, ms));
/** 内存版底层：行 / 键，故障可注入。db.ts 导入时注册的是真 IndexedDB，这里把 RawIo 全部覆盖 */
function journalRig() {
  J.clear();
  const rows = new Map();
  const keys = new Map();
  const s = n => (rows.has(n) ? rows.get(n) : (rows.set(n, new Map()), rows.get(n)));
  const ctl = { getFail: 0, failIds: null, getDelay: 0, writeFail: 0, writeGate: null, writeCalled: false, keyFail: null };
  J.setIo({
    getRow: async (st, id) => {
      if (ctl.getDelay) await tickMs(ctl.getDelay);
      if (ctl.failIds?.has(id)) throw new DOMException('read aborted', 'AbortError');
      if (ctl.getFail > 0) {
        ctl.getFail--;
        throw new DOMException('read aborted', 'AbortError');
      }
      const r = s(st).get(id);
      return r ? structuredClone(r) : undefined;
    },
    getAllRows: async st => [...s(st).values()].map(x => structuredClone(x)),
    writeRows: async ops => {
      ctl.writeCalled = true;
      if (ctl.writeGate) await ctl.writeGate;
      if (ctl.writeFail > 0) {
        ctl.writeFail--;
        throw new DOMException('quota', 'QuotaExceededError');
      }
      for (const o of ops) o.row ? s(o.store).set(o.id, structuredClone(o.row)) : s(o.store).delete(o.id);
    },
    getKey: k => (keys.has(k) ? keys.get(k) : null),
    setKey: (k, v) => {
      if (ctl.keyFail === k) return false;
      v === null ? keys.delete(k) : keys.set(k, v);
      return true;
    },
  });
  // 照 db.ts 的 save / delete：先记前像，再写；写失败照样 reject
  let writeFailNext = 0;
  const save = (st, row) =>
    J.track(
      J.recordRows(st, [{ id: row.id, after: row }]).then(() => {
        if (writeFailNext > 0) {
          writeFailNext--;
          throw new Error('write failed');
        }
        s(st).set(row.id, structuredClone(row));
      }),
    );
  const del = (st, id) => J.track(J.recordRows(st, [{ id, after: undefined }]).then(() => void s(st).delete(id)));
  const setItem = (k, v) => {
    J.recordKey(k, v);
    keys.set(k, v);
  };
  const removeItem = k => {
    J.recordKey(k, null);
    keys.delete(k);
  };
  return { s, keys, ctl, save, del, setItem, removeItem, failNextWrite: () => (writeFailNext = 1) };
}
const tj = async (name, fn) => {
  const warn = console.warn;
  const error = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    await ta(name, fn);
  } finally {
    console.warn = warn;
    console.error = error;
    J.clear();
  }
};

await tj('撤销 C17：读前像失败、写入成功 → 整步不撤（不把那场当成原来没有去删），更早的历史一起清掉；读写都失败也不删', async () => {
  const t = journalRig();
  t.s('workouts').set('w1', { id: 'w1', sets: 3, updatedAt: 'a' });
  J.beginStep('早一步');
  await t.save('workouts', { id: 'x', v: 1 });
  J.beginStep('改组数');
  t.ctl.getFail = 1;
  await t.save('workouts', { id: 'w1', sets: 4, updatedAt: 'b' });
  J.beginStep('');
  const r = await J.undo();
  assert.equal(r?.outcome, 'blocked');
  assert.equal(t.s('workouts').get('w1')?.sets, 4);
  assert.ok(t.s('workouts').has('x'), '更早那一步也不撤：撤了会盖掉这一步对同一行的改动');
  assert.equal(J.getState().canUndo, false);

  t.s('workouts').set('w1', { id: 'w1', sets: 3, updatedAt: 'a' });
  J.beginStep('改组数');
  t.ctl.getFail = 1;
  t.failNextWrite();
  await assert.rejects(t.save('workouts', { id: 'w1', sets: 4, updatedAt: 'b' }));
  J.beginStep('');
  await J.undo();
  assert.equal(t.s('workouts').get('w1')?.sets, 3);
});

await tj('撤销 C17：「并入上一场」一步两行，任一行读不到前像 → 整步不撤，深蹲恰好一份、上一场不被删（只跳过那一行会丢组或出重复）', async () => {
  for (const failing of ['w', 'prev']) {
    const t = journalRig();
    t.s('workouts').set('prev', { id: 'prev', ex: ['卧推'] });
    t.s('workouts').set('w', { id: 'w', ex: ['深蹲'] });
    J.beginStep('并入上一场');
    t.ctl.failIds = new Set([failing]);
    await t.save('workouts', { id: 'prev', ex: ['卧推', '深蹲'] });
    await t.del('workouts', 'w');
    J.beginStep('');
    await J.undo();
    const all = [...t.s('workouts').values()].flatMap(r => r.ex);
    assert.equal(all.filter(x => x === '深蹲').length, 1, failing + ' 读失败');
    assert.ok(t.s('workouts').has('prev'), failing + ' 读失败');
  }
});

await tj('撤销 C17：删除的前像还没读回这一步就结束了 → 不当成「删了个不存在的」丢掉，撤销把它原样放回', async () => {
  const t = journalRig();
  t.s('workouts').set('g1', { id: 'g1', name: '腿日' });
  t.ctl.getDelay = 20;
  J.beginStep('删训练');
  const p = t.del('workouts', 'g1');
  await tickMs(5);
  J.beginStep('');
  await p;
  t.ctl.getDelay = 0;
  const r = await J.undo();
  assert.ok(r);
  assert.deepEqual(t.s('workouts').get('g1'), { id: 'g1', name: '腿日' });
});

await tj('撤销 C18：写回失败 → 不抛、报 failed，这一步还在撤销栈、行一行没动（不撤一半）、键没写；再按一次写完，重做也回得去', async () => {
  const t = journalRig();
  t.keys.set('fitlog_app_prefs', 'old');
  for (const i of [1, 2, 3]) t.s('workouts').set('w' + i, { id: 'w' + i, gym: 'old' });
  J.beginStep('改馆名');
  t.setItem('fitlog_app_prefs', 'new');
  for (const i of [1, 2, 3]) await t.save('workouts', { id: 'w' + i, gym: 'new' });
  J.beginStep('');
  t.ctl.writeFail = 1;
  const r = await J.undo();
  assert.equal(r?.outcome, 'failed');
  assert.equal(J.getState().undoLabel, '改馆名');
  assert.deepEqual([1, 2, 3].map(i => t.s('workouts').get('w' + i).gym), ['new', 'new', 'new']);
  assert.equal(t.keys.get('fitlog_app_prefs'), 'new');
  assert.equal((await J.undo())?.outcome, 'done');
  assert.deepEqual([1, 2, 3].map(i => t.s('workouts').get('w' + i).gym), ['old', 'old', 'old']);
  assert.equal(t.keys.get('fitlog_app_prefs'), 'old');
  assert.equal(J.getState().redoLabel, '改馆名');
  await J.redo();
  assert.deepEqual([1, 2, 3].map(i => t.s('workouts').get('w' + i).gym), ['new', 'new', 'new']);
  assert.equal(t.keys.get('fitlog_app_prefs'), 'new');
});

await tj('撤销 C18：键写不回（setKey 返回 false）算没做成，这一步不被挪去重做栈；腾出空间后再按一次写回', async () => {
  const t = journalRig();
  t.keys.set('fitlog_avatar_data_url', 'BIG');
  J.beginStep('删头像');
  t.removeItem('fitlog_avatar_data_url');
  J.beginStep('');
  t.ctl.keyFail = 'fitlog_avatar_data_url';
  assert.equal((await J.undo())?.outcome, 'failed');
  assert.equal(J.getState().undoLabel, '删头像');
  assert.equal(J.getState().canRedo, false);
  t.ctl.keyFail = null;
  await J.undo();
  assert.equal(t.keys.get('fitlog_avatar_data_url'), 'BIG');
});

await tj('撤销 C19：写回期间 busy=true（界面据此挡输入），结束复位；期间 clear() 过的这一步不复活；写回卡死到超时按 failed、busy 撤掉', async () => {
  const t = journalRig();
  t.s('workouts').set('w1', { id: 'w1', sets: 3 });
  J.beginStep('改组数');
  await t.save('workouts', { id: 'w1', sets: 4 });
  J.beginStep('');
  let open;
  t.ctl.writeGate = new Promise(r => (open = r));
  const p = J.undo();
  while (!t.ctl.writeCalled) await tickMs();
  assert.equal(J.getState().busy, true);
  J.clear();
  open();
  await p;
  assert.equal(J.getState().busy, false);
  assert.equal(J.getState().canRedo, false, '清空过的历史不复活');

  const t2 = journalRig();
  J.beginStep('改组数');
  await t2.save('workouts', { id: 'w1', sets: 4 });
  J.beginStep('');
  t2.ctl.writeGate = new Promise(() => {});
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const q = J.undo();
    while (!t2.ctl.writeCalled) await new Promise(r => setImmediate(r));
    mock.timers.tick(60_000);
    const r = await q;
    assert.equal(r?.outcome, 'failed');
    assert.equal(J.getState().busy, false);
    assert.equal(J.getState().undoLabel, '改组数');
  } finally {
    mock.timers.reset();
  }
});

// ── 撤销的步界（上架审查 C07 / C96 / C16）：系统接回不算用户的一步、开着的步一有改动重做就灰、返回键自己开步 ──────
const EMPTY_BENCH = { id: '', exercises: [] };
const LIVE = { id: 'live', exercises: [{ id: 'e1' }, { id: 'e2' }] };
const DRAFT = { id: 'old', exercises: [{ id: 'd1', v: 80 }], finishedAt: '2026-11-14T10:00:00Z' };
/** 工作台 / 编辑态两个状态源：持有对象由用例自己换（照 WorkoutContext / useWorkoutMutations 的 ref） */
function benchRig(bench, mode = { id: null }) {
  const w = { bench, mode };
  const offs = [
    J.registerSource('currentWorkout', { get: () => w.bench, set: v => (w.bench = v) }),
    J.registerSource('editMode', { get: () => w.mode, set: v => (w.mode = v) }),
  ];
  /** 照 restoreInProgress：先换值（ref 同步写），再 rebaseSource */
  const systemRestore = hit => {
    const prev = w.bench;
    w.bench = hit;
    J.rebaseSource('currentWorkout', prev);
    J.touched();
  };
  return { w, systemRestore, off: () => offs.forEach(f => f()) };
}
/** 状态源是模块级登记的：用例结束摘掉，免得后面的用例开步时去读它 */
const tu = (name, fn) =>
  tj(name, async () => {
    journalRig();
    const offs = [];
    try {
      await fn(rig => (offs.push(rig.off), rig));
    } finally {
      offs.forEach(f => f());
    }
  });

await tu('撤销 C07：冷启动时先碰了屏、接回才落定 → 接回不算这一步，撤销键不亮，撤销不把工作台清空', async use => {
  const { w, systemRestore } = use(benchRig(EMPTY_BENCH));
  J.beginStep('我的');
  systemRestore(LIVE);
  await tickMs();
  assert.equal(J.getState().canUndo, false);
  J.beginStep('');
  assert.equal(await J.undo(), null);
  assert.equal(w.bench.id, 'live');
});

await tu('撤销 C07：保存修改后、接回落定前又碰了屏 → 撤一下回到编辑草稿（撤的是「保存修改」，不是那一下碰屏）', async use => {
  const { w, systemRestore } = use(benchRig(DRAFT, { id: 'old' }));
  J.beginStep('保存修改');
  w.bench = { id: 'b-new', exercises: [] };
  w.mode = { id: null };
  J.beginStep('训练计划');
  systemRestore(LIVE);
  J.beginStep('');
  const r = await J.undo();
  assert.equal(r?.label, '保存修改');
  assert.equal(w.bench.id, 'old');
  assert.equal(w.mode.id, 'old');
});

await tu('撤销 C07：接回落在「保存修改」那一步里（没碰屏）→ 算这一步的结果：撤销回编辑草稿，重做回接回后的那场（挪基线必须看这一步动没动过工作台）', async use => {
  const { w, systemRestore } = use(benchRig(DRAFT, { id: 'old' }));
  J.beginStep('保存修改');
  w.bench = { id: 'b-new', exercises: [] };
  w.mode = { id: null };
  systemRestore(LIVE);
  J.beginStep('');
  await J.undo();
  assert.equal(w.bench.id, 'old');
  assert.equal(w.mode.id, 'old');
  await J.redo();
  assert.equal(w.bench.id, 'live');
  assert.equal(w.mode.id, null);
});

await tu('撤销 C96：撤销后开着的步一有改动，重做键当场灰、redo 什么都不写；同一步里改了又改回，收尾后重做回来', async () => {
  const t = journalRig();
  J.beginStep('单位');
  t.setItem('fitlog_unit', 'lbs');
  J.beginStep('');
  await J.undo();
  J.beginStep('语言');
  t.setItem('fitlog_lang', 'en');
  await tickMs();
  assert.equal(J.getState().canRedo, false);
  assert.equal(J.getState().redoLabel, null);
  assert.equal(await J.redo(), null);
  assert.equal(t.keys.has('fitlog_unit'), false);

  const t2 = journalRig();
  t2.keys.set('fitlog_unit', 'kg');
  J.beginStep('单位');
  t2.setItem('fitlog_unit', 'lbs');
  J.beginStep('');
  await J.undo();
  J.beginStep('又点了两下');
  t2.setItem('fitlog_unit', 'lbs');
  t2.setItem('fitlog_unit', 'kg');
  await tickMs();
  assert.equal(J.getState().canRedo, false, '开着、有写入：先灰');
  J.beginStep('');
  assert.equal(J.getState().canRedo, true, '这一步收尾时是空的：重做不该被清掉');
  assert.equal(J.getState().redoLabel, '单位');
});

await tu('撤销 C16：撤销后按返回键退出编辑 → 返回自成一步、重做栈作废，回首页点重做不把旧场草稿写回工作台', async use => {
  const saved = { document: globalThis.document, HTMLElement: globalThis.HTMLElement, window: globalThis.window };
  Object.assign(globalThis, { HTMLElement: class {}, document: { activeElement: null }, window: { setTimeout } });
  try {
    const { w } = use(benchRig(DRAFT, { id: 'old' }));
    J.beginStep('改数');
    w.bench = { ...DRAFT, exercises: [{ id: 'd1', v: 90 }] };
    J.beginStep('');
    await J.undo();
    assert.equal(J.getState().canRedo, true);
    L.handleHardwareBack('返回', () => {
      w.bench = EMPTY_BENCH;
      w.mode = { id: null };
      J.touched(); // 照 WorkoutContext：工作台一换就叫一声
    });
    await tickMs();
    assert.equal(J.getState().canRedo, false);
    assert.equal(await J.redo(), null);
    assert.equal(w.bench.id, '');
  } finally {
    Object.assign(globalThis, saved);
  }
});

await ta('db.get（撤销读前像）：一次请求级读错误重试一次就拿到；两次都错才 reject —— 一次瞬时错误不该让整步撤不回', async () => {
  const error = console.error;
  console.error = () => {};
  try {
    const d = new L.FitLogDB();
    let calls = 0;
    let failAll = true;
    d.getStore = async () => ({
      get: id => {
        const req = {};
        const nth = ++calls;
        setTimeout(() => {
          if (failAll || nth === 1) {
            req.error = new DOMException('read aborted', 'AbortError');
            req.onerror?.();
          } else {
            req.result = { id };
            req.onsuccess?.();
          }
        });
        return req;
      },
    });
    await assert.rejects(d.get('workouts', 'a'));
    assert.equal(calls, 2);
    failAll = false;
    calls = 0;
    assert.deepEqual(await d.get('workouts', 'a'), { id: 'a' });
    assert.equal(calls, 2);
  } finally {
    console.error = error;
  }
});

// ── 动作身份（上架审查第 17 批）：并入、删做法、同名重建之后，读时别名之外的地方也认得出同一个动作 ──────────
/** 照 ExercisePrefsContext 的接法，把一份动作库状态绑成读取口径（全走 utils/liftIdentity 的纯函数） */
function identity(st, builtins = []) {
  const idx = L.buildNameIndex(builtins, st.customs, st.overrides);
  const def = n => idx.get((n || '').trim());
  const m = d => L.mergeOverride(d, st.overrides[d.id]);
  const aliases = d => st.overrides[d.id]?.variantAliases ?? d.variantAliases ?? {};
  const aliasOf = n => {
    const d = def(n);
    return (d && L.ownValue(aliases(d), (n || '').trim())) || undefined;
  };
  const vid = ex => {
    const d = def(ex.name);
    return d ? L.LI.variantIdIn(ex, aliases(d), [...(m(d).variants ?? []), ...(m(d).deletedVariants ?? [])]) : ex.variantId || undefined;
  };
  const label = ex => {
    const d = def(ex.name);
    return L.LI.variantLabelIn(ex, vid(ex), d ? m(d).variants ?? [] : [], d ? m(d).deletedVariants : undefined);
  };
  const resolve = n => {
    const d = def(n);
    return d ? L.mergedName(d, st.overrides[d.id]).cn : n;
  };
  const liftKey = ex => (label(ex) ? `${resolve(ex.name)}（${label(ex)}）` : resolve(ex.name));
  const stableId = ex => L.LI.stableIdIn(def(ex.name)?.id, vid(ex), liftKey(ex));
  const all = [...builtins, ...st.customs];
  const canonical = key =>
    L.LI.canonicalLiftIdIn(key, {
      stableIdOf: stableId,
      known: n => !!def(n),
      mergedNamesOf: id => {
        const d = all.find(x => x.id === id);
        return d && st.overrides[id]?.mergedInto ? L.EM.mergeNamesOf(m(d)) : undefined;
      },
      isAlias: n => !!aliasOf(n),
    });
  return { def, vid, label, resolve, liftKey, stableId, aliasOf, aliases, canonical, isAlias: n => !!aliasOf(n) };
}
const idDef = (id, cn, variants) => ({ id, name: { cn, en: cn }, bodyPart: 'subChest', tags: [], category: 'STRENGTH', ...(variants ? { variants } : {}) });
const mergeIn = (st, src, tgt, newId) => L.EM.planMerge([], st, src, tgt, { lang: 'cn', named: l => l ?? [], newId }).state;
const summariesOf = (I, ws) =>
  L.buildLiftSummaries({
    workouts: ws,
    stableIdOf: I.stableId,
    liftKey: I.liftKey,
    resolveName: I.resolve,
    signedLoadOf: () => false,
    getActiveMetrics: () => ['weight', 'reps'],
  });
const oneSet = (id, d, ex, kg) => ({ id, date: ago(d), exercises: [{ id: `${id}_e`, category: 'STRENGTH', sets: [{ id: `${id}_s`, weight: kg, reps: 5 }], ...ex }] });

/** T「杠铃平板卧推」自带宽握 v_t；S「史密斯卧推」自带宽握 v_a；S 并入 T 成做法 v_m */
const benchMerged = () =>
  mergeIn({ customs: [idDef('T', '杠铃平板卧推', [{ id: 'v_t', name: '宽握' }]), idDef('S', '史密斯卧推', [{ id: 'v_a', name: '宽握' }])], overrides: {} }, 'S', 'T', 'v_m');
const benchWs = [
  oneSet('w1', 1, { name: '杠铃平板卧推', variantId: 'v_t', variantName: '宽握' }, 60),
  oneSet('w2', 2, { name: '史密斯卧推', variantId: 'v_a', variantName: '宽握' }, 90),
  oneSet('w3', 3, { name: '史密斯卧推' }, 100),
];

// 防 C33#5：源动作自带的做法和目标的同名做法拼出同一个项目键，纪录混算（宽握两场、最好 90）
t('并入后：源自带的「宽握」和目标自己的「宽握」分开算纪录，源的标准落在并入做法上', () => {
  const I = identity(benchMerged());
  const lifts = summariesOf(I, benchWs);
  assert.equal(lifts.length, 3);
  const by = Object.fromEntries(lifts.map(l => [l.stableId, l]));
  assert.equal(by['T|v_t'].best.weight.value, 60);
  assert.equal(by['T|v_t'].sessions.length, 1);
  assert.equal(by['T|v_m/v_a'].best.weight.value, 90);
  assert.equal(by['T|v_m'].best.weight.value, 100);
  assert.equal(by['T|v_m/v_a'].key, '杠铃平板卧推（史密斯卧推 · 宽握）');
});

// 防 C30：目标 / 特别关注存的旧稳定键在并入、补建自建动作之后找不到，目标卡静默变成 0 / 目标
t('旧稳定键规范化：并入源「S|」「S|v_a」、连环并入、手填名补建成自建动作；目标绑的动作找不到时明说 missing', () => {
  const st = benchMerged();
  const I = identity(st);
  assert.equal(I.canonical('S|'), 'T|v_m');
  assert.equal(I.canonical('S|v_a'), 'T|v_m/v_a');
  assert.equal(I.canonical('T|v_t'), 'T|v_t');
  // 连环并入 A→B→C：A 的旧键落在 C 上 A 的名字指向的那个做法
  let chain = { customs: [idDef('3', '窄距高位下拉'), idDef('2', '宽握高位下拉'), idDef('1', '高位下拉')], overrides: {} };
  chain = mergeIn(chain, '3', '2', 'vB');
  chain = mergeIn(chain, '2', '1', 'vC');
  const IC = identity(chain);
  assert.equal(IC.canonical('3|'), IC.stableId({ name: '窄距高位下拉' }));
  assert.equal(IC.canonical('3|'), '1|vC');
  // 手填的「name:X」：后来补建成自建动作 X
  assert.equal(identity({ customs: [], overrides: {} }).canonical('name:哑铃耸肩'), 'name:哑铃耸肩');
  assert.equal(identity({ customs: [idDef('X', '哑铃耸肩')], overrides: {} }).canonical('name:哑铃耸肩'), 'X|');
  // 目标进度：绑「S|」= 那一组（源的标准）的最好成绩；绑一个已经不存在的键 → missing，不是 0
  const lifts = summariesOf(I, benchWs);
  const goal = exerciseName => ({ id: 'g', type: 'strength', unit: 'kg', startDate: ago(30), currentValue: 0, targetValue: 120, autoUpdateRule: { exerciseName } });
  const hit = L.G.goalCardValues(goal('S|'), lifts, [], [], I.canonical);
  assert.equal(hit.current, 100);
  assert.equal(hit.missing, undefined);
  const gone = L.G.goalCardValues(goal('Q|'), lifts, [], [], I.canonical);
  assert.equal(gone.missing, true);
});

// 防 C32：被并动作按名字存的记录项 / 备注 / 收藏被 byDisplayName 用源的键顶到目标上，拆回后也搬不回去
t('并入后：源的记录项 / 备注 / 收藏不顶到目标上，读写都不认源的键；目标有自己的键时以它为准', () => {
  const st = mergeIn({ customs: [idDef('PW', '加重引体向上'), idDef('PU', 'Pull Up')], overrides: {} }, 'PU', 'PW', 'v_m1');
  const I = identity(st);
  for (const raw of [{ 'Pull Up': ['reps'] }, { 'Pull Up': '握距窄' }, { 'Pull Up': 1700000000000 }]) {
    const view = L.byDisplayName(raw, I.resolve, I.isAlias);
    assert.equal(view['加重引体向上'], undefined, '回落默认（记录项）/ 没有备注 / 没收藏');
    assert.deepEqual(L.rawKeysIn(raw, '加重引体向上', I.resolve, I.isAlias), []);
    assert.deepEqual(L.rawKeysIn(raw, 'Pull Up', I.resolve, I.isAlias), []);
  }
  const both = { 'Pull Up': ['reps'], 加重引体向上: ['weight', 'reps'] };
  assert.deepEqual(L.byDisplayName(both, I.resolve, I.isAlias)['加重引体向上'], ['weight', 'reps']);
  assert.deepEqual(L.rawKeysIn(both, '加重引体向上', I.resolve, I.isAlias), ['加重引体向上']);
  // 没有自己的键时新写入落在目标的显示名上（toggleMetric：own ?? resolveName）
  assert.equal(I.resolve('Pull Up'), '加重引体向上');
});

// 防 C29：删掉并入生成的做法只滤 variants，别名指向死 id、来源还挂着 mergedInto，旧记录整批落进目标的「标准」
t('删并入生成的做法：一次拆回全部来源（别名、mergedInto、hidden 都清掉），做法进墓碑；名字各自解析回自己', () => {
  let st = { customs: [idDef('T', '高位下拉'), idDef('S1', '窄距高位下拉'), idDef('S2', '高位下拉（窄距）')], overrides: {} };
  st = mergeIn(st, 'S1', 'T', 'v_m');
  st = mergeIn(st, 'S2', 'T', 'v_other');
  assert.equal(st.customs.find(d => d.id === 'T').variantAliases['高位下拉（窄距）'], 'v_m', '同名做法直接认那一个');
  const { state, unmerged } = L.EM.planRemoveVariant([], st, 'T', 'v_m');
  assert.deepEqual(unmerged.sort(), ['S1', 'S2']);
  const T = state.customs.find(d => d.id === 'T');
  assert.deepEqual(Object.keys(T.variantAliases), []);
  assert.equal(T.variants.some(v => v.id === 'v_m'), false);
  assert.deepEqual(T.deletedVariants.map(v => [v.id, v.name]), [['v_m', '窄距']]);
  for (const s of ['S1', 'S2']) {
    assert.equal(state.overrides[s].mergedInto, undefined);
    assert.equal(state.overrides[s].hidden, undefined);
  }
  const idx = L.buildNameIndex([], state.customs, state.overrides);
  assert.equal(idx.get('窄距高位下拉').id, 'S1');
  assert.equal(idx.get('高位下拉（窄距）').id, 'S2');
  // 孤儿（这批之前删并入做法留下的）认得出来：mergedInto 还在、别名指向的做法没了
  const orphan = { ...st, customs: st.customs.map(d => (d.id === 'T' ? { ...d, variants: [] } : d)) };
  assert.deepEqual(L.EM.orphanMergesIn([], orphan).sort(), ['S1', 'S2']);
  assert.deepEqual(L.EM.orphanMergesIn([], st), []);
});

// 防 gap-6#7：删做法后同名重建得到新 id，liftKey / PR 按名字算、底稿 / 馆设置 / 稳定键按 id 算，两套口径分叉
t('同名新建做法：接回墓碑里最后删的那条（带回器材）；改名改成墓碑里的名字被拒；删掉的内置做法同名新建就放回去', () => {
  const tomb = [{ id: 'v_older', name: '宽握' }, { id: 'v_old', name: '宽握', equipment: 'tagDumbbell' }];
  const r = L.EM.planAddVariant([], tomb, [], '宽握', 'v_new');
  assert.equal(r.id, 'v_old');
  assert.equal(r.list[0].equipment, 'tagDumbbell');
  assert.deepEqual(r.tombstones.map(v => v.id), ['v_older']);
  assert.equal(L.EM.planAddVariant([], tomb, [], '窄握', 'v_new').id, 'v_new');
  assert.equal(L.EM.variantRenameBlocked(tomb, '宽握'), true);
  assert.equal(L.EM.variantRenameBlocked(tomb, '窄握'), false);
  // 删一个自己的做法 → 进墓碑；接回后墓碑里摘掉
  const st0 = { customs: [idDef('C', '划船', [{ id: 'v1', name: '宽握', equipment: 'tagCable' }])], overrides: {} };
  const del = L.EM.withVariantsIn([], st0, 'C', []);
  assert.deepEqual(del.customs[0].deletedVariants, [{ id: 'v1', name: '宽握', equipment: 'tagCable' }]);
  const back = L.EM.planAddVariant([], del.customs[0].deletedVariants, [], '宽握', 'v_new');
  assert.equal(L.EM.withVariantsIn([], del, 'C', back.list).customs[0].deletedVariants, undefined);
  // 内置做法（罗马尼亚硬拉的哑铃）删掉后同名新建：放回原 id，removedVariants 摘掉
  const rdl = { customs: [], overrides: { romanian_deadlift: { variants: [], removedVariants: ['eq_db'] } } };
  const add = L.EM.planAddVariant([], undefined, [{ id: 'eq_db', name: '哑铃', equipment: 'tagDumbbell' }], '哑铃', 'v_new');
  assert.equal(add.id, 'eq_db');
  const after = L.EM.withVariantsIn(L.DEFAULT_EXERCISES, rdl, 'romanian_deadlift', add.list);
  assert.equal(after.overrides.romanian_deadlift.removedVariants, undefined);
});

// 防 gap-2#4、gap-2#1②：新卡沿用上一次已删的做法（下一场又带回来）；旧计划存的并入别名配上标准的底稿
t('新卡的来源（cardSourceFor）：上次的做法已删 → 按标准、抄标准的上一次；名字是并入别名 → 换成目标名、写明做法、按它找底稿', () => {
  const rdlWs = [
    oneSet('r1', 1, { name: '罗马尼亚硬拉', variantId: 'eq_db', variantName: '哑铃' }, 22.5),
    oneSet('r2', 5, { name: '罗马尼亚硬拉' }, 60),
  ];
  const a = L.LI.cardSourceFor({
    name: '罗马尼亚硬拉',
    aliasOf: () => undefined,
    resolveName: n => n,
    live: () => false,
    findLast: v => L.findLastIn(rdlWs, n => n, e => e.variantId, '罗马尼亚硬拉', v),
    variantIdOf: e => e.variantId,
  });
  assert.equal(a.variantId, undefined);
  assert.equal(a.last.ex.sets[0].weight, 60);
  const st = mergeIn({ customs: [idDef('T', '高位下拉'), idDef('S', '窄距高位下拉')], overrides: {} }, 'S', 'T', 'v_m');
  const I = identity(st);
  const ws = [oneSet('p1', 1, { name: '高位下拉' }, 60), oneSet('p2', 5, { name: '窄距高位下拉' }, 45)];
  const b = L.LI.cardSourceFor({
    name: '窄距高位下拉',
    aliasOf: I.aliasOf,
    resolveName: I.resolve,
    live: v => (st.customs.find(d => d.id === 'T').variants ?? []).some(x => x.id === v),
    findLast: v => L.findLastIn(ws, I.resolve, I.vid, '窄距高位下拉', v),
    variantIdOf: I.vid,
  });
  assert.deepEqual([b.name, b.variantId, b.last.ex.sets[0].weight], ['高位下拉', 'v_m', 45]);
});

// 防 gap-2#1①③：卡名是并入别名时选「标准」被别名认回并入做法；改名改成并进自己的旧动作的名字，拆回后两个同名
t('换做法与改名：并入别名的卡切到标准后名字换成目标名、读出来是标准；改名成并入源的名字被拒', () => {
  const st = mergeIn({ customs: [idDef('T', '高位下拉'), idDef('S', '窄距高位下拉')], overrides: {} }, 'S', 'T', 'v_m');
  const I = identity(st);
  const card = L.LI.switchedCardIdentity({ name: '窄距高位下拉' }, undefined, I.aliasOf, I.resolve);
  assert.equal(card.name, '高位下拉');
  assert.equal(I.vid(card), undefined);
  const T = st.customs.find(d => d.id === 'T');
  assert.equal(L.LI.renameClashIn('窄距高位下拉', 'T', I.def('窄距高位下拉').id, I.aliases(T)), true);
  assert.equal(L.LI.renameClashIn('坐姿下拉', 'T', I.def('坐姿下拉')?.id, I.aliases(T)), false);
});

// ── 记录项落定要用的查询（utils/metricDefaults）────────────────────────────
// 防：把 0/0 空行当成记录，没练过的动作改有氧也被钉成重量 × 次数；漏掉训练中已有数的组，训练中改类型不落定（C105）
t('有记录的动作：只看有数的组（进行中那场的底稿行有数也算），旧名记到现名上', () => {
  const ex = (name, sets) => ({ id: name, name, category: 'STRENGTH', sets });
  const done = { id: 'w1', userId: 'u', date: ago(3), title: '', exercises: [ex('卧推', [{ id: 'a', weight: 60, reps: 5 }]), ex('Bench Old', [{ id: 'c', weight: 50, reps: 5 }])] };
  const live = {
    id: 'w2', userId: 'u', date: ago(0), title: '',
    exercises: [ex('农夫走', [{ id: 'b', weight: 70, reps: 6, ghost: true }]), ex('空的', [{ id: 'd', weight: 0, reps: 0 }])],
  };
  const got = L.MD.recordedNames([done, live], n => (n === 'Bench Old' ? '杠铃卧推' : n));
  assert.deepEqual([...got].sort(), ['农夫走', '卧推', '杠铃卧推'].sort());
});
// 防 gap-5#8：关掉的自定义项从选项里消失，历史上记的那一列再也点不回来
t('自定义记录项：这个动作历史里记过数的都列出来，0 和别的动作的不算', () => {
  const w = {
    id: 'w', userId: 'u', date: ago(1), title: '',
    exercises: [
      { id: 'e1', name: '跑步机', category: 'CARDIO', sets: [{ id: 's1', weight: 0, reps: 0, custom_坡度: 3, custom_心率: 0 }] },
      { id: 'e2', name: '划船', category: 'STRENGTH', sets: [{ id: 's2', weight: 0, reps: 0, custom_x: 5 }] },
    ],
  };
  assert.deepEqual(L.MD.customKeysIn([w], n => n, '跑步机'), ['custom_坡度']);
});

// ── 逐场纪录改累计式、汇总全 App 共用一份（审查 C36 / scale-perf#2）────────────
{
  // 神谕：改累计式之前那份朴素的 findRecords，原样冻结在这里（每场把此前全部组从头扫一遍）
  const TOL = 0.1;
  const maxBy = (xs, f) => xs.reduce((b, x) => (b === undefined || f(x) > f(b) ? x : b), undefined);
  const oracle = (rule, history, current, gym) => {
    const g = gym ?? '';
    const past = history.filter(s => (rule.machine || (rule.signed && s.kg < 0) ? s.gym === g : true));
    const now = current.filter(s => s.reps > 0 || s.kg !== 0);
    if (!past.length || !now.length) return [];
    const hits = [];
    if (!rule.tracksWeight) {
      if (!rule.tracksReps) return hits;
      const prev = Math.max(...past.map(s => s.reps));
      const best = maxBy(now, s => s.reps);
      if (best.reps > prev) hits.push({ kind: 'reps', prev, next: best.reps, at: best.at });
      return hits;
    }
    const loadOf = s => (rule.signed ? Math.max(0, s.kg) : s.kg);
    const lifted = s => s.reps > 0 || !(rule.signed || rule.tracksReps);
    const pastW = past.filter(lifted);
    const nowW = now.filter(s => lifted(s) && s.kg > 0);
    if (pastW.length && nowW.length) {
      const prev = Math.max(...pastW.map(loadOf));
      const best = maxBy(nowW, loadOf);
      if (loadOf(best) > prev + TOL && (prev > 0 || rule.signed)) hits.push({ kind: 'weight', prev, next: loadOf(best), at: best.at });
    }
    if (!rule.signed) {
      const pastE = past.map(s => L.R.e1rmOf(s.kg, s.reps)).filter(v => v != null);
      const nowE = now.map(s => ({ s, v: L.R.e1rmOf(s.kg, s.reps) })).filter(x => x.v != null);
      if (pastE.length && nowE.length) {
        const prev = Math.max(...pastE);
        const best = maxBy(nowE, x => x.v);
        if (best.v > prev + TOL * (1 + best.s.reps / 30)) hits.push({ kind: 'e1rm', prev, next: best.v, at: best.s.at });
      }
    }
    const fresh = now.filter(c => c.reps > 0 && !past.some(p => p.kg >= c.kg - TOL && p.reps >= c.reps));
    if (fresh.length) {
      const c = fresh.reduce((b, x) => (x.kg > b.kg + TOL || (Math.abs(x.kg - b.kg) <= TOL && x.reps > b.reps) ? x : b));
      const prev = Math.max(0, ...past.filter(p => p.kg >= c.kg - TOL).map(p => p.reps));
      hits.push({ kind: 'reps', prev, next: c.reps, atKg: c.kg, at: c.at });
    }
    if (!rule.signed) {
      const vol = s => Math.max(0, s.kg) * s.reps;
      const prev = Math.max(...past.map(vol));
      const best = maxBy(now, vol);
      if (prev > 0 && vol(best) > prev + TOL * best.reps) hits.push({ kind: 'volume', prev, next: vol(best), at: best.at });
    }
    return hits.sort((a, b) => L.R.RECORD_PRIORITY.indexOf(a.kind) - L.R.RECORD_PRIORITY.indexOf(b.kind));
  };

  // 固定种子的随机数据：自由重量 / 器械（按馆）/ 带号（辅助负、负重正、0）/ 只记次数 / 不记次数，
  // 底稿行、递减递增档、0 次的组、TOL 附近的浮点噪声、跨单位手打（102.06 / 102.1）、同一天两场、输入乱序
  let seed = 23;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = xs => xs[Math.floor(rnd() * xs.length)];
  const N_LIFT = 24;
  const metricsOf = i => (i % 6 === 0 ? ['reps'] : i % 6 === 1 ? ['weight', 'duration'] : ['weight', 'reps']);
  const signedLift = i => i % 4 === 1 || i % 6 === 0;
  const machineLift = i => i % 3 === 2;
  const name = i => `动作${i}`;
  const idx = nm => Number(nm.slice(2));
  // 重量随场次慢慢往上走（纪录才会一直有人破）；三成照抄这个动作最近用过的重量再加一点噪声，专挑容差边上
  const recent = new Map();
  const kgOf = (i, progress) => {
    const used = recent.get(i) ?? [];
    if (used.length && rnd() < 0.35) return pick(used) + pick([0, 0.04, 0.099, 0.1, 0.101, -0.04]);
    let kg = Math.round((20 + 80 * progress + pick([-10, -5, 0, 0, 2.5, 5])) / 2.5) * 2.5;
    if (rnd() < 0.15) kg = Math.round(kg * K) / 10 / K * 10; // 按 lb 打的一位小数（102.06 一类）
    recent.set(i, [kg, ...used].slice(0, 6));
    return kg;
  };
  const mode = () => pick(['assisted', 'weighted', 'normal', undefined]);
  const set = (i, j, progress) => {
    const s = { id: `s${j}`, weight: kgOf(i, progress), reps: pick([0, 1, 3, 5, 5, 6, 8, 10, 12]), ...(signedLift(i) ? { bodyweightMode: mode() } : {}) };
    if (rnd() < 0.08) s.ghost = true;
    if (rnd() < 0.15) s.subSets = [{ weight: Math.max(0, s.weight + pick([-20, -10, 5])), reps: pick([0, 4, 8]), ...(signedLift(i) ? { bodyweightMode: mode() } : {}) }];
    return s;
  };
  const randomWorkouts = count => {
    const ws = [];
    for (let k = 0; k < count; k++) {
      const day = Math.floor(k * 0.8); // 每 5 场里约有一天练两场
      const exs = [];
      const n = 2 + Math.floor(rnd() * 4);
      for (let e = 0; e < n; e++) {
        const i = Math.floor(rnd() * N_LIFT);
        const sets = Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, j) => set(i, j, k / count));
        exs.push({ id: `w${k}e${e}`, name: name(i), category: 'STRENGTH', sets });
      }
      ws.push({ id: `w${k}`, date: new Date(NOW - (2000 - day) * DAY).toISOString(), gym: pick(['A', 'B', '', undefined]), exercises: exs });
    }
    // 打乱：WorkoutContext 是新的在前，导入 / 合并进来的不保证顺序
    for (let k = ws.length - 1; k > 0; k--) {
      const j = Math.floor(rnd() * (k + 1));
      [ws[k], ws[j]] = [ws[j], ws[k]];
    }
    return ws;
  };
  const params = {
    stableIdOf: e => e.name,
    liftKey: e => e.name,
    resolveName: nm => nm,
    signedLoadOf: e => signedLift(idx(e.name)),
    getActiveMetrics: nm => metricsOf(idx(nm)),
    gymScoped: e => machineLift(idx(e.name)),
  };

  t('逐场纪录：累计判定和逐场重判一模一样', () => {
    // 防的错：C36 把逐场重扫改成累计摘要时把口径改错（前沿查询漏了容差、辅助组进了全局分区、并列时先到先得变成后到）——
    // 历史纪录点、特别关注「刚破纪录」、热力图、刊末页 PB 牌会一起错
    const lifts = L.buildLiftSummaries({ workouts: randomWorkouts(600), ...params });
    const kinds = new Map();
    let sessions = 0;
    for (const lift of lifts) {
      const rule = L.R.prRuleFor(metricsOf(idx(lift.baseName)), lift.signed, lift.machine);
      const hist = [];
      for (const s of lift.sessions) {
        const cur = s.cards.flatMap(c => L.R.prSetsOf(c, s.gym, lift.signed));
        const want = oracle(rule, hist, cur, s.gym);
        assert.deepEqual(s.records, want.map(h => h.kind), `${lift.key} ${s.workoutId}`);
        // prDetect / ExerciseCard 走的 findRecords：整份 RecordHit（prev / next / at / atKg）一样，换个馆判也一样
        for (const g of [s.gym, 'A', 'B', '']) assert.deepEqual(L.R.findRecords(rule, hist, cur, g), oracle(rule, hist, cur, g), `${lift.key} ${s.workoutId} @${g}`);
        for (const h of want) kinds.set(h.kind, (kinds.get(h.kind) ?? 0) + 1);
        hist.push(...cur);
        sessions++;
      }
    }
    assert.ok(sessions > 1500, `sessions ${sessions}`);
    // 数据得真把四种纪录都造出来，否则比对的是一堆空数组
    for (const k of ['weight', 'e1rm', 'reps', 'volume']) assert.ok((kinds.get(k) ?? 0) > 5, `${k}: ${kinds.get(k)}`);
  });

  t('单个动作 4000 场的汇总耗时约是 1000 场的 4 倍', () => {
    // 防的错：C36 的根因退回来 —— 每场把此前全部组从头扫，单个动作 O(场次²)，2000 场切一次页要一秒
    const one = count =>
      Array.from({ length: count }, (_, k) => ({
        id: `p${k}`,
        date: new Date(NOW - (count - k) * DAY).toISOString(),
        exercises: [{ id: `p${k}e`, name: '动作2', category: 'STRENGTH', sets: Array.from({ length: 6 }, (_, j) => ({ id: `s${j}`, weight: 40 + Math.floor(rnd() * 120) / 2, reps: 1 + Math.floor(rnd() * 12) })) }],
      }));
    const p = { ...params, gymScoped: () => false };
    const time = ws => {
      let best = Infinity;
      for (let r = 0; r < 5; r++) {
        const t0 = performance.now();
        for (let k = 0; k < 5; k++) L.buildLiftSummaries({ workouts: ws, ...p });
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    };
    const w1 = one(1000);
    const w4 = one(4000);
    time(w1);
    const ratio = time(w4) / time(w1);
    assert.ok(ratio < 10, `t4000 / t1000 = ${ratio.toFixed(1)}`);
  });

  t('做完的训练：进行中那场开 / 关、换了新数组但内容没变，都返回同一个数组（汇总不重算）', () => {
    // 防的错：C36 加第一个动作、冷启动接回进行中那场时 inProgress 翻转，过滤结果没变却换了新数组，全部历史整份重判
    const done = id => ({ id, date: ago(3), exercises: [{ id: `${id}e`, name: '卧推', sets: [{ id: 's', weight: 60, reps: 5 }] }] });
    const a = done('a'), b = done('b'), c = done('c');
    const fresh = { id: '新场id', date: ago(0), exercises: [{ id: 'x', name: '卧推', sets: [{ id: 's', weight: 60, reps: 5, ghost: true }] }] };
    const all = [fresh, a, b, c];
    const first = L.doneWorkoutsOf(all, undefined);
    assert.deepEqual(first.map(w => w.id), ['a', 'b', 'c']);
    assert.equal(L.doneWorkoutsOf(all, '新场id'), first);
    assert.equal(L.doneWorkoutsOf([...all], '新场id'), first);
    // 进行中那场有做完的组：在 all 里时要排除，不排除就是另一个结果
    const live = { ...fresh, exercises: [{ ...fresh.exercises[0], sets: [{ id: 's', weight: 60, reps: 5 }] }] };
    assert.equal(L.doneWorkoutsOf([live, a, b, c], live.id), first);
    assert.deepEqual(L.doneWorkoutsOf([live, a, b, c], undefined).map(w => w.id), ['新场id', 'a', 'b', 'c']);
    const b2 = { ...b };
    const changed = L.doneWorkoutsOf([fresh, a, b2, c], undefined);
    assert.notEqual(changed, first);
    assert.equal(changed[1], b2);
  });

  t('按动作汇总：只换星标 / 备注不重算，换了汇总真正用到的（liftKey、动作覆盖层）才重算', () => {
    // 防的错：scale-perf#2 拿整个 prefs 当缓存键，点星、存备注、特别关注每一下都把全部历史整份重判
    const ws = L.doneWorkoutsOf(randomWorkouts(20), undefined);
    const def = { id: 'd', name: { cn: '动作2', en: 'Lift 2' }, category: 'STRENGTH', resistance: 'stack', equipment: 'machine' };
    const prefs = {
      findExerciseDef: nm => (nm === '动作2' ? def : undefined),
      variantIdOf: () => undefined,
      liftKey: e => e.name,
      stableIdOf: e => e.name,
      resolveName: nm => nm,
      signedLoadOf: () => false,
      getActiveMetrics: () => ['weight', 'reps'],
      attrsOf: d => ({ equipment: d.equipment, resistance: d.resistance }),
      exerciseOverrides: {},
      starredExercises: {},
      exerciseNotes: {},
    };
    const out = L.liftSummariesFor(ws, prefs);
    assert.equal(out.find(l => l.key === '动作2').machine, true, 'gymScoped built from the library lookup');
    assert.equal(L.liftSummariesFor(ws, { ...prefs, starredExercises: { 动作2: 1 }, exerciseNotes: { 动作2: 'x' } }), out);
    assert.notEqual(L.liftSummariesFor(ws, { ...prefs, liftKey: e => e.name }), out);
    const again = L.liftSummariesFor(ws, prefs);
    assert.notEqual(L.liftSummariesFor(ws, { ...prefs, exerciseOverrides: {} }), again);
  });
}

console.log(`\nlogic-check: ${n} passed`);
