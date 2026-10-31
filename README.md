# GA Election Night

A standalone election-night TV app for Georgia (Nov 3, 2026). Plays **GPB, WSB-TV (ABC 2), WXIA (NBC 11) and Atlanta's CBS (WANF 46)** side by side from your own IPTV .m3u playlist, with live **Georgia Secretary of State** results next to them.

- **Video wall:** 2×2, 1+3 spotlight, or single. Click a tile for its sound; double-click for single view. Keys: `1`–`4` sound, `Q`/`S`/`O` layouts, `M` mute, `F` full screen.
- **Auto station matching:** finds each station in the playlist by callsign/brand (WSB, WXIA / 11Alive, WANF / WGCL / CBS 46, GPB / WGTV), plus FOX 5 (WAGA) and PBS Atlanta (WPBA) as extras. Click a station name to pick a different channel; choices are remembered.
- **Playback:** mpegts.js / hls.js; the desktop app probes each channel and switches to the bundled ffmpeg decoder for broadcast audio/video Chromium can't play (AC-3, MPEG-2). Reconnects on drops and stalls.
- **Results:** `results.sos.ga.gov` public API (`/jurisdictions/Georgia`, `/elections/<jurisdiction>/<id>/data`). Picks the Nov 3 election as soon as the state posts it (until then the latest election). Top races, statewide, US House, ballot questions, legislature, search, and a Metro Atlanta county view (Fulton, DeKalb, Cobb, Gwinnett, Clayton). Polls every 30 s on election day.

## Run / build

```bash
npm install
npm run dev        # http://localhost:1430 (results work; most IPTV streams need the desktop app)
npm run desktop    # Electron
npm run dist:win   # release/GA-Election-Night-<ver>-win.zip (needs vendor/ffmpeg/win32-x64/ffmpeg.exe)
npm run icons      # build/icon.svg -> png/ico
```

The desktop shell (`electron/`) reuses Dial TV's CORS/header handling, decoder and zip self-installer. The playlist link is stored encrypted with the OS keychain. Web version: Netlify, with `netlify/functions/ga-results.mjs` proxying the SOS API.
