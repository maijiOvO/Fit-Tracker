#!/usr/bin/env node
/**
 * 工作台「做到哪了」与交替组的逻辑自检（src/utils/workbench.ts、src/utils/load.ts）。
 *
 * e2e 只走原有的点组号 / ±5 路径，换卡、往回点、交替组、编辑旧训练、带正负的负荷它都没测到（假的成功信号：全绿 ≠ 测到了）。
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
      "export * from './src/utils/workbench.ts'; export * from './src/utils/load.ts'; export * as L from './src/utils/loadable.ts'; export * as S from './src/utils/scrubFeel.ts'; export * as A from './src/utils/exerciseAttrs.ts'; export * as X from './src/constants/exercises.ts'; export * as SW from './src/utils/setWrite.ts'; export * as V from './src/utils/setValues.ts'; export * as P from './src/utils/plates.ts';",
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
/** 点组号：指针挪到这一组正下方 */
const tap = (exs, setId) => {
  const r = W.flatRows(exs).find(x => x.setId === setId);
  const res = W.tapSetNum(exs, r);
  return { exs: W.normalizeGroups(res.exs), outcome: res.outcome };
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

t('做了一半去做别的：那张卡挪到当前卡下面，当前卡剩下的组落在指针上面', () => {
  let exs = [ex('A', [[50, 10], [50, 10], [50, 10]]), ex('B', [[20, 12]]), ex('C', [[30, 15], [30, 15]])];
  exs = tap(exs, 'A1').exs;
  exs = tap(exs, 'C1').exs;
  assert.equal(read(exs), 'A1[D] A2[D] A3[D] C1[D] | C2[p] B1[p]');
});

t('还没开始就去做别的：那张卡挪到最前面', () => {
  let exs = [ex('A', [[50, 10], [50, 10]]), ex('B', [[20, 12], [20, 12]])];
  exs = tap(exs, 'B1').exs;
  assert.equal(read(exs), 'B1[D] | B2[p] A1[p] A2[p]');
});

t('往回点：指针落回那一组正下方，它后面的全部退到指针下面，卡片不挪', () => {
  // 防的错：往回点只选中、指针留在原处（2026-11-23 之前的规则），读数和指针对不上
  let exs = [ex('A', [[30, 15], [30, 15], [30, 15]]), ex('B', [[60, 15], [60, 15], [60, 15]])];
  exs = tap(exs, 'A1').exs;
  exs = tap(exs, 'B1').exs;
  assert.equal(W.doneCount(exs), 4);
  const r = tap(exs, 'A2');
  assert.equal(r.outcome, 'moved');
  assert.equal(read(r.exs), 'A1[D] A2[D] | A3[p] B1[p] B2[p] B3[p]');
  assert.equal(W.doneCount(r.exs), 2);
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

t('拖指针：缝上面的一律算练过（全零的也算），下面的一律退回', () => {
  let exs = [ex('A', [[50, 10], [0, 0], [50, 10]])];
  exs = W.movePointerTo(exs, 'A', 3);
  assert.equal(read(exs), 'A1[D] A2[D] A3[D] |');
  exs = W.movePointerTo(exs, 'A', 1);
  assert.equal(read(exs), 'A1[D] | A2[p] A3[p]');
});

t('拖指针到别的卡的最底：跨卡经过的全做完（含改过数的），doneCount 跟着变', () => {
  // 2026-10-29 练手臂：最早的卡 A 一直待做，B、C 点组号做完 → [B, C, A]
  let exs = [ex('A', [[10, 15], [22, 15], [22, 15], [22, 15]]), ex('B', [[14, 12]]), ex('C', [[9, 12]])];
  exs = tap(exs, 'B1').exs;
  exs = tap(exs, 'C1').exs;
  assert.equal(read(exs), 'B1[D] C1[D] | A1[p] A2[p] A3[p] A4[p]');
  assert.equal(W.doneCount(exs), 2);
  // 落在 A 第 1 组之前 ＝ 指针原位（底下那张卡没露出来时最容易吸到这里）：什么都不变
  assert.equal(read(W.movePointerTo(exs, 'A', 0)), read(exs));
  exs = W.movePointerTo(exs, 'A', 4);
  assert.equal(read(exs), 'B1[D] C1[D] A1[D] A2[D] A3[D] A4[D] |');
  assert.equal(W.doneCount(exs), 6);
  assert.equal(read(W.movePointerTo(exs, 'B', 0)), '| B1[p] C1[p] A1[p] A2[p] A3[p] A4[p]');
});

t('点组号：同一张卡里点下面的组，经过的都算练过（全零的也算）、指针落在它正下方', () => {
  let exs = [ex('A', [[50, 10], [0, 0], [55, 8], [60, 6]]), ex('B', [[20, 12]])];
  const r = tap(exs, 'A3');
  assert.equal(r.outcome, 'moved');
  exs = r.exs;
  assert.equal(read(exs), 'A1[D] A2[D] A3[D] | A4[p] B1[p]');
  assert.equal(W.nextPendingRow(exs).setId, 'A4');
});

t('点组号：指针正上方那组再点＝什么都不变；点更上面的组＝指针跟过去', () => {
  let exs = [ex('A', [[50, 10], [50, 10], [50, 10]])];
  exs = tap(exs, 'A3').exs;
  assert.equal(read(exs), 'A1[D] A2[D] A3[D] |');
  const same = tap(exs, 'A3');
  assert.equal(same.outcome, 'select');
  assert.deepEqual(same.exs, exs);
  const back = tap(exs, 'A1');
  assert.equal(back.outcome, 'moved');
  assert.equal(read(back.exs), 'A1[D] | A2[p] A3[p]');
});

t('用户流程：点 1、点 2，回头点 1 改数 → 指针回到 1–2，只有组 1 变；再点 3 照常前进', () => {
  const r = id => ({ exId: 'A', setId: id });
  const w = exs => exs[0].sets.map(s => s.weight).join(' ');
  let exs = [ex('A', [[20, 10], [20, 10], [20, 10], [20, 10]])];
  exs = tap(exs, 'A1').exs;
  exs = tap(exs, 'A2').exs;
  assert.equal(read(exs), 'A1[D] A2[D] | A3[p] A4[p]');
  exs = tap(exs, 'A1').exs;
  assert.equal(read(exs), 'A1[D] | A2[p] A3[p] A4[p]');
  exs = W.applySetUpdate(exs, r('A1'), { weight: 25 });
  exs = W.applySetUpdate(exs, r('A1'), { reps: 12 });
  assert.equal(w(exs), '25 20 20 20');
  assert.equal(exs[0].sets.map(s => s.reps).join(' '), '12 10 10 10');
  // 打字结算也一样
  exs = W.applySetUpdate(exs, r('A1'), { weight: 30, holdFollow: true });
  exs = W.applySetUpdate(exs, r('A1'), { followFrom: { kg: 25 } });
  assert.equal(w(exs), '30 20 20 20');
  // 改指针下面的组 2：后面的 3、4 也不动
  exs = W.applySetUpdate(exs, r('A2'), { weight: 22.5 });
  assert.equal(w(exs), '30 22.5 20 20');
  exs = tap(exs, 'A3').exs;
  assert.equal(read(exs), 'A1[D] A2[D] A3[D] | A4[p]');
});

t('指针的位置：没点过在第一组上方；点哪组就在哪组正下方（往回点、全零的组、另一张卡都一样）', () => {
  let exs = [ex('A', [[20, 10], [20, 10], [20, 10]]), ex('B', [[0, 0], [30, 8]])];
  const [ka, kb] = W.buildCards(exs).map(c => c.key);
  assert.deepEqual(W.pointerSeam(exs), { cardKey: ka, gap: 0 });
  assert.equal(W.doneCount(exs), 0);
  exs = tap(exs, 'A2').exs;
  assert.deepEqual(W.pointerSeam(exs), { cardKey: ka, gap: 2 });
  exs = tap(exs, 'A1').exs;
  assert.deepEqual(W.pointerSeam(exs), { cardKey: ka, gap: 1 });
  // 另一张卡上没填数的组：指针一样到它下面，读数跟着指针
  exs = tap(exs, 'B1').exs;
  assert.deepEqual(W.pointerSeam(exs), { cardKey: kb, gap: 1 });
  assert.equal(read(exs), 'A1[D] A2[D] A3[D] B1[D] | B2[p]');
  assert.equal(W.doneCount(exs), 4);
});

// ── 递减继承（2026-11-18）─────────────────────────────────────
const chain = exs => exs[0].sets.map(st => [W.signedKg(st, exs[0]), ...(st.subSets ?? []).map(x => W.signedKg(x, exs[0], st))].join('/')).join(' ');
const rA = id => ({ exId: 'A', setId: id });

t('不带正负的卡改重量（补丁带着 bodyweightMode: undefined）：递减档照普通重量平移，不写号、过 0 截住', () => {
  // 防的错：weightFromShown / restoreUpdate 的补丁带 bodyweightMode 键，被当成带正负的平移，档写成辅助、主组降档反而涨
  let exs = [ex('A', [[20, 8]])];
  exs[0].sets[0].subSets = [{ id: 'd1', weight: 10, reps: 8 }];
  exs = W.applySetUpdate(exs, rA('A1'), { weight: 7.5, plateUnit: 'kg', bodyweightMode: undefined });
  assert.equal(chain(exs), '7.5/0');
  assert.equal(exs[0].sets[0].subSets[0].bodyweightMode, undefined);
  exs = W.applySetUpdate(exs, rA('A1'), { weight: 30, bodyweightMode: undefined });
  assert.equal(chain(exs), '30/20');
  assert.equal(exs[0].sets[0].subSets[0].bodyweightMode, undefined);
});

t('平移被 0 截住的档记得本来的差值：母组降下去再升回来，原样回来（不入册）；别的组不动', () => {
  // 防的错：20→10 的递减，母组改成 5 把档截成 0，再改回 20 档成了 15
  let exs = [ex('A', [[20, 8], [10, 8]])];
  exs[0].sets[0].subSets = [{ id: 'd1', weight: 10, reps: 8 }];
  exs = W.applySetUpdate(exs, rA('A1'), { weight: 5 });
  assert.equal(chain(exs), '5/0 10');
  exs = W.applySetUpdate(exs, rA('A1'), { weight: 20 });
  assert.equal(chain(exs), '20/10 10');
  exs = W.applySetUpdate(exs, rA('A1'), { weight: 5 });
  const stripped = W.stripWorkbenchSet(exs[0].sets[0]);
  assert.equal(stripped.subSets[0].want, undefined);
  // 被截住的那一档自己改了数：以后按改的数算，不再回到原来的差值
  exs = W.applySetUpdate(exs, rA('A1'), { subSets: [{ ...exs[0].sets[0].subSets[0], weight: 2, touched: { weight: true } }] });
  exs = W.applySetUpdate(exs, rA('A1'), { weight: 20 });
  assert.equal(chain(exs).split(' ')[0], '20/2');
});

t('手改过的档不跟母组，但母组降到它下面时不翻成递增：贴着母组，母组回去它也回去', () => {
  let exs = [ex('A', [[60, 8]])];
  exs[0].sets[0].subSets = [{ id: 'd1', weight: 45, reps: 8, touched: { weight: true } }, { id: 'd2', weight: 35, reps: 8 }];
  exs = W.applySetUpdate(exs, rA('A1'), { weight: 40 });
  assert.equal(chain(exs), '40/40/15');
  exs = W.applySetUpdate(exs, rA('A1'), { weight: 60 });
  assert.equal(chain(exs), '60/45/35');
  // 递增档反过来：母组升过它时贴着母组
  exs[0].sets[0].subSets = [{ id: 'u1', weight: 70, reps: 8, touched: { weight: true } }];
  exs = W.applySetUpdate(exs, rA('A1'), { weight: 80 });
  assert.equal(chain(exs), '80/80');
});

t('母组只换号（辅助 ⇄ 负重）：自己的递减档保持差值跟过去；别的组不换', () => {
  const a = (id, w, sub) => ({ id, weight: w, reps: 5, ghost: true, bodyweightMode: 'assisted', subSets: [{ id: `${id}d`, weight: sub, reps: 5, bodyweightMode: 'assisted' }] });
  let exs = [{ id: 'A', name: 'A', category: 'STRENGTH', sets: [a('A1', 20, 25), a('A2', 20, 25)] }];
  exs = W.applySetUpdate(exs, rA('A1'), { bodyweightMode: 'weighted' });
  assert.equal(chain(exs), '20/15 -20/-25');
});

t('不带正负的卡：递减档上抄来的旧辅助号在平移时清掉，按看到的数走；带正负的卡照旧按号平移（审查第 19 批）', () => {
  // 防的错：shiftRow 又按「档上有号就带正负」平移 —— 看着是 40 的档，母组 50 → 55 后反倒变成 35，号还一直留着、纪录按 0 比
  const old = (id, w) => ({ id, weight: w, reps: 5, bodyweightMode: 'assisted' });
  let exs = [{ id: 'A', name: 'A', category: 'STRENGTH', sets: [{ id: 'A1', weight: 50, reps: 5, ghost: true, subSets: [old('d1', 40)] }] }];
  exs = W.applySetUpdate(exs, rA('A1'), { weight: 55, bodyweightMode: undefined });
  const [d1] = exs[0].sets[0].subSets;
  assert.equal(d1.weight, 45);
  assert.equal(d1.bodyweightMode, undefined);
  // 改第一档、带下面的档（shiftLowerSubs）：看改的那一档的号认卡，不看下面档自己的旧号
  exs = [{ id: 'A', name: 'A', category: 'STRENGTH', sets: [{ id: 'A1', weight: 60, reps: 5, ghost: true, subSets: [{ id: 'd1', weight: 50, reps: 5 }, old('d2', 40)] }] }];
  exs = W.applySetUpdate(exs, rA('A1'), { subSets: [{ id: 'd1', weight: 45, reps: 5, bodyweightMode: undefined }, old('d2', 40)] });
  const d2 = exs[0].sets[0].subSets[1];
  assert.deepEqual([d2.weight, d2.bodyweightMode], [35, undefined]);
  // 对照：带正负的卡写重量带着号，档按带符号的数平移、号照写（辅助 20 → 15，辅助 25 的档跟到辅助 20）
  const a = { id: 'A1', weight: 20, reps: 5, ghost: true, bodyweightMode: 'assisted', subSets: [old('s1', 25)] };
  exs = W.applySetUpdate([{ id: 'A', name: 'A', category: 'STRENGTH', sets: [a] }], rA('A1'), { weight: 15, bodyweightMode: 'assisted' });
  assert.equal(chain(exs), '-15/-20');
});

t('底稿：不带正负的卡不抄组上的旧号（母组、递减档都清），重量按看到的数；带正负的卡号照抄（审查第 19 批）', () => {
  // 防的错：换了器材 / 关了带正负，没动过的底稿组还记着辅助，入册后纪录一直按 0 比
  const last = { id: 'L', weight: 30, reps: 8, bodyweightMode: 'assisted', plateUnit: 'kg', subSets: [{ id: 'Ld', weight: 35, reps: 6, bodyweightMode: 'assisted' }] };
  const [plain] = W.V.toGhostSets([last], 'p', ['weight', 'reps'], false);
  assert.deepEqual(plain, { id: 'p_0', weight: 30, reps: 8, plateUnit: 'kg', subSets: [{ id: 'p_0_sub0', weight: 35, reps: 6, plateUnit: 'kg' }], ghost: true });
  const [signed] = W.V.toGhostSets([last], 'p', ['weight', 'reps'], true);
  assert.deepEqual([signed.bodyweightMode, signed.subSets[0].bodyweightMode], ['assisted', 'assisted']);
});

t('加一档递减：只加在这一组上，别的组不出现这一档', () => {
  let exs = [ex('A', [[60, 8], [60, 8], [70, 6]])];
  exs = W.applySetUpdate(exs, rA('A1'), { subSets: [{ id: 'n1', weight: 50, reps: 8 }] });
  assert.equal(chain(exs), '60/50 60 70');
});

t('手打的数不在格子上：自己的递减档原样平移，不吸到格子；打的数在格子上才照常吸', () => {
  const snapFor = () => kg => Math.round(kg / 2.5) * 2.5;
  let exs = [ex('A', [[60, 8]])];
  exs[0].sets[0].subSets = [{ id: 'd1', weight: 51, reps: 8 }];
  exs = W.applySetUpdate(exs, rA('A1'), { weight: 61.2, holdFollow: true }, snapFor);
  exs = W.applySetUpdate(exs, rA('A1'), { followFrom: { kg: 60 } }, snapFor);
  assert.equal(chain(exs), '61.2/52.2');
  exs = W.applySetUpdate(exs, rA('A1'), { weight: 65, holdFollow: true }, snapFor);
  exs = W.applySetUpdate(exs, rA('A1'), { followFrom: { kg: 61.2 } }, snapFor);
  assert.equal(chain(exs), '65/55');
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

t('点组号：改过数的组做完再退回，仍认得改过（不再被前面的组带着跟）；没改过的退回还是底稿', () => {
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

t('点组号：全零的组照样能点，指针落到它下面', () => {
  // 防的错：全零的组点了没反应、弹「还没填数」（2026-11-23 起指针只是位置，不看有没有数）
  let exs = [ex('A', [[50, 10], [0, 0], [50, 10]])];
  exs = tap(exs, 'A1').exs;
  const r = tap(exs, 'A2');
  assert.equal(r.outcome, 'moved');
  assert.equal(read(r.exs), 'A1[D] A2[D] | A3[p]');
});

t('点组号：点别的卡 → 那张卡挪到当前卡下面、指针到被点的组；往回点不挪卡；还没开始就挪到最前', () => {
  let exs = [ex('A', [[50, 10], [50, 10], [50, 10]]), ex('B', [[20, 12]]), ex('C', [[30, 15], [30, 15], [30, 15]])];
  exs = tap(exs, 'A1').exs;
  exs = tap(exs, 'C2').exs;
  assert.equal(read(exs), 'A1[D] A2[D] A3[D] C1[D] C2[D] | C3[p] B1[p]');
  const r = tap(exs, 'A2');
  assert.equal(r.outcome, 'moved');
  assert.equal(read(r.exs), 'A1[D] A2[D] | A3[p] C1[p] C2[p] C3[p] B1[p]');

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

t('递减档：改某一档的次数、重量，别的组的同一档都不变', () => {
  const r = exs => W.flatRows(exs)[0];
  let exs = [ex('A', [[60, 8], [60, 8]])];
  exs[0].sets.forEach((st, i) => (st.subSets = [{ id: `d${i}`, weight: 50, reps: 8 }]));
  const s0 = exs[0].sets[0];
  exs = W.applySetUpdate(exs, r(exs), { subSets: [{ ...s0.subSets[0], reps: 6 }] });
  assert.deepEqual(exs[0].sets.map(s => s.subSets[0].reps), [6, 8]);
  exs = W.applySetUpdate(exs, r(exs), { subSets: [{ ...exs[0].sets[0].subSets[0], weight: 45 }] });
  assert.deepEqual(exs[0].sets.map(s => s.subSets[0].weight), [45, 50]);
});

t('改回上次：重量改离默认值才给目标；默认值＝上次的数按今天的馆取整；换算零头、切单位后的同一个重量不算改过', () => {
  // 防的错：没改过也亮「改回上次」（切到 lb 后 60 kg 显示成 132.28）；或改回的是没取整的原数
  const set = (weight, ref) => ({ id: 's', weight, reps: 8, ghost: true, ...(ref ? { prefillRef: ref } : {}) });
  const snap = kg => Math.round(kg / 2.5) * 2.5;
  assert.equal(W.SW.restoreKgOf(set(65), 1, 'kg'), undefined, 'first time: nothing to go back to');
  assert.equal(W.SW.restoreKgOf(set(60, { kg: 60, unit: 'kg' }), 1, 'kg', snap), undefined);
  assert.equal(W.SW.restoreKgOf(set(65, { kg: 60, unit: 'kg' }), 1, 'kg', snap), 60);
  // 上次 22 kg、这家馆只能挂 22.5：默认值是 22.5，停在 22.5 或原数 22 都不算改过；改到 25 就改回 22.5（同馆同片 keep 的除外，见下）
  assert.equal(W.SW.restoreKgOf(set(22.5, { kg: 22, unit: 'kg' }), 1, 'kg', snap), undefined);
  assert.equal(W.SW.restoreKgOf(set(22, { kg: 22, unit: 'kg' }), 1, 'kg', snap), undefined);
  assert.equal(W.SW.restoreKgOf(set(25, { kg: 22, unit: 'kg' }), 1, 'kg', snap), 22.5);
  // 防 C45：同馆同片原样抄的（keep）改回原数 14，不是取整后的 15；换过台的（keep:false）照旧回到格子上
  assert.equal(W.SW.restoreKgOf(set(16, { kg: 14, unit: 'kg', keep: true }), 1, 'kg', snap), 14);
  assert.equal(W.SW.restoreKgOf(set(14, { kg: 14, unit: 'kg', keep: true }), 1, 'kg', snap), undefined);
  assert.equal(W.SW.restoreKgOf(set(25, { kg: 22, unit: 'kg', keep: false }), 1, 'kg', snap), 22.5);
  // 顶栏切到 lb：同一个 60 kg 显示成 132.28，不算改过
  assert.equal(W.SW.restoreKgOf(set(60, { kg: 60, unit: 'kg' }), 1, 'lbs'), undefined);
  // 辅助：上次辅助 20，现在辅助 15 → 改回 −20
  assert.equal(W.SW.restoreKgOf({ ...set(15, { kg: -20, unit: 'kg' }), bodyweightMode: 'assisted' }, -1, 'kg'), -20);
  // 改回的写法：带正负的连号一起写，「改过重量」撤掉、别的格子的标记留着
  const u = W.SW.restoreUpdate({ ...set(15), touched: { weight: true, reps: true } }, -20, true);
  assert.deepEqual(u, { weight: 20, bodyweightMode: 'assisted', touched: { reps: true } });
});

t('入册口径（2026-11 用户定）：有数的组都入册，不论点没点过组号；全零的不入册', () => {
  const s = (patch) => ({ id: 'x', weight: 0, reps: 0, ...patch });
  assert.equal(W.willRecord(s({ weight: 60, reps: 8, ghost: true })), true, 'untapped draft with numbers');
  assert.equal(W.willRecord(s({ weight: 60, reps: 8 })), true, 'done');
  assert.equal(W.willRecord(s({ ghost: true, added: true })), false, 'empty added row');
  assert.equal(W.willRecord(s({ ghost: true, touched: { weight: true } })), false, 'touched but all zero');
  assert.equal(W.willRecord(s({})), false, 'done but all zero');
  assert.equal(W.willRecord(s({ ghost: true, subSets: [{ id: 'd', weight: 0, reps: 5 }] })), true, 'only a drop has numbers');
  // 整场：入册的组数＝有数的组数（刊末页的组数从这里来）；只剩全零组的动作整个不入册；工作台标记剥掉
  const exs = [ex('A', [[60, 8], [60, 8], [0, 0]]), ex('B', [[0, 0]])];
  exs[0].sets[0] = { ...exs[0].sets[0], ghost: false, seq: 5, touched: { reps: true } };
  const rec = W.recordedExercises(exs);
  assert.deepEqual(rec.map(e => e.id), ['A']);
  assert.deepEqual(rec[0].sets.map(x => x.id), ['A1', 'A2']);
  assert.ok(rec[0].sets.every(x => !x.ghost && x.seq === undefined && x.touched === undefined));
});

t('入册口径认速度和自定义记录项（上架审查 C21）：只记速度 / RPE / 坡度的组也入册；seq、want、added、只点了竭都不算数', () => {
  const s = patch => ({ id: 'x', weight: 0, reps: 0, ...patch });
  assert.equal(W.willRecord(s({ speed: 9.5 })), true, 'speed only');
  assert.equal(W.willRecord(s({ custom_高度: 55 })), true, 'custom only');
  assert.equal(W.willRecord(s({ custom_角度: -15 })), true, 'custom may be negative');
  assert.equal(W.willRecord(s({ ghost: true, seq: 1795505657792, want: 60, added: true, toFailure: true })), false, 'non-value fields');
  const run = { id: 'T', name: '跑步机', sets: [{ id: 'T1', weight: 0, reps: 0, speed: 10, ghost: false, seq: 3 }, { id: 'T2', weight: 0, reps: 0, speed: 11, ghost: true, touched: { speed: true } }] };
  const rec = W.recordedExercises([run, ex('B', [[100, 5]])]);
  assert.deepEqual(rec.map(e => e.id), ['T', 'B'], '跑步机整个动作不能被丢');
  assert.equal(rec[0].sets.length, 2);
  assert.ok(rec[0].sets.every(x => x.seq === undefined && x.touched === undefined));
});

t('结束时的计数（上架审查 C20，2026-11-24 用户定）：sets＝会入册的组数，below＝其中还在指针下面的（填了数没点组号）；只存到指针＝只留指针以上的', () => {
  const exs = [
    { id: 'A', name: '卧推', sets: [{ id: 'a0', weight: 60, reps: 8 }, { id: 'a1', weight: 60, reps: 8, ghost: true }, { id: 'a2', weight: 0, reps: 0, ghost: true }] },
    { id: 'B', name: '划船', sets: [{ id: 'b0', weight: 50, reps: 10, ghost: true }] },
  ];
  assert.deepEqual(W.recordTally(exs), { sets: 3, below: 2 });
  const upTo = W.upToPointer(exs);
  assert.deepEqual(upTo.map(e => e.sets.map(s => s.id)), [['a0'], []]);
  assert.deepEqual(W.recordedExercises(upTo).map(e => e.id), ['A'], '指针以上一组都没有的动作不入册');
  assert.deepEqual(W.recordTally([{ id: 'A', name: '卧推', sets: [{ id: 'a0', weight: 60, reps: 8 }] }]), { sets: 1, below: 0 }, '指针到底：不问');
});

t('换做法重铺底稿（上架审查 C43）：卡上有做完 / 改过的行就保留在原位、组数不变，不把新做法上次多出来的组接在后面；全是没动过的底稿才整套换', () => {
  const f = n => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, weight: 50, reps: 5, ghost: true }));
  const done = id => ({ id, weight: 60, reps: 8 });
  const draft = id => ({ id, weight: 60, reps: 8, ghost: true });
  assert.deepEqual(W.refillDraft([done('a'), done('b')], f(4)).map(x => x.id), ['a', 'b']);
  assert.deepEqual(W.refillDraft([draft('a'), draft('b')], f(4)).map(x => x.id), ['f0', 'f1', 'f2', 'f3']);
  assert.deepEqual(W.refillDraft([done('a'), draft('b')], f(3)).map(x => x.id), ['a', 'f1']);
  assert.deepEqual(W.refillDraft([{ ...draft('a'), toFailure: true }, draft('b')], f(2)).map(x => x.id), ['a', 'f1'], '只点了竭也算动过');
  assert.deepEqual(W.refillDraft([{ ...draft('a'), touched: { custom_RPE: true } }, draft('b')], f(2)).map(x => x.id), ['a', 'f1'], '只改了自定义项也算动过');
});

t('底稿 / 添加组只抄开着的记录项（上架审查 gap-2#2、gap-5#1 #2）：关掉的次数、重量不再藏在组里入册；速度和自定义项照抄；改速度记进 touched', () => {
  const last = { id: 'L', weight: 40, reps: 10, duration: 1800, distance: 5, distanceUnit: 'km', speed: 12, custom_坡度: 3, toFailure: true, seq: 9, touched: { reps: true } };
  const cardio = W.V.copyValues(last, ['duration', 'distance', 'speed', 'custom_坡度']);
  assert.deepEqual(cardio, { weight: 0, reps: 0, duration: 1800, distance: 5, distanceUnit: 'km', speed: 12, custom_坡度: 3 });
  assert.deepEqual(W.V.copyValues(last, ['weight', 'reps']), { weight: 40, reps: 10 });
  const ghosts = W.V.toGhostSets([last, { id: 'g', weight: 1, reps: 1, ghost: true }], 'p', ['reps'], false);
  assert.deepEqual(ghosts, [{ id: 'p_0', weight: 0, reps: 10, ghost: true }], '底稿只抄开着的、先滤掉 ghost、力竭不继承');
  assert.deepEqual(W.SW.markTouched({ id: 's', weight: 0, reps: 0, ghost: true }, { speed: 11 }).touched, { speed: true });
  assert.deepEqual(W.SW.markTouched({ id: 's', weight: 0, reps: 0, ghost: true }, { custom_RPE: 8 }).touched, { custom_RPE: true });
});

t('训练中关掉记录项（上架审查 gap-2#2）：目标动作指针以下、没改过的那一格清掉；做完的行、改过的格子、别的动作不动；没变化返回原数组', () => {
  const exs = [
    { id: 'A', name: '农夫行走', sets: [{ id: 'a0', weight: 40, reps: 20, distance: 30 }, { id: 'a1', weight: 40, reps: 20, distance: 30, ghost: true }, { id: 'a2', weight: 40, reps: 25, distance: 30, ghost: true, touched: { reps: true } }] },
    { id: 'B', name: '深蹲', sets: [{ id: 'b0', weight: 100, reps: 5, ghost: true }] },
  ];
  const out = W.V.pruneDraftToMetrics(exs, e => e.name === '农夫行走', ['weight', 'distance']);
  assert.deepEqual(out[0].sets.map(s => s.reps), [20, 0, 25], '做完的不动、没改过的清掉、改过的留着');
  assert.equal(out[1], exs[1], '别的动作原样');
  assert.equal(W.V.pruneDraftToMetrics(exs, e => e.name === '农夫行走', ['weight', 'reps', 'distance']), exs, '没变化不换对象');
});

t('改值只改这一组（2026-11-23 用户定）：重量、次数、时长、正负号，别的组一律不变', () => {
  // 防的错：改第 1 组把后面没动过的组一起带着变（10-15 起的「保持差值」），真机上要逐组改回去
  const r = exs => W.flatRows(exs)[0];
  let exs = [ex('A', [[60, 8], [65, 6], [60, 8]])];
  exs = W.applySetUpdate(exs, r(exs), { weight: 70, touched: { weight: true } });
  exs = W.applySetUpdate(exs, r(exs), { reps: 10 });
  assert.deepEqual(exs[0].sets.map(s => s.weight), [70, 65, 60]);
  assert.deepEqual(exs[0].sets.map(s => s.reps), [10, 6, 8]);
  // 指针上面的组改值同样不带
  exs = [ex('A', [[60, 8], [60, 8]])];
  exs[0].sets[0].ghost = false;
  exs = W.applySetUpdate(exs, r(exs), { weight: 65 });
  assert.deepEqual(exs[0].sets.map(s => s.weight), [65, 60]);
  // 时长
  exs = [ex('A', [[0, 0], [0, 0]])];
  exs[0].sets.forEach(st => (st.duration = 30));
  exs = W.applySetUpdate(exs, r(exs), { duration: 45 });
  assert.deepEqual(exs[0].sets.map(s => s.duration), [45, 30]);
  // 正负号
  exs = [ex('A', [[20, 8], [20, 8]])];
  exs[0].sets.forEach(st => (st.bodyweightMode = 'assisted'));
  exs = W.applySetUpdate(exs, r(exs), { bodyweightMode: 'weighted' });
  assert.deepEqual(exs[0].sets.map(s => s.bodyweightMode), ['weighted', 'assisted']);
});

t('改值带 snapFor：被母组带着平移的递减档吸到能挂的，被改的那组照原样，别的组不动', () => {
  const r = exs => W.flatRows(exs)[0];
  const snap5 = () => kg => Math.round(kg / 5) * 5;
  let exs = [ex('A', [[60, 8], [62, 8]])];
  exs[0].sets[0].subSets = [{ id: 'a1s', weight: 50, reps: 6 }];
  exs[0].sets[1].subSets = [{ id: 'a2s', weight: 52, reps: 6 }];
  exs = W.applySetUpdate(exs, r(exs), { weight: 63 }, snap5);
  assert.deepEqual(exs[0].sets.map(s => s.weight), [63, 62], 'edited set keeps 63');
  assert.equal(exs[0].sets[0].subSets[0].weight, 55, 'own drop 53 → 55');
  assert.equal(exs[0].sets[1].subSets[0].weight, 52);
  // snapFor 返回 null（纯数字的动作）：纯平移
  let plain = [ex('A', [[60, 8]])];
  plain[0].sets[0].subSets = [{ id: 'p1', weight: 51, reps: 6 }];
  plain = W.applySetUpdate(plain, r(plain), { weight: 63 }, () => null);
  assert.equal(plain[0].sets[0].subSets[0].weight, 54);
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

t('改某一档的重量：同一组里下面没改过的档保持差值一起挪，别的组不动；打字中途不带、打完结算', () => {
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
  assert.equal(w(W.applySetUpdate(exs, r(exs), { subSets: [{ ...s0.subSets[0], weight: 45 }, s0.subSets[1]] })), '60/45/35 60/50/40');
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
  assert.equal(w(exs), '60/45/35 60/50/40');
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

t('存的几台：选中的台 → 以前按动作单独设的 → 馆默认；选的台删了＝没选；只有自带器材的画法能存', () => {
  const L = W.L;
  const lb = { id: 'a', v: 5, u: 'lbs', s: 12.5 };
  const kg = { id: 'b', v: 2.5, u: 'kg', s: 5 };
  const own = { v: 10, u: 'lbs' };
  assert.equal(L.machineSpecOf([lb, kg], 'b', own), kg, 'picked rig beats the per-exercise override');
  assert.equal(L.machineSpecOf([lb, kg], '', own), own, 'no pick → the old per-exercise override');
  assert.equal(L.machineSpecOf([lb], 'b', own), own, 'picked rig was deleted → as if not picked');
  assert.equal(L.machineSpecOf([lb], 'b', undefined), undefined, 'nothing → gym default');
  assert.equal(L.machineSpecOf(undefined, 'b', undefined), undefined);
  assert.equal(L.rigListKey('A', { kind: 'pin', equipment: 'tagCable' }), 'A|~stack', 'stack formats are one list per gym');
  assert.equal(L.rigListKey('A', { kind: 'pair' }), 'A|~pair', 'no equipment → by kind');
  assert.equal(L.rigListKey('A', { kind: 'loaded', equipment: 'tagMachine' }), null, 'plate-loaded uses the gym plates');
  assert.equal(L.rigListKey('A', { kind: 'signed', equipment: 'x' }), null);
  assert.equal(L.rigListKey(undefined, { kind: 'pin', equipment: 'tagCable' }), null, 'no gym, nowhere to remember');
  assert.ok(L.sameSpec({ v: 5, u: 'kg' }, { v: 5, u: 'kg', s: 0 }));
  assert.ok(!L.sameSpec({ v: 5, u: 'kg', s: 5 }, { v: 5, u: 'kg' }));
  assert.ok(!L.sameSpec({ v: 5, u: 'kg' }, { v: 5, u: 'lbs' }));
  const prof = { plateUnit: 'lbs', plates: [45], cable: { v: 5, u: 'lbs', s: 12.5 }, machine: { v: 10, u: 'lbs' }, dumbbell: { v: 5, u: 'lbs' } };
  assert.deepEqual(L.gymSpecOf(prof, 'pin', 'cable'), { v: 5, u: 'lbs', s: 12.5 });
  assert.deepEqual(L.gymSpecOf(prof, 'pin', 'machine'), { v: 10, u: 'lbs' });
  assert.deepEqual(L.gymSpecOf(prof, 'bell', 'machine'), { v: 5, u: 'lbs' }, 'old profile without kettlebell → default for its unit');
  // 每格不再限于档位表：15 kg 一格照样落在格子上
  assert.deepEqual(L.bracket('pin', 40, { unit: 'kg', plates: [], bar: 0, inc: 15, start: 5 }), { lo: 35, hi: 50 });
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
  // 编辑时加的组（全零的也一样）：原地并进记录的样子；卡和组的顺序不变，别的组（含后面的 B）不动
  assert.equal(tapE(base, 'A4').outcome, 'moved');
  r = tapE(base, 'A3');
  assert.equal(r.outcome, 'moved');
  assert.equal(ids(r.exs), ids(base));
  const a3 = W.findSet(r.exs, { exId: 'A', setId: 'A3' });
  assert.equal(a3.ghost, false);
  assert.ok(a3.seq > 0, 'tapped-done set gets a seq');
  assert.deepEqual(r.exs[1], base[1]);
  assert.deepEqual(r.exs[0].sets.filter(s => s.id !== 'A3'), base[0].sets.filter(s => s.id !== 'A3'));
  // 这次编辑点实的组（有 seq）选过别的再点回来：只选中，不退回（审查 A3：退回的组保存时会被剥掉）
  const r2 = tapE(tapE(r.exs, 'B1').exs, 'A3');
  assert.equal(r2.outcome, 'select');
  assert.equal(r2.exs, r.exs);
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

t('重量是 0 的组没有号：打正数沿用前面最近一组有重量的号，第 1 组按动作实例', () => {
  // 防的错：0 的组打 5 一律按卡片旧标记记（上一组是辅助 20，这一组打 5 却记成负重 5）
  const e = ex('P', [[20, 8], [0, 8], [0, 8]], { instanceConfig: { bodyweightMode: 'weighted' } });
  e.sets[0].bodyweightMode = 'assisted';
  e.sets[1].bodyweightMode = 'normal';
  assert.equal(W.carrySign(e, e.sets[1]), -1);
  assert.equal(W.carrySign(e, e.sets[2]), -1, '隔着一组 0 也往前找');
  const first = ex('Q', [[0, 8], [10, 8]], { instanceConfig: { bodyweightMode: 'assisted' } });
  assert.equal(W.carrySign(first, first.sets[0]), -1, '第 1 组回落到动作实例');
  // 有重量但没写号的旧数据：照旧按动作实例
  const old = ex('R', [[20, 8], [10, 8]], { instanceConfig: { bodyweightMode: 'weighted' } });
  old.sets[0].bodyweightMode = 'assisted';
  assert.equal(W.carrySign(old, old.sets[1]), 1);
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

t('交替组成员按什么认：同名的（左右分记）带做法起简称，不同名的照旧只按名字（审查 gap-4#2）', () => {
  // 防的错：调用处又只传名字，左右退回 A / B；或者一律传带做法的名字，「哑铃卧推（宽握）⇄哑铃飞鸟」的简称从「卧推」变「宽握」
  const lbl = (cn = true) => m => (m.variantName ? (cn ? `${m.name}（${m.variantName}）` : `${m.name} (${m.variantName})`) : m.name);
  const keys = (ms, cn) => W.memberKeys(ms, m => m.name, lbl(cn));
  const lr = [{ name: '哑铃弯举', variantName: '左' }, { name: '哑铃弯举', variantName: '右' }];
  assert.deepEqual(W.memberAbbrs(keys(lr)), ['左', '右']);
  const en = [{ name: 'Dumbbell Curl', variantName: 'Left' }, { name: 'Dumbbell Curl', variantName: 'Right' }];
  assert.deepEqual(W.memberAbbrs(keys(en, false)), ['Left', 'Right']);
  const bf = [{ name: '哑铃卧推', variantName: '宽握' }, { name: '哑铃飞鸟' }];
  assert.deepEqual(keys(bf), ['哑铃卧推', '哑铃飞鸟']);
  assert.deepEqual(W.memberAbbrs(keys(bf)), ['卧推', '飞鸟']);
});

t('改记：做完的组按先后插回轮换里的位置，入册和拆开后顺序同卡上；改回来回原位；待做的接在末尾（审查 gap-4#4）', () => {
  // 防的错：改记的组一律接在目标末尾，卡上是 a1 b1 a2，入册剥掉 seq 后变成 a1 a2 a3 b1
  const S = (id, seq) => ({ id, weight: 10, reps: 10, ...(seq ? { ghost: false, seq } : { ghost: true }) });
  let exs = [
    { id: 'A', name: 'A', category: 'STRENGTH', altGroup: 'g', sets: [S('a1', 1), S('a2', 3), S('a3')] },
    { id: 'B', name: 'B', category: 'STRENGTH', altGroup: 'g', sets: [S('b1', 2), S('b2', 4), S('b3')] },
  ];
  const ids = (list, id) => list.find(e => e.id === id).sets.map(s => s.id);
  const moved = W.moveSetToExercise(exs, { exId: 'B', setId: 'b1' }, 'A');
  assert.deepEqual(ids(moved, 'A'), ['a1', 'b1', 'a2', 'a3']);
  assert.deepEqual(ids(W.recordedExercises(moved), 'A'), ['a1', 'b1', 'a2', 'a3'], '入册顺序同卡上（a3 有数，照样入册）');
  assert.deepEqual(ids(W.splitGroup(moved, 'g'), 'A'), ['a1', 'b1', 'a2', 'a3']);
  assert.deepEqual(ids(W.moveSetToExercise(moved, { exId: 'A', setId: 'b1' }, 'B'), 'B'), ['b1', 'b2', 'b3'], '改回来回到原位');
  assert.deepEqual(ids(W.moveSetToExercise(exs, { exId: 'B', setId: 'b3' }, 'A'), 'A'), ['a1', 'a2', 'a3', 'b3'], '待做的接在末尾');
});

t('交替组 id：同一毫秒里连着建几千个也不撞（审查 gap-4#5）', () => {
  // 防的错：复制为今天 / 从计划开练在同一个同步循环里建几个组，只靠 3 位随机区分，撞了两组被并成一组
  const ids = Array.from({ length: 3000 }, () => W.newGroupId());
  assert.equal(new Set(ids).size, 3000);
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

/** 去掉换单位前那份（IncSpec.was）和显式的 undefined：换算出来的值照旧比，记没记 was 由专门的用例管 */
const noWas = x => Object.fromEntries(Object.entries(x).filter(([k, v]) => k !== 'was' && v !== undefined));

t('loadable.withPlateUnit：切馆的片子单位，跟着旧片子单位走的各档一起换，单独设成别的单位的保留', () => {
  const L = W.L;
  // 新馆按显示单位 kg 起的档案，切成磅片：五档都没动过 → 就是一份 lb 的默认档案（壶铃 4 kg → 5 lb，不是表里最近的 10 lb）
  const lb = L.withPlateUnit(L.defaultProfile('kg'), 'lbs');
  assert.deepEqual(lb, L.defaultProfile('lbs'));
  // 改过的档按实重取档位表里最近的：哑铃 2 kg ≈ 4.4 lb → 5；已经单独设成 lb 的龙门架原样保留；
  // kg 的机器一档带起始点 → 单位、一档和起始一起换
  const mixed = { ...L.defaultProfile('kg'), dumbbell: { v: 2, u: 'kg' }, cable: { v: 10, u: 'lbs', s: 12.5 }, machine: { v: 5, u: 'kg', s: 10 } };
  const m = L.withPlateUnit(mixed, 'lbs');
  assert.deepEqual(noWas(m.dumbbell), { v: 5, u: 'lbs' });
  assert.deepEqual(m.cable, { v: 10, u: 'lbs', s: 12.5 }, '单独设过的保留');
  assert.equal(m.machine.u, 'lbs');
  assert.equal(m.machine.v, 10);
  assert.equal(m.machine.s, Math.round(10 * 2.20462 * 20) / 20, '起始按实重换算');
  // 换回 kg：刚才跟着换成 lb 的又跟着回来，原本就是 lb 的龙门架照旧不动（它在 lb 馆里是「跟着走」的，所以也换）
  const back = L.withPlateUnit(m, 'kg');
  assert.equal(back.cable.u, 'kg');
  assert.equal(back.machine.u, 'kg');
  // 同单位切同单位：原样
  assert.deepEqual(L.withPlateUnit(mixed, 'kg'), mixed);
  // 旧档案缺壶铃 / 固定杠铃一项：切单位后仍然缺（按默认走），不凭空补出来
  const old = { plateUnit: 'kg', plates: [20, 10], cable: { v: 5, u: 'kg' }, machine: { v: 5, u: 'kg' }, dumbbell: { v: 2.5, u: 'kg' } };
  const o = L.withPlateUnit(old, 'lbs');
  assert.equal('kettlebell' in o, false);
  assert.equal('fixedBar' in o, false);
});

// 防 C48：切片子单位只做单向换算（吸到最近的档位），来回切一次各档就回不到原值
t('loadable.withPlateUnit：磅片馆切成公斤片再切回来，改过的各档原样还原，片子表照旧重置成标准片（上架审查 C48）', () => {
  const L = W.L;
  const p = { ...L.defaultProfile('lbs'), plates: [45, 25, 10, 5, 2.5, 1.25], cable: { v: 5, u: 'lbs', s: 12.5 }, machine: { v: 15, u: 'lbs' }, dumbbell: { v: 2.5, u: 'lbs' } };
  const back = L.withPlateUnit(L.withPlateUnit(p, 'kg'), 'lbs');
  for (const k of ['cable', 'machine', 'dumbbell', 'kettlebell', 'fixedBar']) assert.deepEqual(noWas(back[k]), p[k], k);
  // 还原出来的不再挂着 was；片子表按「换馆重量」D 重置，自定义的 1.25 不回来
  assert.equal(back.cable.was, undefined);
  assert.deepEqual(back.plates, W.P.DEFAULT_PLATES.lbs);
});

// 防 C47：stepTo 探 0.001，比格子经 r2 带来的偏差（≤ 0.005）还小，下一格被认回同一格、± 卡住不动
t('loadable.stepTo：换算过来的短杠、手打三位小数的每格，± 一格一格走，不卡住（上架审查 C47）', () => {
  const L = W.L;
  const kgPlates = L.profileIn(L.defaultProfile('kg'), 'kg').plates;
  const lbPlates = L.profileIn(L.defaultProfile('lbs'), 'lbs').plates;
  const stuckAt = (bars, c0) => {
    const stuck = [];
    for (const [w, bar] of bars) {
      const c = { ...c0, bar };
      const g = L.stepTo('plates', L.stepTo('plates', bar, 1, 1, c), 1, 1, c);
      if (L.stepTo('plates', g, -1, 1, c) >= g) stuck.push(`${w}−`);
      if (L.stepTo('plates', g, 1, 1, c) <= g) stuck.push(`${w}+`);
    }
    return stuck;
  };
  // 公斤短杠在磅片馆：1–30 kg 每 0.5 一根（原来 23 根卡「−」、23 根卡「＋」）；ctx.bar 就是 barWeight 换算出来的值
  const kgBars = Array.from({ length: 59 }, (_, i) => 1 + i * 0.5).map(w => [w, W.P.barWeight({ kind: 'short', weight: w, unit: 'kg' }, 'lbs')]);
  assert.equal(kgBars[18][1], 10 / 0.45359237, '短杠按实重换算、不取整（这正是偏差的来源）');
  assert.deepEqual(stuckAt(kgBars, { unit: 'lbs', plates: lbPlates, inc: 10 }), []);
  // 反方向：10–60 lb 的磅短杠在公斤片馆
  const lbBars = Array.from({ length: 51 }, (_, i) => 10 + i).map(w => [w, W.P.barWeight({ kind: 'short', weight: w, unit: 'lbs' }, 'kg')]);
  assert.deepEqual(stuckAt(lbBars, { unit: 'kg', plates: kgPlates, inc: 5 }), []);
  // 插销手打每格 2.333：往上一格一格走，再原路走回来（原来卡在 7）
  const c = { unit: 'kg', plates: kgPlates, bar: 20, inc: 2.333, start: 0 };
  let x = L.stepTo('pin', 2.333, 1, 1, c);
  const seen = [x];
  for (let i = 0; i < 4; i++) seen.push((x = L.stepTo('pin', x, 1, 1, c)));
  for (let i = 0; i < 4; i++) seen.push((x = L.stepTo('pin', x, -1, 1, c)));
  assert.deepEqual(seen, [4.67, 7, 9.33, 11.67, 14, 11.67, 9.33, 7, 4.67]);
});

t('insertDoneCards：并进工作台的做过的卡插在第一张有待做行的卡前面，指针以上仍全是做过的（上架审查 C04）', () => {
  const ex = (id, sets) => ({ id, name: id, category: 'STRENGTH', sets });
  const done = id => ({ id, weight: 60, reps: 5 });
  const ghost = id => ({ id, weight: 60, reps: 5, ghost: true });
  const base = [ex('A', [done('a1'), ghost('a2')]), ex('B', [ghost('b1')])];
  const Z = [ex('Z', [done('z1'), done('z2')])];
  const r = W.insertDoneCards(base, Z);
  assert.deepEqual(r.map(e => e.id), ['Z', 'A', 'B']);
  assert.equal(W.pointerIndex(r), 3, '直接追加时指针跑到 5，A、B 的待做行被挤到指针上面');
  assert.equal(W.doneCount(r), 3);
  assert.deepEqual(W.nextPendingRow(r), { exId: 'A', setId: 'a2' });
  // 整场都做完了：接在最后
  const full = [ex('A', [done('a1')])];
  assert.deepEqual(W.insertDoneCards(full, Z).map(e => e.id), ['A', 'Z']);
});

console.log(`== ${n} passed ==`);
