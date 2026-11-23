import type { DailyStats, WordCard } from '../types';

const CARDS_KEY = 'eslabqol_cards_v1';
const STATS_KEY = 'eslabqol_stats_v1';

export function getTodayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function loadCards(): WordCard[] {
  try {
    const raw = localStorage.getItem(CARDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WordCard[]) : [];
  } catch {
    return [];
  }
}

export function saveCards(cards: WordCard[]): void {
  try {
    localStorage.setItem(CARDS_KEY, JSON.stringify(cards));
  } catch {
    // storage quota ignored
  }
}

export function loadStats(): DailyStats {
  const today = getTodayKey();
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) {
      return {
        todayKey: today,
        reviewedToday: 0,
        correctToday: 0,
        streakDays: 0,
        lastActiveKey: '',
      };
    }
    const parsed = JSON.parse(raw) as DailyStats;
    if (parsed.todayKey !== today) {
      return {
        ...parsed,
        todayKey: today,
        reviewedToday: 0,
        correctToday: 0,
      };
    }
    return parsed;
  } catch {
    return {
      todayKey: today,
      reviewedToday: 0,
      correctToday: 0,
      streakDays: 0,
      lastActiveKey: '',
    };
  }
}

export function recordReviewStat(prev: DailyStats, isCorrect: boolean): DailyStats {
  const today = getTodayKey();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = getTodayKey(yesterdayDate);

  let streakDays = prev.streakDays;
  if (prev.lastActiveKey !== today) {
    if (prev.lastActiveKey === yesterday) {
      streakDays = prev.streakDays + 1;
    } else {
      streakDays = 1;
    }
  }

  const next: DailyStats = {
    todayKey: today,
    reviewedToday: prev.todayKey === today ? prev.reviewedToday + 1 : 1,
    correctToday:
      (prev.todayKey === today ? prev.correctToday : 0) + (isCorrect ? 1 : 0),
    streakDays,
    lastActiveKey: today,
  };

  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function exportBackupJson(cards: WordCard[], stats: DailyStats): void {
  const payload = {
    app: 'EslabQol',
    version: 1,
    exportedAt: new Date().toISOString(),
    cards,
    stats,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `eslabqol-zaxira-${getTodayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseBackupJson(text: string): WordCard[] | null {
  try {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : parsed?.cards;
    if (!Array.isArray(list)) return null;
    return list.filter(
      (item): item is WordCard =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.en === 'string' &&
        typeof item.uz === 'string'
    );
  } catch {
    return null;
  }
}
