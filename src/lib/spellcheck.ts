import { DISTRACTOR_POOL } from '../data/distractorPool';

/**
 * Simple Levenshtein edit distance for fuzzy spelling correction.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[n];
}

// Common everyday Uzbek Latin spelling mistakes -> standard Uzbek Latin
const UZBEK_COMMON_FIXES: Record<string, string> = {
  hato: 'xato',
  yahshi: 'yaxshi',
  hohlamoq: 'xohlamoq',
  hohlash: 'xohlash',
  huddi: 'xuddi',
  xamma: 'hamma',
  xam: 'ham',
  xar: 'har',
  xali: 'hali',
  xozir: 'hozir',
  xech: 'hech',
  xaqiqiy: 'haqiqiy',
  xaqiqat: 'haqiqat',
  xayot: 'hayot',
  xarakat: 'harakat',
  xurmat: 'hurmat',
  xavf: 'xavf',
  muhim: 'muhim',
  muxim: 'muhim',
  axamiyat: 'ahamiyat',
  axamiyatli: 'ahamiyatli',
  masalan: 'masalan',
  hullas: 'xullas',
  hursand: 'xursand',
  hizmat: 'xizmat',
  havotir: 'xavotir',
  hotira: 'xotira',
  huquq: 'huquq',
  xuquq: 'huquq',
  inglz: 'ingliz',
  inglizcha: 'inglizcha',
  ozbek: 'o‘zbek',
  ozbekcha: 'o‘zbekcha',
  organmoq: 'o‘rganmoq',
  oqimoq: 'o‘qimoq',
  oylamoq: 'o‘ylamoq',
  ozgarmoq: 'o‘zgarmoq',
  ozgartirmoq: 'o‘zgartirmoq',
  qoshmoq: 'qo‘shmoq',
  qol: 'qo‘l',
  togri: 'to‘g‘ri',
  notogri: 'noto‘g‘ri',
  bolmoq: 'bo‘lmoq',
  korinmoq: 'ko‘rinmoq',
  kormoq: 'ko‘rmoq',
  kop: 'ko‘p',
  soz: 'so‘z',
  yordam: 'yordam',
};

/**
 * Normalizes and auto-corrects Uzbek Latin text:
 * - Standardizes o' -> o‘, g' -> g‘, and apostrophe ’
 * - Fixes common Uzbek spelling errors
 * - Collapses accidental triple letters & extra spaces
 */
export function autoCorrectUzbek(raw: string): {
  text: string;
  changed: boolean;
} {
  const original = raw.trim();
  if (!original) return { text: '', changed: false };

  let text = original
    .replace(/\s+/g, ' ')
    // Collapse accidental 3+ repeated characters (e.g. yugurrmoq -> yugurmoq)
    .replace(/(.)\1{2,}/gi, '$1$1')
    // Normalize Uzbek o‘ and g‘
    .replace(/([ogOG])['`’ʻ]/g, '$1‘')
    // Normalize remaining straight apostrophes to tutuq belgisi ’
    .replace(/([a-zA-Z])['`]([a-zA-Z])/g, '$1’$2');

  // Word-by-word common fix
  text = text
    .split(/(\s+|,\s*)/)
    .map((part) => {
      const lower = part.toLowerCase();
      if (UZBEK_COMMON_FIXES[lower]) {
        const fixed = UZBEK_COMMON_FIXES[lower];
        // Preserve leading capitalization if user capitalized it
        if (part[0] === part[0].toUpperCase() && part[0] !== part[0].toLowerCase()) {
          return fixed[0].toUpperCase() + fixed.slice(1);
        }
        return fixed;
      }
      return part;
    })
    .join('');

  return { text, changed: text !== original };
}

/**
 * Auto-corrects an English word using:
 * 1. Free Dictionary API check (is the word already valid?)
 * 2. Local pool fuzzy check (works offline)
 * 3. Free keyless Datamuse suggestion API (`api.datamuse.com/sug`)
 */
export async function autoCorrectEnglish(raw: string): Promise<{
  text: string;
  changed: boolean;
}> {
  const original = raw.trim().replace(/\s+/g, ' ');
  if (!original) return { text: '', changed: false };

  // Don't auto-rewrite multi-word phrases beyond whitespace cleanup
  if (original.includes(' ')) {
    return { text: original, changed: original !== raw.trim() };
  }

  const lower = original.toLowerCase();

  // 1. Check if it's already in our local pool exactly
  if (DISTRACTOR_POOL.some((p) => p.en.toLowerCase() === lower)) {
    return { text: original, changed: false };
  }

  // 2. Quick check against Free Dictionary API to see if spelling is already valid
  try {
    const dictRes = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lower)}`
    );
    if (dictRes.ok) {
      return { text: original, changed: false };
    }
  } catch {
    // Offline: fall back to local fuzzy pool check
    const localBest = findLocalEnglishMatch(lower);
    if (localBest) {
      return { text: localBest, changed: localBest !== lower };
    }
    return { text: original, changed: false };
  }

  // 3. Not found in dictionary -> ask keyless Datamuse API for spelling suggestions
  try {
    const sugRes = await fetch(
      `https://api.datamuse.com/sug?s=${encodeURIComponent(lower)}&max=6`
    );
    if (sugRes.ok) {
      const suggestions = (await sugRes.json()) as Array<{ word: string }>;
      // Pick the closest single-word suggestion within edit distance <= 2
      let bestWord: string | null = null;
      let bestDist = Infinity;

      for (const s of suggestions) {
        const candidate = s.word.toLowerCase();
        if (candidate.includes(' ')) continue;
        const dist = levenshtein(lower, candidate);
        const maxAllowed = lower.length <= 4 ? 1 : 2;
        if (dist > 0 && dist <= maxAllowed && dist < bestDist) {
          bestDist = dist;
          bestWord = candidate;
        }
      }

      if (bestWord) {
        return { text: bestWord, changed: true };
      }
    }
  } catch {
    // ignore network failure
  }

  // 4. Final fallback: local pool fuzzy match
  const localBest = findLocalEnglishMatch(lower);
  if (localBest) {
    return { text: localBest, changed: true };
  }

  return { text: original, changed: false };
}

function findLocalEnglishMatch(lower: string): string | null {
  const maxAllowed = lower.length <= 4 ? 1 : 2;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const p of DISTRACTOR_POOL) {
    const cand = p.en.toLowerCase();
    if (cand.includes(' ')) continue;
    const d = levenshtein(lower, cand);
    if (d > 0 && d <= maxAllowed && d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  return best;
}
