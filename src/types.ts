// Core domain types shared by providers, stores and UI.

export interface Channel {
  id: string;
  number: number;
  name: string;
  group: string;
  /** Short text mark shown when no logo image is available. */
  mark: string;
  logo?: string;
  url: string;
  /** XMLTV channel id (tvg-id) used to join guide data. */
  tvgId?: string;
  sourceId: string;
  /** Optional backup stream URLs supplied by the playlist owner. */
  fallbackUrls?: string[];
  /** HTTP options from #EXTVLCOPT / attributes (informational in the browser). */
  userAgent?: string;
  referrer?: string;
  /** Other request headers from the playlist (Origin, Cookie, ...): #EXTVLCOPT, #EXTHTTP, #KODIPROP, |pipe options. */
  headers?: Record<string, string>;
  /** Live channel (default), movie, or series episode: see lib/content.ts. */
  kind?: 'live' | 'movie' | 'series';
  /** Movies/episodes: cleaned title and year. */
  title?: string;
  year?: number;
  series?: { show: string; season: number; episode: number };
}
