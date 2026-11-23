import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Cloud,
  CloudOff,
  FolderOpen,
  GraduationCap,
  Menu,
  PlusCircle,
  RefreshCw,
  Volume2,
  X,
  Zap,
} from 'lucide-react';
import type { DailyStats, WordCard } from './types';
import { ESSENTIAL_3_UNIT_1_SAMPLE } from './data/distractorPool';
import { applyReviewResult, getDueCards } from './lib/srs';
import {
  getEnglishVoices,
  getSelectedVoiceUri,
  setSelectedVoiceUri,
  speakEnglish,
  type VoiceOption,
} from './lib/dictionary';
import {
  loadCards,
  loadStats,
  recordReviewStat,
  saveCards,
} from './lib/storage';
import {
  getActiveFirebaseConfig,
  getSyncId,
  mergeCardLists,
  parseFirebaseConfigInput,
  pushToCloud,
  saveFirebaseConfig,
  setSyncId,
  subscribeToCloudSync,
} from './lib/firebase';
import { StudyView } from './components/StudyView';
import { AddView } from './components/AddView';
import { LibraryView } from './components/LibraryView';

type SimpleTab = 'study' | 'add' | 'library';

function getInitialTab(): SimpleTab {
  if (typeof window === 'undefined') return 'study';
  const t = new URLSearchParams(window.location.search).get('tab');
  if (t === 'study' || t === 'add' || t === 'library') return t;
  return 'study';
}

export function App() {
  const [tab, setTab] = useState<SimpleTab>(getInitialTab);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);

  const [cards, setCards] = useState<WordCard[]>(() => loadCards());
  const [stats, setStats] = useState<DailyStats>(() => loadStats());
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [studyDeckOverride, setStudyDeckOverride] = useState<string>('all');

  // Voice settings
  const [voices, setVoices] = useState<VoiceOption[]>(() => getEnglishVoices());
  const [voiceUri, setVoiceUri] = useState<string>(() => getSelectedVoiceUri());

  // Firebase Cloud Sync settings
  const [syncId, setSyncIdState] = useState<string>(() => getSyncId());
  const [syncIdInput, setSyncIdInput] = useState<string>(() => getSyncId());
  const [cloudStatus, setCloudStatus] = useState<
    'off' | 'connecting' | 'connected' | 'error'
  >('off');
  const [showFbSetup, setShowFbSetup] = useState(false);
  const [fbConfigInput, setFbConfigInput] = useState('');
  const [fbNotice, setFbNotice] = useState<string | null>(null);
  const [configVersion, setConfigVersion] = useState(0);

  const isApplyingRemoteRef = useRef(false);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const statsRef = useRef(stats);
  statsRef.current = stats;

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const syncVoices = () => setVoices(getEnglishVoices());
    syncVoices();
    window.speechSynthesis.addEventListener('voiceschanged', syncVoices);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', syncVoices);
    };
  }, []);

  useEffect(() => {
    saveCards(cards);
    if (isApplyingRemoteRef.current) {
      isApplyingRemoteRef.current = false;
      return;
    }
    if (getActiveFirebaseConfig()) {
      void pushToCloud(syncId, cards, statsRef.current);
    }
  }, [cards, syncId]);

  useEffect(() => {
    const unsub = subscribeToCloudSync(
      syncId,
      (remoteCards) => {
        // If cloud is empty but we already have local words, push local words to cloud
        if (remoteCards.length === 0 && cardsRef.current.length > 0) {
          void pushToCloud(syncId, cardsRef.current, statsRef.current);
          return;
        }
        const merged = mergeCardLists(cardsRef.current, remoteCards);
        if (JSON.stringify(merged) !== JSON.stringify(cardsRef.current)) {
          isApplyingRemoteRef.current = true;
          setCards(merged);
        }
      },
      (status) => setCloudStatus(status)
    );
    return () => {
      if (unsub) unsub();
    };
  }, [syncId, configVersion]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url.toString());
  }, [tab]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const dueCount = useMemo(
    () => getDueCards(cards, nowTick).length,
    [cards, nowTick]
  );

  const decks = useMemo(() => {
    const set = new Set<string>();
    for (const c of cards) {
      if (c.deck) set.add(c.deck);
    }
    return Array.from(set).sort();
  }, [cards]);

  const navigateTo = (nextTab: SimpleTab, deckName?: string) => {
    if (deckName) setStudyDeckOverride(deckName);
    setTab(nextTab);
    setDrawerOpen(false);
  };

  const handleVoiceChange = (nextUri: string) => {
    setVoiceUri(nextUri);
    setSelectedVoiceUri(nextUri);
    speakEnglish('Hello, ready to practice English', undefined, nextUri);
  };

  const handleSaveSyncId = (e: React.FormEvent) => {
    e.preventDefault();
    const clean =
      syncIdInput.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'asosiy';
    setSyncId(clean);
    setSyncIdState(clean);
    setSyncIdInput(clean);
    setFbNotice(`Sinxronizatsiya kodi “${clean}” ga o‘zgartirildi.`);
    if (getActiveFirebaseConfig() && cards.length > 0) {
      void pushToCloud(clean, cards, stats);
    }
  };

  const handleSaveFbConfig = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFirebaseConfigInput(fbConfigInput);
    if (!parsed) {
      setFbNotice(
        'apiKey va projectId topilmadi. Firebase Console’dagi firebaseConfig kodini to‘liq nusxalab tashlang.'
      );
      return;
    }
    saveFirebaseConfig(parsed);
    setFbConfigInput('');
    setShowFbSetup(false);
    setConfigVersion((v) => v + 1);
    setFbNotice(`Firebase (${parsed.projectId}) muvaffaqiyatli ulandi!`);
    if (cards.length > 0) {
      void pushToCloud(syncId, cards, stats);
    }
  };

  const handleAnswer = (
    cardId: string,
    isCorrect: boolean,
    chosenDistractors: string[],
    updateSchedule: boolean
  ) => {
    setCards((prev) => {
      const now = Date.now();
      const target = prev.find((c) => c.id === cardId);
      if (!target) return prev;

      const updatedTarget = applyReviewResult(
        target,
        isCorrect,
        chosenDistractors,
        now,
        updateSchedule
      );

      // Synchronize all cards in the target's new stage to ONE shared batch timer
      // so words added or reviewed minutes apart never trigger separate timers 5 minutes apart!
      const targetStage = updatedTarget.stage;
      const unifiedNextReviewAt = updatedTarget.nextReviewAt;

      return prev.map((c) => {
        if (c.id === cardId) return updatedTarget;
        if (updateSchedule && c.stage === targetStage && c.nextReviewAt > now) {
          return { ...c, nextReviewAt: unifiedNextReviewAt };
        }
        return c;
      });
    });
    setStats((prev) => recordReviewStat(prev, isCorrect));
  };

  const handleAddCards = (newCards: WordCard[]) => {
    setCards((prev) => {
      // If there are already words waiting in Stage 0, sync new words to the same Stage 0 timer
      // so adding units 5 minutes apart groups them into the exact same review batch!
      const existingStage0 = prev.find((c) => c.stage === 0);
      const sharedStage0Time = existingStage0
        ? existingStage0.nextReviewAt
        : newCards[0]?.nextReviewAt ?? Date.now();

      const syncedNew = newCards.map((c) => ({
        ...c,
        nextReviewAt: sharedStage0Time,
      }));
      return [...syncedNew, ...prev];
    });
  };

  const handleEnrichCard = (
    id: string,
    patch: Partial<Pick<WordCard, 'phonetic' | 'audioUrl' | 'pos' | 'example'>>
  ) => {
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  };

  const handleDeleteCard = (id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  };

  const handleResetCard = (id: string) => {
    setCards((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, stage: 0, nextReviewAt: Date.now() } : c
      )
    );
  };

  const handleImportCards = (imported: WordCard[]) => {
    setCards((prev) => mergeCardLists(prev, imported));
  };

  const handleLoadSample = () => {
    const now = Date.now();
    const sampleCards: WordCard[] = ESSENTIAL_3_UNIT_1_SAMPLE.map(
      (item, idx) => ({
        id: `sample-${now}-${idx}`,
        en: item.en,
        uz: item.uz,
        pos: item.pos,
        deck: 'Essential 3 — Unit 1',
        phonetic: item.phonetic,
        example: item.example,
        stage: 0,
        nextReviewAt: now + idx,
        createdAt: now,
        correctCount: 0,
        wrongCount: 0,
        recentDistractors: [],
      })
    );
    setCards((prev) => [...sampleCards, ...prev]);
  };

  const activeFbConfig = getActiveFirebaseConfig();

  const renderFirebaseSettingsBlock = () => (
    <div>
      {fbNotice && (
        <div className="notice-banner" style={{ marginBottom: 10 }}>
          {fbNotice}
        </div>
      )}

      <form
        onSubmit={handleSaveSyncId}
        style={{ display: 'flex', gap: 6, marginBottom: 10 }}
      >
        <input
          className="field-input"
          style={{ minHeight: 38, padding: '6px 10px', fontSize: 13 }}
          value={syncIdInput}
          onChange={(e) => setSyncIdInput(e.target.value)}
          placeholder="Profil kodi (masalan: ali-2026)"
          aria-label="Sinxronizatsiya profil kodi"
        />
        <button
          type="submit"
          className="btn-ghost"
          style={{ minHeight: 38, padding: '6px 12px', whiteSpace: 'nowrap' }}
        >
          <Check size={14} aria-hidden="true" />
          Saqlash
        </button>
      </form>

      <div
        style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          marginBottom: 8,
        }}
      >
        {activeFbConfig ? (
          <span style={{ color: 'var(--accent-green)' }}>
            ● Firebase ulangan ({activeFbConfig.projectId}). Kompyuter va
            telefonda <strong>{syncId}</strong> kodini kiritsangiz, so‘zlar
            avtomatik sinxronlashadi.
          </span>
        ) : (
          <span>
            Kompyuter va telefonda so‘zlar bir xil turishi uchun Firebase
            loyihangizning <code>firebaseConfig</code> kodini bir marta
            kiriting:
          </span>
        )}
      </div>

      <button
        type="button"
        className="btn-ghost"
        style={{ width: '100%', minHeight: 36, fontSize: 12 }}
        onClick={() => setShowFbSetup((v) => !v)}
      >
        <RefreshCw size={13} aria-hidden="true" />
        {activeFbConfig
          ? 'Firebase sozlamasini yangilash'
          : 'Firebase Config ulash'}
      </button>

      {showFbSetup && (
        <form
          onSubmit={handleSaveFbConfig}
          style={{
            marginTop: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <textarea
            className="field-textarea"
            style={{ minHeight: 110, fontSize: 12 }}
            value={fbConfigInput}
            onChange={(e) => setFbConfigInput(e.target.value)}
            placeholder={`const firebaseConfig = {\n  apiKey: "AIza...",\n  projectId: "lugatim-123"\n};`}
          />
          <button
            type="submit"
            className="btn-green"
            style={{ minHeight: 38, fontSize: 13 }}
          >
            Firebase’ni ulash
          </button>
        </form>
      )}
    </div>
  );

  return (
    <div className="app-shell">
      <header className="wc-header">
        <div className="app-container">
          <div className="wc-header-top">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Mobile-only Hamburger button */}
              <button
                type="button"
                className="menu-trigger-btn mobile-only"
                onClick={() => setDrawerOpen(true)}
                aria-label="Menyuni ochish"
              >
                <Menu size={20} aria-hidden="true" />
              </button>

              <button
                type="button"
                className="brand-home-btn"
                onClick={() => navigateTo('study')}
              >
                <span className="wc-logo-badge" aria-hidden="true">
                  <Zap size={17} strokeWidth={2.5} />
                </span>
                <span className="wc-brand-title">EslabQol</span>
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className={`cloud-pill ${
                  cloudStatus === 'connected'
                    ? 'is-online'
                    : cloudStatus === 'error'
                    ? 'is-err'
                    : ''
                }`}
                onClick={() => setCloudOpen((v) => !v)}
                title="Firebase sinxronizatsiya"
              >
                {cloudStatus === 'connected' ? (
                  <Cloud size={14} aria-hidden="true" />
                ) : (
                  <CloudOff size={14} aria-hidden="true" />
                )}
                <span>{cloudStatus === 'connected' ? syncId : 'Firebase'}</span>
              </button>

              {/* Desktop Ovoz & Bugun pills */}
              <button
                type="button"
                className={`wc-streak-pill desktop-only ${
                  voiceOpen ? 'is-active-pill' : ''
                }`}
                onClick={() => setVoiceOpen((v) => !v)}
                aria-expanded={voiceOpen}
              >
                <Volume2 size={15} aria-hidden="true" />
                <span>Ovoz</span>
              </button>

              <span className="wc-streak-pill mono desktop-only">
                Bugun: {stats.reviewedToday}
              </span>
            </div>
          </div>

          {/* Desktop-only Voice Popover */}
          {voiceOpen && (
            <div
              className="voice-bar desktop-only"
              role="region"
              aria-label="Ovoz sozlamasi"
            >
              <select
                aria-label="Inglizcha ovoz"
                className="field-select"
                style={{ minHeight: 38, padding: '6px 10px', flex: 1 }}
                value={voiceUri}
                onChange={(e) => handleVoiceChange(e.target.value)}
              >
                <option value="auto">Avto (Lug‘at audio + standart)</option>
                {voices.map((v) => (
                  <option key={v.uri} value={v.uri}>
                    {v.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-ghost"
                style={{ minHeight: 38, padding: '6px 12px' }}
                onClick={() =>
                  speakEnglish('Practice makes permanent', undefined, voiceUri)
                }
              >
                <Volume2 size={14} aria-hidden="true" />
                Sinash
              </button>
            </div>
          )}

          {/* Inline Firebase Popover (when clicking Firebase pill in top header) */}
          {cloudOpen && (
            <div
              className="voice-bar"
              style={{ flexDirection: 'column', alignItems: 'stretch' }}
              role="region"
              aria-label="Firebase sinxronizatsiya"
            >
              {renderFirebaseSettingsBlock()}
            </div>
          )}

          {/* Desktop-only 3-Tab Pill Navigation Bar (Oldingiday!) */}
          <nav
            className="wc-nav wc-nav-3 desktop-only-grid"
            aria-label="Asosiy menyu"
          >
            <button
              type="button"
              className={`wc-nav-btn ${tab === 'study' ? 'is-active' : ''}`}
              onClick={() => navigateTo('study')}
            >
              <GraduationCap size={16} aria-hidden="true" />
              <span>Mashq</span>
              {dueCount > 0 && <span className="wc-nav-badge">{dueCount}</span>}
            </button>

            <button
              type="button"
              className={`wc-nav-btn ${tab === 'add' ? 'is-active' : ''}`}
              onClick={() => navigateTo('add')}
            >
              <PlusCircle size={16} aria-hidden="true" />
              <span>Qo‘shish</span>
            </button>

            <button
              type="button"
              className={`wc-nav-btn ${tab === 'library' ? 'is-active' : ''}`}
              onClick={() => navigateTo('library')}
            >
              <FolderOpen size={16} aria-hidden="true" />
              <span>So‘zlar</span>
              {cards.length > 0 && (
                <span className="wc-nav-badge">{cards.length}</span>
              )}
            </button>
          </nav>
        </div>
      </header>

      {/* Mobile Slide-Over Side Navbar Drawer */}
      {drawerOpen && (
        <div
          className="drawer-backdrop"
          onClick={() => setDrawerOpen(false)}
          role="presentation"
        >
          <aside
            className="side-drawer"
            aria-label="Yon menyu"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="wc-logo-badge" aria-hidden="true">
                  <Zap size={16} strokeWidth={2.5} />
                </span>
                <div>
                  <div className="wc-brand-title" style={{ fontSize: 17 }}>
                    EslabQol
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Bugun: {stats.reviewedToday} ta takrorlandi
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="menu-trigger-btn"
                onClick={() => setDrawerOpen(false)}
                aria-label="Menyuni yopish"
              >
                <X size={19} aria-hidden="true" />
              </button>
            </div>

            <nav className="drawer-nav" aria-label="Asosiy bo‘limlar">
              <button
                type="button"
                className={`drawer-nav-item ${tab === 'study' ? 'is-active' : ''}`}
                onClick={() => navigateTo('study')}
              >
                <GraduationCap size={18} aria-hidden="true" />
                <span>Mashq (Vaqt Qutilari)</span>
                {dueCount > 0 && (
                  <span className="drawer-badge is-green">{dueCount}</span>
                )}
              </button>

              <button
                type="button"
                className={`drawer-nav-item ${tab === 'add' ? 'is-active' : ''}`}
                onClick={() => navigateTo('add')}
              >
                <PlusCircle size={18} aria-hidden="true" />
                <span>Yangi so‘z qo‘shish</span>
              </button>

              <button
                type="button"
                className={`drawer-nav-item ${tab === 'library' ? 'is-active' : ''}`}
                onClick={() => navigateTo('library')}
              >
                <FolderOpen size={18} aria-hidden="true" />
                <span>Barcha so‘zlar va Unitlar</span>
                <span className="drawer-badge">{cards.length}</span>
              </button>
            </nav>

            {decks.length > 0 && (
              <div className="drawer-section">
                <div className="drawer-section-title">Unitlar (Tezkor o‘tish)</div>
                <div className="drawer-unit-list">
                  <button
                    type="button"
                    className={`drawer-unit-chip ${
                      studyDeckOverride === 'all' && tab === 'study'
                        ? 'is-active'
                        : ''
                    }`}
                    onClick={() => navigateTo('study', 'all')}
                  >
                    Barchasi ({cards.length})
                  </button>
                  {decks.map((d) => {
                    const count = cards.filter((c) => c.deck === d).length;
                    return (
                      <button
                        key={d}
                        type="button"
                        className={`drawer-unit-chip ${
                          studyDeckOverride === d && tab === 'study'
                            ? 'is-active'
                            : ''
                        }`}
                        onClick={() => navigateTo('study', d)}
                      >
                        {d} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="drawer-section">
              <div className="drawer-section-title">Inglizcha ovoz (Talaffuz)</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  aria-label="Inglizcha ovoz"
                  className="field-select"
                  style={{ minHeight: 38, padding: '6px 10px', fontSize: 13 }}
                  value={voiceUri}
                  onChange={(e) => handleVoiceChange(e.target.value)}
                >
                  <option value="auto">Avto (Lug‘at audio + standart)</option>
                  {voices.map((v) => (
                    <option key={v.uri} value={v.uri}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ minHeight: 38, padding: '6px 10px' }}
                  onClick={() =>
                    speakEnglish('Practice makes permanent', undefined, voiceUri)
                  }
                  title="Ovozni sinab ko‘rish"
                >
                  <Volume2 size={15} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="drawer-section">
              <div className="drawer-section-title">
                Firebase Sinxronizatsiya (Kompyuter ↔ Telefon)
              </div>
              {renderFirebaseSettingsBlock()}
            </div>
          </aside>
        </div>
      )}

      <main className="app-main">
        <div className="app-container">
          {tab === 'study' && (
            <StudyView
              cards={cards}
              decks={decks}
              initialDeck={studyDeckOverride}
              onSelectDeck={setStudyDeckOverride}
              onAnswer={handleAnswer}
              onGoAdd={() => navigateTo('add')}
              onLoadSample={handleLoadSample}
            />
          )}

          {tab === 'add' && (
            <AddView
              decks={decks}
              onAddCards={handleAddCards}
              onEnrichCard={handleEnrichCard}
            />
          )}

          {tab === 'library' && (
            <LibraryView
              cards={cards}
              stats={stats}
              decks={decks}
              onDeleteCard={handleDeleteCard}
              onResetCard={handleResetCard}
              onImportCards={handleImportCards}
              onStudyDeck={(deckName) => navigateTo('study', deckName)}
            />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
