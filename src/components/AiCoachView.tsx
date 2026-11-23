import { useState } from 'react';
import { Award, Check, KeyRound, Send, Sparkles } from 'lucide-react';
import type { DailyStats, WordCard } from '../types';
import {
  analyzeProgressWithAi,
  checkUserSentencesWithAi,
  getGeminiApiKey,
  saveGeminiApiKey,
  type CoachReport,
} from '../lib/ai';

interface AiCoachViewProps {
  cards: WordCard[];
  stats: DailyStats;
}

export function AiCoachView({ cards, stats }: AiCoachViewProps) {
  const [hasKey, setHasKey] = useState<boolean>(() => Boolean(getGeminiApiKey()));
  const [keyInput, setKeyInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<CoachReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sentence practice
  const [sentenceInput, setSentenceInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSaveKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;
    saveGeminiApiKey(keyInput.trim());
    setHasKey(true);
    setKeyInput('');
    setError(null);
  };

  const handleAnalyze = async () => {
    if (cards.length === 0) {
      setError('Avval kamida 1 ta so‘z qo‘shing.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await analyzeProgressWithAi(cards, stats);
      setReport(res);
      setFeedback(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI tahlilida xatolik.');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckSentence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sentenceInput.trim() || !report) return;
    setChecking(true);
    setError(null);
    try {
      const reply = await checkUserSentencesWithAi(
        sentenceInput.trim(),
        report.challengeWords
      );
      setFeedback(reply);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tekshirishda xatolik.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="wc-card" aria-label="AI Ustoz">
      <div className="section-header-row" style={{ marginBottom: 12 }}>
        <div>
          <h1 className="section-title" style={{ fontSize: 20 }}>
            AI Ustoz (Nazorat va Vazifalar)
          </h1>
          <p className="section-sub">
            Darajangni aniqlaydi, xato qilayotgan so‘zlaringni topadi va kunlik vazifa beradi
          </p>
        </div>
      </div>

      {!hasKey && (
        <form
          onSubmit={handleSaveKey}
          style={{
            padding: 14,
            borderRadius: 12,
            backgroundColor: 'var(--bg-input)',
            border: '1px solid var(--border-subtle)',
            marginBottom: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            <KeyRound size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Gemini API kalitini kiriting (telefonda 1 marta saqlanadi)
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              className="field-input"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="AQ.Ab8RN6... yoki AIza..."
            />
            <button type="submit" className="btn-green" style={{ whiteSpace: 'nowrap' }}>
              <Check size={15} aria-hidden="true" />
              Saqlash
            </button>
          </div>
        </form>
      )}

      {error && <div className="notice-banner">{error}</div>}

      <button
        type="button"
        className="btn-indigo"
        style={{ width: '100%', minHeight: 46 }}
        disabled={loading}
        onClick={() => void handleAnalyze()}
      >
        <Sparkles size={17} aria-hidden="true" />
        {loading
          ? 'Darajang tahlil qilinmoqda...'
          : report
          ? 'Tahlilni yangilash'
          : 'Darajamni aniqlash va Vazifa olish'}
      </button>

      {report && (
        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="popup-task-card is-ready" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Award size={18} style={{ color: 'var(--accent-green)' }} />
              <strong style={{ fontSize: 16 }}>{report.levelLabel}</strong>
            </div>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              {report.summaryUz}
            </p>
          </div>

          {report.weakWords.length > 0 && (
            <div>
              <div className="field-label">E’tibor berish kerak bo‘lgan so‘zlar:</div>
              <div className="leitner-word-chips">
                {report.weakWords.map((w) => (
                  <span key={w} className="chip is-accent">
                    {w}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="field-label">Bugungi vazifalaring:</div>
            <div className="word-list">
              {report.tasks.map((t, i) => (
                <div key={i} className="word-row-card" style={{ padding: '10px 14px' }}>
                  <span style={{ fontSize: 14 }}>
                    <strong className="mono" style={{ color: 'var(--accent-brand)', marginRight: 8 }}>
                      {i + 1}.
                    </strong>
                    {t}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {report.challengeWords.length > 0 && (
            <form onSubmit={(e) => void handleCheckSentence(e)} className="form-stack">
              <div className="field-label">
                Gap tuzish mashqi ({report.challengeWords.join(', ')}):
              </div>
              <textarea
                className="field-textarea"
                style={{ minHeight: 90, fontFamily: 'var(--font-sans)' }}
                value={sentenceInput}
                onChange={(e) => setSentenceInput(e.target.value)}
                placeholder="Shu so‘zlardan foydalanib 1-2 ta inglizcha gap yoz..."
              />
              <button
                type="submit"
                className="btn-green"
                disabled={checking || !sentenceInput.trim()}
              >
                <Send size={15} aria-hidden="true" />
                {checking ? 'AI tekshirmoqda...' : 'Gapimni tekshirish'}
              </button>
            </form>
          )}

          {feedback && (
            <div className="feedback-box is-ok" style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>
              {feedback}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
