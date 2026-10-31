import { parseM3U } from './m3u';
import { desktop } from './desktop';
import type { Channel } from '../types';

/** Where the playlist comes from: a link (kept in the OS keychain on desktop) or an opened .m3u file. */
export type Source = { kind: 'url'; url: string } | { kind: 'file'; name: string };

const LS_SOURCE = 'gaen.source';
const DB = 'gaen';

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kv<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await idb();
  return new Promise((res, rej) => {
    const req = fn(db.transaction('kv', mode).objectStore('kv'));
    req.onsuccess = () => res(req.result as T);
    req.onerror = () => rej(req.error);
  });
}

export async function saveSource(src: Source, fileText?: string) {
  if (src.kind === 'url') {
    const d = desktop();
    if (d && (await d.secrets.set('playlist', src.url))) localStorage.setItem(LS_SOURCE, JSON.stringify({ kind: 'url', keychain: true }));
    else localStorage.setItem(LS_SOURCE, JSON.stringify(src));
  } else {
    await kv('readwrite', (s) => s.put(fileText ?? '', 'playlistFile'));
    localStorage.setItem(LS_SOURCE, JSON.stringify(src));
  }
}

export async function loadSource(): Promise<Source | null> {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_SOURCE) ?? 'null');
    if (!raw) return null;
    if (raw.kind === 'url' && raw.keychain) {
      const url = await desktop()?.secrets.get('playlist');
      return url ? { kind: 'url', url } : null;
    }
    return raw as Source;
  } catch {
    return null;
  }
}

export async function forgetSource() {
  localStorage.removeItem(LS_SOURCE);
  await desktop()?.secrets.set('playlist', null);
  await kv('readwrite', (s) => s.delete('playlistFile')).catch(() => {});
}

export async function loadChannels(src: Source, signal?: AbortSignal): Promise<Channel[]> {
  let text: string;
  if (src.kind === 'url') {
    let res: Response;
    try {
      res = await fetch(src.url, { signal });
    } catch {
      throw new Error(desktop() ? 'Could not reach the playlist link.' : 'The browser blocked the playlist (CORS). Use the desktop app — it works with any provider.');
    }
    if (!res.ok) throw new Error(`Playlist link answered HTTP ${res.status}.`);
    text = await res.text();
  } else {
    text = (await kv<string | undefined>('readonly', (s) => s.get('playlistFile'))) ?? '';
  }
  if (!/#EXTINF/i.test(text)) throw new Error('That does not look like an .m3u playlist.');
  return parseM3U(text, 'pl', 1).channels.filter((c) => !c.kind || c.kind === 'live');
}

/** Which channel the user put on each station (by channel id); unset stations are matched automatically. */
const LS_PICKS = 'gaen.picks';
export const loadPicks = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(LS_PICKS) ?? '{}'); } catch { return {}; } };
export const savePicks = (p: Record<string, string>) => localStorage.setItem(LS_PICKS, JSON.stringify(p));
