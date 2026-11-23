export type PartOfSpeech = 'verb' | 'noun' | 'adj' | 'adv' | 'phrase' | 'other';

export interface WordCard {
  id: string;
  en: string;
  uz: string;
  pos: PartOfSpeech;
  deck: string;
  phonetic?: string;
  audioUrl?: string;
  example?: string;
  stage: number; // 0..9
  nextReviewAt: number; // epoch ms
  createdAt: number;
  lastReviewedAt?: number;
  correctCount: number;
  wrongCount: number;
  recentDistractors: string[]; // tracks last shown distractors to keep choices fresh
}

export type QuizMode = 'en-to-uz' | 'uz-to-en' | 'audio-to-uz';
export type QuizModePreference = 'auto' | QuizMode;
export type AppTab = 'study' | 'add' | 'library' | 'schedule';

export interface DailyStats {
  todayKey: string; // YYYY-MM-DD
  reviewedToday: number;
  correctToday: number;
  streakDays: number;
  lastActiveKey: string;
}

export interface QuizOption {
  id: string;
  label: string;
  isCorrect: boolean;
}
