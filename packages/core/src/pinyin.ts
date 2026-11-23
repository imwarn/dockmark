/**
 * [INPUT]: standalone zero-dependency Hanzi Pinyin initial extractor using Intl.Collator("zh-CN-u-co-pinyin") with fallback map
 * [OUTPUT]: provides pinyinInitials, pinyinStartsWith, and textContainsTokenOrPinyin
 * [POS]: shared CJK initial-letter search matcher in packages/core/src consumed by command-rank.ts and client search predicates
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

const PINYIN_BOUNDARIES: ReadonlyArray<readonly [string, string]> = [
  ["a", "吖"],
  ["b", "八"],
  ["c", "嚓"],
  ["d", "哒"],
  ["e", "妸"],
  ["f", "发"],
  ["g", "旮"],
  ["h", "哈"],
  ["j", "丌"],
  ["k", "咔"],
  ["l", "垃"],
  ["m", "妈"],
  ["n", "拿"],
  ["o", "喔"],
  ["p", "趴"],
  ["q", "七"],
  ["r", "然"],
  ["s", "仨"],
  ["t", "他"],
  ["w", "挖"],
  ["x", "夕"],
  ["y", "丫"],
  ["z", "匝"],
];

// Polyphone candidates (first letter is primary for pinyinInitials) plus
// ultra-common tech/web characters so matching stays reliable even if a
// runtime omits ICU zh-CN pinyin collation data.
const HANZI_INITIAL_OVERRIDES: Readonly<Record<string, string>> = {
  重: "cz",
  行: "xh",
  长: "cz",
  藏: "cz",
  乐: "ly",
  调: "td",
  传: "cz",
  知: "z",
  乎: "h",
  哔: "b",
  哩: "l",
  掘: "j",
  金: "j",
  微: "w",
  信: "x",
  豆: "d",
  瓣: "b",
  淘: "t",
  宝: "b",
  京: "j",
  东: "d",
  百: "b",
  度: "d",
  网: "w",
  易: "y",
  云: "y",
  腾: "t",
  讯: "x",
  阿: "a",
  里: "l",
  小: "x",
  红: "h",
  书: "s",
  站: "z",
  专: "z",
  栏: "l",
  文: "w",
  档: "d",
  工: "g",
  具: "j",
  搜: "s",
  索: "s",
  开: "k",
  源: "y",
  中: "z",
  国: "g",
  前: "q",
  端: "d",
  后: "h",
  设: "s",
  计: "j",
  音: "y",
  视: "s",
  频: "p",
  博: "b",
  客: "k",
  论: "l",
  坛: "t",
  社: "s",
  区: "q",
};

const ALNUM_TOKEN_RE = /^[a-z0-9]+$/;
const HANZI_RE = /[\u3400-\u9fff]/;

function createPinyinCollator(): Intl.Collator | null {
  try {
    if (typeof Intl === "undefined" || typeof Intl.Collator !== "function") return null;
    const collator = new Intl.Collator("zh-CN-u-co-pinyin");
    const valid =
      collator.compare("阿", "八") < 0 &&
      collator.compare("八", "嚓") < 0 &&
      collator.compare("他", "挖") < 0 &&
      collator.compare("夕", "丫") < 0 &&
      collator.compare("丫", "匝") < 0 &&
      collator.compare("知", "匝") >= 0;
    return valid ? collator : null;
  } catch {
    return null;
  }
}

const PINYIN_COLLATOR = createPinyinCollator();
const HANZI_CACHE = new Map<string, string>();

function isHanziCode(code: number) {
  return code >= 0x3400 && code <= 0x9fff;
}

function isAsciiAlnumCode(code: number) {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function resolveHanziInitials(char: string): string {
  const override = HANZI_INITIAL_OVERRIDES[char];
  if (override) return override;

  const cached = HANZI_CACHE.get(char);
  if (cached !== undefined) return cached;

  if (!PINYIN_COLLATOR) {
    HANZI_CACHE.set(char, "");
    return "";
  }

  const firstBoundary = PINYIN_BOUNDARIES[0];
  if (!firstBoundary || PINYIN_COLLATOR.compare(char, firstBoundary[1]) < 0) {
    HANZI_CACHE.set(char, "");
    return "";
  }

  let low = 0;
  let high = PINYIN_BOUNDARIES.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const entry = PINYIN_BOUNDARIES[mid];
    if (!entry) break;
    const cmp = PINYIN_COLLATOR.compare(char, entry[1]);
    if (cmp === 0) {
      HANZI_CACHE.set(char, entry[0]);
      return entry[0];
    }
    if (cmp < 0) high = mid - 1;
    else low = mid + 1;
  }

  const resolved = PINYIN_BOUNDARIES[high]?.[0] ?? "";
  HANZI_CACHE.set(char, resolved);
  return resolved;
}

function extractPinyinSlots(text: string): string[] {
  const slots: string[] = [];
  let prevWasHanzi = false;
  let pendingSpace = false;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);

    if (isHanziCode(code)) {
      const candidates = resolveHanziInitials(text[index] ?? "");
      if (candidates) {
        // Horizontal whitespace strictly between Hanzi stays contiguous so "知乎 专栏" -> "zhzl".
        if (pendingSpace && !prevWasHanzi && slots.length > 0) slots.push(" ");
        pendingSpace = false;
        slots.push(candidates);
        prevWasHanzi = true;
      } else {
        if (slots.length > 0) pendingSpace = true;
        prevWasHanzi = false;
      }
      continue;
    }

    if (isAsciiAlnumCode(code)) {
      if (pendingSpace && slots.length > 0) slots.push(" ");
      pendingSpace = false;
      slots.push((text[index] ?? "").toLowerCase());
      prevWasHanzi = false;
      continue;
    }

    // Newlines and punctuation always break runs; horizontal space may bridge adjacent Hanzi.
    if (code === 32 || code === 9) {
      if (slots.length > 0) pendingSpace = true;
    } else {
      if (slots.length > 0) pendingSpace = true;
      prevWasHanzi = false;
    }
  }

  return slots;
}

function slotsMatchAt(slots: readonly string[], tokenLower: string, start: number): boolean {
  if (start < 0 || start + tokenLower.length > slots.length) return false;
  for (let offset = 0; offset < tokenLower.length; offset += 1) {
    const slot = slots[start + offset];
    const expected = tokenLower[offset];
    if (!slot || !expected || !slot.includes(expected)) return false;
  }
  return true;
}

function slotsContainToken(slots: readonly string[], tokenLower: string): boolean {
  const limit = slots.length - tokenLower.length;
  for (let start = 0; start <= limit; start += 1) {
    if (slotsMatchAt(slots, tokenLower, start)) return true;
  }
  return false;
}

export function pinyinInitials(text: string): string {
  const slots = extractPinyinSlots(text);
  let output = "";
  for (const slot of slots) {
    output += slot[0] ?? "";
  }
  return output;
}

export function pinyinStartsWith(text: string, tokenLower: string): boolean {
  if (!tokenLower || !ALNUM_TOKEN_RE.test(tokenLower) || !HANZI_RE.test(text)) return false;
  if (tokenLower.length === 1) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 6 || trimmed.includes("\n")) return false;
  }
  const slots = extractPinyinSlots(text);
  return slotsMatchAt(slots, tokenLower, 0);
}

export function textContainsTokenOrPinyin(text: string, tokenLower: string): boolean {
  if (!tokenLower) return true;
  if (text.toLocaleLowerCase().includes(tokenLower)) return true;
  if (!ALNUM_TOKEN_RE.test(tokenLower) || !HANZI_RE.test(text)) return false;

  if (tokenLower.length === 1) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 6 || trimmed.includes("\n")) return false;
    const slots = extractPinyinSlots(trimmed);
    return slotsMatchAt(slots, tokenLower, 0);
  }

  const slots = extractPinyinSlots(text);
  return slotsContainToken(slots, tokenLower);
}
