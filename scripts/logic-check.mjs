#!/usr/bin/env node
/**
 * 散在各处的纯逻辑自检：体重 30 天基线 / 变化、PR 判定（刊末页 / 训练中 / 历史同一份口径）与印章换单位、
 * 底稿抄哪一场、龙门架标签迁移、递减档取整保持方向、按馆的片子单位取整、单边挂片、动作属性的器材 ⇄ 阻力联动、
 * 覆盖层合并、交替组改记到别的动作、搜索归一化。
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'logic-check-'));
const out = join(dir, 'logic.mjs');

// useLoadRounder / useLoadKind 顶上引了 React context：这里只用它们导出的纯函数，context 换成空壳
const stubContexts = {
  name: 'stub-contexts',
  setup(b) {
    b.onResolve({ filter: /\/contexts\// }, a => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'const no = () => { throw new Error("context used in logic-check"); }; export const useExercisePrefs = no; export const useUserSettingsContext = no;',
      loader: 'js',
    }));
  },
};

await build({
  stdin: {
    contents: [
      "export * from './src/utils/weightSummary.ts';",
      "export { stampsInUnit } from './src/utils/prDetect.ts';",
      "export { findLastIn } from './src/utils/prefillSource.ts';",
      "export { migrateCableTags } from './src/utils/cableTagMigration.ts';",
      "export { makeRounder, roundPrefill, reRoundPending, snapUntouched } from './src/hooks/useLoadRounder.ts';",
      "export * as A from './src/utils/exerciseAttrs.ts';",
      "export { mergeOverride } from './src/utils/exerciseOverride.ts';",
      "export { detectPRs } from './src/utils/prDetect.ts';",
      "export * as R from './src/utils/prRecords.ts';",
      "export { buildLiftSummaries, trendPoints } from './src/utils/liftHistory.ts';",
      "export { moveSetToExercise } from './src/utils/workbench.ts';",
      "export * as S from './src/utils/exerciseSearch.ts';",
      "export { trackScrub, ENGAGE_PX } from './src/utils/scrubFeel.ts';",
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
  const vOf = e => e.variantId;
  assert.equal(L.findLastIn(ws, id, vOf, '推肩', null, undefined, 'A').workout.id, 'w_a', 'same gym first');
  assert.equal(L.findLastIn(ws, id, vOf, '推肩', null, undefined, 'B').workout.id, 'w_b');
  assert.equal(L.findLastIn(ws, id, vOf, '推肩', null, undefined, 'C').workout.id, 'w_b', 'never trained at C → latest anywhere');
  assert.equal(L.findLastIn(ws, id, vOf, '推肩').workout.id, 'w_b', 'no gym → latest');
  assert.equal(L.findLastIn(ws, id, vOf, '推肩', null, 'w_a', 'A').workout.id, 'w_a_old', 'skipWorkoutId');
  assert.equal(L.findLastIn(ws, id, vOf, '深蹲'), null);
  // 做法：'' = 标准做法，别的做法不算
  const wv = [W('v1', 'A', [ex('推肩', [done(30)], 'wide')]), W('v0', 'A', [ex('推肩', [done(20)])])];
  assert.equal(L.findLastIn(wv, id, vOf, '推肩', '', undefined, 'A').workout.id, 'v0');
  assert.equal(L.findLastIn(wv, id, vOf, '推肩', 'wide', undefined, 'A').workout.id, 'v1');
  assert.equal(L.findLastIn(wv, id, vOf, '推肩', null, undefined, 'A').workout.id, 'v1', 'null = any variant');
  // 名字按 resolveName 认（改过名的动作）
  assert.equal(L.findLastIn([W('r', 'A', [ex('旧名', [done(10)])])], n => (n === '旧名' ? '新名' : n), vOf, '新名').workout.id, 'r');
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
t('递减档保持方向：递增档（比上一档重）吸到同一格时往重的方向挪', () => {
  const r = L.makeRounder(pinInfo, 'lbs', lbCtx(10), false);
  const s = { id: 's', weight: 18 * LB, reps: 9, ghost: true, subSets: [{ weight: 23.4 * LB, reps: 6 }] };
  assert.deepEqual(lbsOf(L.reRoundPending([s], ex1, r)[0]), [20, 30]);
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
    const rule = { tracksWeight: true, signed: false, machine: false };
    const hist = L.R.prSetsOf(h[0].exercises[0], '', false);
    assert.equal(hist.length, 1, 'ghost row is not a fact');
    const cur = exOf('卧推', [st(95, 5), st(102.5, 3), st(105, 1, { ghost: true })]);
    const top = L.R.findRecords(rule, hist, L.R.prSetsOf(cur, '', false), '')[0];
    assert.equal(top.kind, 'weight');
    assert.equal(top.at, 1);
  });
}

// ── 体重变化那一行（审查 A22）──────────────────────────────────────
t('体重变化：最新一次超过 30 天不显示；基线就是最新那条不显示；都在 30 天内按实际天数；先取整再定号', () => {
  const w = (d, kg) => ({ date: ago(d), weight: kg });
  assert.equal(L.weightDelta([w(40, 80), w(70, 82)], 'kg', NOW), null);
  assert.equal(L.weightDelta([w(3, 80)], 'kg', NOW), null);
  const d = L.weightDelta([w(2, 80), w(14, 81)], 'kg', NOW);
  assert.equal(d.text, '-1');
  assert.equal(d.days, 12);
  assert.equal(L.weightDelta([w(1, 80), w(40, 82)], 'lbs', NOW).text, '-4.4');
  assert.equal(L.weightDelta([w(1, 80.02), w(10, 80)], 'kg', NOW).text, '0', 'no -0.0 / +0.0');
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

console.log(`\nlogic-check: ${n} passed`);
