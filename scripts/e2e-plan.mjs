/**
 * e2e 的步骤依赖表与 E2E_ONLY 挑选（e2e-smoke.mjs / e2e-backup.mjs 共用）。
 *
 * 每套用例（主流程 / 带夹具 / 备份）在文件里按执行顺序声明一张表：
 *   [步骤名, 直接前置?, { home }?]
 *   - 直接前置省略＝表里的上一步（一条链）；写 [] ＝不依赖任何步骤
 *   - home：这一步从首页开始、自己导航。跑的时候中间有步骤被跳过、且上一个跑过的步骤不是它的前置时，
 *     先把界面复位到首页（套件给的 reset），免得接着上一步留下的弹层 / 训练页往下走
 * step() 遇到表里没有的名字直接报错 —— 新加用例必须先声明依赖。
 *
 * E2E_ONLY：逗号分隔，每项是名字前缀，或 /正则/（可带 flags）。命中的步骤连同它的前置（递归）一起跑，
 * 其余跳过；一个步骤都没选中的套件整套不起（不开 context、不灌夹具）。
 */

export function parseOnly(raw) {
  return String(raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const m = /^\/(.+)\/([a-z]*)$/.exec(s);
      if (m) {
        const re = new RegExp(m[1], m[2]);
        return { src: s, test: n => re.test(n) };
      }
      return { src: s, test: n => n.startsWith(s) };
    });
}

/**
 * @param {string} label
 * @param {Array<[string, string[]?, {home?: boolean, always?: boolean}?]>} decl
 * @param {ReturnType<typeof parseOnly>} only
 */
export function planSuite(label, decl, only) {
  const names = decl.map(d => d[0]);
  const deps = new Map();
  const opts = new Map();
  decl.forEach(([n, d, o], i) => {
    if (deps.has(n)) throw new Error(`${label}: step "${n}" declared twice`);
    deps.set(n, d ?? (i ? [decl[i - 1][0]] : []));
    opts.set(n, o ?? {});
  });
  for (const [n, ds] of deps) {
    for (const d of ds) {
      if (!deps.has(d)) throw new Error(`${label}: "${n}" depends on unknown step "${d}"`);
      if (names.indexOf(d) > names.indexOf(n)) throw new Error(`${label}: "${n}" depends on "${d}", which runs after it`);
    }
  }
  const closure = n => {
    const out = new Set();
    const stack = [n];
    while (stack.length) {
      for (const d of deps.get(stack.pop())) {
        if (!out.has(d)) {
          out.add(d);
          stack.push(d);
        }
      }
    }
    return out;
  };
  const picked = only.length ? names.filter(n => only.some(f => f.test(n))) : names;
  const run = new Set();
  for (const n of picked) {
    run.add(n);
    for (const d of closure(n)) run.add(d);
  }
  // always：只要这套里有别的步骤要跑就带上（比如「没有请求逃逸到真后端」）
  const always = names.filter(n => opts.get(n).always);
  if (only.length && [...run].some(n => !always.includes(n))) always.forEach(n => run.add(n));
  return {
    label,
    names,
    deps,
    opts,
    closure,
    run,
    picked,
    /** 运行时状态：上一个跑过的步骤、之后有没有跳过 */
    lastRun: null,
    skipped: false,
  };
}

/** 门：返回 false＝跳过；要复位时先调 reset */
export async function enterStep(plan, name, reset) {
  if (!plan.run.has(name)) {
    plan.skipped = true;
    return false;
  }
  const home = plan.opts.get(name).home;
  if (home && plan.skipped && plan.lastRun && !plan.closure(name).has(plan.lastRun) && reset) await reset();
  plan.skipped = false;
  plan.lastRun = name;
  return true;
}

/** 启动时打印挑中了什么、顺带跑了哪些前置 */
export function describeSelection(plans, only) {
  if (!only.length) return;
  console.log(`E2E_ONLY=${only.map(o => o.src).join(',')}`);
  for (const p of plans) {
    if (!p.run.size) {
      console.log(`  ${p.label}: (整套跳过)`);
      continue;
    }
    const extra = p.names.filter(n => p.run.has(n) && !p.picked.includes(n));
    console.log(`  ${p.label}: ${p.run.size} 步 —— 选中 ${p.picked.join(', ') || '(无)'}${extra.length ? `；连带前置 ${extra.join(', ')}` : ''}`);
  }
  console.log('');
}

/** 每步耗时（含截图），收尾时打印最慢的几步 */
export function printSlowest(label, timings, k = 10) {
  if (!timings.length) return;
  const total = timings.reduce((s, t) => s + t.ms, 0);
  console.log(`   ${label}: ${timings.length} 步，步骤合计 ${(total / 1000).toFixed(1)}s；最慢：`);
  for (const t of [...timings].sort((a, b) => b.ms - a.ms).slice(0, k)) console.log(`     ${(t.ms / 1000).toFixed(1).padStart(5)}s  ${t.name}`);
}
