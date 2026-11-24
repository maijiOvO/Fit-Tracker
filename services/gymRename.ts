/**
 * 馆改名的两半（首选项里的档案 / 器械设置、库里历史训练上的馆名）一次写完，被杀了下次打开续完（上架审查 C49）。
 *
 * 原来先改首选项、再给每场训练各开一个事务，中间没有「进行中」标记：App 在中途被杀，就停在
 * 「档案已经叫新名字、一部分训练还叫旧名字」，按馆找底稿 / 比纪录从此对不上。
 * 现在：先记标记（localStorage，不进撤销日志），再改首选项，再一个事务整批改训练（db.saveMany），提交后才摘标记。
 * 启动时（useFitlogSync.initApp）有没摘的标记就按顺序续完：两半都是幂等的，重跑不会多改。
 *
 * 残留：标记和首选项都在 localStorage，WebView 若延迟落盘、恰在事务提交后几秒内被杀，可能反过来停在
 * 「库里已改名、首选项没改」。要根治得把标记放进 IndexedDB 和训练同一个事务（新 store），没做。
 */
import type { WorkoutSession } from '../types';
import type { GymProfile } from '../src/utils/loadable';
import { storage, parseJsonOr } from './appStorage';
import { readAppPrefs, recordAppPrefs, renameGymIn } from './appPrefs';
import { db } from './db';
import { undoJournal } from './undoJournal';

/** 没写完的改名，按发生的顺序（连着改两次名时前一条不能被盖掉） */
const KEY = 'fitlog_gym_renames';

export interface GymRename {
  from: string;
  to: string;
  profile: GymProfile;
}

function readMarks(): GymRename[] {
  const raw = parseJsonOr<unknown>(storage.getItem(KEY), []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (m): m is GymRename => !!m && typeof m.from === 'string' && !!m.from && typeof m.to === 'string' && !!m.to && !!m.profile && typeof m.profile === 'object',
  );
}

function writeMarks(list: GymRename[]): void {
  if (list.length) storage.setItem(KEY, JSON.stringify(list));
  else storage.removeItem(KEY);
}

/** 改名开始：先记下来，再改首选项（两笔 localStorage 写放在同一个任务里） */
export function markGymRename(m: GymRename): void {
  writeMarks([...readMarks(), m]);
}

/**
 * from→to 这条（最早那条同名的）连同排在它前面、还挂着的前序改名：A→B 写库失败、标记留着时又改 B→C，
 * 库里那些还叫 A 的训练也得一起改成 C；不然 B→C 摘掉后，下次续 A→B 只会把它们改到已是墓碑的 B 上，再没人改成 C。
 * 只看排在前面的标记：后来又改回 A 再改名的那条，它的训练还没写，不能被这条顺手摘掉。
 */
function lineage(list: GymRename[], m: Pick<GymRename, 'from' | 'to'>): { names: Set<string>; drop: Set<number> } {
  const at = list.findIndex(x => x.from === m.from && x.to === m.to);
  const names = new Set([m.from]);
  const drop = new Set<number>(at < 0 ? [] : [at]);
  for (let grew = true; grew; ) {
    grew = false;
    for (let i = 0; i < at; i++) {
      if (drop.has(i) || !names.has(list[i].to)) continue;
      names.add(list[i].from);
      drop.add(i);
      grew = true;
    }
  }
  return { names, drop };
}

/** 这一条的训练写完了：连同它的前序改名一起摘掉 */
export function unmarkGymRename(m: Pick<GymRename, 'from' | 'to'>): void {
  const list = readMarks();
  const { drop } = lineage(list, m);
  if (!drop.size) return;
  writeMarks(list.filter((_, i) => !drop.has(i)));
}

/** 几次改名串成一条链，按顺序写：前一次还没提交，后一次读库就读不到它改的 */
let chain: Promise<unknown> = Promise.resolve();

/**
 * 把库里还叫 from（或它还挂着的前序旧名，见 lineage）的训练整批改成 to（一个事务），返回写了几场。读库里的，不用 React 状态里的副本。
 * skipId：工作台上进行中的那一场，由 switchGym 改名、随落盘写（审查 A3：不能拿库里的旧副本顶掉它）。
 */
export function renameGymRows(from: string, to: string, skipId?: string): Promise<number> {
  const run = chain.then(async () => {
    const { names } = lineage(readMarks(), { from, to });
    const stamp = new Date().toISOString();
    const rows = (await db.getAll<WorkoutSession>('workouts'))
      .filter(w => !!w.gym && names.has(w.gym) && w.id !== skipId)
      .map(w => ({ ...w, gym: to, updatedAt: stamp }));
    if (rows.length) await db.saveMany('workouts', rows);
    return rows.length;
  });
  chain = run.catch(() => {});
  return run;
}

/**
 * 启动时续完上次没写完的改名，返回续了几条（> 0 时调用方要排一次推送）。
 * 首选项那半：旧名字还不是墓碑就补一次 renameGymIn；训练那半：库里还叫旧名字的整批改掉；都完了才摘标记。
 * 某条写库失败就停在那条，标记留着下次再续。不进撤销日志（系统补写，不是用户这一步）。
 */
export async function resumeGymRenames(): Promise<number> {
  const marks = readMarks();
  if (!marks.length) return 0;
  return undoJournal.withoutJournal(async () => {
    for (const m of marks) {
      const raw = readAppPrefs().appPrefs;
      if (raw?.gyms?.[m.from] !== '') recordAppPrefs(renameGymIn(raw, m.to, m.profile, m.from));
      await renameGymRows(m.from, m.to);
      unmarkGymRename(m);
    }
    return marks.length;
  });
}
