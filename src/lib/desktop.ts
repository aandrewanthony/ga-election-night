import type { Channel } from '../types';

export interface StreamInfo { video: string | null; audio: string | null; interlaced: boolean; resolution: string | null; pixFmt?: string | null; profile?: string | null; httpStatus?: number | null }
export type HeaderMap = Record<string, string>;

export interface DesktopBridge {
  platform: string;
  version(): Promise<string>;
  fullscreen(): Promise<boolean>;
  secrets: { get(name: string): Promise<string | null>; set(name: string, value: string | null): Promise<boolean> };
  setStreamHeaders(url: string, headers: HeaderMap): Promise<boolean>;
  decoder: {
    info(): Promise<{ available: boolean; hwEncoder?: string | null }>;
    probe(url: string, headers?: HeaderMap): Promise<StreamInfo | null>;
    url(src: string, headers?: HeaderMap, opts?: Record<string, unknown>): Promise<string | null>;
  };
}

export const desktop = (): DesktopBridge | undefined => (window as unknown as { gaDesktop?: DesktopBridge }).gaDesktop;
export const isDesktop = () => !!desktop();

/** A channel's playlist request headers (User-Agent, Referer, Origin, Cookie, ...). */
export function channelHeaders(c: Pick<Channel, 'userAgent' | 'referrer' | 'headers'>): HeaderMap {
  const out: HeaderMap = { ...(c.headers ?? {}) };
  if (c.userAgent) out['User-Agent'] = c.userAgent;
  if (c.referrer) out.Referer = c.referrer;
  return out;
}

/** Chromium plays 8-bit H.264 with AAC / MP3 / Opus; everything else goes through the decoder. */
export function directPlayable(i: StreamInfo): boolean {
  const v = !i.video || (i.video === 'h264' && (!i.pixFmt || /^(yuvj?420p|nv12)$/.test(i.pixFmt)) && !/high 10|4:2:2|4:4:4/i.test(i.profile ?? ''));
  const a = !i.audio || /^(aac|mp3|opus|mp4a)/.test(i.audio);
  return v && a;
}
