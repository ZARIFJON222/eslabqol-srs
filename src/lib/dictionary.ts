import type { PartOfSpeech } from '../types';

export interface DictionaryEnrichment {
  phonetic?: string;
  audioUrl?: string;
  pos?: PartOfSpeech;
  example?: string;
}

export interface VoiceOption {
  uri: string;
  label: string;
  lang: string;
}

const VOICE_PREF_KEY = 'eslabqol_voice_uri_v1';

interface FreeDictResponseItem {
  phonetic?: string;
  phonetics?: Array<{ text?: string; audio?: string }>;
  meanings?: Array<{
    partOfSpeech?: string;
    definitions?: Array<{ definition?: string; example?: string }>;
  }>;
}

function mapDictPos(raw?: string): PartOfSpeech | undefined {
  if (!raw) return undefined;
  const r = raw.toLowerCase();
  if (r.includes('verb') && !r.includes('adverb')) return 'verb';
  if (r.includes('noun')) return 'noun';
  if (r.includes('adj')) return 'adj';
  if (r.includes('adverb')) return 'adv';
  return undefined;
}

export async function fetchWordDetails(word: string): Promise<DictionaryEnrichment> {
  const clean = word.trim().toLowerCase();
  if (!clean || clean.includes(' ')) return {};

  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(clean)}`
    );
    if (!res.ok) return {};
    const data = (await res.json()) as FreeDictResponseItem[];
    const first = data?.[0];
    if (!first) return {};

    const phonetic =
      first.phonetic || first.phonetics?.find((p) => p.text)?.text || undefined;
    const audioUrl =
      first.phonetics?.find((p) => p.audio && p.audio.length > 0)?.audio || undefined;
    const firstMeaning = first.meanings?.[0];
    const pos = mapDictPos(firstMeaning?.partOfSpeech);

    let example: string | undefined;
    for (const m of first.meanings || []) {
      const found = m.definitions?.find((d) => d.example)?.example;
      if (found) {
        example = found;
        break;
      }
    }

    return { phonetic, audioUrl, pos, example };
  } catch {
    return {};
  }
}

export function getSelectedVoiceUri(): string {
  try {
    return localStorage.getItem(VOICE_PREF_KEY) || 'auto';
  } catch {
    return 'auto';
  }
}

export function setSelectedVoiceUri(uri: string): void {
  try {
    localStorage.setItem(VOICE_PREF_KEY, uri);
  } catch {
    // ignore
  }
}

export function getEnglishVoices(): VoiceOption[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return [];
  }
  const raw = window.speechSynthesis.getVoices();
  const enVoices = raw.filter((v) => v.lang.toLowerCase().startsWith('en'));

  // Sort US & GB voices first, then alphabetically
  enVoices.sort((a, b) => {
    const rank = (lang: string) => {
      const l = lang.toLowerCase();
      if (l === 'en-us') return 0;
      if (l === 'en-gb') return 1;
      return 2;
    };
    const diff = rank(a.lang) - rank(b.lang);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });

  return enVoices.map((v) => ({
    uri: v.voiceURI,
    label: `${v.name.replace(/^Microsoft\s+/i, '').replace(/\s*-\s*English.*$/i, '')} (${v.lang})`,
    lang: v.lang,
  }));
}

let currentAudio: HTMLAudioElement | null = null;

/**
 * Speaks English text.
 * - If user chose a specific browser voice, uses that voice directly.
 * - If 'auto', prefers native dictionary audioUrl when available, falling back to speechSynthesis.
 */
export function speakEnglish(
  text: string,
  audioUrl?: string,
  overrideVoiceUri?: string
): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  const chosenUri = overrideVoiceUri ?? getSelectedVoiceUri();

  if (chosenUri === 'auto' && audioUrl) {
    try {
      const audio = new Audio(audioUrl);
      currentAudio = audio;
      audio.play().catch(() => speakWithSynthesis(text, 'auto'));
      return;
    } catch {
      // fall through
    }
  }

  speakWithSynthesis(text, chosenUri);
}

function speakWithSynthesis(text: string, voiceUri: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';
    utter.rate = 0.94;

    const voices = window.speechSynthesis.getVoices();
    let targetVoice: SpeechSynthesisVoice | undefined;

    if (voiceUri && voiceUri !== 'auto') {
      targetVoice = voices.find((v) => v.voiceURI === voiceUri);
    }
    if (!targetVoice) {
      targetVoice =
        voices.find((v) => v.lang === 'en-US' && v.localService) ||
        voices.find((v) => v.lang === 'en-US') ||
        voices.find((v) => v.lang.toLowerCase().startsWith('en'));
    }

    if (targetVoice) {
      utter.voice = targetVoice;
      utter.lang = targetVoice.lang;
    }
    window.speechSynthesis.speak(utter);
  } catch {
    // ignore speech errors
  }
}
