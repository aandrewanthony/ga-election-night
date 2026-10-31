import type { Channel } from '../types';

/** The Atlanta stations this app is built around. The first four fill the quad by default. */
export interface Station {
  key: StationKey;
  network: string;
  /** Short on-air name, e.g. "WSB-TV 2". */
  call: string;
  brand: string;
  color: string;
  /** Strong identifiers: a callsign or on-air brand. */
  strong: RegExp[];
  /** Network word that counts only next to "Atlanta" / "Georgia". */
  network_re: RegExp;
}
export type StationKey = 'gpb' | 'abc' | 'nbc' | 'cbs' | 'fox' | 'pba';

export const STATIONS: Station[] = [
  { key: 'gpb', network: 'GPB', call: 'GPB · WGTV 8', brand: 'Georgia Public Broadcasting', color: '#2f8fd8',
    strong: [/\bgpb\b/, /georgia public/, /\bwgtv\b/], network_re: /\bpbs\b/ },
  { key: 'abc', network: 'ABC', call: 'WSB-TV 2', brand: 'Channel 2 Action News', color: '#e8e8e8',
    strong: [/\bwsb\b/, /\bwsbtv\b/, /channel 2 action/], network_re: /\babc\b/ },
  { key: 'nbc', network: 'NBC', call: 'WXIA 11', brand: '11Alive', color: '#f2a73b',
    strong: [/\bwxia\b/, /\b11 ?alive\b/], network_re: /\bnbc\b/ },
  { key: 'cbs', network: 'CBS', call: 'WANF 46', brand: 'Atlanta News First', color: '#4fa3ff',
    strong: [/\bwanf\b/, /\bwgcl\b/, /atlanta news first/, /\bcbs ?46\b/], network_re: /\bcbs\b/ },
  { key: 'fox', network: 'FOX', call: 'WAGA 5', brand: 'FOX 5 Atlanta', color: '#9aa4b2',
    strong: [/\bwaga\b/, /\bfox ?5 atlanta\b/], network_re: /\bfox\b/ },
  { key: 'pba', network: 'PBS', call: 'WPBA 30', brand: 'PBS Atlanta', color: '#6fc2a0',
    strong: [/\bwpba\b/, /\bpbs atlanta\b/, /\batlanta pbs\b/, /\batl pba\b/], network_re: /\bpba\b/ },
];
export const QUAD: StationKey[] = ['gpb', 'abc', 'nbc', 'cbs'];
export const stationOf = (k: StationKey) => STATIONS.find((s) => s.key === k)!;

const norm = (s: string) => s.toLowerCase().replace(/[_|:()[\]{}]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
const LOCAL = /\b(atlanta|atl|georgia)\b|\bga\b/;
// Game / event channels ("NFL Teams: CBS Falcons (WGCL)") and replays: a fallback at best.
const SPORTSY = /\b(nfl|nba|wnba|mlb|mls|nhl|ncaa|ppv|falcons|braves|hawks|dream|united|vs|@)\b/;
const EVENTY = /\b\d{1,2}[:.]\d{2}\b|\b20\d\d\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/;
const OTHER_MARKETS = /\b(new york|los angeles|chicago|miami|boston|dallas|houston|denver|seattle|detroit|philadelphia|phoenix|tampa|orlando|charlotte|nashville|savannah|macon|augusta|columbus|albany|chattanooga|jacksonville|birmingham)\b/;

/** How strongly a playlist channel looks like this station (0 = not it). */
export function scoreChannel(st: Station, ch: Channel): number {
  if (ch.kind && ch.kind !== 'live') return 0;
  const n = norm(ch.name);
  const g = norm(ch.group ?? '');
  let s = 0;
  if (st.strong.some((re) => re.test(n))) s += 10;
  else if (st.network_re.test(n) && LOCAL.test(n)) s += 6;
  else if (st.network_re.test(n) && /\b(atlanta|georgia)\b/.test(g)) s += 4;
  else return 0;
  if (LOCAL.test(n)) s += 2;
  if (/\b(us|usa|local|locals)\b/.test(g) || /\b(local|locals)\b/.test(n)) s += 1;
  if (/\bhd\b|\bfhd\b|\b1080/.test(n)) s += 0.5;
  if (SPORTSY.test(n)) s -= 4;
  if (EVENTY.test(n)) s -= 6;
  if (OTHER_MARKETS.test(n) && !st.strong.some((re) => re.test(n))) s -= 6;
  if (/\b(backup|test|4k|uhd|sd)\b/.test(n)) s -= 0.5;
  // GPB vs. Atlanta's PBS (WPBA): "PBS Atlanta" belongs to WPBA.
  if (st.key === 'gpb' && /\bwpba\b|pbs atlanta|atlanta pbs/.test(n)) return 0;
  return s;
}

export interface Ranked { ch: Channel; score: number }

/** Best playlist channels for a station, best first. */
export function candidates(st: Station, channels: Channel[], limit = 12): Ranked[] {
  const out: Ranked[] = [];
  for (const ch of channels) {
    const score = scoreChannel(st, ch);
    if (score > 0) out.push({ ch, score });
  }
  out.sort((a, b) => b.score - a.score || a.ch.name.length - b.ch.name.length);
  return out.slice(0, limit);
}

/** Atlanta / Georgia related live channels, for the manual picker's default view. */
export function localChannels(channels: Channel[]): Channel[] {
  return channels.filter((c) => (!c.kind || c.kind === 'live') && (LOCAL.test(norm(c.name)) || /\b(atlanta|georgia)\b/.test(norm(c.group ?? ''))));
}
