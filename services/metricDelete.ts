/**
 * 身体指标整项删除（上架审查 C79）：名字就是指标，删掉这个名字下的全部记录。
 *
 * 一个事务删完（db.deleteMany），全局撤销记成一步。每条立刻记墓碑：personal 同步合并时靠它，
 * 不记的话下次拉取会把服务器上那几条原样合并回来（和单条删除同一个做法）；墓碑也进撤销日志，撤销时一起摘掉。
 * 名字按原样比：「Waist」和「waist」是两项，只删点开的那一项。
 */
import type { Measurement } from '../types';
import { db } from './db';
import { recordTombstone } from './fitlogTombstones';

export async function deleteMetric(measurements: Measurement[], name: string): Promise<void> {
  const ids = measurements.filter(m => m.name === name).map(m => m.id);
  await db.deleteMany('custom_metrics', ids);
  for (const id of ids) recordTombstone('customMetrics', id);
}
