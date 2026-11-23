import { useMemo, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import type { WordCard } from '../types';
import { fetchWordDetails } from '../lib/dictionary';
import { autoCorrectEnglish, autoCorrectUzbek } from '../lib/spellcheck';
import { inferPartOfSpeech } from '../lib/srs';

interface AddViewProps {
  decks: string[];
  onAddCards: (newCards: WordCard[]) => void;
  onEnrichCard: (
    id: string,
    patch: Partial<Pick<WordCard, 'phonetic' | 'audioUrl' | 'pos' | 'example'>>
  ) => void;
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AddView({ decks, onAddCards, onEnrichCard }: AddViewProps) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [isNewDeck, setIsNewDeck] = useState(decks.length === 0);
  const [selectedDeck, setSelectedDeck] = useState(
    decks[0] || 'Essential 3 — Unit 1'
  );
  const [newDeckName, setNewDeckName] = useState('');
  const [en, setEn] = useState('');
  const [uz, setUz] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activeDeckName = (
    isNewDeck
      ? newDeckName.trim() || `Essential 3 — Unit ${decks.length + 1}`
      : selectedDeck.trim() || decks[0] || 'Essential 3 — Unit 1'
  );

  const parsedBulk = useMemo(() => {
    const lines = bulkText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const items: Array<{ en: string; uz: string }> = [];
    for (const line of lines) {
      const match = line.match(/^(.+?)\s*(?:[-–—=]|\t)\s*(.+)$/);
      if (match) {
        const left = match[1].trim();
        const right = match[2].trim();
        if (left && right) items.push({ en: left, uz: right });
      }
    }
    return items;
  }, [bulkText]);

  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawEn = en.trim();
    const rawUz = uz.trim();
    const cleanDeck = activeDeckName;
    if (!rawEn || !rawUz || saving) return;

    setSaving(true);
    const [enCheck, uzCheck] = await Promise.all([
      autoCorrectEnglish(rawEn),
      Promise.resolve(autoCorrectUzbek(rawUz)),
    ]);
    setSaving(false);

    const cleanEn = enCheck.text;
    const cleanUz = uzCheck.text;

    const id = makeId();
    const card: WordCard = {
      id,
      en: cleanEn,
      uz: cleanUz,
      pos: inferPartOfSpeech(cleanEn, cleanUz),
      deck: cleanDeck,
      stage: 0,
      nextReviewAt: Date.now(),
      createdAt: Date.now(),
      correctCount: 0,
      wrongCount: 0,
      recentDistractors: [],
    };

    onAddCards([card]);
    setSelectedDeck(cleanDeck);
    setIsNewDeck(false);
    setNewDeckName('');
    setEn('');
    setUz('');

    const fixes: string[] = [];
    if (enCheck.changed) fixes.push(`${rawEn} → ${cleanEn}`);
    if (uzCheck.changed) fixes.push(`${rawUz} → ${cleanUz}`);
    setNotice(
      fixes.length > 0
        ? `Imlo to‘g‘rilandi (${fixes.join(', ')}) va qo‘shildi.`
        : `“${cleanEn}” qo‘shildi.`
    );

    // Auto-enrich phonetic, audio, POS & example quietly in background
    const details = await fetchWordDetails(cleanEn);
    if (details.phonetic || details.audioUrl || details.example || details.pos) {
      onEnrichCard(id, details);
    }
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedBulk.length === 0 || saving) return;
    const cleanDeck = activeDeckName;
    const now = Date.now();

    setSaving(true);
    let fixedCount = 0;
    const created: WordCard[] = [];

    for (let idx = 0; idx < parsedBulk.length; idx++) {
      const item = parsedBulk[idx];
      const enCheck = await autoCorrectEnglish(item.en);
      const uzCheck = autoCorrectUzbek(item.uz);
      if (enCheck.changed || uzCheck.changed) fixedCount++;

      created.push({
        id: `${makeId()}-${idx}`,
        en: enCheck.text,
        uz: uzCheck.text,
        pos: inferPartOfSpeech(enCheck.text, uzCheck.text),
        deck: cleanDeck,
        stage: 0,
        nextReviewAt: now + idx,
        createdAt: now,
        correctCount: 0,
        wrongCount: 0,
        recentDistractors: [],
      });
    }
    setSaving(false);

    onAddCards(created);
    setSelectedDeck(cleanDeck);
    setIsNewDeck(false);
    setNewDeckName('');
    setBulkText('');
    setNotice(
      fixedCount > 0
        ? `${created.length} ta so‘z qo‘shildi (${fixedCount} tasida imlo avtomatik to‘g‘rilandi).`
        : `${created.length} ta so‘z qo‘shildi.`
    );

    for (const c of created) {
      const details = await fetchWordDetails(c.en);
      if (details.phonetic || details.audioUrl || details.example || details.pos) {
        onEnrichCard(c.id, details);
      }
    }
  };

  return (
    <section className="wc-card" aria-label="So‘z qo‘shish">
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div className="pill-switch" role="group" aria-label="Qo‘shish turi">
          <button
            type="button"
            className={`pill-switch-btn ${mode === 'single' ? 'is-active' : ''}`}
            onClick={() => {
              setMode('single');
              setNotice(null);
            }}
          >
            Bitta so‘z
          </button>
          <button
            type="button"
            className={`pill-switch-btn ${mode === 'bulk' ? 'is-active' : ''}`}
            onClick={() => {
              setMode('bulk');
              setNotice(null);
            }}
          >
            Ro‘yxat (Unit)
          </button>
        </div>
      </div>

      {notice && (
        <div className="notice-banner" role="status">
          {notice}
        </div>
      )}

      <div className="form-stack">
        <div>
          <label className="field-label" htmlFor="deck-select">
            Qaysi unitga qo‘shamiz?
          </label>
          {!isNewDeck && decks.length > 0 ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                id="deck-select"
                className="field-select"
                style={{ flex: 1 }}
                value={decks.includes(selectedDeck) ? selectedDeck : decks[0]}
                onChange={(e) => setSelectedDeck(e.target.value)}
              >
                {decks.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-ghost"
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => {
                  setIsNewDeck(true);
                  setNewDeckName(`Essential 3 — Unit ${decks.length + 1}`);
                }}
              >
                <Plus size={15} aria-hidden="true" />
                Yangi unit
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id="deck-select"
                className="field-input"
                style={{ flex: 1 }}
                value={newDeckName}
                onChange={(e) => setNewDeckName(e.target.value)}
                placeholder={`Essential 3 — Unit ${decks.length + 1}`}
              />
              {decks.length > 0 && (
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ whiteSpace: 'nowrap' }}
                  onClick={() => setIsNewDeck(false)}
                >
                  Mavjudidan tanlash
                </button>
              )}
            </div>
          )}
        </div>

        {mode === 'single' ? (
          <form onSubmit={handleSingleSubmit} className="form-stack">
            <div>
              <label className="field-label" htmlFor="en-input">
                Inglizcha
              </label>
              <input
                id="en-input"
                className="field-input"
                value={en}
                onChange={(e) => setEn(e.target.value)}
                placeholder="compensate"
                autoComplete="off"
                required
              />
            </div>

            <div>
              <label className="field-label" htmlFor="uz-input">
                O‘zbekcha
              </label>
              <input
                id="uz-input"
                className="field-input"
                value={uz}
                onChange={(e) => setUz(e.target.value)}
                placeholder="o‘rnini qoplamoq"
                autoComplete="off"
                required
              />
            </div>

            <button
              type="submit"
              className="btn-green"
              style={{ width: '100%', marginTop: 4 }}
              disabled={saving}
            >
              <Plus size={18} aria-hidden="true" />
              {saving ? 'Tekshirilmoqda...' : 'Qo‘shish'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleBulkSubmit} className="form-stack">
            <div>
              <label className="field-label" htmlFor="bulk-textarea">
                Har qatorga: inglizcha - o‘zbekcha
              </label>
              <textarea
                id="bulk-textarea"
                className="field-textarea"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={
                  'arise - paydo bo‘lmoq\nbenefactor - homiy\ncharitable - saxovatli'
                }
              />
            </div>

            <button
              type="submit"
              className="btn-green"
              style={{ width: '100%' }}
              disabled={parsedBulk.length === 0 || saving}
            >
              <Sparkles size={17} aria-hidden="true" />
              {saving
                ? 'Imlo tekshirilmoqda...'
                : `Barchasini qo‘shish (${parsedBulk.length})`}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
