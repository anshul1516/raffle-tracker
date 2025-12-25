export interface ParsedComment {
  commentId: string;
  author: string;
  raw: string;
  spots: number;
  specificSpots: number[];
  randomSpots: number;
  beneficiary: string;
  payer: string;
  isTab: boolean;
  needsReview: boolean;
}

const WORD_NUMBERS: Record<string, number> = {
  // 1–30 (expanded a bit)
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,

  // informal
  a: 1,
  an: 1,
  single: 1,
  couple: 2,
  pair: 2,
  few: 3,
};

const STOP_WORDS = new Set([
  "by",
  "to",
  "for",
  "and",
  "with",
  "on",
  "pls",
  "plz",
  "please",
  "me",
  "sir",
  "senor",
]);

function normalizeName(s: string) {
  return (s || "").replace(/[^a-z0-9_]/gi, "").toLowerCase();
}

function isValidUsernameCandidate(s: string) {
  if (!s) return false;
  if (STOP_WORDS.has(s)) return false;
  return true;
}

/**
 * Key properties:
 * - Random counts are extracted first and removed so they don't become specific spots.
 * - "N spots" means N RANDOM spots (host convention).
 * - Specific spots include ranges, comma lists, and whitespace-separated lists.
 */
export function parseComment(
  body: string,
  author: string,
  commentId: string
): ParsedComment {
  const raw = body;
  let working = body;

  let specificSpots: number[] = [];
  let randomSpots = 0;

  let beneficiary = normalizeName(author);
  let payer = normalizeName(author);
  let isTab = false;
  let needsReview = false;

  // -----------------------------
  // 1) PAYER / TAB DETECTION (improved)
  // -----------------------------
  const payerPatterns: RegExp[] = [
    /tab+b?e?d?\s+by\s+([a-z0-9_-]+)/i, // "tabbed by fuzz"
    /tab+b?e?d?\s+to\s+([a-z0-9_-]+)/i,
    /tab+b?e?d?\s+for\s+([a-z0-9_-]+)/i,
    /tab+b?e?d?\s+([a-z0-9_-]+)/i,     // "tabbed fuzzy"
    /\btab\s+to\s+([a-z0-9_-]+)/i,
    /\btab\s+([a-z0-9_-]+)/i,
    /wff\s+to\s+([a-z0-9_-]+)/i,
    /wff\s+([a-z0-9_-]+)/i,
    /paid\s+by\s+([a-z0-9_-]+)/i,
    /on\s+([a-z0-9_-]+)'?s?\s+tab/i,
    /([a-z0-9_-]+)\s+(?:will\s+)?pay\b/i,
    /([a-z0-9_-]+)\s+is\s+paying\b/i,
  ];

  for (const p of payerPatterns) {
    const m = body.match(p);
    if (m) {
      const cand = normalizeName(m[1]);
      if (isValidUsernameCandidate(cand)) {
        payer = cand;
        isTab = /\b(tab|tabbed|wff|paid by)\b/i.test(body);
        break;
      }
    }
  }

  // If tab keywords appear but payer didn’t resolve, flag review
  if (!isTab && /\b(tab|tabbed|wff)\b/i.test(body)) {
    isTab = true;
    needsReview = true;
  }

  // -----------------------------
  // 2) RANDOM SPOTS EXTRACTION
  // -----------------------------

  // Special rule: "30 spots" => 30 random
  // Also covers "30 spot" (singular)
  for (const m of working.matchAll(/\b(\d+)\s*spots?\b/gi)) {
    randomSpots += parseInt(m[1], 10);
  }
  working = working.replace(/\b(\d+)\s*spots?\b/gi, " ");

  // Numeric randoms: "4 rand", "3 random pls", "2 more randoms"
  for (const m of working.matchAll(
    /(\d+)\s*(?:more\s+|additional\s+)?(?:random|rand|rands|randoms)\b/gi
  )) {
    randomSpots += parseInt(m[1], 10);
  }

  // Word randoms: "one random", "couple randoms", "a random"
  for (const m of working.matchAll(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|a|an|single|couple|pair|few)\s*(?:more\s+|additional\s+)?(?:random|rand|randoms|rands)\b/gi
  )) {
    const w = m[1].toLowerCase();
    randomSpots += WORD_NUMBERS[w] ?? 0;
  }

  // Implicit single random: "another random", "extra random"
  const implicitSingles = working.match(/\b(another|extra)\s+(random|rand)\b/gi);
  if (implicitSingles) randomSpots += implicitSingles.length;

  // Remove random phrases so numbers inside them don’t become specific
  working = working.replace(
    /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|a|an|single|couple|pair|few)\s*(?:more\s+|additional\s+)?(?:random|rand|rands|randoms)\b/gi,
    " "
  );
  working = working.replace(/\b(another|extra)\s+(random|rand)\b/gi, " ");

  // -----------------------------
  // 3) SPECIFIC SPOTS EXTRACTION
  // -----------------------------
  const rangeNums = new Set<number>();

  // Ranges: "4-10"
  for (const m of working.matchAll(/(\d+)\s*-\s*(\d+)/g)) {
    const start = parseInt(m[1], 10);
    const end = parseInt(m[2], 10);
    if (Number.isFinite(start) && Number.isFinite(end) && start <= end) {
      for (let i = start; i <= end; i++) rangeNums.add(i);
    }
  }
  working = working.replace(/(\d+)\s*-\s*(\d+)/g, " ");

  // Labeled singles: "spot 1", "spot #1"
  for (const m of working.matchAll(/\bspot\s*#?(\d+)\b/gi)) {
    specificSpots.push(parseInt(m[1], 10));
  }
  working = working.replace(/\bspot\s*#?\d+\b/gi, " ");

  // Comma lists: "40,161,162"
  for (const m of working.matchAll(/\b(\d+\s*,\s*\d+(?:\s*,\s*\d+)*)\b/g)) {
    const parts = m[1].split(",").map((x) => parseInt(x.trim(), 10));
    for (const n of parts) if (Number.isFinite(n)) specificSpots.push(n);
  }
  working = working.replace(/,/g, " ");

  // Whitespace singles: "1 10 19 24 28"
  for (const m of working.matchAll(/\b\d+\b/g)) {
    const n = parseInt(m[0], 10);
    if (Number.isFinite(n)) specificSpots.push(n);
  }

  for (const n of rangeNums) specificSpots.push(n);

  // Dedup + sort
  specificSpots = Array.from(new Set(specificSpots)).sort((a, b) => a - b);

  // -----------------------------
  // 4) BENEFICIARY (conservative)
  // -----------------------------
  const benMatch = body.match(/\b(?:for|to)\s+([a-z0-9_-]+)\b/i);
  if (benMatch) {
    const cand = normalizeName(benMatch[1]);
    if (isValidUsernameCandidate(cand)) beneficiary = cand;
  }

  // -----------------------------
  // 5) FINAL
  // -----------------------------
  const spots = specificSpots.length + randomSpots;

  if (spots === 0 && /\b(random|rand|spot|spots|#|\d+)\b/i.test(body)) {
    needsReview = true;
  }

  return {
    commentId,
    author: normalizeName(author),
    raw,
    spots,
    specificSpots,
    randomSpots,
    beneficiary,
    payer,
    isTab,
    needsReview,
  };
}
