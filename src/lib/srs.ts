import { DISTRACTOR_POOL } from '../data/distractorPool';
import type {
  PartOfSpeech,
  QuizMode,
  QuizModePreference,
  QuizOption,
  WordCard,
} from '../types';

export interface StageSpec {
  stage: number;
  boxNumber: number;
  title: string;
  label: string;
  desc: string;
  intervalMs: number;
  phase: string;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * 7 Visual Leitner Time Boxes (WordCard-inspired):
 * Box 1: Har 1 soatda
 * Box 2: Har 5 soatda
 * Box 3: Har 1 kunda
 * Box 4: Har 3 kunda
 * Box 5: Har 7 kunda
 * Box 6: Har 14 kunda
 * Box 7: Har 1 oyda (Uzoq muddatli xotira)
 */
export const SRS_STAGES: StageSpec[] = [
  {
    stage: 0,
    boxNumber: 1,
    title: 'Har 1 soatda',
    label: '1 soat',
    desc: 'Yangi va qayta o‘rganilayotgan so‘zlar',
    intervalMs: 1 * HOUR,
    phase: '1-bosqich',
  },
  {
    stage: 1,
    boxNumber: 2,
    title: 'Har 5 soatda',
    label: '5 soat',
    desc: 'Birinchi sinovdan o‘tgan so‘zlar',
    intervalMs: 5 * HOUR,
    phase: '2-bosqich',
  },
  {
    stage: 2,
    boxNumber: 3,
    title: 'Har 1 kunda',
    label: '1 kun',
    desc: 'Kunlik mustahkamlash qutisi',
    intervalMs: 1 * DAY,
    phase: '3-bosqich',
  },
  {
    stage: 3,
    boxNumber: 4,
    title: 'Har 3 kunda',
    label: '3 kun',
    desc: 'Esda qola boshlagan so‘zlar',
    intervalMs: 3 * DAY,
    phase: '4-bosqich',
  },
  {
    stage: 4,
    boxNumber: 5,
    title: 'Har 7 kunda',
    label: '7 kun',
    desc: 'Haftalik tekshiruv qutisi',
    intervalMs: 7 * DAY,
    phase: '5-bosqich',
  },
  {
    stage: 5,
    boxNumber: 6,
    title: 'Har 14 kunda',
    label: '14 kun',
    desc: 'Ikki haftalik mustahkam xotira',
    intervalMs: 14 * DAY,
    phase: '6-bosqich',
  },
  {
    stage: 6,
    boxNumber: 7,
    title: 'Har 1 oyda',
    label: '1 oy',
    desc: 'Uzoq muddatli xotiraga muhrlangan so‘zlar',
    intervalMs: 30 * DAY,
    phase: '7-bosqich',
  },
];

export function clampStage(stage: number): number {
  return Math.max(0, Math.min(stage, SRS_STAGES.length - 1));
}

export function getStageSpec(stage: number): StageSpec {
  return SRS_STAGES[clampStage(stage)];
}

export function applyReviewResult(
  card: WordCard,
  isCorrect: boolean,
  chosenDistractors: string[],
  now: number = Date.now(),
  updateSchedule: boolean = true
): WordCard {
  const currentStage = clampStage(card.stage);
  const mergedRecent = [...chosenDistractors, ...(card.recentDistractors || [])].slice(
    0,
    6
  );

  if (!updateSchedule) {
    return {
      ...card,
      stage: currentStage,
      recentDistractors: mergedRecent,
    };
  }

  if (isCorrect) {
    const nextStage = clampStage(currentStage + 1);
    const interval = SRS_STAGES[nextStage].intervalMs;
    return {
      ...card,
      stage: nextStage,
      nextReviewAt: now + interval,
      lastReviewedAt: now,
      correctCount: card.correctCount + 1,
      recentDistractors: mergedRecent,
    };
  }

  // On mistake, return to Box 1 (Har 1 soatda)
  return {
    ...card,
    stage: 0,
    nextReviewAt: now + SRS_STAGES[0].intervalMs,
    lastReviewedAt: now,
    wrongCount: card.wrongCount + 1,
    recentDistractors: mergedRecent,
  };
}

export function isCardDue(card: WordCard, now: number = Date.now()): boolean {
  return card.nextReviewAt <= now;
}

export function getDueCards(
  cards: WordCard[],
  now: number = Date.now(),
  deckFilter?: string
): WordCard[] {
  return cards
    .filter((c) => !deckFilter || deckFilter === 'all' || c.deck === deckFilter)
    .filter((c) => isCardDue(c, now))
    .sort((a, b) => a.nextReviewAt - b.nextReviewAt);
}

export function formatRelativeTimeUz(
  targetMs: number,
  now: number = Date.now()
): string {
  const diff = targetMs - now;
  if (diff <= 0) return 'Vaqti keldi';
  const mins = Math.max(1, Math.round(diff / MIN));
  if (mins < 60) return `${mins} daqiqa qoldi`;
  const hours = Math.round(diff / HOUR);
  if (hours < 24) return `${hours} soat qoldi`;
  const days = Math.round(diff / DAY);
  if (days < 30) return `${days} kun qoldi`;
  const months = Math.round(days / 30);
  return `${months} oy qoldi`;
}

/**
 * Formats a live ticking countdown (e.g. "00:59:42" or "2 kun 14:20:05").
 */
export function formatCountdownUz(
  targetMs: number,
  now: number = Date.now()
): string {
  const diff = targetMs - now;
  if (diff <= 0) return '00:00:00';
  const totalSec = Math.ceil(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const hh = String(hours).padStart(2, '0');
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');

  if (days > 0) {
    return `${days} kun ${hh}:${mm}:${ss}`;
  }
  return `${hh}:${mm}:${ss}`;
}

export function posLabelUz(pos: PartOfSpeech): string {
  switch (pos) {
    case 'verb':
      return 'Fe’l';
    case 'noun':
      return 'Ot';
    case 'adj':
      return 'Sifat';
    case 'adv':
      return 'Ravish';
    case 'phrase':
      return 'Ibora';
    default:
      return 'So‘z';
  }
}

export function inferPartOfSpeech(en: string, uz: string): PartOfSpeech {
  const cleanEn = en.trim().toLowerCase();
  const cleanUz = uz.trim().toLowerCase();

  if (cleanEn.includes(' ')) return 'phrase';
  if (/(moq|ish|uv)\b/.test(cleanUz)) return 'verb';
  if (cleanEn.endsWith('ly') && cleanEn.length > 4) return 'adv';
  if (/(ous|ful|ive|able|ible|less|ic|al|ant|ent)$/.test(cleanEn)) return 'adj';
  if (/(li|siz|dor|chan|kor|iy)\b/.test(cleanUz)) return 'adj';
  return 'noun';
}

export function pickQuizMode(
  card: WordCard,
  preference: QuizModePreference
): QuizMode {
  if (preference !== 'auto') return preference;
  const stage = clampStage(card.stage);
  if (stage <= 1) return 'en-to-uz';
  if (stage <= 4) {
    return (card.correctCount + card.wrongCount) % 2 === 0
      ? 'uz-to-en'
      : 'en-to-uz';
  }
  const r = (card.correctCount + card.wrongCount) % 3;
  if (r === 0) return 'audio-to-uz';
  if (r === 1) return 'uz-to-en';
  return 'en-to-uz';
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalizeText(s: string): string {
  return s.trim().toLowerCase().replace(/[‘’'`]/g, "'");
}

export function generateSmartChoices(
  target: WordCard,
  allUserCards: WordCard[],
  mode: QuizMode
): { options: QuizOption[]; chosenDistractors: string[] } {
  const answerIsEnglish = mode === 'uz-to-en';
  const correctLabel = answerIsEnglish ? target.en : target.uz;
  const correctNorm = normalizeText(correctLabel);
  const recentSet = new Set((target.recentDistractors || []).map(normalizeText));

  interface Candidate {
    label: string;
    norm: string;
    samePos: boolean;
    isFresh: boolean;
  }

  const seen = new Set<string>([correctNorm]);
  const candidates: Candidate[] = [];

  const pushCandidate = (rawLabel: string, pos: PartOfSpeech) => {
    const label = rawLabel.trim();
    const norm = normalizeText(label);
    if (!label || seen.has(norm)) return;
    if (norm.includes(correctNorm) || correctNorm.includes(norm)) return;
    seen.add(norm);
    candidates.push({
      label,
      norm,
      samePos: pos === target.pos,
      isFresh: !recentSet.has(norm),
    });
  };

  for (const c of allUserCards) {
    if (c.id === target.id) continue;
    pushCandidate(answerIsEnglish ? c.en : c.uz, c.pos);
  }
  for (const p of DISTRACTOR_POOL) {
    pushCandidate(answerIsEnglish ? p.en : p.uz, p.pos);
  }

  const tier1 = shuffle(candidates.filter((c) => c.samePos && c.isFresh));
  const tier2 = shuffle(candidates.filter((c) => !c.samePos && c.isFresh));
  const tier3 = shuffle(candidates.filter((c) => c.samePos && !c.isFresh));
  const tier4 = shuffle(candidates.filter((c) => !c.samePos && !c.isFresh));

  const ordered = [...tier1, ...tier2, ...tier3, ...tier4];
  const distractors = ordered.slice(0, 3).map((c) => c.label);

  const options: QuizOption[] = shuffle([
    { id: 'correct', label: correctLabel, isCorrect: true },
    ...distractors.map((label, idx) => ({
      id: `d-${idx}`,
      label,
      isCorrect: false,
    })),
  ]);

  return { options, chosenDistractors: distractors };
}
