#!/usr/bin/env node
/**
 * 工作台「做到哪了」与交替组的逻辑自检（src/utils/workbench.ts、src/utils/load.ts）。
 *
 * e2e 只走原有的点组号 / ±5 路径，跳过、交替组、带正负的负荷它都没测到（假的成功信号：全绿 ≠ 测到了）。
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
      const st = s.ghost ? (s.skipped ? 'S' : 'p') : 'D';
      return `${i === P ? '| ' : ''}${r.setId}[${st}]`;
    })
    .join(' ') + (P === flat.length ? ' |' : '');
};
const done = (exs, setId) => {
  const r = W.flatRows(exs).find(x => x.setId === setId);
  const res = W.markSetDone(exs, r);
  return { exs: W.normalizeGroups(res.exs), suggest: res.suggestPair };
};

console.log('workbench-check');

t('一路往下：指针跟着做完走，默认选中指针下面那组', () => {
  let exs = [ex('A', [[50, 10], [50, 10], [50, 10]]), ex('B', [[20, 12], [20, 12]])];
  assert.equal(W.nextPendingRow(exs).setId, 'A1');
  exs = done(exs, 'A1').exs;
  exs = done(exs, 'A2').exs;
  assert.equal(read(exs), 'A1[D] A2[D] | A3[p] B1[p] B2[p]');
  assert.equal(W.nextPendingRow(exs).setId, 'A3');
});

t('同一张卡里跳着做：那一组挪到指针正下方', () => {
  let exs = [ex('A', [[50, 10], [55, 8], [60, 6]])];
  exs = done(exs, 'A3').exs;
  assert.equal(read(exs), 'A3[D] | A1[p] A2[p]');
});

t('做了一半去做别的：剩下的组跳过，那张卡挪到当前卡下面', () => {
  let exs = [ex('A', [[50, 10], [50, 10], [50, 10]]), ex('B', [[20, 12]]), ex('C', [[30, 15], [30, 15]])];
  exs = done(exs, 'A1').exs;
  exs = done(exs, 'C1').exs;
  assert.equal(read(exs), 'A1[D] A2[S] A3[S] C1[D] | C2[p] B1[p]');
});

t('还没开始就去做别的：不算跳过，那张卡挪到最前面', () => {
  let exs = [ex('A', [[50, 10], [50, 10]]), ex('B', [[20, 12], [20, 12]])];
  exs = done(exs, 'B1').exs;
  assert.equal(read(exs), 'B1[D] | B2[p] A1[p] A2[p]');
});

t('跳回去补做跳过的组：原地做完 + 提示交替；合并后跳过的恢复待做、按轮换排', () => {
  let exs = [ex('A', [[30, 15], [30, 15], [30, 15]]), ex('B', [[60, 15], [60, 15], [60, 15]])];
  exs = done(exs, 'A1').exs;
  exs = done(exs, 'B1').exs; // A2、A3 跳过
  const r = done(exs, 'A2');
  assert.deepEqual(r.suggest, { a: 'A', b: 'B' });
  exs = W.groupExercises(r.exs, ['A', 'B'], { unskip: true });
  // 做完的按实际先后（A1 B1 A2），待做从最后做完那组（A）的下一个动作（B）接着轮
  assert.equal(read(exs), 'A1[D] B1[D] A2[D] | B2[p] A3[p] B3[p]');
});

t('交替组：成员左右移只重排待做，做完的不动；改记到另一个动作', () => {
  let exs = W.groupExercises([ex('A', [[1, 1], [1, 1]]), ex('B', [[2, 2], [2, 2]])], ['A', 'B']);
  assert.equal(read(exs), '| A1[p] B1[p] A2[p] B2[p]');
  exs = done(exs, 'A1').exs;
  exs = W.moveGroupMember(exs, 'B', -1); // 轮换顺序 B, A
  assert.equal(read(exs), 'A1[D] | B1[p] A2[p] B2[p]');
  const r = W.flatRows(exs).find(x => x.setId === 'A2');
  exs = W.moveSetToExercise(exs, r, 'B');
  assert.equal(exs.find(e => e.id === 'B').sets.length, 3);
});

t('移出交替 / 拆开：状态原样带走；只剩一个成员的组自动拆掉', () => {
  let exs = W.groupExercises([ex('A', [[1, 1]]), ex('B', [[2, 2]]), ex('C', [[3, 3]])], ['A', 'B', 'C']);
  exs = done(exs, 'B1').exs;
  exs = W.removeFromGroup(exs, 'B');
  assert.equal(W.buildCards(exs).length, 2);
  assert.equal(exs.find(e => e.id === 'B').sets[0].ghost, false);
  exs = W.removeFromGroup(exs, 'A');
  assert.ok(exs.every(e => !e.altGroup), 'a one-member group should dissolve');
});

t('拖指针：往下经过的做完（全零的记跳过），往上经过的退回待做', () => {
  let exs = [ex('A', [[50, 10], [0, 0], [50, 10]])];
  exs = W.movePointerTo(exs, 'A', 3);
  assert.equal(read(exs), 'A1[D] A2[S] A3[D] |');
  exs = W.movePointerTo(exs, 'A', 1);
  assert.equal(read(exs), 'A1[D] | A2[p] A3[p]');
});

t('退回只给刚做完的那组', () => {
  let exs = [ex('A', [[50, 10], [50, 10]])];
  exs = done(exs, 'A1').exs;
  exs = done(exs, 'A2').exs;
  const r1 = W.flatRows(exs)[0];
  const r2 = W.flatRows(exs)[1];
  assert.equal(W.isJustDone(exs, r1), false);
  assert.equal(W.isJustDone(exs, r2), true);
  assert.equal(read(W.revertSet(exs, r2)), 'A1[D] | A2[p]');
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
