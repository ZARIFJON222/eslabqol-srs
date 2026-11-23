import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  FolderPlus,
  Headphones,
  Lock,
  Play,
  Sparkles,
  Square,
  Volume2,
  XCircle,
} from 'lucide-react';
import type { QuizMode, QuizOption, WordCard } from '../types';
import {
  SRS_STAGES,
  clampStage,
  formatCountdownUz,
  generateSmartChoices,
  getStageSpec,
  pickQuizMode,
} from '../lib/srs';
import { speakEnglish } from '../lib/dictionary';

interface StudyViewProps {
  cards: WordCard[];
  decks: string[];
  initialDeck?: string;
  onSelectDeck?: (deck: string) => void;
  onAnswer: (
    cardId: string,
    isCorrect: boolean,
    chosenDistractors: string[]
  ) => void;
  onCompleteUnitLevel: (unitName: string, currentStage: number) => void;
  onGoAdd: () => void;
  onLoadSample: () => void;
}

interface UnitCardGroup {
  unitName: string;
  stage: number;
  levelLabel: string;
  nextLevelLabel: string;
  intervalMs: number;
  cards: WordCard[];
  dueAtMs: number; // Strict time when this unit becomes ready
  lockAtMs: number; // Strict deadline: if ignored past (dueAtMs + intervalMs), it locks all other time frames!
  isReady: boolean;
  isLockingOthers: boolean; // True when overdue past lockAtMs (e.g. 7-day unit ignored for 2 weeks)
  overdueDurationMs: number;
}

export function StudyView({
  cards,
  onAnswer,
  onCompleteUnitLevel,
  onGoAdd,
  onLoadSample,
}: StudyViewProps) {
  const [selectedLevel, setSelectedLevel] = useState<number | 'all'>('all');
  const [expandedUnit, setExpandedUnit] = useState<string | null>(null);
  const [roadReaderOpen, setRoadReaderOpen] = useState<boolean>(false);
  const [autoPlaying, setAutoPlaying] = useState<boolean>(false);
  const [activeAudioWordId, setActiveAudioWordId] = useState<string | null>(
    null
  );
  const [now, setNow] = useState<number>(() => Date.now());
  const autoPlayTimerRef = useRef<number | null>(null);

  // Active Unit Quiz session state
  const [activeQuizUnit, setActiveQuizUnit] = useState<UnitCardGroup | null>(
    null
  );
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [initialQueueSize, setInitialQueueSize] = useState<number>(0);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [questionNonce, setQuestionNonce] = useState(0);

  // Live 1-second ticker for strict reverse countdowns & lock timers
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /**
   * Groups words by Unit (`deck`).
   * - Each Unit has its own strict timer (`dueAtMs`) and strict lock deadline (`lockAtMs = dueAtMs + intervalMs`).
   * - Units move from Time Frame to Time Frame like train cars (catching up if an earlier frame is empty or waiting).
   * - If a Unit is neglected past `lockAtMs` (e.g., a 7-day unit sits untouched for 2 weeks),
   *   `isLockingOthers` becomes true and blocks all other Time Frames until completed!
   */
  const unitCards = useMemo<UnitCardGroup[]>(() => {
    const map = new Map<string, WordCard[]>();
    for (const c of cards) {
      const list = map.get(c.deck);
      if (list) list.push(c);
      else map.set(c.deck, [c]);
    }

    const groups: UnitCardGroup[] = [];
    for (const [unitName, unitWords] of map.entries()) {
      const stage = clampStage(unitWords[0].stage);
      const spec = getStageSpec(stage);
      const nextSpec = getStageSpec(clampStage(stage + 1));

      // Strict due timestamp for this unit
      const dueAtMs = Math.min(...unitWords.map((w) => w.nextReviewAt));
      // Strict discipline lock deadline: if due and neglected for another full interval
      // (e.g. 7-day unit not done after 14 days / 2 weeks total, or 1-hour unit not done after 2 hours total)
      const lockAtMs = dueAtMs + spec.intervalMs;
      const isReady = now >= dueAtMs;
      const isLockingOthers = now >= lockAtMs;
      const overdueDurationMs = Math.max(0, now - dueAtMs);

      groups.push({
        unitName,
        stage,
        levelLabel: spec.label,
        nextLevelLabel: nextSpec.label,
        intervalMs: spec.intervalMs,
        cards: unitWords,
        dueAtMs,
        lockAtMs,
        isReady,
        isLockingOthers,
        overdueDurationMs,
      });
    }

    // Sort: Locking/Overdue units first, then Ready units, then by soonest countdown
    groups.sort((a, b) => {
      if (a.isLockingOthers !== b.isLockingOthers) {
        return a.isLockingOthers ? -1 : 1;
      }
      if (a.isReady !== b.isReady) return a.isReady ? -1 : 1;
      return a.dueAtMs - b.dueAtMs;
    });

    return groups;
  }, [cards, now]);

  // Find if any unit is currently neglected past its lock deadline
  const blockingUnits = useMemo(
    () => unitCards.filter((u) => u.isLockingOthers),
    [unitCards]
  );

  const primaryBlocker = blockingUnits[0] ?? null;

  // Count how many Unit Cards are in each of the 8 Time Frames
  const levelStats = useMemo(() => {
    return SRS_STAGES.map((spec) => {
      const unitsInLevel = unitCards.filter((u) => u.stage === spec.stage);
      const readyInLevel = unitsInLevel.filter((u) => u.isReady).length;
      const lockingInLevel = unitsInLevel.filter(
        (u) => u.isLockingOthers
      ).length;
      return {
        ...spec,
        unitCount: unitsInLevel.length,
        readyCount: readyInLevel,
        lockingCount: lockingInLevel,
      };
    });
  }, [unitCards]);

  const visibleUnits = useMemo(() => {
    if (selectedLevel === 'all') return unitCards;
    return unitCards.filter((u) => u.stage === selectedLevel);
  }, [unitCards, selectedLevel]);

  const stopAutoPlay = () => {
    if (autoPlayTimerRef.current) {
      window.clearTimeout(autoPlayTimerRef.current);
      autoPlayTimerRef.current = null;
    }
    setAutoPlaying(false);
    setActiveAudioWordId(null);
  };

  useEffect(() => {
    return () => stopAutoPlay();
  }, []);

  const startAutoPlay = (list: WordCard[]) => {
    if (list.length === 0) return;
    stopAutoPlay();
    setAutoPlaying(true);

    let idx = 0;
    const step = () => {
      if (idx >= list.length) {
        stopAutoPlay();
        return;
      }
      const w = list[idx];
      setActiveAudioWordId(w.id);
      speakEnglish(w.en, w.audioUrl);
      idx++;
      autoPlayTimerRef.current = window.setTimeout(step, 3200);
    };
    step();
  };

  const startUnitQuiz = (unit: UnitCardGroup) => {
    if (unit.cards.length === 0) return;
    // Enforce discipline lock: if another unit is blocking, only allow starting blocking units!
    if (primaryBlocker && !unit.isLockingOthers) {
      setSelectedLevel(primaryBlocker.stage);
      return;
    }
    stopAutoPlay();
    const ids = unit.cards.map((c) => c.id);
    setQueueIds(ids);
    setInitialQueueSize(ids.length);
    setActiveQuizUnit(unit);
    setSelectedOptionId(null);
    setQuestionNonce((n) => n + 1);
  };

  const exitQuiz = () => {
    setActiveQuizUnit(null);
    setQueueIds([]);
    setSelectedOptionId(null);
  };

  const currentCard = useMemo(
    () => cards.find((c) => c.id === queueIds[0]) ?? null,
    [cards, queueIds]
  );

  const activeQuestion = useMemo<{
    cardId: string;
    mode: QuizMode;
    options: QuizOption[];
    chosenDistractors: string[];
  } | null>(() => {
    if (!currentCard) return null;
    const mode = pickQuizMode(currentCard, 'auto');
    const { options, chosenDistractors } = generateSmartChoices(
      currentCard,
      cards,
      mode
    );
    return {
      cardId: currentCard.id,
      mode,
      options,
      chosenDistractors,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCard?.id, questionNonce]);

  useEffect(() => {
    if (
      currentCard &&
      activeQuestion?.mode === 'audio-to-uz' &&
      !selectedOptionId
    ) {
      speakEnglish(currentCard.en, currentCard.audioUrl);
    }
  }, [currentCard, activeQuestion?.mode, selectedOptionId]);

  const handleChoose = (option: QuizOption) => {
    if (!currentCard || !activeQuestion || selectedOptionId) return;
    setSelectedOptionId(option.id);

    if (activeQuestion.mode === 'uz-to-en') {
      speakEnglish(currentCard.en, currentCard.audioUrl);
    }

    onAnswer(
      currentCard.id,
      option.isCorrect,
      activeQuestion.chosenDistractors
    );
  };

  const handleNext = () => {
    if (!currentCard || !selectedOptionId || !activeQuizUnit) return;
    const chosenOpt = activeQuestion?.options.find(
      (o) => o.id === selectedOptionId
    );
    const wasWrong = chosenOpt ? !chosenOpt.isCorrect : false;

    const rest = queueIds.slice(1);
    if (wasWrong) {
      const insertIdx = Math.min(2, rest.length);
      rest.splice(insertIdx, 0, currentCard.id);
    }

    if (rest.length === 0) {
      onCompleteUnitLevel(activeQuizUnit.unitName, activeQuizUnit.stage);
      if (selectedLevel !== 'all') {
        setSelectedLevel(Math.min(activeQuizUnit.stage + 1, 7));
      }
    }

    setQueueIds(rest);
    setSelectedOptionId(null);
    setQuestionNonce((n) => n + 1);
  };

  useEffect(() => {
    if (!activeQuizUnit) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (!activeQuestion) return;
      if (!selectedOptionId) {
        const idx = Number(e.key) - 1;
        if (idx >= 0 && idx < activeQuestion.options.length) {
          e.preventDefault();
          handleChoose(activeQuestion.options[idx]);
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // 1. Empty state if 0 words exist
  if (cards.length === 0) {
    return (
      <section className="empty-card" aria-label="Boshlash">
        <div className="empty-icon-box" aria-hidden="true">
          <FolderPlus size={26} />
        </div>
        <h1 className="empty-title">Hali unit qo‘shilmagan</h1>
        <p className="empty-desc">
          Yangi unit qo‘shing yoki Essential 3 — Unit 1 namunasini yuklab darhol
          boshlang.
        </p>
        <div className="empty-actions">
          <button type="button" className="btn-indigo" onClick={onGoAdd}>
            <Sparkles size={16} aria-hidden="true" />
            So‘z qo‘shish
          </button>
          <button type="button" className="btn-ghost" onClick={onLoadSample}>
            <Play size={15} aria-hidden="true" />
            Unit 1 namunasi (10 ta so‘z)
          </button>
        </div>
      </section>
    );
  }

  // 2. Active Unit Quiz Mode
  if (activeQuizUnit) {
    if (!currentCard || !activeQuestion) {
      const nextLvl = getStageSpec(clampStage(activeQuizUnit.stage + 1));
      return (
        <section className="empty-card" aria-label="Unit yakunlandi">
          <div
            className="empty-icon-box"
            style={{
              backgroundColor: 'var(--accent-green-soft)',
              color: 'var(--accent-green)',
            }}
            aria-hidden="true"
          >
            <CheckCircle2 size={28} />
          </div>
          <h1 className="empty-title">
            “{activeQuizUnit.unitName}” → {nextLvl.label} bo‘limiga o‘tdi!
          </h1>
          <p className="empty-desc">
            Endi bu unit uchun qat’iy <strong>{nextLvl.label}lik</strong>{' '}
            teskari sanoq taymeri boshlandi.
          </p>
          <div className="empty-actions">
            <button type="button" className="btn-green" onClick={exitQuiz}>
              <ArrowLeft size={16} aria-hidden="true" />
              Time frame’larga qaytish
            </button>
          </div>
        </section>
      );
    }

    const progressRatio =
      initialQueueSize > 0
        ? Math.min(
            1,
            Math.max(
              0.05,
              (initialQueueSize - queueIds.length) / initialQueueSize
            )
          )
        : 0;

    return (
      <section aria-label="Unit testi">
        <div className="toolbar-row" style={{ marginBottom: 10 }}>
          <button type="button" className="btn-ghost" onClick={exitQuiz}>
            <ArrowLeft size={15} aria-hidden="true" />
            Orqaga
          </button>

          <span className="chip is-accent mono">
            {activeQuizUnit.unitName} ({activeQuizUnit.levelLabel} →{' '}
            {activeQuizUnit.nextLevelLabel}) · Qoldi: {queueIds.length}
          </span>
        </div>

        <div className="wc-card mobile-quiz-card">
          <div className="quiz-progress-bar" aria-hidden="true">
            <div
              className="quiz-progress-fill"
              style={{ transform: `scaleX(${progressRatio})` }}
            />
          </div>

          <div className="quiz-hero-word">
            {activeQuestion.mode === 'audio-to-uz' && !selectedOptionId ? (
              <button
                type="button"
                className="btn-indigo"
                onClick={() =>
                  speakEnglish(currentCard.en, currentCard.audioUrl)
                }
              >
                <Volume2 size={20} aria-hidden="true" />
                Tinglash
              </button>
            ) : (
              <div className="quiz-word-line">
                <h1 className="quiz-word-text">
                  {activeQuestion.mode === 'uz-to-en'
                    ? currentCard.uz
                    : currentCard.en}
                </h1>
                {activeQuestion.mode !== 'uz-to-en' && (
                  <button
                    type="button"
                    className="btn-icon-round"
                    aria-label="Talaffuz"
                    onClick={() =>
                      speakEnglish(currentCard.en, currentCard.audioUrl)
                    }
                  >
                    <Volume2 size={20} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}

            {activeQuestion.mode !== 'uz-to-en' &&
              currentCard.phonetic &&
              (activeQuestion.mode !== 'audio-to-uz' || selectedOptionId) && (
                <div className="quiz-phonetic">{currentCard.phonetic}</div>
              )}
          </div>

          <div className="choices-grid" role="list">
            {activeQuestion.options.map((opt, idx) => {
              const isSelected = selectedOptionId === opt.id;
              let stateClass = '';
              if (selectedOptionId) {
                if (opt.isCorrect) stateClass = 'is-correct';
                else if (isSelected) stateClass = 'is-wrong';
                else stateClass = 'is-dimmed';
              }

              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={Boolean(selectedOptionId)}
                  className={`choice-card ${stateClass}`}
                  onClick={() => handleChoose(opt)}
                >
                  <span className="choice-num">{idx + 1}</span>
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>

          {selectedOptionId &&
            (() => {
              const isOk = Boolean(
                activeQuestion.options.find((o) => o.id === selectedOptionId)
                  ?.isCorrect
              );

              return (
                <div
                  className={`feedback-box ${isOk ? 'is-ok' : 'is-err'}`}
                  role="status"
                  aria-live="polite"
                >
                  <div className="feedback-top">
                    <span
                      className={`feedback-status ${isOk ? 'is-ok' : 'is-err'}`}
                    >
                      {isOk ? (
                        <>
                          <CheckCircle2 size={18} aria-hidden="true" />
                          To‘g‘ri!
                        </>
                      ) : (
                        <>
                          <XCircle size={18} aria-hidden="true" />
                          Xato! Shu unit ichida yana chiqadi
                        </>
                      )}
                    </span>

                    <span className="box-move-badge mono">
                      {activeQuizUnit.levelLabel} →{' '}
                      {activeQuizUnit.nextLevelLabel}
                    </span>
                  </div>

                  {currentCard.example && (
                    <p className="feedback-example">{currentCard.example}</p>
                  )}

                  <button
                    type="button"
                    className="btn-green"
                    style={{ width: '100%', minHeight: 50, fontSize: 16 }}
                    onClick={handleNext}
                  >
                    Keyingisi
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </div>
              );
            })()}
        </div>
      </section>
    );
  }

  // 3. Main Mashq Screen: 8 Time Frames + Train Catch-Up + Overdue Discipline Lock!
  return (
    <section aria-label="Mashq">
      {/* Top Row: 8 Time Frames in Center + Road Reader Toggle */}
      <div className="level-bar-wrap">
        <div
          className="srs-strip level-strip-center"
          role="group"
          aria-label="Time frame bo‘limlari"
        >
          <button
            type="button"
            className={`srs-pill ${selectedLevel === 'all' ? 'is-active' : ''}`}
            onClick={() => setSelectedLevel('all')}
          >
            <span>Barchasi</span>
            <span className="srs-pill-num">{unitCards.length}</span>
          </button>

          {levelStats.map((lvl) => (
            <button
              key={lvl.stage}
              type="button"
              className={`srs-pill ${
                selectedLevel === lvl.stage ? 'is-active' : ''
              } ${
                lvl.lockingCount > 0
                  ? 'has-locking-unit'
                  : lvl.readyCount > 0
                  ? 'has-ready-unit'
                  : ''
              }`}
              onClick={() => setSelectedLevel(lvl.stage)}
            >
              <span>{lvl.label}</span>
              <span className="srs-pill-num">{lvl.unitCount}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`btn-ghost ${roadReaderOpen ? 'is-active-mode' : ''}`}
          style={{ minHeight: 38, whiteSpace: 'nowrap', flexShrink: 0 }}
          onClick={() => {
            stopAutoPlay();
            setRoadReaderOpen((v) => !v);
          }}
        >
          <BookOpen size={15} aria-hidden="true" />
          <span>{roadReaderOpen ? 'Time frame' : 'Yo‘lda o‘qish'}</span>
        </button>
      </div>

      {/* Discipline Lock Alert Banner if a Time Frame has been neglected past its deadline! */}
      {primaryBlocker && !roadReaderOpen && (
        <div className="discipline-lock-banner" role="alert">
          <div className="discipline-lock-top">
            <AlertTriangle size={20} aria-hidden="true" />
            <strong>
              Hoy, “{primaryBlocker.levelLabel}” time frame’ni qilmayapsiz!
            </strong>
          </div>
          <p className="discipline-lock-desc">
            <strong>{primaryBlocker.unitName}</strong> uniti{' '}
            <strong>{primaryBlocker.levelLabel}</strong> bo‘limida qimirlamay
            turganiga belgilangan muddatdan oshib ketdi. Qolgan time frame’lar
            vaqtincha <strong>bloklandi</strong> — avval shuni tugating, keyin
            qolganlari ochiladi!
          </p>
          <button
            type="button"
            className="btn-green"
            style={{ minHeight: 44 }}
            onClick={() => startUnitQuiz(primaryBlocker)}
          >
            <Play size={16} aria-hidden="true" />
            “{primaryBlocker.unitName}” ({primaryBlocker.levelLabel}) ni hozir
            tugatish
          </button>
        </div>
      )}

      {roadReaderOpen ? (
        <div
          className="road-reader-wrap"
          style={{ maxWidth: 580, marginInline: 'auto' }}
        >
          <div className="road-reader-header">
            <div>
              <h2 className="leitner-box-title">
                Barcha so‘zlar ({cards.length})
              </h2>
              <p className="leitner-box-desc">
                Kartochka ustiga bossangiz inglizcha talaffuzini o‘qib beradi
              </p>
            </div>

            {autoPlaying ? (
              <button
                type="button"
                className="btn-ghost"
                style={{
                  borderColor: 'var(--accent-red)',
                  color: 'var(--accent-red)',
                }}
                onClick={stopAutoPlay}
              >
                <Square size={15} aria-hidden="true" />
                To‘xtatish
              </button>
            ) : (
              <button
                type="button"
                className="btn-indigo"
                style={{ minHeight: 40, padding: '6px 14px' }}
                onClick={() => startAutoPlay(cards)}
              >
                <Headphones size={16} aria-hidden="true" />
                Avto-o‘qish
              </button>
            )}
          </div>

          <div className="road-card-list">
            {cards.map((w, idx) => {
              const spec = getStageSpec(w.stage);
              const isSpeaking = activeAudioWordId === w.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  className={`road-word-card ${
                    isSpeaking ? 'is-speaking' : ''
                  }`}
                  onClick={() => {
                    setActiveAudioWordId(w.id);
                    speakEnglish(w.en, w.audioUrl);
                  }}
                >
                  <div className="road-word-main">
                    <span className="road-word-index mono">{idx + 1}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="road-word-en">
                        {w.en}
                        {w.phonetic && (
                          <span className="road-word-phonetic">
                            {w.phonetic}
                          </span>
                        )}
                      </div>
                      <div className="road-word-uz">{w.uz}</div>
                    </div>
                  </div>

                  <div className="road-word-right">
                    <span className="chip mono">{spec.label}</span>
                    <Volume2
                      size={20}
                      style={{ color: 'var(--accent-brand)', flexShrink: 0 }}
                      aria-hidden="true"
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : visibleUnits.length === 0 ? (
        <div
          className="empty-card"
          style={{ maxWidth: 560, marginInline: 'auto', marginTop: 10 }}
        >
          <p className="empty-desc">
            Hozircha{' '}
            <strong>
              {selectedLevel !== 'all' ? getStageSpec(selectedLevel).label : ''}
            </strong>{' '}
            time frame bo‘sh. Orqadagi unitlarni qaytarganingizda poyezd bo‘lib
            shu yerga yetib keladi.
          </p>
        </div>
      ) : (
        <div className="center-tasks-feed">
          {visibleUnits.map((unit) => {
            const isExpanded = expandedUnit === unit.unitName;
            // A unit is locked ONLY if another unit has triggered the overdue discipline lock
            const isBlockedByOther =
              Boolean(primaryBlocker) && !unit.isLockingOthers;

            return (
              <div
                key={unit.unitName}
                className={`popup-task-card ${
                  unit.isLockingOthers
                    ? 'is-locking'
                    : unit.isReady
                    ? 'is-ready'
                    : 'is-waiting'
                } ${isBlockedByOther ? 'is-blocked-card' : ''}`}
              >
                <div className="popup-task-top">
                  {unit.isLockingOthers ? (
                    <span className="popup-danger-pill">
                      <AlertTriangle size={14} aria-hidden="true" />
                      {unit.levelLabel} · Qimirlamayapti (Majburiy!)
                    </span>
                  ) : unit.isReady ? (
                    <span className="popup-ready-pill">
                      <span className="pulse-dot" aria-hidden="true" />
                      {unit.levelLabel} · Vaqti keldi!
                    </span>
                  ) : (
                    <span className="popup-wait-pill">
                      <Clock size={14} aria-hidden="true" />
                      <span>Time frame: {unit.levelLabel}</span>
                    </span>
                  )}

                  {unit.isLockingOthers ? (
                    <span className="countdown-badge is-danger-timer mono">
                      Kechikdi: +{formatCountdownUz(now + unit.overdueDurationMs, now)}
                    </span>
                  ) : unit.isReady ? (
                    <span
                      className="countdown-badge is-warn-timer mono"
                      title="Shu vaqt ichida qilinmasa qolgan bo‘limlar bloklanadi"
                    >
                      Blokgacha: {formatCountdownUz(unit.lockAtMs, now)}
                    </span>
                  ) : (
                    <span className="countdown-badge mono">
                      Qoldi: {formatCountdownUz(unit.dueAtMs, now)}
                    </span>
                  )}
                </div>

                <h2 className="popup-unit-title">{unit.unitName}</h2>
                <p className="popup-unit-sub">
                  {unit.cards.length} ta so‘z · Tugatgach{' '}
                  <strong>{unit.nextLevelLabel}</strong> time frame’ga poyezd
                  bo‘lib qo‘shiladi
                </p>

                <div className="popup-task-actions">
                  {isBlockedByOther ? (
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled
                      style={{ flex: 1, minHeight: 46, opacity: 0.65 }}
                    >
                      <Lock size={15} aria-hidden="true" />
                      Bloklangan (Avval “{primaryBlocker?.unitName}”ni tugating)
                    </button>
                  ) : unit.isReady ? (
                    <button
                      type="button"
                      className="btn-green"
                      style={{ flex: 1, minHeight: 48, fontSize: 15 }}
                      onClick={() => startUnitQuiz(unit)}
                    >
                      <Play size={17} aria-hidden="true" />
                      {unit.levelLabel}likni boshlash ({unit.cards.length})
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-indigo"
                      style={{ flex: 1, minHeight: 44, fontSize: 14 }}
                      onClick={() => startUnitQuiz(unit)}
                    >
                      <Play size={15} aria-hidden="true" />
                      Kutmasdan hozir tugatish ({unit.levelLabel} →{' '}
                      {unit.nextLevelLabel})
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ minHeight: 44, paddingInline: 14 }}
                    onClick={() =>
                      setExpandedUnit(isExpanded ? null : unit.unitName)
                    }
                  >
                    <BookOpen size={16} aria-hidden="true" />
                    {isExpanded ? 'Yopish' : 'So‘zlar'}
                  </button>
                </div>

                {isExpanded && (
                  <div className="leitner-drawer">
                    {unit.cards.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        className="leitner-drawer-row"
                        onClick={() => speakEnglish(w.en, w.audioUrl)}
                      >
                        <Volume2
                          size={16}
                          style={{
                            color: 'var(--accent-brand)',
                            flexShrink: 0,
                          }}
                          aria-hidden="true"
                        />
                        <div
                          style={{ flex: 1, minWidth: 0, textAlign: 'left' }}
                        >
                          <strong
                            style={{
                              color: 'var(--text-primary)',
                              fontSize: 15,
                            }}
                          >
                            {w.en}
                          </strong>{' '}
                          <span
                            style={{
                              color: 'var(--text-secondary)',
                              fontSize: 14,
                            }}
                          >
                            — {w.uz}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
