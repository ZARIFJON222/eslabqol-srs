import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  Pencil,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  X,
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
import { auditWordsWithAi, getGeminiApiKey } from '../lib/ai';
import {
  getSyncId,
  listCloudBackups,
  type CloudBackupEntry,
} from '../lib/firebase';

interface LibraryViewProps {
  cards: WordCard[];
  stats: DailyStats;
  decks: string[];
  onDeleteCard: (id: string) => void;
  onResetCard: (id: string) => void;
  onUpdateCard: (
    id: string,
    patch: Partial<Pick<WordCard, 'en' | 'uz' | 'deck'>>
  ) => void;
  onRenameDeck: (oldName: string, newName: string) => void;
  onBatchFixCards: (
    updates: Array<{ id: string; en: string; uz: string }>
  ) => void;
  onImportCards: (imported: WordCard[]) => void;
  onStudyDeck: (deckName: string) => void;
}

export function LibraryView({
  cards,
  stats,
  decks,
  onDeleteCard,
  onResetCard,
  onUpdateCard,
  onRenameDeck,
  onBatchFixCards,
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

  // Unit rename state
  const [renamingDeck, setRenamingDeck] = useState<string | null>(null);
  const [renameDeckValue, setRenameDeckValue] = useState('');

  // Word inline edit state
  const [editingWordId, setEditingWordId] = useState<string | null>(null);
  const [editEn, setEditEn] = useState('');
  const [editUz, setEditUz] = useState('');
  const [editDeck, setEditDeck] = useState('');

  // AI Audit & Cloud Backups state
  const [aiAuditing, setAiAuditing] = useState(false);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [cloudBackups, setCloudBackups] = useState<CloudBackupEntry[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);

  const handleOpenBackups = async () => {
    if (backupsOpen) {
      setBackupsOpen(false);
      return;
    }
    setBackupsOpen(true);
    setBackupsLoading(true);
    const list = await listCloudBackups(getSyncId());
    setCloudBackups(list);
    setBackupsLoading(false);
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const deckSummaries = useMemo(() => {
    return decks.map((name) => {
      const list = cards.filter((c) => c.deck === name);
      const due = list.filter((c) => isCardDue(c, now)).length;
      return { name, total: list.length, due };
    });
  }, [cards, decks, now]);

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
      .filter(
        (c) => stageFilter === 'all' || clampStage(c.stage) === stageFilter
      )
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

  const handleNormalizeAndAiFix = async () => {
    if (filtered.length === 0 || aiAuditing) return;
    setAiAuditing(true);
    setImportMsg(null);

    try {
      if (getGeminiApiKey()) {
        const targetSlice = filtered.slice(0, 40);
        const fixes = await auditWordsWithAi(targetSlice);
        const updates = fixes.map((f) => ({ id: f.id, en: f.en, uz: f.uz }));
        if (updates.length > 0) {
          onBatchFixCards(updates);
          setImportMsg(
            `AI ${updates.length} ta so‘zni tekshirdi: katta harflar va imlo xatolari to‘g‘rilandi!`
          );
          return;
        }
      }

      // Offline / no-key fallback: lowercase accidental leading capitals
      const localFixes = filtered.map((c) => ({
        id: c.id,
        en: c.en.trim().toLowerCase(),
        uz: c.uz.trim().toLowerCase(),
      }));
      onBatchFixCards(localFixes);
      setImportMsg(
        `${localFixes.length} ta so‘zda bosh harflar kichik harfga to‘g‘rilandi.`
      );
    } catch (e) {
      setImportMsg(
        e instanceof Error ? e.message : 'AI bilan tekshirishda xatolik.'
      );
    } finally {
      setAiAuditing(false);
    }
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

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            className="btn-indigo"
            style={{ minHeight: 38, padding: '6px 12px', fontSize: 13 }}
            disabled={filtered.length === 0 || aiAuditing}
            onClick={() => void handleNormalizeAndAiFix()}
          >
            <Sparkles size={14} aria-hidden="true" />
            {aiAuditing ? 'Tekshirilmoqda...' : 'AI bilan tozalash'}
          </button>

          <button
            type="button"
            className="btn-ghost"
            onClick={() => void handleOpenBackups()}
          >
            <RotateCcw size={15} aria-hidden="true" />
            Zaxiralar
          </button>
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

      {backupsOpen && (
        <div className="wc-card" style={{ marginBottom: 16, padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
            Avtomatik kunlik Firebase zaxiralari
          </div>
          {backupsLoading ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Zaxiralar yuklanmoqda...
            </p>
          ) : cloudBackups.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Hali kunlik zaxira yaratilmagan (yangi so‘z qo‘shilishi bilan avtomatik yaratiladi).
            </p>
          ) : (
            <div className="word-list">
              {cloudBackups.map((b) => (
                <div key={b.dateKey} className="word-row-card" style={{ padding: '10px 12px' }}>
                  <div>
                    <strong className="mono">{b.dateKey}</strong>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 10 }}>
                      {b.count} ta so‘z
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-green"
                    style={{ minHeight: 34, padding: '4px 12px', fontSize: 12 }}
                    onClick={() => {
                      onImportCards(b.cards);
                      setImportMsg(`${b.dateKey} sanasidagi ${b.count} ta so‘z tiklandi!`);
                      setBackupsOpen(false);
                    }}
                  >
                    Tiklash
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {deckSummaries.length > 0 && (
        <div className="deck-grid">
          {deckSummaries.map((d) => {
            const isSelected = deckFilter === d.name;
            const isRenaming = renamingDeck === d.name;

            return (
              <div
                key={d.name}
                className={`deck-card ${isSelected ? 'is-selected' : ''}`}
                onClick={() => {
                  if (!isRenaming) {
                    setDeckFilter((prev) => (prev === d.name ? 'all' : d.name));
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (!isRenaming && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    setDeckFilter((prev) => (prev === d.name ? 'all' : d.name));
                  }
                }}
              >
                {isRenaming ? (
                  <div
                    style={{ display: 'flex', gap: 6 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      className="field-input"
                      style={{ minHeight: 36, padding: '4px 10px', fontSize: 13 }}
                      value={renameDeckValue}
                      onChange={(e) => setRenameDeckValue(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="btn-green"
                      style={{ minHeight: 36, padding: '4px 10px' }}
                      onClick={() => {
                        const clean = renameDeckValue.trim();
                        if (clean && clean !== d.name) {
                          onRenameDeck(d.name, clean);
                          if (deckFilter === d.name) setDeckFilter(clean);
                        }
                        setRenamingDeck(null);
                      }}
                    >
                      <Check size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ minHeight: 36, padding: '4px 10px' }}
                      onClick={() => setRenamingDeck(null)}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 8,
                    }}
                  >
                    <span className="deck-card-title">{d.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {d.due > 0 && (
                        <span className="chip is-accent mono">
                          {d.due} tayyor
                        </span>
                      )}
                      <button
                        type="button"
                        className="btn-danger-icon"
                        style={{ width: 28, height: 28 }}
                        title="Unit nomini tahrirlash"
                        aria-label={`${d.name} nomini tahrirlash`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingDeck(d.name);
                          setRenameDeckValue(d.name);
                        }}
                      >
                        <Pencil size={13} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                )}

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

      <div
        className="srs-strip"
        role="group"
        aria-label="Takrorlash oralig‘i bo‘yicha filtr"
      >
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
            const isEditing = editingWordId === card.id;

            if (isEditing) {
              return (
                <div
                  key={card.id}
                  className="word-row-card"
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}
                >
                  <div className="form-2col">
                    <input
                      className="field-input"
                      value={editEn}
                      onChange={(e) => setEditEn(e.target.value)}
                      placeholder="Inglizcha"
                    />
                    <input
                      className="field-input"
                      value={editUz}
                      onChange={(e) => setEditUz(e.target.value)}
                      placeholder="O‘zbekcha"
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="field-input"
                      style={{ flex: 1 }}
                      value={editDeck}
                      onChange={(e) => setEditDeck(e.target.value)}
                      placeholder="Unit nomi"
                    />
                    <button
                      type="button"
                      className="btn-green"
                      style={{ minHeight: 40, padding: '6px 14px' }}
                      onClick={() => {
                        if (editEn.trim() && editUz.trim()) {
                          onUpdateCard(card.id, {
                            en: editEn.trim(),
                            uz: editUz.trim(),
                            deck: editDeck.trim() || card.deck,
                          });
                        }
                        setEditingWordId(null);
                      }}
                    >
                      <Check size={15} aria-hidden="true" />
                      Saqlash
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ minHeight: 40 }}
                      onClick={() => setEditingWordId(null)}
                    >
                      Bekor
                    </button>
                  </div>
                </div>
              );
            }

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
                    {SRS_STAGES[clampStage(card.stage)]?.label || '1 soat'}
                  </span>

                  <button
                    type="button"
                    className="btn-danger-icon"
                    title="So‘zni tahrirlash"
                    aria-label={`${card.en} so‘zini tahrirlash`}
                    onClick={() => {
                      setEditingWordId(card.id);
                      setEditEn(card.en);
                      setEditUz(card.uz);
                      setEditDeck(card.deck);
                    }}
                  >
                    <Pencil size={14} aria-hidden="true" />
                  </button>

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
