import type { DailyStats, WordCard } from '../types';

const GEMINI_KEY_STORAGE = 'eslabqol_gemini_key_v1';
const GEMINI_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite',
];

export function getGeminiApiKey(): string | null {
  const envKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (envKey && envKey.trim()) return envKey.trim();
  try {
    const saved = localStorage.getItem(GEMINI_KEY_STORAGE);
    return saved && saved.trim() ? saved.trim() : null;
  } catch {
    return null;
  }
}

export function saveGeminiApiKey(key: string | null): void {
  try {
    if (!key || !key.trim()) {
      localStorage.removeItem(GEMINI_KEY_STORAGE);
    } else {
      localStorage.setItem(GEMINI_KEY_STORAGE, key.trim());
    }
  } catch {
    // ignore
  }
}

async function callGemini(prompt: string, jsonMode = false): Promise<string> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API kaliti kiritilmagan.');
  }

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
  };
  if (jsonMode) {
    body.generationConfig = { responseMimeType: 'application/json' };
  }

  let lastErr: Error | null = null;
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
      apiKey
    )}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.status === 503 || res.status === 429 || res.status === 404) {
        lastErr = new Error(`Model ${model} band (${res.status})`);
        continue;
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini xatosi (${res.status}): ${errText.slice(0, 140)}`);
      }

      const data = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('AI bo‘sh javob qaytardi.');
      return text;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr || new Error('AI bilan bog‘lanib bo‘lmadi.');
}

export interface WordFixItem {
  id: string;
  en: string;
  uz: string;
  reason?: string;
}

/**
 * Audits a Unit's words with Gemini AI:
 * - Fixes accidental capitalization (e.g. "Abandon" -> "abandon")
 * - Fixes English & Uzbek spelling mistakes
 */
export async function auditWordsWithAi(
  words: WordCard[]
): Promise<WordFixItem[]> {
  if (words.length === 0) return [];

  const compact = words.map((w) => ({
    id: w.id,
    en: w.en,
    uz: w.uz,
  }));

  const prompt = `You are a strict English-Uzbek dictionary editor.
Inspect this JSON array of vocabulary items. For each item:
1. Convert English words to lowercase unless it is a proper noun (like "Monday", "English"). Fix any English spelling typos.
2. Convert Uzbek translations to lowercase (unless proper noun), normalize Uzbek Latin apostrophes (use o‘ and g‘ and ’), and fix Uzbek spelling typos.
3. Keep the meaning accurate and concise.
4. Return ONLY a JSON array of objects with keys: "id", "en", "uz", "reason" (short Uzbek note if changed, or empty string if unchanged).

Input:
${JSON.stringify(compact)}`;

  const raw = await callGemini(prompt, true);
  const parsed = JSON.parse(raw) as WordFixItem[];
  return Array.isArray(parsed) ? parsed : [];
}

export interface CoachReport {
  levelLabel: string;
  summaryUz: string;
  weakWords: string[];
  tasks: string[];
  challengeWords: string[];
}

/**
 * Evaluates the learner's vocabulary progress, error patterns, and assigns daily tasks.
 */
export async function analyzeProgressWithAi(
  cards: WordCard[],
  stats: DailyStats
): Promise<CoachReport> {
  const sample = cards.slice(0, 60).map((c) => ({
    en: c.en,
    uz: c.uz,
    stage: c.stage,
    correct: c.correctCount,
    wrong: c.wrongCount,
    deck: c.deck,
  }));

  const prompt = `Sen o‘zbek tilida gaplashadigan shaxsiy ingliz tili AI ustozisan. Do‘stona ("sen" deb) va aniq gapir.
Quyidagi o‘quvchi ma’lumotlarini tahlil qil:
- Jami so‘zlar: ${cards.length}
- Bugun takrorlangan: ${stats.reviewedToday} (to‘g‘ri: ${stats.correctToday})
- Ketma-ket kunlar: ${stats.streakDays}
- So‘zlar holati (stage 0=1 soat, 7=1 oy): ${JSON.stringify(sample)}

Faqat JSON formatda javob qaytar:
{
  "levelLabel": "masalan: B1 · Faol o‘rganuvchi",
  "summaryUz": "O‘quvchining hozirgi darajasi, qaysi so‘zlarda qiynalayotgani va nima ustida ishlashi kerakligi haqida 2-3 jumla",
  "weakWords": ["eng ko'p xato qilingan yoki 0-stage dagi 3-5 ta inglizcha so'z"],
  "tasks": ["Aniq bajariladigan 3 ta qisqa vazifa o'zbek tilida"],
  "challengeWords": ["gap tuzish uchun 3 ta inglizcha so'z"]
}`;

  const raw = await callGemini(prompt, true);
  return JSON.parse(raw) as CoachReport;
}

/**
 * Checks user-written English sentences using the assigned challenge words.
 */
export async function checkUserSentencesWithAi(
  userText: string,
  targetWords: string[]
): Promise<string> {
  const prompt = `Sen ingliz tili o‘qituvchisisan. O‘quvchi quyidagi so‘zlardan foydalanib gap(lar) tuzishi kerak edi: ${targetWords.join(
    ', '
  )}.
O‘quvchining yozgani: "${userText}"

O‘zbek tilida ("sen" deb) qisqa va foydali tekshiruv ber:
1. Grammatika va so‘z ishlatilishi to‘g‘rimi?
2. Xato bo‘lsa, to‘g‘ri variantini ko‘rsat.
3. 10 ballik baho qo‘y.`;

  return await callGemini(prompt, false);
}

export interface FillBlankQuestion {
  word: string;
  uz: string;
  sentenceWithBlank: string;
  options: string[];
}

/**
 * Generates fill-in-the-blank context questions for recent 1h/2h units.
 */
export async function generateContextQuizWithAi(
  words: WordCard[]
): Promise<FillBlankQuestion[]> {
  const subset = words.slice(0, 6).map((w) => ({ en: w.en, uz: w.uz }));
  const prompt = `Create 4 short, natural B1-level English fill-in-the-blank sentences using 4 words from this list: ${JSON.stringify(
    subset
  )}.
Replace the target word in the sentence with "____".
Return ONLY a JSON array of 4 objects:
[
  {
    "word": "target english word",
    "uz": "its uzbek meaning",
    "sentenceWithBlank": "Sentence with ____ inside.",
    "options": ["target", "distractor1", "distractor2", "distractor3"]
  }
]`;

  const raw = await callGemini(prompt, true);
  const parsed = JSON.parse(raw) as FillBlankQuestion[];
  return Array.isArray(parsed) ? parsed : [];
}
