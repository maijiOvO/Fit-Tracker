#!/usr/bin/env node
/**
 * 散在各处的纯逻辑自检：体重 30 天基线、PR 印章换单位、底稿抄哪一场、龙门架标签迁移、
 * 递减档取整保持方向、动作属性的器材 ⇄ 阻力联动、覆盖层合并。
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
t('动作属性：固定器械默认配重片、可改成杠铃片；杠铃锁定杠铃片；写入时锁定的器材不存阻力', () => {
  const { A } = L;
  assert.equal(A.defaultResistance(A.EQ_MACHINE, []), 'stack');
  assert.ok(A.resistanceSelectable(A.EQ_MACHINE));
  assert.equal(A.effectiveResistance(A.EQ_MACHINE, 'plates', []), 'plates');
  assert.equal(A.effectiveResistance(A.EQ_MACHINE, undefined, []), 'stack');
  assert.ok(!A.resistanceSelectable(A.EQ_BARBELL));
  assert.equal(A.effectiveResistance(A.EQ_BARBELL, 'stack', []), 'plates', 'barbell load is locked to plates');
  assert.deepEqual(A.attrsPatch(A.EQ_BARBELL, 'stack'), { equipment: A.EQ_BARBELL, resistance: undefined, tags: [A.EQ_BARBELL] });
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

console.log(`\nlogic-check: ${n} passed`);
