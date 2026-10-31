import { useEffect, useRef, useState } from 'react';
import type { Channel } from './types';
import { channelHeaders, desktop, directPlayable } from './lib/desktop';

export type TileState = 'connecting' | 'playing' | 'retrying' | 'error';

type Engine = { destroy(): void };

/**
 * One live channel. Plays the stream directly (mpegts.js for raw .ts, hls.js for .m3u8); on desktop
 * it probes the codecs in parallel and switches to the bundled ffmpeg decoder when Chromium can't
 * decode them (AC-3 / MPEG-2, common on US locals), or when direct playback fails. Reconnects on
 * drops and stalls, walking the playlist's backup links.
 */
export function Tile({ channel, muted, volume, onState }: { channel: Channel; muted: boolean; volume: number; onState?: (s: TileState, msg?: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<TileState>('connecting');
  const [msg, setMsg] = useState('');
  const [engine, setEngine] = useState('');
  const report = useRef(onState);
  report.current = onState;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    v.volume = volume;
  }, [muted, volume]);

  useEffect(() => {
    const v = videoRef.current!;
    const d = desktop();
    const headers = channelHeaders(channel);
    const urls = [channel.url, ...(channel.fallbackUrls ?? [])];
    let alive = true;
    let current: Engine | null = null;
    let attempt = 0;
    let urlIdx = 0;
    let useDecoder = false;
    let retryTimer: number | undefined;
    let lastTime = 0;
    let lastMove = Date.now();

    const set = (s: TileState, m = '') => { if (!alive) return; setState(s); setMsg(m); report.current?.(s, m); };
    const teardown = () => {
      current?.destroy();
      current = null;
      v.removeAttribute('src');
      v.load();
    };

    const retry = (why: string) => {
      if (!alive) return;
      teardown();
      attempt++;
      // Direct playback failed on desktop: the decoder handles odd codecs and picky servers.
      if (d && !useDecoder) useDecoder = true;
      else if (urls.length > 1) { urlIdx = (urlIdx + 1) % urls.length; useDecoder = false; }
      const wait = Math.min(2000 * attempt, 15000);
      set(attempt > 6 ? 'error' : 'retrying', why);
      retryTimer = window.setTimeout(() => void start(), wait);
    };

    const start = async () => {
      if (!alive) return;
      const src = urls[urlIdx];
      lastMove = Date.now();
      if (attempt === 0) set('connecting');
      if (d) await d.setStreamHeaders(src, headers);
      let playUrl = src;
      if (useDecoder && d) {
        const u = await d.decoder.url(src, headers, { preset: 'veryfast', maxHeight: 720, deinterlace: 'auto', hw: true });
        if (u) playUrl = u;
        else useDecoder = false;
      }
      if (!alive) return;
      const hls = !useDecoder && /\.m3u8(\?|$)/i.test(src);
      setEngine(useDecoder ? 'decoder' : hls ? 'hls' : 'ts');
      try {
        if (hls) {
          const Hls = (await import('hls.js')).default;
          if (!alive) return;
          if (!Hls.isSupported()) { v.src = playUrl; current = { destroy() {} }; }
          else {
            const h = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30, capLevelToPlayerSize: true });
            h.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) retry(`Stream error (${data.details})`); });
            h.loadSource(playUrl);
            h.attachMedia(v);
            current = h;
          }
        } else {
          const mpegts = (await import('mpegts.js')).default;
          if (!alive) return;
          const p = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: playUrl }, {
            enableWorker: true, enableStashBuffer: true, stashInitialSize: 128 * 1024,
            liveSync: true, liveSyncMaxLatency: 6, liveSyncTargetLatency: 2.5, liveSyncPlaybackRate: 1.1,
            autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 40, autoCleanupMinBackwardDuration: 20, fixAudioTimestampGap: true,
          });
          p.on(mpegts.Events.ERROR, (type: string, detail: string, info?: { code?: number }) => {
            const code = info?.code;
            retry(code === 403 || code === 401 ? 'Provider refused (too many streams at once?)' : code === 404 ? 'Channel link not found' : `Stream error: ${detail || type}`);
          });
          p.on(mpegts.Events.LOADING_COMPLETE, () => retry('Stream ended'));
          p.attachMediaElement(v);
          p.load();
          current = { destroy() { try { p.pause(); p.unload(); p.detachMediaElement(); p.destroy(); } catch { /* already gone */ } } };
        }
        v.muted = muted;
        void v.play().catch(() => {});
      } catch (e) {
        retry(String((e as Error)?.message ?? e));
        return;
      }
      // Desktop: check the codecs while direct playback starts; switch to the decoder if needed.
      if (d && !useDecoder) {
        void d.decoder.probe(src, headers).then((info) => {
          if (!alive || useDecoder || !info) return;
          if (info.httpStatus && info.httpStatus >= 400) return;
          if (!directPlayable(info)) { teardown(); useDecoder = true; void start(); }
        });
      }
    };

    const onPlaying = () => { attempt = 0; set('playing'); };
    const onErr = () => retry('Playback error');
    v.addEventListener('playing', onPlaying);
    v.addEventListener('error', onErr);
    // Frozen picture for 20 s while "playing": reconnect.
    const watchdog = window.setInterval(() => {
      if (v.currentTime !== lastTime) { lastTime = v.currentTime; lastMove = Date.now(); return; }
      if (Date.now() - lastMove > 20000 && current) { lastMove = Date.now(); retry('Stream stalled'); }
    }, 2000);

    void start();
    return () => {
      alive = false;
      clearTimeout(retryTimer);
      clearInterval(watchdog);
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('error', onErr);
      teardown();
    };
  }, [channel.id, channel.url]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="tileVideo">
      <video ref={videoRef} playsInline muted={muted} />
      {state !== 'playing' && (
        <div className={`tileStatus ${state}`}>
          <div className="spin" />
          <span>{state === 'connecting' ? 'Tuning…' : state === 'retrying' ? `Reconnecting — ${msg}` : msg || 'Could not play this channel'}</span>
        </div>
      )}
      {engine === 'decoder' && state === 'playing' && <span className="engine" title="Converted by the built-in decoder (broadcast audio/video)">DEC</span>}
    </div>
  );
}
