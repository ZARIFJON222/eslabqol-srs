import type { DailyStats, WordCard } from '../types';

export interface FirebaseConfigData {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  databaseURL?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

const FB_CONFIG_KEY = 'eslabqol_firebase_config_v1';
const FB_SYNC_ID_KEY = 'eslabqol_sync_id_v1';
const DELETED_IDS_KEY = 'eslabqol_deleted_ids_v1';

const DEFAULT_KARTA_FIREBASE_CONFIG: FirebaseConfigData = {
  apiKey: 'AIzaSyCNH5U1C_JNy3oaAVXs71g8IKxeF_koR5k',
  authDomain: 'karta-d23be.firebaseapp.com',
  databaseURL: 'https://karta-d23be-default-rtdb.firebaseio.com',
  projectId: 'karta-d23be',
  storageBucket: 'karta-d23be.firebasestorage.app',
  messagingSenderId: '195654108406',
  appId: '1:195654108406:web:86443492750129ff2898d7',
};

export function loadDeletedIds(): string[] {
  try {
    const raw = localStorage.getItem(DELETED_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function saveDeletedIds(ids: string[]): void {
  try {
    // Keep last 500 tombstones
    const trimmed = Array.from(new Set(ids)).slice(-500);
    localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore
  }
}

export function getSyncId(): string {
  try {
    return localStorage.getItem(FB_SYNC_ID_KEY) || 'asosiy';
  } catch {
    return 'asosiy';
  }
}

export function setSyncId(id: string): void {
  const clean =
    id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'asosiy';
  try {
    localStorage.setItem(FB_SYNC_ID_KEY, clean);
  } catch {
    // ignore
  }
}

export function getActiveFirebaseConfig(): FirebaseConfigData | null {
  const envApiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
  const envProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as
    | string
    | undefined;

  if (envApiKey && envProjectId) {
    return {
      apiKey: envApiKey,
      authDomain:
        (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) ||
        `${envProjectId}.firebaseapp.com`,
      projectId: envProjectId,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL as
        | string
        | undefined,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as
        | string
        | undefined,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as
        | string
        | undefined,
      appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
    };
  }

  try {
    const raw = localStorage.getItem(FB_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as FirebaseConfigData;
      if (parsed?.apiKey && parsed?.projectId) return parsed;
    }
  } catch {
    // ignore
  }

  return DEFAULT_KARTA_FIREBASE_CONFIG;
}

export function parseFirebaseConfigInput(
  input: string
): FirebaseConfigData | null {
  const extract = (key: string): string | undefined => {
    const m = input.match(
      new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`)
    );
    return m?.[1]?.trim();
  };

  const apiKey = extract('apiKey');
  const projectId = extract('projectId');
  if (!apiKey || !projectId) return null;

  return {
    apiKey,
    authDomain: extract('authDomain') || `${projectId}.firebaseapp.com`,
    projectId,
    databaseURL: extract('databaseURL'),
    storageBucket: extract('storageBucket'),
    messagingSenderId: extract('messagingSenderId'),
    appId: extract('appId'),
  };
}

export function saveFirebaseConfig(config: FirebaseConfigData | null): void {
  try {
    if (!config) {
      localStorage.removeItem(FB_CONFIG_KEY);
    } else {
      localStorage.setItem(FB_CONFIG_KEY, JSON.stringify(config));
    }
  } catch {
    // ignore
  }
}

/**
 * Merges local and cloud cards while respecting deletedIds tombstones
 * so deleted words NEVER resurrect across devices or accounts.
 */
export function mergeCardLists(
  local: WordCard[],
  remote: WordCard[],
  deletedIds: string[] = []
): WordCard[] {
  const deletedSet = new Set(deletedIds);
  const map = new Map<string, WordCard>();

  for (const c of local) {
    if (!deletedSet.has(c.id)) {
      map.set(c.id, c);
    }
  }
  for (const r of remote) {
    if (deletedSet.has(r.id)) continue;
    const existing = map.get(r.id);
    if (!existing) {
      map.set(r.id, r);
    } else {
      const localStamp = existing.lastReviewedAt || existing.createdAt || 0;
      const remoteStamp = r.lastReviewedAt || r.createdAt || 0;
      if (remoteStamp >= localStamp) {
        map.set(r.id, r);
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export interface CloudPayload {
  cards?: WordCard[];
  deletedIds?: string[];
  stats?: DailyStats;
  updatedAt?: number;
}

// Track in-flight push count so periodic pulls never overwrite an active delete/add
let activePushCount = 0;

export function isPushInFlight(): boolean {
  return activePushCount > 0;
}

async function fetchFromCloud(
  cfg: FirebaseConfigData,
  syncId: string
): Promise<CloudPayload | null> {
  const safeId = encodeURIComponent(syncId || 'asosiy');

  if (cfg.databaseURL) {
    const base = cfg.databaseURL.replace(/\/$/, '');
    const res = await fetch(`${base}/eslabqol_workspaces/${safeId}.json`, {
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`RTDB HTTP ${res.status}`);
    }
    const data = (await res.json()) as CloudPayload | null;
    if (!data) {
      return { cards: [], deletedIds: [] };
    }
    return {
      cards: Array.isArray(data.cards) ? data.cards : [],
      deletedIds: Array.isArray(data.deletedIds) ? data.deletedIds : [],
      stats: data.stats,
      updatedAt: data.updatedAt,
    };
  }

  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    cfg.projectId
  )}/databases/(default)/documents/eslabqol_workspaces/${safeId}?key=${encodeURIComponent(
    cfg.apiKey
  )}`;

  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) {
    return { cards: [], deletedIds: [] };
  }
  if (!res.ok) {
    throw new Error(`Firestore HTTP ${res.status}`);
  }
  const docJson = (await res.json()) as {
    fields?: { payload?: { stringValue?: string } };
  };
  const rawPayload = docJson?.fields?.payload?.stringValue;
  if (!rawPayload) return { cards: [], deletedIds: [] };
  return JSON.parse(rawPayload) as CloudPayload;
}

export function subscribeToCloudSync(
  syncId: string,
  onRemoteData: (
    cards: WordCard[],
    deletedIds: string[],
    stats?: DailyStats
  ) => void,
  onStatusChange: (status: 'off' | 'connecting' | 'connected' | 'error') => void
): (() => void) | null {
  const cfg = getActiveFirebaseConfig();
  if (!cfg) {
    onStatusChange('off');
    return null;
  }

  let active = true;
  onStatusChange('connecting');

  const pull = async () => {
    if (!active || isPushInFlight()) return;
    try {
      const data = await fetchFromCloud(cfg, syncId);
      if (!active || isPushInFlight()) return;
      onStatusChange('connected');
      if (data) {
        onRemoteData(
          Array.isArray(data.cards) ? data.cards : [],
          Array.isArray(data.deletedIds) ? data.deletedIds : [],
          data.stats
        );
      }
    } catch {
      if (active) onStatusChange('error');
    }
  };

  void pull();
  const intervalId = window.setInterval(() => void pull(), 4000);
  const onFocus = () => void pull();
  const onVis = () => {
    if (document.visibilityState === 'visible') void pull();
  };

  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVis);

  return () => {
    active = false;
    window.clearInterval(intervalId);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVis);
  };
}

export async function pushToCloud(
  syncId: string,
  cards: WordCard[],
  stats: DailyStats,
  deletedIds: string[] = []
): Promise<boolean> {
  const cfg = getActiveFirebaseConfig();
  if (!cfg) return false;

  const safeId = encodeURIComponent(syncId || 'asosiy');
  const payloadObj: CloudPayload = {
    cards,
    deletedIds: Array.from(new Set(deletedIds)).slice(-500),
    stats,
    updatedAt: Date.now(),
  };

  activePushCount++;
  try {
    if (cfg.databaseURL) {
      try {
        const base = cfg.databaseURL.replace(/\/$/, '');
        const res = await fetch(`${base}/eslabqol_workspaces/${safeId}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadObj),
        });
        if (res.ok) return true;
      } catch {
        // fall through to Firestore REST
      }
    }

    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      cfg.projectId
    )}/databases/(default)/documents/eslabqol_workspaces/${safeId}?key=${encodeURIComponent(
      cfg.apiKey
    )}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          payload: {
            stringValue: JSON.stringify(payloadObj),
          },
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    activePushCount = Math.max(0, activePushCount - 1);
  }
}
