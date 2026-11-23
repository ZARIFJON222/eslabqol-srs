import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Gamepad2,
  RotateCcw,
  Sparkles,
  Volume2,
} from 'lucide-react';
import type { WordCard } from '../types';
import { speakEnglish } from '../lib/dictionary';
import {
  generateContextQuizWithAi,
  getGeminiApiKey,
  type FillBlankQuestion,
} from '../lib/ai';

interface MiniGamesViewProps {
  unitName: string;
  words: WordCard[];
  onClose: () => void;
}

type GameKind = 'match' | 'scramble' | 'ai-context';

function shuffle<T>(arr: T[]): T[] {
  const c = [...arr];
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c;
}

export function MiniGamesView({ unitName, words, onClose }: MiniGamesViewProps) {
  const [game, setGame] = useState<GameKind>('match');

  // --- GAME 1: MATCH PAIRS ---
  const [matchRound, setMatchRound] = useState(0);
  const roundWords = useMemo(
    () => shuffle(words).slice(0, 5),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [words, matchRound]
  );
  const leftItems = useMemo(
    () => shuffle(roundWords.map((w) => ({ id: w.id, text: w.en }))),
    [roundWords]
  );
  const rightItems = useMemo(
    () => shuffle(roundWords.map((w) => ({ id: w.id, text: w.uz }))),
    [roundWords]
  );
  const [pickedLeft, setPickedLeft] = useState<string | null>(null);
  const [pickedRight, setPickedRight] = useState<string | null>(null);
  const [matchedIds, setMatchedIds] = useState<string[]>([]);
  const [matchWrongFlash, setMatchWrongFlash] = useState(false);

  const handleMatchPick = (side: 'left' | 'right', id: string) => {
    if (matchedIds.includes(id) || matchWrongFlash) return;

    const nextLeft = side === 'left' ? id : pickedLeft;
    const nextRight = side === 'right' ? id : pickedRight;

    if (side === 'left') {
      setPickedLeft(id);
      const w = words.find((x) => x.id === id);
      if (w) speakEnglish(w.en, w.audioUrl);
    } else {
      setPickedRight(id);
    }

    if (nextLeft && nextRight) {
      if (nextLeft === nextRight) {
        setMatchedIds((prev) => [...prev, nextLeft]);
        setPickedLeft(null);
        setPickedRight(null);
      } else {
        setMatchWrongFlash(true);
        setTimeout(() => {
          setPickedLeft(null);
          setPickedRight(null);
          setMatchWrongFlash(false);
        }, 450);
      }
    }
  };

  const resetMatch = () => {
    setMatchedIds([]);
    setPickedLeft(null);
    setPickedRight(null);
    setMatchRound((r) => r + 1);
  };

  // --- GAME 2: LETTER SCRAMBLE ---
  const scrambleWords = useMemo(
    () => shuffle(words.filter((w) => w.en.replace(/[^a-zA-Z]/g, '').length >= 3)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [words, game]
  );
  const [scrIdx, setScrIdx] = useState(0);
  const currentScramble = scrambleWords[scrIdx % Math.max(1, scrambleWords.length)];
  const targetClean = currentScramble
    ? currentScramble.en.toLowerCase().replace(/\s+/g, '')
    : '';

  const scrambledLetters = useMemo(() => {
    if (!targetClean) return [];
    return shuffle(
      targetClean.split('').map((ch, idx) => ({ key: `${idx}-${ch}`, ch }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentScramble?.id, scrIdx]);

  const [pickedKeys, setPickedKeys] = useState<string[]>([]);
  const builtWord = pickedKeys
    .map((k) => scrambledLetters.find((l) => l.key === k)?.ch || '')
    .join('');
  const isScrambleComplete =
    targetClean.length > 0 && builtWord.length === targetClean.length;
  const isScrambleRight = isScrambleComplete && builtWord === targetClean;

  const handleScrambleTap = (key: string) => {
    if (pickedKeys.includes(key) || isScrambleRight) return;
    const next = [...pickedKeys, key];
    setPickedKeys(next);
    const built = next
      .map((k) => scrambledLetters.find((l) => l.key === k)?.ch || '')
      .join('');
    if (built === targetClean && currentScramble) {
      speakEnglish(currentScramble.en, currentScramble.audioUrl);
    }
  };

  // --- GAME 3: AI FILL-IN-THE-BLANK ---
  const [aiQuestions, setAiQuestions] = useState<FillBlankQuestion[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiIdx, setAiIdx] = useState(0);
  const [aiPicked, setAiPicked] = useState<string | null>(null);

  const loadAiContextGame = async () => {
    if (!getGeminiApiKey()) {
      setAiError('AI o‘yin uchun avval yon menyu yoki AI Ustoz bo‘limidan Gemini API kalitini kiriting.');
      return;
    }
    setAiLoading(true);
    setAiError(null);
    setAiIdx(0);
    setAiPicked(null);
    try {
      const qs = await generateContextQuizWithAi(shuffle(words));
      setAiQuestions(qs);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI savol tuza olmadi.');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <section className="wc-card" aria-label="1-2 soatlik unit o‘yinlari">
      <div className="toolbar-row" style={{ marginBottom: 14 }}>
        <button type="button" className="btn-ghost" onClick={onClose}>
          <ArrowLeft size={15} aria-hidden="true" />
          Orqaga
        </button>
        <span className="chip is-accent">
          <Gamepad2 size={14} aria-hidden="true" />
          {unitName}
        </span>
      </div>

      <div className="pill-switch" style={{ width: '100%', marginBottom: 16 }}>
        <button
          type="button"
          className={`pill-switch-btn ${game === 'match' ? 'is-active' : ''}`}
          style={{ flex: 1 }}
          onClick={() => setGame('match')}
        >
          Juftini top
        </button>
        <button
          type="button"
          className={`pill-switch-btn ${game === 'scramble' ? 'is-active' : ''}`}
          style={{ flex: 1 }}
          onClick={() => {
            setGame('scramble');
            setPickedKeys([]);
          }}
        >
          Harflardan yig‘
        </button>
        <button
          type="button"
          className={`pill-switch-btn ${game === 'ai-context' ? 'is-active' : ''}`}
          style={{ flex: 1 }}
          onClick={() => {
            setGame('ai-context');
            if (aiQuestions.length === 0) void loadAiContextGame();
          }}
        >
          AI Gap
        </button>
      </div>

      {/* GAME 1: MATCH */}
      {game === 'match' && (
        <div>
          <p className="popup-unit-sub" style={{ marginBottom: 12 }}>
            Inglizcha so‘zni va uning o‘zbekcha juftini ketma-ket bosing (SRS vaqti o‘zgarmaydi)
          </p>

          {matchedIds.length === roundWords.length ? (
            <div className="empty-card" style={{ padding: 28 }}>
              <CheckCircle2 size={32} style={{ color: 'var(--accent-green)' }} />
              <div className="empty-title" style={{ fontSize: 19 }}>
                Ajoyib! Barcha juftlar topildi
              </div>
              <button type="button" className="btn-green" onClick={resetMatch}>
                <RotateCcw size={16} aria-hidden="true" />
                Yana o‘ynash
              </button>
            </div>
          ) : (
            <div className="match-grid">
              <div className="match-col">
                {leftItems.map((item) => {
                  const done = matchedIds.includes(item.id);
                  const active = pickedLeft === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={done}
                      className={`match-tile ${done ? 'is-done' : ''} ${
                        active ? 'is-picked' : ''
                      } ${active && matchWrongFlash ? 'is-wrong' : ''}`}
                      onClick={() => handleMatchPick('left', item.id)}
                    >
                      {item.text}
                    </button>
                  );
                })}
              </div>

              <div className="match-col">
                {rightItems.map((item) => {
                  const done = matchedIds.includes(item.id);
                  const active = pickedRight === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={done}
                      className={`match-tile ${done ? 'is-done' : ''} ${
                        active ? 'is-picked' : ''
                      } ${active && matchWrongFlash ? 'is-wrong' : ''}`}
                      onClick={() => handleMatchPick('right', item.id)}
                    >
                      {item.text}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* GAME 2: SCRAMBLE */}
      {game === 'scramble' && currentScramble && (
        <div style={{ textAlign: 'center' }}>
          <p className="popup-unit-sub" style={{ marginBottom: 8 }}>
            O‘zbekcha ma’nosiga qarab inglizcha so‘zni harflardan yig‘ing
          </p>
          <h2 className="quiz-word-text" style={{ fontSize: '1.6rem', marginBottom: 14 }}>
            {currentScramble.uz}
          </h2>

          <div className="scramble-slots">
            {builtWord || '...'}
          </div>

          <div className="scramble-letters">
            {scrambledLetters.map((l) => {
              const used = pickedKeys.includes(l.key);
              return (
                <button
                  key={l.key}
                  type="button"
                  disabled={used}
                  className={`scramble-key ${used ? 'is-used' : ''}`}
                  onClick={() => handleScrambleTap(l.key)}
                >
                  {l.ch}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 14 }}>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setPickedKeys([])}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Tozalash
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => speakEnglish(currentScramble.en, currentScramble.audioUrl)}
            >
              <Volume2 size={15} aria-hidden="true" />
              Eshitish
            </button>
            {isScrambleComplete && (
              <button
                type="button"
                className={isScrambleRight ? 'btn-green' : 'btn-indigo'}
                onClick={() => {
                  setPickedKeys([]);
                  setScrIdx((i) => i + 1);
                }}
              >
                {isScrambleRight ? 'To‘g‘ri! Keyingisi' : 'Keyingi so‘z'}
              </button>
            )}
          </div>
          {isScrambleComplete && !isScrambleRight && (
            <p style={{ color: 'var(--accent-red)', marginTop: 10, fontSize: 13 }}>
              To‘g‘risi: <strong>{targetClean}</strong>
            </p>
          )}
        </div>
      )}

      {/* GAME 3: AI CONTEXT FILL-IN-THE-BLANK */}
      {game === 'ai-context' && (
        <div>
          {aiLoading ? (
            <div className="empty-card" style={{ padding: 28 }}>
              <Sparkles size={26} style={{ color: 'var(--accent-brand)' }} />
              <p className="empty-desc">Gemini AI gaplar tuzmoqda...</p>
            </div>
          ) : aiError ? (
            <div className="notice-banner">{aiError}</div>
          ) : aiQuestions[aiIdx] ? (
            <div>
              <div className="quiz-top-meta">
                <span className="chip is-accent">
                  Gap {aiIdx + 1}/{aiQuestions.length}
                </span>
                <span className="chip">{aiQuestions[aiIdx].uz}</span>
              </div>

              <p
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  marginBottom: 16,
                  lineHeight: 1.5,
                }}
              >
                {aiQuestions[aiIdx].sentenceWithBlank}
              </p>

              <div className="choices-grid">
                {aiQuestions[aiIdx].options.map((opt) => {
                  const isCorrect =
                    opt.toLowerCase() === aiQuestions[aiIdx].word.toLowerCase();
                  const isSelected = aiPicked === opt;
                  let cls = '';
                  if (aiPicked) {
                    if (isCorrect) cls = 'is-correct';
                    else if (isSelected) cls = 'is-wrong';
                    else cls = 'is-dimmed';
                  }
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={Boolean(aiPicked)}
                      className={`choice-card ${cls}`}
                      onClick={() => {
                        setAiPicked(opt);
                        speakEnglish(aiQuestions[aiIdx].word);
                      }}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>

              {aiPicked && (
                <button
                  type="button"
                  className="btn-green"
                  style={{ width: '100%', marginTop: 14 }}
                  onClick={() => {
                    if (aiIdx + 1 < aiQuestions.length) {
                      setAiIdx((i) => i + 1);
                      setAiPicked(null);
                    } else {
                      void loadAiContextGame();
                    }
                  }}
                >
                  {aiIdx + 1 < aiQuestions.length
                    ? 'Keyingi gap'
                    : 'Yangi AI gaplar tuzish'}
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="btn-indigo"
              style={{ width: '100%' }}
              onClick={() => void loadAiContextGame()}
            >
              <Sparkles size={16} aria-hidden="true" />
              AI gap o‘yinini boshlash
            </button>
          )}
        </div>
      )}
    </section>
  );
}
