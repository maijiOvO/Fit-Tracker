#!/usr/bin/env node
/**
 * 工作台「做到哪了」与交替组的逻辑自检（src/utils/workbench.ts、src/utils/load.ts）。
 *
 * e2e 只走原有的点组号 / ±5 路径，换卡、补做、交替组、编辑旧训练、带正负的负荷它都没测到（假的成功信号：全绿 ≠ 测到了）。
 * 这里不起浏览器，用 esbuild 把两个纯函数模块打成临时 ESM 直接跑断言，几百毫秒。
 *
 * 用法：node scripts/workbench-check.mjs
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'wb-check-'));
const out = join(dir, 'wb.mjs');
await build({
  stdin: {
    contents:
      "export * from './src/utils/workbench.ts'; export * from './src/utils/load.ts'; export * as L from './src/utils/loadable.ts'; export * as S from './src/utils/scrubFeel.ts'; export * as A from './src/utils/exerciseAttrs.ts'; export * as X from './src/constants/exercises.ts';",
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'silent',
});
const W = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

/** 动作：name + 每组 [重量, 次数]，全部待做 */
const ex = (id, sets, extra = {}) => ({
  id,
  name: id,
  category: 'STRENGTH',
  sets: sets.map(([w, r], i) => ({ id: `${id}${i + 1}`, weight: w, reps: r, ghost: true })),
  ...extra,
});
/** 一行一行念出来：A1[D] |P| A2[p] … */
const read = exs => {
  const flat = W.flatRows(exs);
  const P = W.pointerIndex(exs);
  return flat
    .map((r, i) => {
      const s = W.findSet(exs, r);
      const st = s.ghost ? 'p' : 'D';
      return `${i === P ? '| ' : ''}${r.setId}[${st}]`;
    })
    .join(' ') + (P === flat.length ? ' |' : '');
};
/** 点组号（2026-10-11）：一下＝选中 + 指针挪到这一组正下方 */
const tap = (exs, setId) => {
  const r = W.flatRows(exs).find(x => x.setId === setId);
  const res = W.tapSetNum(exs, r);
  return { exs: W.normalizeGroups(res.exs), outcome: res.outcome, suggest: res.suggestPair };
};
const fill = (exs, setId, patch) => exs.map(e => ({ ...e, sets: e.sets.map(s => (s.id === setId ? { ...s, ...patch } : s)) }));

console.log('workbench-check');

t('一路往下：指针跟着做完走，默认选中指针下面那组', () => {
  let exs = [ex('A', [[50, 10], [50, 10], [50, 10]]), ex('B', [[20, 12], [20, 12]])];
  assert.equal(W.nextPendingRow(exs).setId, 'A1');
  exs = tap(exs, 'A1').exs;
  exs = tap(exs, 'A2').exs;
  assert.equal(read(exs), 'A1[D] A2[D] | A3[p] B1[p] B2[p]');
  assert.equal(W.nextPendingRow(exs).setId, 'A3');
});

t('做了一半去做别的：剩下的组原样留着待做，那张卡挪到当前卡下面', () => {
  let exs = [ex('A', [[50, 10], [50, 10], [50, 10]]), ex('B', [[20, 12]]), ex('C', [[30, 15], [30, 15]])];
  exs = tap(exs, 'A1').exs;
  exs = tap(exs, 'C1').exs;
  assert.equal(read(exs), 'A1[D] A2[p] A3[p] C1[D] | C2[p] B1[p]');
});

t('还没开始就去做别的：那张卡挪到最前面', () => {
  let exs = [ex('A', [[50, 10], [50, 10]]), ex('B', [[20, 12], [20, 12]])];
  exs = tap(exs, 'B1').exs;
  assert.equal(read(exs), 'B1[D] | B2[p] A1[p] A2[p]');
});

t('跳回去补做留下的组：原地做完 + 提示交替；合并后待做的按轮换排', () => {
  let exs = [ex('A', [[30, 15], [30, 15], [30, 15]]), ex('B', [[60, 15], [60, 15], [60, 15]])];
  exs = tap(exs, 'A1').exs;
  exs = tap(exs, 'B1').exs; // A2、A3 留在指针上面待做
  const r = tap(exs, 'A2');
  assert.deepEqual(r.suggest, { a: 'A', b: 'B' });
  exs = W.groupExercises(r.exs, ['A', 'B']);
  // 做完的按实际先后（A1 B1 A2），待做从最后做完那组（A）的下一个动作（B）接着轮
  assert.equal(read(exs), 'A1[D] B1[D] A2[D] | B2[p] A3[p] B3[p]');
});

t('交替组：成员左右移只重排待做，做完的不动；改记到另一个动作', () => {
  let exs = W.groupExercises([ex('A', [[1, 1], [1, 1]]), ex('B', [[2, 2], [2, 2]])], ['A', 'B']);
  assert.equal(read(exs), '| A1[p] B1[p] A2[p] B2[p]');
  exs = tap(exs, 'A1').exs;
  exs = W.moveGroupMember(exs, 'B', -1); // 轮换顺序 B, A
  assert.equal(read(exs), 'A1[D] | B1[p] A2[p] B2[p]');
  const r = W.flatRows(exs).find(x => x.setId === 'A2');
  exs = W.moveSetToExercise(exs, r, 'B');
  assert.equal(exs.find(e => e.id === 'B').sets.length, 3);
});

t('移出交替 / 拆开：状态原样带走；只剩一个成员的组自动拆掉', () => {
  let exs = W.groupExercises([ex('A', [[1, 1]]), ex('B', [[2, 2]]), ex('C', [[3, 3]])], ['A', 'B', 'C']);
  exs = tap(exs, 'B1').exs; // 按轮换扫过 A1、B1
  exs = W.removeFromGroup(exs, 'B');
  assert.equal(W.buildCards(exs).length, 2);
  assert.equal(exs.find(e => e.id === 'B').sets[0].ghost, false);
  exs = W.removeFromGroup(exs, 'A');
  assert.ok(exs.every(e => !e.altGroup), 'a one-member group should dissolve');
});

t('拖指针：往下经过的做完（全零的留着待做），往上经过的退回待做', () => {
  let exs = [ex('A', [[50, 10], [0, 0], [50, 10]])];
  exs = W.movePointerTo(exs, 'A', 3);
  assert.equal(read(exs), 'A1[D] A2[p] A3[D] |');
  exs = W.movePointerTo(exs, 'A', 1);
  assert.equal(read(exs), 'A1[D] | A2[p] A3[p]');
});

t('点组号：同一张卡里点下面的组，经过的做完（全零的留着待做）、指针落在它正下方', () => {
  let exs = [ex('A', [[50, 10], [0, 0], [55, 8], [60, 6]]), ex('B', [[20, 12]])];
  const r = tap(exs, 'A3');
  assert.equal(r.outcome, 'done');
  exs = r.exs;
  assert.equal(read(exs), 'A1[D] A2[p] A3[D] | A4[p] B1[p]');
  assert.equal(W.nextPendingRow(exs).setId, 'A4');
});

t('点组号：做完的组再点（刚做完的、更上面的）＝只选中，指针不往回跳、什么都不退回', () => {
  let exs = [ex('A', [[50, 10], [50, 10], [50, 10]])];
  exs = tap(exs, 'A3').exs;
  assert.equal(read(exs), 'A1[D] A2[D] A3[D] |');
  for (const id of ['A3', 'A1']) {
    const r = tap(exs, id);
    assert.equal(r.outcome, 'select');
    assert.deepEqual(r.exs, exs);
  }
});

t('用户流程：点 1、点 2，回头点 1 改手误 → 指针留在 2–3，组 2 不退回、不跟；再点 3 照常前进', () => {
  const r = id => ({ exId: 'A', setId: id });
  const w = exs => exs[0].sets.map(s => s.weight).join(' ');
  let exs = [ex('A', [[20, 10], [20, 10], [20, 10], [20, 10]])];
  exs = tap(exs, 'A1').exs;
  exs = tap(exs, 'A2').exs;
  assert.equal(read(exs), 'A1[D] A2[D] | A3[p] A4[p]');
  assert.equal(tap(exs, 'A1').outcome, 'select');
  // 组 1 改成 25：它后面还有做完的组 2 → 后面全部不动（重量、次数都是）
  exs = W.applySetUpdate(exs, r('A1'), { weight: 25 });
  exs = W.applySetUpdate(exs, r('A1'), { reps: 12 });
  assert.equal(w(exs), '25 20 20 20');
  assert.equal(exs[0].sets.map(s => s.reps).join(' '), '12 10 10 10');
  // 打字结算也一样
  exs = W.applySetUpdate(exs, r('A1'), { weight: 30, holdFollow: true });
  exs = W.applySetUpdate(exs, r('A1'), { followFrom: { kg: 25 } });
  assert.equal(w(exs), '30 20 20 20');
  // 改最新做完的组 2：后面待做的照常跟
  exs = W.applySetUpdate(exs, r('A2'), { weight: 22.5 });
  assert.equal(w(exs), '30 22.5 22.5 22.5');
  exs = tap(exs, 'A3').exs;
  assert.equal(read(exs), 'A1[D] A2[D] A3[D] | A4[p]');
});

t('改不是最新做完的组：同一组里的递减链照样保持差值，后面组的递减档不动', () => {
  const r = id => ({ exId: 'A', setId: id });
  let exs = [ex('A', [[60, 8], [60, 8], [60, 8]])];
  exs[0].sets.forEach((st, i) => (st.subSets = [{ id: `d${i}a`, weight: 50, reps: 8 }, { id: `d${i}b`, weight: 40, reps: 8 }]));
  exs = tap(exs, 'A2').exs;
  const s0 = exs[0].sets[0];
  exs = W.applySetUpdate(exs, r('A1'), { subSets: [{ ...s0.subSets[0], weight: 45 }, s0.subSets[1]] });
  assert.equal(exs[0].sets.map(st => [st.weight, ...st.subSets.map(x => x.weight)].join('/')).join(' '), '60/45/35 60/50/40 60/50/40');
  // 母组改重量：自己的递减档跟着挪，后面的组不动
  exs = W.applySetUpdate(exs, r('A1'), { weight: 70 });
  assert.equal(exs[0].sets.map(st => [st.weight, ...st.subSets.map(x => x.weight)].join('/')).join(' '), '70/55/45 60/50/40 60/50/40');
});

t('点组号：改过数的组做完再退回，仍认得改过（结束训练要提醒）；没改过的退回还是底稿', () => {
  let exs = [ex('A', [[50, 10], [50, 10]])];
  exs = fill(exs, 'A1', { weight: 55, touched: { weight: true }, subSets: [{ weight: 40, reps: 8, touched: { reps: true } }] });
  exs = tap(exs, 'A2').exs;
  assert.equal(read(exs), 'A1[D] A2[D] |');
  exs = W.movePointerTo(exs, W.buildCards(exs)[0].key, 0); // 书签拖回最上面：A1、A2 退回
  assert.equal(read(exs), '| A1[p] A2[p]');
  assert.deepEqual(exs[0].sets[0].touched, { weight: true }, 'touched survives done → revert');
  assert.deepEqual(exs[0].sets[0].subSets[0].touched, { reps: true }, 'drop-set touched survives done → revert');
  assert.equal(exs[0].sets[1].touched, undefined, 'an untouched draft stays untouched after done → revert');
});

t('点组号：全零的组点不实（只选中，指针不动）；指针上面留下的组填了数再点＝原地补做', () => {
  let exs = [ex('A', [[50, 10], [0, 0], [50, 10]])];
  exs = tap(exs, 'A1').exs;
  const r = tap(exs, 'A2');
  assert.equal(r.outcome, 'empty');
  assert.equal(read(r.exs), 'A1[D] | A2[p] A3[p]');
  exs = tap(exs, 'A3').exs; // A2 全零 → 扫过去也留着待做
  assert.equal(read(exs), 'A1[D] A2[p] A3[D] |');
  assert.equal(tap(exs, 'A2').outcome, 'empty'); // 在指针上面、全零：还是点不实
  const f = tap(fill(exs, 'A2', { reps: 8 }), 'A2');
  assert.equal(f.outcome, 'done');
  assert.equal(f.suggest, undefined, 'same card: no pairing hint');
  assert.equal(read(f.exs), 'A1[D] A2[D] A3[D] |');
});

t('点组号：点别的卡 → 当前卡剩下的留着待做、那张卡挪上来并扫到被点的组；还没开始就挪到最前', () => {
  let exs = [ex('A', [[50, 10], [50, 10], [50, 10]]), ex('B', [[20, 12]]), ex('C', [[30, 15], [30, 15], [30, 15]])];
  exs = tap(exs, 'A1').exs;
  exs = tap(exs, 'C2').exs;
  assert.equal(read(exs), 'A1[D] A2[p] A3[p] C1[D] C2[D] | C3[p] B1[p]');
  const r = tap(exs, 'A2');
  assert.equal(r.outcome, 'done');
  assert.deepEqual(r.suggest, { a: 'A', b: 'C' });
  assert.equal(read(r.exs), 'A1[D] A2[D] A3[p] C1[D] C2[D] | C3[p] B1[p]');

  let fresh = [ex('A', [[50, 10], [50, 10]]), ex('B', [[20, 12], [20, 12]])];
  fresh = tap(fresh, 'B2').exs;
  assert.equal(read(fresh), 'B1[D] B2[D] | A1[p] A2[p]');
});

t('点组号：交替组里按轮换扫过去', () => {
  let exs = W.groupExercises([ex('A', [[1, 1], [1, 1]]), ex('B', [[2, 2], [2, 2]])], ['A', 'B']);
  exs = tap(exs, 'A2').exs;
  assert.equal(read(exs), 'A1[D] B1[D] A2[D] | B2[p]');
});

t('交替组行序：待做的从「最后一条做完（seq 最大）的成员」的下一位开始轮换', () => {
  // B1 最后做完（seq 2）→ 轮到 A：A2 在 B2 前面
  let exs = W.groupExercises([ex('A', [[1, 1], [1, 1]]), ex('B', [[2, 2], [2, 2]])], ['A', 'B']);
  exs = fill(fill(exs, 'A1', { ghost: false, seq: 1 }), 'B1', { ghost: false, seq: 2 });
  assert.equal(read(exs), 'A1[D] B1[D] | A2[p] B2[p]');
  // 反过来 A1 最后做完 → 轮到 B：B2 在 A2 前面（做完的按 seq 排，B1 先）
  exs = fill(fill(exs, 'A1', { seq: 2 }), 'B1', { seq: 1 });
  assert.equal(read(exs), 'B1[D] A1[D] | B2[p] A2[p]');
});

t('改值：重量保持差值带后面没动过的待做底稿，次数只带原值相同的；改过的、做完的不跟', () => {
  const r = exs => W.flatRows(exs)[0];
  // 全是 60：改第 1 组（待做）→ 后面全跟；跟着变的不记 touched
  let exs = [ex('A', [[60, 8], [60, 8], [60, 8]])];
  exs = W.applySetUpdate(exs, r(exs), { weight: 62.5, touched: { weight: true } });
  assert.deepEqual(exs[0].sets.map(s => s.weight), [62.5, 62.5, 62.5]);
  assert.equal(exs[0].sets[1].touched, undefined, 'followers stay drafts');
  assert.deepEqual(exs[0].sets.map(s => s.reps), [8, 8, 8], 'reps untouched by a weight edit');
  // 金字塔：重量整体平移（原值不同的也跟），结构不被压平；次数只跟原值相同的
  exs = [ex('A', [[60, 8], [65, 6], [60, 8]])];
  exs = W.applySetUpdate(exs, r(exs), { weight: 70 });
  assert.deepEqual(exs[0].sets.map(s => s.weight), [70, 75, 70]);
  exs = W.applySetUpdate(exs, r(exs), { reps: 10 });
  assert.deepEqual(exs[0].sets.map(s => s.reps), [10, 6, 10]);
  // 手动改过的不跟；做完的不跟
  exs = [ex('A', [[60, 8], [60, 8], [60, 8]])];
  exs[0].sets[1].touched = { weight: true };
  exs[0].sets[2].ghost = false;
  exs = W.applySetUpdate(exs, r(exs), { weight: 65 });
  assert.deepEqual(exs[0].sets.map(s => s.weight), [65, 60, 60]);
  // 做完的组改值也带动后面的底稿（做完第 1 组按 +5 记实际重量）
  exs = [ex('A', [[60, 8], [60, 8]])];
  exs[0].sets[0].ghost = false;
  exs = W.applySetUpdate(exs, r(exs), { weight: 65 });
  assert.deepEqual(exs[0].sets.map(s => s.weight), [65, 65]);
  // 热身：改第 1 组成 40 全跟（−20）；第 2 组改回 60（+20），3 跟着平移回来
  exs = [ex('A', [[60, 8], [60, 8], [60, 8]])];
  exs = W.applySetUpdate(exs, r(exs), { weight: 40 });
  exs = W.applySetUpdate(exs, W.flatRows(exs)[1], { weight: 60, touched: { weight: true } });
  assert.deepEqual(exs[0].sets.map(s => s.weight), [40, 60, 60]);
});

t('改值带 snapFor：跟着平移的组和递减档吸到能挂的，被改的那组照原样', () => {
  const r = exs => W.flatRows(exs)[0];
  const snap5 = () => kg => Math.round(kg / 5) * 5;
  let exs = [ex('A', [[60, 8], [62, 8], [60, 8]])];
  exs[0].sets[0].subSets = [{ id: 'a1s', weight: 50, reps: 6 }];
  exs[0].sets[1].subSets = [{ id: 'a2s', weight: 52, reps: 6 }];
  exs = W.applySetUpdate(exs, r(exs), { weight: 63 }, snap5);
  assert.deepEqual(exs[0].sets.map(s => s.weight), [63, 65, 65], 'edited set keeps 63; followers 63/65 snap to 65');
  assert.equal(exs[0].sets[0].subSets[0].weight, 55, 'own drop 53 → 55');
  assert.equal(exs[0].sets[1].subSets[0].weight, 55, "follower's drop 55");
  assert.ok(exs[0].sets.slice(1).every(s => s.draftAuto === false), 'followed sets are no longer auto drafts');
  // snapFor 返回 null（纯数字的动作）：照原来纯平移
  let plain = [ex('A', [[60, 8], [62, 8]])];
  plain = W.applySetUpdate(plain, r(plain), { weight: 63 }, () => null);
  assert.deepEqual(plain[0].sets.map(s => s.weight), [63, 65]);
  plain = [ex('A', [[60, 8], [61, 8]])];
  plain = W.applySetUpdate(plain, r(plain), { weight: 63 }, () => null);
  assert.deepEqual(plain[0].sets.map(s => s.weight), [63, 64]);
});

t('改值清 draftAuto：被改的组；递减档按 id 比，删掉中间一档不误判后面的', () => {
  const r = exs => W.flatRows(exs)[0];
  let exs = [ex('A', [[60, 8]])];
  exs[0].sets[0] = { ...exs[0].sets[0], draftAuto: true, checkWeight: true };
  const w = W.applySetUpdate(exs, r(exs), { weight: 65 });
  assert.equal(w[0].sets[0].draftAuto, false);
  assert.equal(w[0].sets[0].checkWeight, false);
  assert.equal(W.applySetUpdate(exs, r(exs), { reps: 10 })[0].sets[0].draftAuto, true, 'reps edit keeps draftAuto');

  const subs = [
    { id: 's1', weight: 50, reps: 6, draftAuto: true },
    { id: 's2', weight: 40, reps: 6, draftAuto: true },
  ];
  exs = [ex('A', [[60, 8]])];
  exs[0].sets[0].subSets = subs;
  // 删掉第一档：s2 前移到下标 0，但没改过 → 还是 draftAuto
  const del = W.applySetUpdate(exs, r(exs), { subSets: [subs[1]] });
  assert.equal(del[0].sets[0].subSets[0].id, 's2');
  assert.equal(del[0].sets[0].subSets[0].draftAuto, true);
  // 改 s2（最后一档）的重量：只有 s2 清掉（改 s1 会带着 s2 平移，s2 也清）
  const ed = W.applySetUpdate(exs, r(exs), { subSets: [subs[0], { ...subs[1], weight: 35 }] });
  assert.deepEqual(ed[0].sets[0].subSets.map(s => s.draftAuto), [true, false]);
});

t('改某一档的重量：同一组里下面没改过的档保持差值一起挪，后面待做组的同几档照样跟；打字中途不跟、打完结算', () => {
  const r = exs => W.flatRows(exs)[0];
  const mk = () => {
    const exs = [ex('A', [[60, 8], [60, 8]])];
    exs[0].sets.forEach((st, i) => (st.subSets = [{ id: `d${i}a`, weight: 50, reps: 8 }, { id: `d${i}b`, weight: 40, reps: 8 }]));
    return exs;
  };
  const w = exs => exs[0].sets.map(st => [st.weight, ...st.subSets.map(x => x.weight)].join('/')).join(' ');
  let exs = mk();
  const s0 = exs[0].sets[0];
  // ± / 横拖：一步到位
  assert.equal(w(W.applySetUpdate(exs, r(exs), { subSets: [{ ...s0.subSets[0], weight: 45 }, s0.subSets[1]] })), '60/45/35 60/45/35');
  // 下面那档改过（touched）：不动
  exs = mk();
  exs[0].sets[0].subSets[1].touched = { weight: true };
  const t0 = exs[0].sets[0];
  assert.equal(w(W.applySetUpdate(exs, r(exs), { subSets: [{ ...t0.subSets[0], weight: 45 }, t0.subSets[1]] })).split(' ')[0], '60/45/40');
  // 打字：中途只改这一格，打完按总差值结算
  exs = mk();
  exs = W.applySetUpdate(exs, r(exs), { subSets: [{ ...s0.subSets[0], weight: 45 }, s0.subSets[1]], holdFollow: true });
  assert.equal(w(exs), '60/45/40 60/50/40');
  exs = W.applySetUpdate(exs, r(exs), { followFrom: { kg: 50, sub: 0 } });
  assert.equal(w(exs), '60/45/35 60/45/35');
});

t('loadable：就近取整、等距取轻、不规则片、空杠下限、跨 0、哑铃下限', () => {
  const L = W.L;
  const kg = { unit: 'kg', plates: [25, 20, 15, 10, 5, 2.5, 1.25], bar: 20, inc: 5 };
  // 等距取轻
  assert.equal(L.nearest('plates', 21.25, kg), 20);
  assert.equal(L.nearest('plates', 21.3, kg), 22.5);
  assert.equal(L.nearest('pin', 12.5, kg), 10);
  assert.equal(L.snap('pin', 12.5, kg), 10);
  assert.equal(L.snap('plates', 22.5, kg), 22.5, 'loadable stays');
  assert.equal(L.snap('plain', 12.34, kg), 12.34);
  // 不规则片 [25, 20]：60 往上一下是 70（不是跳到 100）；65 等距取轻 60
  const odd = { ...kg, plates: [25, 20] };
  assert.equal(L.stepTo('plates', 60, 1, 1, odd), 70);
  assert.equal(L.stepTo('plates', 70, -1, 1, odd), 60);
  assert.equal(L.nearest('plates', 65, odd), 60);
  assert.equal(L.isLoadable('plates', 80, odd), false);
  // 杠铃到空杠为止
  assert.equal(L.nearest('plates', 10, kg), 20);
  assert.equal(L.stepTo('plates', 20, -1, 1, kg), 20);
  assert.equal(L.stepTo('plates', 20, 1, 1, kg), 22.5, 'one step = smallest pair');
  // 不在格子上：第一下先落到那个方向最近能挂的
  assert.equal(L.stepTo('plates', 61, 1, 1, kg), 62.5);
  assert.equal(L.stepTo('plates', 61, -1, 1, kg), 60);
  // 带正负：辅助按一档、负重按最小片；跨过 0 不出 -0
  assert.ok(Object.is(L.stepTo('signed', -5, 1, 1, kg), 0));
  assert.equal(L.stepTo('signed', 0, 1, 1, kg), 1.25);
  assert.equal(L.stepTo('signed', 0, -1, 1, kg), -5);
  assert.equal(L.nearest('signed', -7.4, kg), -5);
  // 哑铃：最轻那一对就是下限
  const db = { ...kg, inc: 2.5 };
  assert.equal(L.nearest('pair', 1, db), 2.5);
  assert.equal(L.stepTo('pair', 2.5, -1, 1, db), 2.5);
  assert.equal(L.stepTo('pair', 2.5, 1, 1, db), 5);
});

t('退回只给刚做完的那组', () => {
  let exs = [ex('A', [[50, 10], [50, 10]])];
  exs = tap(exs, 'A1').exs;
  exs = tap(exs, 'A2').exs;
  const r1 = W.flatRows(exs)[0];
  const r2 = W.flatRows(exs)[1];
  assert.equal(W.isJustDone(exs, r1), false);
  assert.equal(W.isJustDone(exs, r2), true);
  assert.equal(read(W.revertSet(exs, r2)), 'A1[D] | A2[p]');
});

t('编辑旧训练点组号：只动被点的这一组，不挪卡、不扫别的组', () => {
  // 练完的训练：记录里的组做完、没有 seq（入册时剥掉）；编辑时在 A 后面加了两组待做
  const rec = (id, sets) => ({ ...ex(id, sets), sets: ex(id, sets).sets.map(({ ghost: _g, ...s }) => ({ ...s, ghost: false })) });
  const base = [rec('A', [[50, 10], [50, 10]]), rec('B', [[20, 12], [20, 12]])];
  base[0].sets.push({ id: 'A3', weight: 55, reps: 8, ghost: true }, { id: 'A4', weight: 0, reps: 0, ghost: true });
  const tapE = (exs, setId) => W.tapSetNumEditing(exs, W.flatRows(exs).find(x => x.setId === setId));
  const ids = exs => exs.map(e => `${e.id}:${e.sets.map(s => s.id).join(',')}`).join(' ');

  // 记录里的组：只选中，数据一点不动
  let r = tapE(base, 'B2');
  assert.equal(r.outcome, 'select');
  assert.equal(r.exs, base);
  // 全零的待做组：点不实
  r = tapE(base, 'A4');
  assert.equal(r.outcome, 'empty');
  assert.equal(r.exs, base);
  // 编辑时加的待做组：原地做完；卡和组的顺序不变，别的组（含指针下面的 B）不动
  r = tapE(base, 'A3');
  assert.equal(r.outcome, 'done');
  assert.equal(ids(r.exs), ids(base));
  const a3 = W.findSet(r.exs, { exId: 'A', setId: 'A3' });
  assert.equal(a3.ghost, false);
  assert.ok(a3.seq > 0, 'tapped-done set gets a seq');
  assert.deepEqual(r.exs[1], base[1]);
  assert.deepEqual(r.exs[0].sets.filter(s => s.id !== 'A3'), base[0].sets.filter(s => s.id !== 'A3'));
  // 这次编辑点实的组（有 seq）再点：退回待做，值保留
  const r2 = tapE(r.exs, 'A3');
  assert.equal(r2.outcome, 'revert');
  const back = W.findSet(r2.exs, { exId: 'A', setId: 'A3' });
  assert.equal(back.ghost, true);
  assert.equal(back.seq, undefined);
  assert.equal(back.weight, 55);
  assert.equal(ids(r2.exs), ids(base));
});

t('带正负的负荷：号按组、没写按动作实例；辅助不算容量', () => {
  const inst = { id: 'X', name: 'X', category: 'STRENGTH', sets: [], instanceConfig: { bodyweightMode: 'weighted' } };
  assert.equal(W.signedKg({ weight: 10, bodyweightMode: 'assisted' }, inst), -10);
  assert.equal(W.signedKg({ weight: 10 }, inst), 10); // 旧数据：组上没写，按实例的负重
  assert.deepEqual(W.fromSignedKg(-5), { weight: 5, bodyweightMode: 'assisted' });
  assert.deepEqual(W.fromSignedKg(0), { weight: 0, bodyweightMode: 'normal' });
  assert.equal(W.setVolumeKg({ weight: 20, reps: 10, bodyweightMode: 'assisted' }, null), 0);
  assert.equal(
    W.setVolumeKg({ weight: 10, reps: 5, bodyweightMode: 'weighted', subSets: [{ weight: 5, reps: 5, bodyweightMode: 'assisted' }] }, null),
    50,
  );
});

t('交替组成员简称：从后往前找别人没有的词，中文 ≤2 字、英文 ≤5 字母', () => {
  assert.deepEqual(W.memberAbbrs(['哑铃卧推', '哑铃飞鸟']), ['卧推', '飞鸟']);
  assert.deepEqual(W.memberAbbrs(['上斜哑铃卧推', '平板哑铃卧推']), ['上斜', '平板']);
  assert.deepEqual(W.memberAbbrs(['内收', '髋外展']), ['内收', '外展']);
  assert.deepEqual(W.memberAbbrs(['引体向上', '双杠臂屈伸']), ['引体', '臂屈']);
  assert.deepEqual(W.memberAbbrs(['杠铃弯举', '绳索下压', '哑铃侧平举']), ['弯举', '下压', '侧平']);
  assert.deepEqual(W.memberAbbrs(['器械推胸', '器械推胸']), ['A', 'B']);
  assert.deepEqual(W.memberAbbrs(['甲乙丙', '甲乙丁']), ['乙丙', '乙丁']); // 词表外的长段：前两个字撞了取末两个字
  assert.deepEqual(W.memberAbbrs(['Dumbbell Bench Press', 'Dumbbell Fly']), ['Press', 'Fly']);
  assert.deepEqual(W.memberAbbrs(['Lat Pulldown', 'Seated Cable Row']), ['Pull.', 'Row']);
  assert.deepEqual(W.memberAbbrs(['Leg Extension', 'Leg Extensions']), ['A', 'B']); // 截短后撞了
});

t('自定义片（按馆的单位存）：20.4 kg 的 45 lb 片、0.5 kg 微调片都按原值参与取整和配片', () => {
  const L = W.L;
  // kg 馆里只有一对 45 lb 片（存 20.4）+ 标准小片：20 杠 + 2×20.4 = 60.8 能挂，不能被当成 20.5 算成 61
  const ctx = { unit: 'kg', plates: [20.4, 5, 2.5, 1.25], bar: 20, inc: 5 };
  assert.ok(L.isLoadable('plates', 60.8, ctx));
  assert.ok(!L.isLoadable('plates', 61, ctx));
  assert.deepEqual(L.sidePlates(20.4, ctx.plates, 'kg'), [20.4]);
  assert.equal(L.snap('plates', 61, ctx), 60.8);
  // 馆里没有 1.25、自带 0.5 kg 微调片：一次加 1 kg（每边 0.5），不是一对 2.5 的 5 kg
  const micro = { unit: 'kg', plates: [20, 10, 5, 2.5, 0.5], bar: 20, inc: 5 };
  assert.equal(L.stepTo('plates', 60, 1, 1, micro), 61);
  // lb 馆的 51 lb 八角片：挂片式器械只算片子，两片 = 102
  assert.ok(L.isLoadable('loaded', 102, { unit: 'lbs', plates: [51, 45, 25], bar: 45, inc: 10 }));
});

t('起拖：走够 20px 且顺着拖动方向的位移大于另一方向；斜着划也认，偏另一方向才放手', () => {
  const S = W.S;
  assert.equal(S.scrubEngage(12, 0), 'wait'); // 原来 12 就起拖，手滑一下就改了重量
  assert.equal(S.scrubEngage(19, 5), 'wait');
  assert.equal(S.scrubEngage(20, 0), 'engage');
  assert.equal(S.scrubEngage(-24, 10), 'engage');
  assert.equal(S.scrubEngage(24, 16), 'engage'); // 拇指斜着划（曾经按 1.5 倍判成放手，这一下什么都不发生）
  assert.equal(S.scrubEngage(22, 21), 'engage');
  assert.equal(S.scrubEngage(20, 20), 'release'); // 正 45° 不归这一格
  assert.equal(S.scrubEngage(4, 30), 'release'); // 翻页
  // 竖拖（配重片大图）：along＝竖向，同一条规则
  assert.equal(S.scrubEngage(30, 8), 'engage');
  assert.equal(S.scrubEngage(8, 30), 'release');
});

t('大图拖动方向：配重片竖拖，其余横拖（用户纠正：纵向排布就竖着滑）', () => {
  const S = W.S;
  assert.equal(S.heroScrubAxis('pin'), 'y');
  for (const k of ['plates', 'loaded', 'pair', 'bell', 'fixed', 'signed', undefined]) assert.equal(S.heroScrubAxis(k), 'x', String(k));
});

t('配重片：最轻一格钉住后改每格，起点不跟着变', () => {
  const L = W.L;
  // 没设最轻一格：下限就是一档（5 → 5、10、15…）
  assert.deepEqual(L.bracket('pin', 7, { unit: 'kg', plates: [], bar: 0, inc: 5 }), { lo: 5, hi: 10 });
  // 每格从 5 改成 2.5、最轻一格按显示的 5 存下（ExerciseCard.setStack 存 s=5）：5、7.5、10…
  assert.deepEqual(L.bracket('pin', 6, { unit: 'kg', plates: [], bar: 0, inc: 2.5, start: 5 }), { lo: 5, hi: 7.5 });
  assert.deepEqual(L.bracket('pin', 3, { unit: 'kg', plates: [], bar: 0, inc: 2.5, start: 5 }), { lo: 5, hi: 5 });
});

t('固定杠铃：杠铃上能选，一根一个总重、按馆的一档走，没有杆重和配片', () => {
  const { A, L } = W;
  assert.deepEqual(A.resistanceChoices('tagBarbell'), ['plates', 'fixedBar']);
  assert.equal(A.effectiveResistance('tagBarbell', undefined, []), 'plates');
  assert.equal(A.effectiveResistance('tagBarbell', 'fixedBar', []), 'fixedBar');
  assert.equal(A.effectiveResistance('tagBarbell', 'stack', []), 'plates'); // 杠铃选不了配重片
  assert.equal(A.effectiveResistance('tagDumbbell', 'fixedBar', []), 'dumbbell'); // 哑铃锁定
  assert.equal(L.profileIn(undefined, 'kg').fixedBar, 2.5);
  assert.equal(L.profileIn(undefined, 'lbs').fixedBar, 5);
  assert.equal(L.profileIn({ ...L.defaultProfile('kg'), fixedBar: undefined }, 'kg').fixedBar, 2.5); // 旧档案没有这一项
  const ctx = { unit: 'kg', plates: [20, 2.5], bar: 20, inc: 2.5 };
  assert.equal(L.snap('fixed', 31, ctx), 30); // 不算杆重、不按片子凑
  assert.equal(L.stepTo('fixed', 30, 1, 1, ctx), 32.5);
  assert.equal(L.stepTo('fixed', 2.5, -1, 1, ctx), 2.5); // 最轻一根就是一档
  assert.equal(L.stepOf('fixed', 30, ctx), 2.5);
});

t('默认片：kg 2.5–20、lb 2.5–45，kg 杠铃一下 5 kg', () => {
  const L = W.L;
  assert.deepEqual(L.defaultProfile('kg').plates, [20, 15, 10, 5, 2.5]);
  assert.deepEqual(L.defaultProfile('lbs').plates, [45, 35, 25, 10, 5, 2.5]);
  const p = L.profileIn(undefined, 'kg');
  assert.equal(L.stepOf('plates', 60, { unit: 'kg', plates: p.plates, bar: 20, inc: 5 }), 5);
});

t('细分多选：region 是主细分，regions 补次要的；拖到别的列换主细分', () => {
  const A = W.A;
  assert.deepEqual(A.regionList({ region: 'legQuad', regions: ['legQuad', 'legGlute'] }), ['legQuad', 'legGlute']);
  assert.deepEqual(A.regionList({ region: 'legGlute', regions: ['legQuad', 'legGlute'] }), ['legGlute', 'legQuad']); // 旧版 APK 只改了 region
  assert.deepEqual(A.regionList({ region: '', regions: ['legQuad'] }), []); // 没有主细分＝未细分
  assert.deepEqual(A.regionList({ region: 'legHam' }), ['legHam']); // 旧数据
  assert.deepEqual(A.regionsPatch(['a', 'b', 'a', '']), { region: 'a', regions: ['a', 'b'] });
  assert.deepEqual(A.regionsPatch([]), { region: '', regions: [] });
  assert.deepEqual(A.movePrimary(['legQuad', 'legGlute'], 'legGlute'), ['legGlute', 'legQuad']);
  assert.deepEqual(A.movePrimary(['legQuad', 'legGlute'], 'legHam'), ['legHam', 'legGlute']); // 拖走＝不在原来那列
  assert.deepEqual(A.movePrimary(['legQuad'], ''), []);
  assert.deepEqual(A.toggleRegion(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(A.toggleRegion(['a', 'b'], 'a'), ['b']); // 去掉主细分，下一个顶上
  assert.deepEqual(A.toggleRegion(['a'], 'a'), ['a']); // 最后一个去不掉
});

t('内置复合动作：主细分是自己部位的，次要细分可以跨部位但都得是存在的细分', () => {
  const X = W.X;
  const all = new Set(Object.values(X.BODY_REGIONS).flat());
  let multi = 0;
  for (const d of X.DEFAULT_EXERCISES) {
    if (!d.regions) continue;
    multi++;
    assert.equal(d.regions[0], d.region, d.id);
    assert.ok(X.BODY_REGIONS[d.bodyPart].includes(d.region), `${d.id}: 主细分 ${d.region} 不在 ${d.bodyPart} 下`);
    for (const r of d.regions) assert.ok(all.has(r), `${d.id}: 没有 ${r} 这个细分`);
    assert.equal(new Set(d.regions).size, d.regions.length, d.id);
  }
  for (const id of Object.keys(X.REGIONS_ALSO)) assert.ok(X.REGION_OF[id], `${id} 没有主细分`);
  assert.ok(multi >= 40, `只有 ${multi} 个动作带次要细分`);
  const dl = X.DEFAULT_EXERCISES.find(d => d.id === 'dl_barbell');
  assert.deepEqual(dl.regions.slice(0, 3), ['backLower', 'legGlute', 'legHam']); // 用户点名：下背 + 臀 + 腿后侧
});

t('跨部位多选：自己部位的排前面，主细分永远是自己部位的', () => {
  const A = W.A;
  const own = ['backLats', 'backLower'];
  assert.deepEqual(A.toggleRegion([], 'legGlute', own), []); // 还没主细分，别的部位的挂不上
  assert.deepEqual(A.toggleRegion(['backLower'], 'legGlute', own), ['backLower', 'legGlute']);
  assert.deepEqual(A.toggleRegion(['backLower', 'legGlute'], 'backLats', own), ['backLower', 'backLats', 'legGlute']);
  assert.deepEqual(A.toggleRegion(['backLower', 'legGlute'], 'backLower', own), ['backLower', 'legGlute']); // 自己部位的最后一个去不掉
  assert.deepEqual(A.toggleRegion(['backLower', 'backLats', 'legGlute'], 'backLower', own), ['backLats', 'legGlute']);
  assert.deepEqual(A.toggleRegion(['backLower', 'legGlute'], 'legGlute', own), ['backLower']);
});

console.log(`== ${n} passed ==`);
