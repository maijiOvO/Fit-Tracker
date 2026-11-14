/** 本场的一张卡，按弹层「×N」的口径认：小写显示名 + 做法 id */
export interface CardKey {
  id: string;
  key: string;
  vid?: string;
}

/**
 * 弹层里点一行「×N」该跳到本场哪张卡（审查 C12）；null＝这一行本场还没有，照常加。
 * 做法行（vid）只认同做法的卡；母行的 ×N 不含有自己一行的做法（skipVids，审查 C1），跳的时候也跳过，和数字对得上。
 * 多张取最后一张：原来再点是往末尾加一张，落点和以前新卡出现的地方一致，也是最近加、多半正在做的那张。
 */
export const cardToRevisit = (cards: readonly CardKey[], key: string, vid: string | undefined, skipVids: readonly string[]): string | null => {
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i];
    if (c.key !== key) continue;
    if (vid ? c.vid === vid : !(c.vid && skipVids.includes(c.vid))) return c.id;
  }
  return null;
};
