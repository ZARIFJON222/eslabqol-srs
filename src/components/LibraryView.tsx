import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Play,
  RotateCcw,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import type { DailyStats, WordCard } from '../types';
import {
  SRS_STAGES,
  clampStage,
  formatCountdownUz,
  isCardDue,
  posLabelUz,
} from '../lib/srs';
import { speakEnglish } from '../lib/dictionary';
import { exportBackupJson, parseBackupJson } from '../lib/storage';

interface LibraryViewProps {
  cards: WordCard[];
  stats: DailyStats;
  decks: string[];
  onDeleteCard: (id: string) => void;
  onResetCard: (id: string) => void;
  onImportCards: (imported: WordCard[]) => void;
  onStudyDeck: (deckName: string) => void;
}

export function LibraryView({
  cards,
  stats,
  decks,
  onDeleteCard,
  onResetCard,
  onImportCards,
  onStudyDeck,
}: LibraryViewProps) {
  const [search, setSearch] = useState('');
  const [deckFilter, setDeckFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState<number | 'all'>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const deckSummaries = useMemo(() => {
    const now = Date.now();
    return decks.map((name) => {
      const list = cards.filter((c) => c.deck === name);
      const due = list.filter((c) => isCardDue(c, now)).length;
      return { name, total: list.length, due };
    });
  }, [cards, decks]);

  const stageCounts = useMemo(() => {
    const scoped = cards.filter(
      (c) => deckFilter === 'all' || c.deck === deckFilter
    );
    return SRS_STAGES.map((spec) => ({
      ...spec,
      count: scoped.filter((c) => clampStage(c.stage) === spec.stage).length,
    }));
  }, [cards, deckFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards
      .filter((c) => deckFilter === 'all' || c.deck === deckFilter)
      .filter((c) => stageFilter === 'all' || clampStage(c.stage) === stageFilter)
      .filter(
        (c) =>
          !q ||
          c.en.toLowerCase().includes(q) ||
          c.uz.toLowerCase().includes(q) ||
          c.deck.toLowerCase().includes(q)
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [cards, search, deckFilter, stageFilter]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseBackupJson(text);
    if (!parsed) {
      setImportMsg('Fayl formati noto‘g‘ri. EslabQol JSON faylini tanlang.');
    } else {
      onImportCards(parsed);
      setImportMsg(`${parsed.length} ta so‘z zaxiradan yuklandi.`);
    }
    e.target.value = '';
  };

  return (
    <section aria-label="Unitlar va so‘zlar">
      <div className="section-header-row">
        <div>
          <h1 className="section-title">Unitlar va so‘zlar</h1>
          <p className="section-sub">
            Jami {decks.length} ta unit va {cards.length} ta so‘z
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => exportBackupJson(cards, stats)}
            disabled={cards.length === 0}
          >
            <Download size={15} aria-hidden="true" />
            Export
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={15} aria-hidden="true" />
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      </div>

      {importMsg && (
        <div className="notice-banner" role="status">
          {importMsg}
        </div>
      )}

      {deckSummaries.length > 0 && (
        <div className="deck-grid">
          {deckSummaries.map((d) => {
            const isSelected = deckFilter === d.name;
            return (
              <div
                key={d.name}
                className={`deck-card ${isSelected ? 'is-selected' : ''}`}
                onClick={() =>
                  setDeckFilter((prev) => (prev === d.name ? 'all' : d.name))
                }
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setDeckFilter((prev) => (prev === d.name ? 'all' : d.name));
                  }
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <span className="deck-card-title">{d.name}</span>
                  {d.due > 0 && (
                    <span className="chip is-accent mono">{d.due} tayyor</span>
                  )}
                </div>

                <div className="deck-card-meta">
                  <span className="mono">{d.total} ta so‘z</span>
                  <button
                    type="button"
                    className="btn-indigo"
                    style={{ minHeight: 34, padding: '4px 12px', fontSize: 12 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onStudyDeck(d.name);
                    }}
                  >
                    <Play size={13} aria-hidden="true" />
                    Mashq
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="srs-strip" role="group" aria-label="Takrorlash oralig‘i bo‘yicha filtr">
        <button
          type="button"
          className={`srs-pill ${stageFilter === 'all' ? 'is-active' : ''}`}
          onClick={() => setStageFilter('all')}
        >
          Barchasi
        </button>
        {stageCounts.map((s) => (
          <button
            key={s.stage}
            type="button"
            className={`srs-pill ${stageFilter === s.stage ? 'is-active' : ''}`}
            onClick={() => setStageFilter(s.stage)}
          >
            <span>{s.label}</span>
            <span className="srs-pill-num">{s.count}</span>
          </button>
        ))}
      </div>

      <div className="toolbar-row">
        <input
          type="search"
          aria-label="So‘z qidirish"
          className="field-input"
          placeholder="So‘z yoki tarjima qidirish..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="empty-card">
          <p className="empty-desc">Mos so‘z topilmadi.</p>
        </div>
      ) : (
        <div className="word-list">
          {filtered.map((card) => {
            const due = isCardDue(card, now);
            return (
              <div key={card.id} className="word-row-card">
                <div className="word-row-left">
                  <button
                    type="button"
                    className="btn-icon-round"
                    style={{ width: 36, height: 36 }}
                    aria-label={`${card.en} talaffuzi`}
                    onClick={() => speakEnglish(card.en, card.audioUrl)}
                  >
                    <Volume2 size={16} aria-hidden="true" />
                  </button>

                  <div style={{ minWidth: 0 }}>
                    <div className="word-row-en">
                      {card.en}{' '}
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          color: 'var(--text-muted)',
                          marginLeft: 4,
                        }}
                      >
                        {posLabelUz(card.pos)}
                      </span>
                    </div>
                    <div className="word-row-uz">{card.uz}</div>
                  </div>
                </div>

                <div className="word-row-meta">
                  <span className={`chip mono ${due ? 'is-green' : ''}`}>
                    {due
                      ? 'Tayyor'
                      : formatCountdownUz(card.nextReviewAt, now)}
                  </span>
                  <span className="chip is-accent mono">
                    {SRS_STAGES[clampStage(card.stage)]?.title || 'Har 1 soatda'}
                  </span>

                  <button
                    type="button"
                    className="btn-danger-icon"
                    title="Bosqichni nolga qaytarish"
                    aria-label="Bosqichni nolga qaytarish"
                    onClick={() => onResetCard(card.id)}
                  >
                    <RotateCcw size={15} aria-hidden="true" />
                  </button>

                  {confirmDeleteId === card.id ? (
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{
                        minHeight: 32,
                        padding: '2px 10px',
                        fontSize: 12,
                        borderColor: 'var(--accent-red)',
                        color: 'var(--accent-red)',
                      }}
                      onClick={() => {
                        onDeleteCard(card.id);
                        setConfirmDeleteId(null);
                      }}
                    >
                      O‘chirish
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-danger-icon"
                      title="O‘chirish"
                      aria-label="O‘chirish"
                      onClick={() => setConfirmDeleteId(card.id)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
