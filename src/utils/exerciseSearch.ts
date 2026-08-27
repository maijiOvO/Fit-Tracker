/**
 * 动作搜索：分词 + 中英双名 + 拼音（全拼/首字母）+ 中文子序列 + 标签名
 *
 * 纯函数模块，被两处共用：
 *   - useFilteredExercises（动作库全屏页 / 计划页选动作）
 *   - useExercisePickerData（训练页底部选动作弹层）
 *
 * 打分规则（每个 token 取最高命中，token 间 AND，总分为各 token 之和）：
 *   中文名前缀 100 > 中文名包含 82 > 英文名前缀 74 > 英文名包含 66
 *   > 拼音全拼前缀 62 > 全拼包含 56 > 首字母前缀 54 > 首字母包含 48
 *   > 中文子序列 42（如「杠铃卧推」命中「杠铃平板卧推」）
 *   > 标签/部位名包含 30（如「胸」带出所有胸部动作）
 */
import { pinyin } from 'pinyin-pro';

export interface ExerciseSearchEntry {
  /** 中文名（小写） */
  cn: string;
  /** 英文名（小写） */
  en: string;
  /** 中文名拼音全拼（小写，无声调） */
  py: string;
  /** 中文名拼音首字母（小写） */
  pyi: string;
  /** 标签/部位候选：显示名 + 各自拼音全拼/首字母（全小写） */
  tagCandidates: string[];
}

const CJK_RE = /[一-鿿]/;

/** pinyin-pro 结果缓存（动作名 / 标签名数量有限，常驻缓存即可） */
const pinyinCache = new Map<string, { py: string; pyi: string }>();

export function pinyinOf(text: string): { py: string; pyi: string } {
  const cached = pinyinCache.get(text);
  if (cached) return cached;
  let out: { py: string; pyi: string };
  if (!CJK_RE.test(text)) {
    // 无中文：拼音即原文（小写去空格），避免调用开销
    const flat = text.toLowerCase().replace(/\s+/g, '');
    out = { py: flat, pyi: flat };
  } else {
    out = {
      py: pinyin(text, { toneType: 'none', type: 'array' }).join('').toLowerCase(),
      pyi: pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase(),
    };
  }
  pinyinCache.set(text, out);
  return out;
}

export function buildSearchEntry(nameCn: string, nameEn: string, tagNames: string[]): ExerciseSearchEntry {
  const { py, pyi } = pinyinOf(nameCn || '');
  const tagCandidates: string[] = [];
  for (const t of tagNames) {
    if (!t) continue;
    const lower = t.toLowerCase();
    tagCandidates.push(lower);
    const tp = pinyinOf(t);
    if (tp.py && tp.py !== lower) tagCandidates.push(tp.py);
    if (tp.pyi && tp.pyi !== lower) tagCandidates.push(tp.pyi);
  }
  return {
    cn: (nameCn || '').toLowerCase(),
    en: (nameEn || '').toLowerCase(),
    py,
    pyi,
    tagCandidates,
  };
}

/** needle 是否为 hay 的子序列（字符按序出现，可不连续） */
export function isSubsequence(needle: string, hay: string): boolean {
  if (!needle) return true;
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}

export function tokenize(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function scoreToken(entry: ExerciseSearchEntry, tok: string): number {
  if (entry.cn.startsWith(tok)) return 100;
  if (entry.cn.includes(tok)) return 82;
  if (entry.en.startsWith(tok)) return 74;
  if (entry.en.includes(tok)) return 66;
  if (entry.py && entry.py.startsWith(tok)) return 62;
  if (entry.py && entry.py.includes(tok)) return 56;
  if (entry.pyi && entry.pyi.startsWith(tok)) return 54;
  if (entry.pyi && entry.pyi.includes(tok)) return 48;
  if (CJK_RE.test(tok) && isSubsequence(tok, entry.cn)) return 42;
  for (const c of entry.tagCandidates) {
    if (c.includes(tok)) return 30;
  }
  return 0;
}

/** 0 = 不匹配；>0 = 匹配分（越大越靠前） */
export function scoreEntry(entry: ExerciseSearchEntry, tokens: string[]): number {
  if (tokens.length === 0) return 1;
  let total = 0;
  for (const tok of tokens) {
    const s = scoreToken(entry, tok);
    if (s === 0) return 0;
    total += s;
  }
  return total;
}
