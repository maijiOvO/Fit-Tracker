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
    contents: "export * from './src/utils/workbench.ts'; export * from './src/utils/load.ts';",
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

t('点组号：刚做完的再点＝退回；更上面的做完组再点＝指针挪回去、后面的退回待做', () => {
  let exs = [ex('A', [[50, 10], [50, 10], [50, 10]])];
  exs = tap(exs, 'A3').exs;
  assert.equal(read(exs), 'A1[D] A2[D] A3[D] |');
  let r = tap(exs, 'A3');
  assert.equal(r.outcome, 'revert');
  assert.equal(read(r.exs), 'A1[D] A2[D] | A3[p]');
  r = tap(exs, 'A1');
  assert.equal(r.outcome, 'moved');
  assert.equal(read(r.exs), 'A1[D] | A2[p] A3[p]');
  assert.equal(r.exs[0].sets[1].weight, 50, 'reverted sets keep their values');
});

t('点组号：改过数的组做完再退回，仍认得改过（结束训练要提醒）；没改过的退回还是底稿', () => {
  let exs = [ex('A', [[50, 10], [50, 10]])];
  exs = fill(exs, 'A1', { weight: 55, touched: { weight: true }, subSets: [{ weight: 40, reps: 8, touched: { reps: true } }] });
  exs = tap(exs, 'A2').exs;
  assert.equal(read(exs), 'A1[D] A2[D] |');
  exs = tap(exs, 'A2').exs; // 退回 A2
  exs = tap(exs, 'A1').exs; // 退回 A1
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

t('交替组成员简称：从后往前找别人没有的字', () => {
  assert.deepEqual(W.memberAbbrs(['内收', '髋外展']), ['收', '展']);
  assert.deepEqual(W.memberAbbrs(['器械推胸', '器械推胸']), ['A', 'B']);
});

console.log(`== ${n} passed ==`);
