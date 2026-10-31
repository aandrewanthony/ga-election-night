import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Channel } from './types';
import { Tile, type TileState } from './Tile';
import { QUAD, STATIONS, candidates, localChannels, stationOf, type StationKey } from './lib/stations';
import { forgetSource, loadChannels, loadPicks, loadSource, savePicks, saveSource, type Source } from './lib/playlist';
import { desktop, isDesktop } from './lib/desktop';
import {
  CATEGORY_LABEL, ELECTION_DAY, METRO, SOS_PAGE, fetchResults, fmt, listElections, pct, pickElection,
  type Category, type ElectionRef, type Race, type Results,
} from './lib/results';

type Layout = 'quad' | 'spot' | 'single';
const POLLS_CLOSE = Date.parse('2026-11-04T00:00:00Z'); // 7:00 PM Eastern, Nov 3

const LS_UI = 'gaen.ui';
const loadUi = (): { slots: StationKey[]; layout: Layout; volume: number } => {
  try { return { slots: QUAD, layout: 'quad', volume: 1, ...JSON.parse(localStorage.getItem(LS_UI) ?? '{}') }; } catch { return { slots: QUAD, layout: 'quad', volume: 1 }; }
};

export default function App() {
  const [source, setSource] = useState<Source | null | undefined>(undefined);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loadErr, setLoadErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  const load = useCallback(async (src: Source) => {
    setLoading(true);
    setLoadErr('');
    try {
      setChannels(await loadChannels(src));
      setShowSetup(false);
    } catch (e) {
      setLoadErr((e as Error).message);
      setShowSetup(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSource().then((s) => { setSource(s); if (s) void load(s); else setShowSetup(true); });
  }, [load]);

  if (source === undefined) return <div className="boot">GA Election Night</div>;
  return (
    <>
      <Main channels={channels} loading={loading} onSettings={() => setShowSetup(true)} />
      {showSetup && (
        <Setup
          error={loadErr}
          loading={loading}
          hasSource={!!source}
          onClose={channels.length ? () => setShowSetup(false) : undefined}
          onForget={async () => { await forgetSource(); setSource(null); setChannels([]); }}
          onSubmit={async (src, text) => { await saveSource(src, text); setSource(src); await load(src); }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function Main({ channels, loading, onSettings }: { channels: Channel[]; loading: boolean; onSettings: () => void }) {
  const init = useMemo(loadUi, []);
  const [slots, setSlots] = useState<StationKey[]>(init.slots);
  const [layout, setLayout] = useState<Layout>(init.layout);
  const [volume, setVolume] = useState(init.volume);
  const [focus, setFocus] = useState(0);
  const [mutedAll, setMutedAll] = useState(false);
  const [picks, setPicks] = useState<Record<string, string>>(loadPicks);
  const [picking, setPicking] = useState<number | null>(null);
  const [states, setStates] = useState<Record<number, TileState>>({});

  useEffect(() => { localStorage.setItem(LS_UI, JSON.stringify({ slots, layout, volume })); }, [slots, layout, volume]);

  const byId = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const channelFor = useCallback((k: StationKey): Channel | undefined => {
    const picked = picks[k] && byId.get(picks[k]);
    return picked || candidates(stationOf(k), channels, 1)[0]?.ch;
  }, [picks, byId, channels]);

  // Keyboard: 1–4 give a tile the sound, Q/S/O layouts, M mute, F full screen.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,select,textarea')) return;
      if (/^[1-4]$/.test(e.key)) setFocus(+e.key - 1);
      else if (e.key === 'q') setLayout('quad');
      else if (e.key === 's') setLayout('spot');
      else if (e.key === 'o') setLayout('single');
      else if (e.key === 'm') setMutedAll((m) => !m);
      else if (e.key === 'f') void (desktop()?.fullscreen() ?? document.documentElement.requestFullscreen?.());
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const order = layout === 'quad' ? [0, 1, 2, 3] : [focus, ...[0, 1, 2, 3].filter((i) => i !== focus)];
  const visible = layout === 'single' ? [focus] : order;
  const refused = Object.values(states).filter((s) => s === 'error').length >= 2;

  return (
    <div className="app">
      <TopBar layout={layout} setLayout={setLayout} volume={volume} setVolume={setVolume} mutedAll={mutedAll} setMutedAll={setMutedAll} onSettings={onSettings} />
      <div className="body">
        <section className={`wall ${layout}`}>
          {!channels.length && <div className="wallEmpty">{loading ? 'Loading your playlist…' : 'Add your IPTV playlist to start.'}</div>}
          {channels.length > 0 && visible.map((i, pos) => {
            const st = stationOf(slots[i]);
            const ch = channelFor(slots[i]);
            const focused = focus === i;
            return (
              <div key={i} className={`tile ${focused ? 'focus' : ''} ${pos === 0 && layout === 'spot' ? 'big' : ''}`} onClick={() => setFocus(i)} onDoubleClick={() => { setFocus(i); setLayout(layout === 'single' ? 'quad' : 'single'); }}>
                {ch ? (
                  <Tile channel={ch} muted={mutedAll || !focused} volume={volume} onState={(s) => setStates((p) => (p[i] === s ? p : { ...p, [i]: s }))} />
                ) : (
                  <div className="tileMissing">
                    <b>{st.network} · {st.call}</b>
                    <span>Not found in your playlist</span>
                    <button onClick={(e) => { e.stopPropagation(); setPicking(i); }}>Choose a channel</button>
                  </div>
                )}
                <div className="tileBar" onClick={(e) => e.stopPropagation()}>
                  <span className="net" style={{ background: st.color }}>{st.network}</span>
                  <button className="tileName" title="Change channel" onClick={() => setPicking(i)}>
                    <b>{st.call}</b> <span>{st.brand}</span>
                  </button>
                  <span className="key">{i + 1}</span>
                  {focused && !mutedAll && <span className="aud" title="This tile has the sound">🔊</span>}
                </div>
              </div>
            );
          })}
          {refused && layout !== 'single' && (
            <div className="limitHint">Several channels were refused. Your IPTV plan may allow fewer streams at once — try <button onClick={() => setLayout('single')}>Single view</button>.</div>
          )}
        </section>
        <ResultsPanel />
      </div>
      <Ticker />
      {picking !== null && (
        <Picker
          channels={channels}
          slot={slots[picking]}
          current={channelFor(slots[picking])}
          onClose={() => setPicking(null)}
          onPick={(k, chId) => {
            setSlots((s) => s.map((x, j) => (j === picking ? k : x)));
            const next = { ...picks };
            if (chId) next[k] = chId; else delete next[k];
            setPicks(next);
            savePicks(next);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}

function TopBar(p: { layout: Layout; setLayout: (l: Layout) => void; volume: number; setVolume: (v: number) => void; mutedAll: boolean; setMutedAll: (m: boolean) => void; onSettings: () => void }) {
  const now = useNow(1000);
  const left = POLLS_CLOSE - now;
  const clock = new Date(now).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' });
  return (
    <header className="top">
      <div className="brand">
        <span className="peach">●</span>
        <div><b>GA ELECTION NIGHT</b><small>Tuesday, November 3, 2026 · Georgia</small></div>
      </div>
      <div className="polls">
        {left > 0 ? (
          <><small>Polls close 7:00 PM ET in</small><b>{countdown(left)}</b></>
        ) : (
          <><small>Polls closed</small><b className="live"><i />LIVE RESULTS</b></>
        )}
      </div>
      <div className="clock"><small>Atlanta</small><b>{clock}</b></div>
      <div className="controls">
        <div className="seg">
          {(['quad', 'spot', 'single'] as Layout[]).map((l) => (
            <button key={l} className={p.layout === l ? 'on' : ''} onClick={() => p.setLayout(l)} title={l === 'quad' ? 'Quad (Q)' : l === 'spot' ? 'Spotlight 1 + 3 (S)' : 'Single (O)'}>
              {l === 'quad' ? '2×2' : l === 'spot' ? '1+3' : '1'}
            </button>
          ))}
        </div>
        <button className="icon" onClick={() => p.setMutedAll(!p.mutedAll)} title="Mute (M)">{p.mutedAll ? '🔇' : '🔊'}</button>
        <input type="range" min={0} max={1} step={0.05} value={p.volume} onChange={(e) => p.setVolume(+e.target.value)} aria-label="Volume" />
        <button className="icon" onClick={p.onSettings} title="Playlist">⚙</button>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
function countdown(ms: number) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
const ago = (t: number, now: number) => { const s = Math.max(0, Math.round((now - t) / 1000)); return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`; };

/** Shared results state: the election list, the chosen election and its polled results. */
const resultsBus = {
  results: null as Results | null,
  listeners: new Set<() => void>(),
  set(r: Results) { this.results = r; this.listeners.forEach((f) => f()); },
};
function useBusResults() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); resultsBus.listeners.add(f); return () => { resultsBus.listeners.delete(f); }; }, []);
  return resultsBus.results;
}

function ResultsPanel() {
  const [elections, setElections] = useState<ElectionRef[]>([]);
  const [electionId, setElectionId] = useState<string>('');
  const [results, setResults] = useState<Results | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Category | 'metro'>('featured');
  const [q, setQ] = useState('');
  const now = useNow(5000);
  const manual = useRef(false);
  const sawTonight = useRef(false);

  useEffect(() => {
    const ctl = new AbortController();
    const go = () => listElections(ctl.signal).then((l) => {
      setElections(l);
      // Keep a hand-picked election, except when tonight's results first appear.
      const tonightNew = l.some((e) => e.date === ELECTION_DAY) && !sawTonight.current;
      if (tonightNew) { sawTonight.current = true; manual.current = false; }
      setElectionId((cur) => (manual.current && l.some((e) => e.id === cur) ? cur : pickElection(l)?.id ?? ''));
    }).catch((e) => setErr(`Results list: ${(e as Error).message}`));
    void go();
    // The state posts election night as a new election: look for it every 5 minutes.
    const t = setInterval(go, 5 * 60_000);
    return () => { ctl.abort(); clearInterval(t); };
  }, []);

  const election = elections.find((e) => e.id === electionId);
  const tonight = election?.date === ELECTION_DAY;

  useEffect(() => {
    if (!electionId) return;
    let ctl = new AbortController();
    const go = () => {
      ctl.abort();
      ctl = new AbortController();
      fetchResults('Georgia', electionId, ctl.signal).then((r) => { setResults(r); resultsBus.set(r); setErr(''); }).catch((e) => { if ((e as Error).name !== 'AbortError') setErr((e as Error).message); });
    };
    go();
    const t = setInterval(go, tonight ? 30_000 : 5 * 60_000);
    return () => { ctl.abort(); clearInterval(t); };
  }, [electionId, tonight]);

  const races = useMemo(() => {
    const all = results?.races ?? [];
    if (q.trim()) {
      const n = q.toLowerCase();
      return all.filter((r) => r.name.toLowerCase().includes(n) || r.options.some((o) => o.name.toLowerCase().includes(n)));
    }
    return tab === 'metro' ? [] : all.filter((r) => r.category === tab);
  }, [results, tab, q]);
  const counts = useMemo(() => {
    const c: Partial<Record<Category, number>> = {};
    for (const r of results?.races ?? []) c[r.category] = (c[r.category] ?? 0) + 1;
    return c;
  }, [results]);
  const featured = useMemo(() => (results?.races ?? []).filter((r) => r.category === 'featured'), [results]);
  // A tab with nothing in it for this election: show the first one that has races.
  useEffect(() => {
    if (!results || (tab === 'metro' ? featured.length : counts[tab])) return;
    const first = (Object.keys(CATEGORY_LABEL) as Category[]).find((c) => counts[c]);
    if (first) setTab(first);
  }, [results, tab, counts, featured.length]);

  return (
    <aside className="results">
      <div className="resHead">
        <div className="resTitle">
          <b>Georgia results</b>
          <small>Secretary of State · {results ? `updated ${ago(results.fetchedAt, now)}` : 'loading…'}{results?.election.official ? ' · official' : ''}</small>
        </div>
        <select value={electionId} onChange={(e) => { manual.current = true; setElectionId(e.target.value); }} aria-label="Election">
          {elections.slice(0, 12).map((e) => <option key={e.id} value={e.id}>{e.date} · {e.name}</option>)}
        </select>
      </div>
      {election && !tonight && (
        <div className="notTonight">
          Showing <b>{election.name}</b>. Tonight's results switch on automatically when Georgia posts the November 3 election.
        </div>
      )}
      {err && <div className="resErr">{err}</div>}
      <div className="tabs">
        {(Object.keys(CATEGORY_LABEL) as Category[]).filter((c) => counts[c]).map((c) => (
          <button key={c} className={tab === c && !q ? 'on' : ''} onClick={() => { setTab(c); setQ(''); }}>{CATEGORY_LABEL[c]} <span>{counts[c]}</span></button>
        ))}
        {featured.length > 0 && <button className={tab === 'metro' && !q ? 'on' : ''} onClick={() => { setTab('metro'); setQ(''); }}>Metro Atlanta</button>}
      </div>
      <input className="search" placeholder="Search races or candidates…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="raceList">
        {tab === 'metro' && !q && electionId ? <Metro electionId={electionId} featured={featured} tonight={tonight} /> : races.map((r) => <RaceCard key={r.id} r={r} big={r.category === 'featured'} />)}
        {results && !races.length && tab !== 'metro' && <div className="muted">No races here.</div>}
      </div>
      <a className="sosLink" href={SOS_PAGE + electionId} target="_blank" rel="noreferrer">Open on results.sos.ga.gov ↗</a>
    </aside>
  );
}

function RaceCard({ r, big }: { r: Race; big?: boolean }) {
  const shown = big ? r.options : r.options.slice(0, 4);
  const lead = r.options[0];
  const margin = r.options.length > 1 ? pct(r.options[0].votes - r.options[1].votes, r.votes) : 0;
  return (
    <div className={`race ${big ? 'big' : ''}`}>
      <div className="raceHead">
        <b>{r.name}</b>
        {r.close && <span className="close">Close race</span>}
      </div>
      <div className="bar">
        {r.options.map((o) => <i key={o.name} style={{ width: `${pct(o.votes, r.votes)}%`, background: o.color }} title={o.name} />)}
      </div>
      {shown.map((o) => (
        <div key={o.name} className={`cand ${o.winner ? 'win' : ''}`}>
          <span className="dot" style={{ background: o.color }} />
          <span className="cn">{o.name}{o.incumbent && <em> (i)</em>}{o.party && <small> {o.party}</small>}{o.winner && <span className="check">✓</span>}</span>
          <span className="pc">{r.votes ? pct(o.votes, r.votes).toFixed(1) + '%' : '—'}</span>
          <span className="vc">{fmt(o.votes)}</span>
        </div>
      ))}
      <div className="raceFoot">
        <span>{r.total ? `${fmt(r.reporting)} of ${fmt(r.total)} ${r.total === 159 ? 'counties' : 'units'} reporting` : ''}</span>
        <span>{r.votes ? `${fmt(r.votes)} votes${lead && r.options.length > 1 ? ` · ${lead.name.split(' ').slice(-1)[0]} +${margin.toFixed(1)}` : ''}` : 'No votes yet'}</span>
      </div>
    </div>
  );
}

/** Top races in Fulton, DeKalb, Cobb, Gwinnett and Clayton. */
function Metro({ electionId, featured, tonight }: { electionId: string; featured: Race[]; tonight: boolean }) {
  const [rows, setRows] = useState<Record<string, Results | 'none'>>({});
  useEffect(() => {
    const ctl = new AbortController();
    const go = () => METRO.forEach((c) => {
      fetchResults(c.id, electionId, ctl.signal).then((r) => setRows((p) => ({ ...p, [c.id]: r }))).catch(() => setRows((p) => ({ ...p, [c.id]: p[c.id] ?? 'none' })));
    });
    go();
    const t = setInterval(go, tonight ? 60_000 : 10 * 60_000);
    return () => { ctl.abort(); clearInterval(t); };
  }, [electionId, tonight]);
  return (
    <>
      {featured.map((race) => {
        const top = race.options.slice(0, 2);
        return (
          <div key={race.id} className="race metro">
            <div className="raceHead"><b>{race.name}</b><small>by county</small></div>
            <table>
              <thead><tr><th>County</th>{top.map((o) => <th key={o.name} style={{ color: o.color }}>{o.name.split(' ').slice(-1)[0]}</th>)}<th>Reporting</th></tr></thead>
              <tbody>
                {METRO.map((c) => {
                  const r = rows[c.id];
                  const cr = r && r !== 'none' ? r.races.find((x) => x.name === race.name) : undefined;
                  return (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      {top.map((o) => {
                        const v = cr?.options.find((x) => x.name === o.name);
                        return <td key={o.name}>{cr && v ? `${pct(v.votes, cr.votes).toFixed(1)}%` : '—'}</td>;
                      })}
                      <td className="muted">{cr ? `${cr.total ? Math.round(pct(cr.reporting, cr.total)) : 0}%` : r === 'none' ? 'n/a' : '…'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

function Ticker() {
  const results = useBusResults();
  const items = (results?.races ?? []).filter((r) => r.category === 'featured' || r.category === 'statewide' || r.category === 'house');
  const ref = useRef<HTMLDivElement>(null);
  if (!items.length) return <footer className="ticker"><span className="tag">GEORGIA</span><div className="tickWrap"><div className="muted">Results load from the Georgia Secretary of State.</div></div></footer>;
  const text = items.map((r) => {
    const [a, b] = r.options;
    const rep = r.total ? ` (${Math.round(pct(r.reporting, r.total))}% in)` : '';
    return { k: r.id, title: r.name, a, b, total: r.votes, rep };
  });
  return (
    <footer className="ticker">
      <span className="tag">GEORGIA</span>
      <div className="tickWrap">
        <div className="tick" ref={ref} style={{ animationDuration: `${Math.max(40, text.length * 6)}s` }}>
          {[0, 1].map((dup) => (
            <span key={dup}>
              {text.map((t) => (
                <span key={t.k + dup} className="ti">
                  <b>{t.title}</b>
                  {t.a && <span style={{ color: t.a.color }}>{t.a.name} {t.total ? pct(t.a.votes, t.total).toFixed(1) : '0'}%</span>}
                  {t.b && <span style={{ color: t.b.color }}>{t.b.name} {t.total ? pct(t.b.votes, t.total).toFixed(1) : '0'}%</span>}
                  <small>{t.rep}</small>
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */

function Picker({ channels, slot, current, onClose, onPick }: { channels: Channel[]; slot: StationKey; current?: Channel; onClose: () => void; onPick: (k: StationKey, channelId?: string) => void }) {
  const [station, setStation] = useState<StationKey>(slot);
  const [q, setQ] = useState('');
  const st = stationOf(station);
  const auto = useMemo(() => candidates(st, channels, 15), [st, channels]);
  const list = useMemo(() => {
    if (!q.trim()) return localChannels(channels).slice(0, 200);
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return channels.filter((c) => words.every((w) => c.name.toLowerCase().includes(w) || c.group.toLowerCase().includes(w))).slice(0, 200);
  }, [q, channels]);
  return (
    <div className="modalBack" onClick={onClose}>
      <div className="modal picker" onClick={(e) => e.stopPropagation()}>
        <div className="mHead"><b>Choose a station for this tile</b><button className="icon" onClick={onClose}>✕</button></div>
        <div className="stations">
          {STATIONS.map((s) => (
            <button key={s.key} className={station === s.key ? 'on' : ''} onClick={() => setStation(s.key)}>
              <span className="net" style={{ background: s.color }}>{s.network}</span> {s.call}
            </button>
          ))}
        </div>
        <div className="pickCols">
          <div>
            <h4>Best matches for {st.call}</h4>
            <button className="row auto" onClick={() => onPick(station)}>Automatic (best match)</button>
            {auto.map(({ ch }) => (
              <button key={ch.id} className={`row ${current?.id === ch.id ? 'cur' : ''}`} onClick={() => onPick(station, ch.id)}>
                {ch.name} <small>{ch.group}</small>
              </button>
            ))}
            {!auto.length && <div className="muted">Nothing in your playlist looks like {st.call}. Search on the right.</div>}
          </div>
          <div>
            <h4>All channels</h4>
            <input autoFocus placeholder={`Search ${fmt(channels.length)} channels (e.g. "atlanta", "wsb")`} value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="scroll">
              {list.map((ch) => (
                <button key={ch.id} className={`row ${current?.id === ch.id ? 'cur' : ''}`} onClick={() => onPick(station, ch.id)}>
                  {ch.name} <small>{ch.group}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Setup({ error, loading, hasSource, onClose, onForget, onSubmit }: {
  error: string; loading: boolean; hasSource: boolean; onClose?: () => void; onForget: () => void; onSubmit: (s: Source, text?: string) => Promise<void>;
}) {
  const [url, setUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="modalBack">
      <div className="modal setup">
        <div className="mHead"><b>Your IPTV playlist</b>{onClose && <button className="icon" onClick={onClose}>✕</button>}</div>
        <p>Paste the same .m3u link you use in Dial TV, or open the .m3u file. GA Election Night finds GPB, WSB-TV (ABC), WXIA (NBC) and Atlanta's CBS on its own.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (/^https?:\/\//i.test(url.trim())) void onSubmit({ kind: 'url', url: url.trim() }); }}>
          <input type="url" placeholder="http://provider.example/get.php?username=…&type=m3u_plus" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button type="submit" disabled={loading || !/^https?:\/\//i.test(url.trim())}>{loading ? 'Loading…' : 'Load'}</button>
        </form>
        <div className="or">or</div>
        <button className="ghost" disabled={loading} onClick={() => fileRef.current?.click()}>Open .m3u file…</button>
        <input ref={fileRef} type="file" accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl,text/plain" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) await onSubmit({ kind: 'file', name: f.name }, await f.text());
        }} />
        {error && <div className="resErr">{error}</div>}
        <p className="muted small">{isDesktop() ? 'The link is stored encrypted with Windows’ keychain on this PC only.' : 'Web version: most IPTV providers block browsers. Use the Windows app to watch; results work here.'}</p>
        {hasSource && <button className="link" onClick={onForget}>Forget saved playlist</button>}
      </div>
    </div>
  );
}
