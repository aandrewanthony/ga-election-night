# CLAUDE HANDOFF — GA Election Night

## Mission
A standalone election-night TV app for Georgia's **Tuesday, November 3, 2026** general election (US Senate: Ossoff vs. Collins; open Governor's race; down-ballot statewide, US House, legislature, ballot questions). It plays the Atlanta stations side by side from the owner's **own IPTV .m3u** (the same playlist Dial TV uses) and shows live **Georgia Secretary of State** results beside them.

The owner asked for this to be **totally separate from Dial TV**, so it is not a Dial TV page or mode. It copies a few of Dial TV's tested pieces (see "Borrowed from Dial TV"); keep the two apps independent.

- Repo: `aandrewanthony/ga-election-night` (**public**, branch `master`; the owner's browser is signed in to GitHub as `studiofarms`, so keep secrets out of it). Local: `C:\Users\RSVP\Documents\ga-election-tv`. Commit author: `Andrew <andrew@studiofarmsny.com>` (set in repo config).
- Web (results only): Netlify site `ga-election-night` (id `2735d724-7347-4c27-abee-c938e3737f47`) → https://ga-election-night.netlify.app
- Windows app: `release/GA-Election-Night-<ver>-win.zip` (built locally, not in git).

## Stations (src/lib/stations.ts)
| Key | Tile | Matched by |
|---|---|---|
| gpb | GPB · WGTV 8 (Georgia Public Broadcasting) | `gpb`, `georgia public`, `wgtv`; "PBS" only next to Atlanta/Georgia; never "PBS Atlanta" (that's WPBA) |
| abc | WSB-TV 2 (Channel 2 Action News) | `wsb`, `wsbtv`; "ABC" + Atlanta/Georgia |
| nbc | WXIA 11 (11Alive) | `wxia`, `11alive` |
| cbs | WANF 46 (Atlanta News First) | `wanf`, **`wgcl`** (old callsign; the owner's playlist still uses it), `atlanta news first`, `cbs 46` |
| fox | WAGA 5 (extra) | `waga`, `fox 5 atlanta` |
| pba | WPBA 30 PBS Atlanta (extra) | `wpba`, `pbs atlanta` |

The default quad is gpb, abc, nbc, cbs. Scoring: a callsign or brand counts most, then the network word next to "Atlanta". There are penalties for sports/event channels (e.g. "NFL Teams: CBS Falcons (WGCL)" ranks below a plain CBS 46 feed), dated/timed event names, and other markets. A hand-picked channel per station is kept in localStorage `gaen.picks` (by channel id = `pl:<tvg-id or name>` lowercased). The owner's full lineup has never been seen: the cached Dial TV blob only held sports channels. **Check the real matches with the owner on first run.**

## Results (src/lib/results.ts)
- Public JSON from Enhanced Voting, no key: `https://results.sos.ga.gov/results/public/api/`
  - `jurisdictions/Georgia` → `.elections[]` (`publicElectionId`, `electionDate`, `name`). The app picks the one dated `2026-11-03` as soon as it appears; until then, the newest (currently `08252026SpecialElectionRunoff`). The list is re-checked every 5 min; when tonight's election first shows up, it overrides a hand-picked election.
  - `elections/<jurisdiction>/<id>/data` → `.ballotItems[]` (name, `reportingStatus.reportingUnits/totalUnits`, `voteTotal`, `isCloseRace`, `summaryResults.ballotOptions[]` with `voteCount`, `party.abbreviation`, `isWinner`). About 1 MB statewide. Counties use `fulton-county-ga`, `dekalb-county-ga`, `cobb-county-ga`, `gwinnett-county-ga`, `clayton-county-ga` (their units are precincts, not counties).
  - Other routes seen in their JS: `/stats`, `/turnout`, `/vr`, `/localities`, `/closeraces`. Unused so far.
- Candidate names carry `(Rep)`/`(Dem)` and `(I)` = incumbent; parsed out. Party colours come from our own palette first (the API's REP colour `#960018` is unreadable on dark).
- Categories: featured (US Senate / Governor / President), statewide, US House, ballot questions (non-candidate contests or amendment-style names), legislature, other. If the open tab is empty for an election, it jumps to the first one with races.
- Polling: statewide every 30 s on election day (5 min otherwise); Metro Atlanta counties every 60 s (10 min).
- **No CORS headers.** Desktop: the Electron shell adds them. Web: `netlify/functions/ga-results.mjs` proxies with an allow-list regex (`jurisdictions/Georgia` and `elections/<A-Za-z0-9->/<id>/data` only); everything else → 400. `npm run dev` serves the same function via a Vite middleware (vite.config.ts).

## Playback (src/Tile.tsx)
- Raw `.ts` uses mpegts.js; `.m3u8` uses hls.js. The desktop app registers playlist headers (`gaen:stream-headers`); the shell uses VLC's User-Agent unless the playlist sets one.
- Desktop: it probes codecs in parallel with direct play and switches to the bundled ffmpeg decoder when `directPlayable()` says no (AC-3/E-AC-3/MP2 audio, MPEG-2/HEVC/10-bit video, which is common on US locals). Any direct-play failure also goes to the decoder. After that it rotates the playlist's fallback URLs and backs off up to 15 s; it shows an error after 6 tries. A 20 s frozen picture triggers a reconnect.
- **Verified 2026-10-31** with the packaged exe (`--mute-audio`) and real-time looped test streams: AAC tiles played direct, AC-3 tiles switched to the decoder ("DEC" badge), all 4 decoded video and audio. The test harness was a throwaway Playwright `_electron` script plus a node server that pipes `ffmpeg -re -stream_loop -1 … -c copy -f mpegts`. Test with `GAEN_PROFILE=e2e` (separate userData in %TEMP%) so the owner's saved playlist isn't touched, and clear `%LOCALAPPDATA%\Temp\ga-election-e2e` between runs.
- **Not yet tested with the owner's real playlist/provider.** Risk: provider connection limits. 4 tiles = 4 simultaneous streams. When ≥2 tiles error, a hint offers Single view.

## UI (src/App.tsx, src/style.css)
Top bar: brand, polls-close countdown (7:00 PM ET = `2026-11-04T00:00:00Z`; DST ends Nov 1), Atlanta clock, layout (2×2 / 1+3 / 1), mute, volume, playlist settings. Video wall | results panel (election picker, tabs, search, race cards, Metro Atlanta county table, link to results.sos.ga.gov). Bottom ticker of featured + statewide + US House leaders. Channel picker modal: station chips, best matches, and search across all channels (defaults to Atlanta/Georgia channels). Keys: `1`–`4` sound, `Q`/`S`/`O` layouts, `M` mute, `F` full screen; double-click a tile toggles single view. UI prefs live in localStorage `gaen.ui`.

## Playlist (src/lib/playlist.ts)
URL or opened .m3u file. Desktop: the URL is saved with `safeStorage` (`gaen:secret-*`, userData/secrets.json) and localStorage only says `{kind:'url', keychain:true}`. A file's text goes to IndexedDB `gaen/kv/playlistFile`. Only live entries are kept (`lib/content.ts` classification). The playlist is re-fetched on every launch; there is no channel cache.

## Web version: known limit (explained to the owner)
On https://ga-election-night.netlify.app the playlist and streams are **blocked by the browser**:
1. CORS: IPTV servers don't allow outside sites.
2. Mixed content: the provider's links are `http://` and the site is `https://`.
3. Even past both, Dolby/AC-3 channels would be silent (no decoder in the browser), and some providers reject browser user agents.

The owner asked why their provider's own web player works. It's on the provider's own domain/allow-list, its http/https setup matches, and it often serves browser-ready HLS. Possible exceptions were explained (Chrome Site settings → Insecure content → Allow; CORS only via an unblock extension, which isn't recommended). **Recommendation given: use the Windows app; the web is for results on a phone.** Don't proxy streams or playlists through Netlify: that would send the owner's provider login and all video through a server. A possible small follow-up: make the web setup screen say "playback needs the Windows app" up front, with a download link.

## Borrowed from Dial TV (copied, then edited)
- `electron/decoder.cjs`: unchanged copy. It still uses the `dial:` IPC channel names (`dial:decoder-info`, `dial:probe`, `dial:decoder-url`); preload maps them. Harmless, but don't "fix" one side only.
- `electron/installer.cjs`: names changed to GA Election Night (`GAEN_*` env hooks, uninstall key `GAElectionNight`, appId `com.studiofarms.gaelection`).
- `electron/main.cjs`: trimmed from Dial TV's (CORS + stream headers, secrets, decoder, installer; no DVR/timeshift/remote/ESPN).
- `src/lib/m3u.ts`, `url.ts`, `content.ts`: unchanged copies. `src/types.ts`: Dial TV's `Channel` type only.

## Build / release
```bash
npm install
npm run dev        # http://localhost:1430 (browser-pane config "ga-election" in Documents/.claude/launch.json)
npm run typecheck
npm run desktop    # build + Electron
npm run dist:win   # release/GA-Election-Night-<ver>-win.zip
npm run icons      # build/icon.svg -> build/icon.png, build/icon.ico, electron/icon.png
```
- `vendor/ffmpeg/win32-x64/ffmpeg.exe` is copied from dial-tv (gitignored). Copy it again after a fresh clone.
- Icons render with Electron (`scripts/make-icons.cjs`): **Playwright's Chromium is blocked by Smart App Control** on the dev PC (`spawn UNKNOWN`). The Electron exe is trusted, and so is the packaged app (`signAndEditExecutable: false`, zip + self-installer, same scheme as Dial TV).
- **Web deploy:** `npm run build`, then rebuild `web-deploy/` (gitignored) = `dist/*` + `netlify/functions/ga-results.mjs` + a `netlify.toml` with `publish = "."` and `functions = "netlify/functions"`. Then the Netlify MCP `deploy-site` command from inside `web-deploy/`. Don't deploy from the repo root: it would upload `release/` (140 MB) and `vendor/`.
- No Mac or iPad builds. Dial TV's Mac builds use GitHub Actions, and the owner must approve any Actions run first (minutes ran out before). There's no CI in this repo; keep it that way unless asked.

## Owner preferences that apply here
- Push to GitHub and deploy to Netlify yourself after changes, and always end with the live URL.
- Never let audio play out loud when testing: `--mute-audio` for Electron, override `HTMLMediaElement.prototype.play` in the browser pane, and use dead test links.
- No test suites for every change; typecheck + build, plus a quick look. Run a playback check only for player changes.

## Next / ideas
- First run with the owner's real playlist: confirm the 4 matches and that the provider allows 4 streams at once.
- Election night: confirm the `2026-11-03` election appears in `jurisdictions/Georgia` and that `/data` parses (general-election names have no `- Rep/Dem` suffix; 2024 general parsed fine).
- Possible: race-call badges from `isWinner`, the `/closeraces` route, a runoff notice (Georgia requires 50%+1; runoff Dec 1, 2026), and a county map (the SOS uses Mapbox with `featureIdField: NAME`).
