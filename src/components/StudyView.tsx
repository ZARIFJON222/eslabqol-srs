import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  FolderPlus,
  Headphones,
  Layers,
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
  isCardDue,
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
    chosenDistractors: string[],
    updateSchedule: boolean
  ) => void;
  onGoAdd: () => void;
  onLoadSample: () => void;
}

interface UnifiedStageBatch {
  stage: number;
  stageLabel: string;
  nextStageLabel: string;
  cards: WordCard[];
  dueCards: WordCard[];
  unitNames: string[];
  isReady: boolean;
  batchDueMs: number;
}

function stageActionTitle(stage: number): string {
  const spec = getStageSpec(stage);
  return `${spec.label}lik takrorlash`;
}

export function StudyView({
  cards,
  onAnswer,
  onGoAdd,
  onLoadSample,
}: StudyViewProps) {
  const [expandedStage, setExpandedStage] = useState<number | null>(null);
  const [roadReaderOpen, setRoadReaderOpen] = useState<boolean>(false);
  const [autoPlaying, setAutoPlaying] = useState<boolean>(false);
  const [activeAudioWordId, setActiveAudioWordId] = useState<string | null>(
    null
  );
  const [now, setNow] = useState<number>(() => Date.now());
  const autoPlayTimerRef = useRef<number | null>(null);

  // Active quiz session state
  const [quizTitle, setQuizTitle] = useState<string | null>(null);
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [initialQueueSize, setInitialQueueSize] = useState<number>(0);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [answeredCardStageBefore, setAnsweredCardStageBefore] =
    useState<number>(0);
  const [questionNonce, setQuestionNonce] = useState(0);
  const [updateSrsOnQuiz, setUpdateSrsOnQuiz] = useState(true);

  // Live 1-second ticker for reverse countdowns
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /**
   * Combines ALL units together by SRS Stage so units added minutes or hours apart
   * share ONE unified batch and are reviewed together in one sitting.
   */
  const stageBatches = useMemo<UnifiedStageBatch[]>(() => {
    const batches: UnifiedStageBatch[] = [];

    for (const spec of SRS_STAGES) {
      const stageCards = cards.filter(
        (c) => clampStage(c.stage) === spec.stage
      );
      if (stageCards.length === 0) continue;

      // Shared batch timer = earliest due timestamp in this stage
      // If any card in this stage is due, the whole stage batch is ready together!
      const earliestDueMs = Math.min(...stageCards.map((c) => c.nextReviewAt));
      const stageIsReady =
        earliestDueMs <= now || stageCards.some((c) => isCardDue(c, now));

      const unitNames = Array.from(
        new Set(stageCards.map((c) => c.deck))
      ).sort();

      batches.push({
        stage: spec.stage,
        stageLabel: stageActionTitle(spec.stage),
        nextStageLabel: stageActionTitle(clampStage(spec.stage + 1)),
        cards: stageCards,
        dueCards: stageIsReady ? stageCards : [],
        unitNames,
        isReady: stageIsReady,
        batchDueMs: earliestDueMs,
      });
    }

    // Sort: Ready batches at top, then by soonest countdown
    batches.sort((a, b) => {
      if (a.isReady !== b.isReady) return a.isReady ? -1 : 1;
      return a.batchDueMs - b.batchDueMs;
    });

    return batches;
  }, [cards, now]);

  const readyBatches = useMemo(
    () => stageBatches.filter((b) => b.isReady),
    [stageBatches]
  );

  const waitingBatches = useMemo(
    () => stageBatches.filter((b) => !b.isReady),
    [stageBatches]
  );

  // Combined list of all ready cards across all ready stages
  const allCombinedReadyCards = useMemo(
    () => readyBatches.flatMap((b) => b.cards),
    [readyBatches]
  );

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

  const startQuiz = (
    targetCards: WordCard[],
    title: string,
    shouldUpdateSrs: boolean
  ) => {
    if (targetCards.length === 0) return;
    stopAutoPlay();
    const ids = targetCards.map((c) => c.id);
    setQueueIds(ids);
    setInitialQueueSize(ids.length);
    setQuizTitle(title);
    setUpdateSrsOnQuiz(shouldUpdateSrs);
    setSelectedOptionId(null);
    setQuestionNonce((n) => n + 1);
  };

  const exitQuiz = () => {
    setQuizTitle(null);
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
    setAnsweredCardStageBefore(clampStage(currentCard.stage));
    setSelectedOptionId(option.id);

    if (activeQuestion.mode === 'uz-to-en') {
      speakEnglish(currentCard.en, currentCard.audioUrl);
    }

    onAnswer(
      currentCard.id,
      option.isCorrect,
      activeQuestion.chosenDistractors,
      updateSrsOnQuiz
    );
  };

  const handleNext = () => {
    if (!currentCard || !selectedOptionId) return;
    const chosenOpt = activeQuestion?.options.find(
      (o) => o.id === selectedOptionId
    );
    const wasWrong = chosenOpt ? !chosenOpt.isCorrect : false;

    setQueueIds((prev) => {
      const rest = prev.slice(1);
      if (wasWrong) {
        const insertIdx = Math.min(2, rest.length);
        rest.splice(insertIdx, 0, currentCard.id);
      }
      return rest;
    });
    setSelectedOptionId(null);
    setQuestionNonce((n) => n + 1);
  };

  useEffect(() => {
    if (!quizTitle) return;
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
        <h1 className="empty-title">Hali so‘z qo‘shilmagan</h1>
        <p className="empty-desc">
          Kompyuter yoki telefonda so‘z qo‘shing, yoki Essential 3 — Unit 1
          namunasini yuklab darhol boshlang.
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

  // 2. Active Quiz Mode
  if (quizTitle) {
    if (!currentCard || !activeQuestion) {
      return (
        <section className="empty-card" aria-label="Yakunlandi">
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
          <h1 className="empty-title">Takrorlash bajarildi!</h1>
          <p className="empty-desc">
            Barcha so‘zlar keyingi vaqt bosqichiga birlashtirildi va umumiy
            teskari sanoq boshlandi.
          </p>
          <div className="empty-actions">
            <button type="button" className="btn-green" onClick={exitQuiz}>
              <ArrowLeft size={16} aria-hidden="true" />
              Mashq ekraniga qaytish
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
      <section aria-label="Takrorlash testi">
        <div className="toolbar-row" style={{ marginBottom: 10 }}>
          <button type="button" className="btn-ghost" onClick={exitQuiz}>
            <ArrowLeft size={15} aria-hidden="true" />
            Orqaga
          </button>

          <span className="chip is-accent mono">
            {quizTitle} · Qoldi: {queueIds.length}
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
              const fromSpec = getStageSpec(answeredCardStageBefore);
              const toSpec = isOk
                ? getStageSpec(answeredCardStageBefore + 1)
                : getStageSpec(0);

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
                          To‘g‘ri! Keyingi bosqichga qo‘shildi
                        </>
                      ) : (
                        <>
                          <XCircle size={18} aria-hidden="true" />
                          Xato! 1 soatlik takrorlashga qaytdi
                        </>
                      )}
                    </span>

                    <span className="box-move-badge mono">
                      {fromSpec.label} → {toSpec.label}
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

  // 3. Default Unified Center Screen: All Units Combined by Time Stage!
  return (
    <section aria-label="Mashq">
      <div
        className="toolbar-row"
        style={{ maxWidth: 560, marginInline: 'auto' }}
      >
        <span className="chip">
          <Layers size={14} aria-hidden="true" />
          Jami: {cards.length} ta so‘z (barcha unitlar birlashtirilgan)
        </span>

        <button
          type="button"
          className={`btn-ghost ${roadReaderOpen ? 'is-active-mode' : ''}`}
          style={{ minHeight: 40, whiteSpace: 'nowrap' }}
          onClick={() => {
            stopAutoPlay();
            setRoadReaderOpen((v) => !v);
          }}
        >
          <BookOpen size={15} aria-hidden="true" />
          <span>{roadReaderOpen ? 'Takrorlash' : 'Yo‘lda o‘qish'}</span>
        </button>
      </div>

      {roadReaderOpen ? (
        <div
          className="road-reader-wrap"
          style={{ maxWidth: 560, marginInline: 'auto' }}
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
      ) : (
        <div className="center-tasks-feed">
          {/* If 2+ stages are due at once (e.g. morning's 5-hour + evening's 1-hour), offer ONE combined button! */}
          {readyBatches.length > 1 && (
            <div className="popup-task-card is-ready">
              <div className="popup-task-top">
                <span className="popup-ready-pill">
                  <span className="pulse-dot" aria-hidden="true" />
                  Barcha tayyor takrorlashlar birlashtirildi
                </span>
                <span className="leitner-count-pill mono">
                  {allCombinedReadyCards.length} ta so‘z
                </span>
              </div>

              <h2 className="popup-unit-title">
                Umumiy takrorlash ({readyBatches.map((b) => b.stageLabel).join(' + ')})
              </h2>
              <p className="popup-unit-sub">
                Ertalabki va kechki unitlarni alohida-alohida o‘tirmasdan, bitta
                sessiyada birga takrorlang
              </p>

              <div className="popup-task-actions">
                <button
                  type="button"
                  className="btn-green"
                  style={{ width: '100%', minHeight: 50, fontSize: 15 }}
                  onClick={() =>
                    startQuiz(
                      allCombinedReadyCards,
                      'Umumiy takrorlash',
                      true
                    )
                  }
                >
                  <Play size={17} aria-hidden="true" />
                  Hammasini birga boshlash ({allCombinedReadyCards.length} ta so‘z)
                </button>
              </div>
            </div>
          )}

          {/* 1. READY STAGE BATCHES */}
          {readyBatches.map((batch) => {
            const isExpanded = expandedStage === batch.stage;
            return (
              <div key={batch.stage} className="popup-task-card is-ready">
                <div className="popup-task-top">
                  <span className="popup-ready-pill">
                    <span className="pulse-dot" aria-hidden="true" />
                    Vaqti keldi!
                  </span>
                  <span className="leitner-count-pill mono">
                    {batch.cards.length} ta so‘z
                  </span>
                </div>

                <h2 className="popup-unit-title">{batch.stageLabel}</h2>
                <p className="popup-unit-sub">
                  Ichidagi unitlar: {batch.unitNames.join(', ')} · Keyingi
                  bosqich: {batch.nextStageLabel}
                </p>

                <div className="popup-task-actions">
                  <button
                    type="button"
                    className="btn-green"
                    style={{ flex: 1, minHeight: 48, fontSize: 15 }}
                    onClick={() =>
                      startQuiz(batch.cards, batch.stageLabel, true)
                    }
                  >
                    <Play size={17} aria-hidden="true" />
                    {batch.stageLabel}ni boshlash ({batch.cards.length})
                  </button>

                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ minHeight: 48, paddingInline: 14 }}
                    onClick={() =>
                      setExpandedStage(isExpanded ? null : batch.stage)
                    }
                  >
                    <BookOpen size={16} aria-hidden="true" />
                    {isExpanded ? 'Yopish' : 'Ko‘rish'}
                  </button>
                </div>

                {isExpanded && (
                  <div className="leitner-drawer">
                    {batch.cards.map((w) => (
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
                        <span
                          className="mono"
                          style={{ fontSize: 11, color: 'var(--text-muted)' }}
                        >
                          {w.deck}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* 2. WAITING STAGE BATCHES (Unified countdown per stage!) */}
          {waitingBatches.map((batch) => {
            const isExpanded = expandedStage === batch.stage;
            return (
              <div key={batch.stage} className="popup-task-card is-waiting">
                <div className="popup-task-top">
                  <span className="popup-wait-pill">
                    <Clock size={14} aria-hidden="true" />
                    <span>Kutilmoqda</span>
                  </span>

                  <span className="countdown-badge mono">
                    {formatCountdownUz(batch.batchDueMs, now)}
                  </span>
                </div>

                <h2 className="popup-unit-title">{batch.stageLabel}</h2>
                <p className="popup-unit-sub">
                  {batch.cards.length} ta so‘z ({batch.unitNames.join(', ')}) ·
                  Vaqt tugaganda hammasi bitta bo‘lib chiqadi
                </p>

                <div className="popup-task-actions">
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ flex: 1, minHeight: 42 }}
                    onClick={() =>
                      setExpandedStage(isExpanded ? null : batch.stage)
                    }
                  >
                    <BookOpen size={15} aria-hidden="true" />
                    {isExpanded
                      ? 'Ro‘yxatni yopish'
                      : `So‘zlarni o‘qish (${batch.cards.length})`}
                  </button>

                  <button
                    type="button"
                    className="btn-indigo"
                    style={{ minHeight: 42, paddingInline: 14, fontSize: 13 }}
                    onClick={() =>
                      startQuiz(batch.cards, batch.stageLabel, true)
                    }
                  >
                    <Play size={14} aria-hidden="true" />
                    Kutmasdan boshlash
                  </button>
                </div>

                {isExpanded && (
                  <div className="leitner-drawer">
                    {batch.cards.map((w) => (
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
                        <span
                          className="mono"
                          style={{ fontSize: 11, color: 'var(--text-muted)' }}
                        >
                          {w.deck}
                        </span>
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
