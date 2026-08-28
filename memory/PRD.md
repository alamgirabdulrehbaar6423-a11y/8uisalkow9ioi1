# Product Requirements — Private Two-Person Chat App ("Our Chat 💌")

## Overview
A private, passcode-protected two-person romantic chat SPA (Vite + React 19 + TypeScript + Tailwind).
Backend is entirely Supabase (Realtime, Database, Storage, Edge Functions for web push).
Runs on port 3000 via the existing supervisor `nextjs` program (`yarn --cwd frontend dev`).

## Core (pre-existing, must never break)
- Passcode lock screen (code **2407**, 10 wrong attempts = permanent device block)
- Realtime text messages, replies, editing, unsend/delete, reactions
- Full-history message search (🔍 top-right) with Up/Down navigation
- Photos, videos, camera, gallery, voice messages (Supabase `chat-media` bucket)
- Typing indicators, dark-mode toggle, notification bell (web push via VAPID + Edge Function)

## Music Section (added June 2025 session)
User's spec — performance over everything:
1. 🎵 button at top-right of chat header, immediately LEFT of the search icon.
2. Tapping opens a dedicated FULL-SCREEN music page (not a popup/modal).
3. Songs live in the user's PUBLIC Supabase Storage bucket named `music` — listed
   automatically via the Storage API (no hardcoded URLs, no fixed song count, scales 20→200+).
4. ONE audio element for the whole app; no preloading, no Web Audio/FFT/visualizers/canvas.
5. Bottom player: song name, time/duration, seekable progress, play/pause, prev/next,
   volume, stop; progress painted to DOM refs (no React state per tick).
6. Music state fully isolated from chat — playback must cause ZERO chat re-renders.
7. No heavy animations (one 0.18s fade on open only).
8. Auto-advance when a song ends; bounded error skipping; no autoplay retry loops.
9. X button at top returns to chat; music keeps playing via the module singleton.
10. Mobile-first: safe areas, 44px+ touch targets, list padding so player never covers rows.
11. Song names = filenames with extension stripped; order = deterministic hash shuffle
    (NOT alphabetical, stable across sessions, adding files doesn't reshuffle existing ones).
12. Never expose service_role key — anon key only in frontend.

### Implementation
- `src/lib/music.ts` — singleton audio engine + Storage listing + subscriber store
- `src/components/music/music-page.tsx` — full-screen page + bottom player
- `src/pages/homepage/_components/chat-overlay.tsx` — 🎵 button + `musicOpen` boolean
- `src/index.css` — `.hb-music-page` fade, `.hb-music-row` content-visibility

### Now Playing Pill (added after music section)
- Tiny pill on its own row inside the chat header (translucent white, matching header buttons)
- Shows ♪ + current song title; nested ▶/❚❚ button pauses/resumes WITHOUT opening the music page
- Tapping the pill body opens the full music page; pill hidden when no song is selected
- Performance: self-subscribed via useSyncExternalStore + memo() — play/pause re-renders ONLY
  the pill; chat re-renders (typing/messages) skip it entirely; no timers/progress/animation
- File: `src/components/music/now-playing-pill.tsx`; header got `flexWrap: "wrap"` so the
  pill wraps to its own row
- Dev-only test hook `window.__musicDebug.injectSongs()` in lib/music.ts (stripped from prod builds)

### Known setup requirement (user side)
The `music` bucket is public (downloads work) but anon LISTING returns `[]` until this
RLS policy is run once in the Supabase SQL Editor:
```sql
create policy "Public can list music"
on storage.objects for select
to public
using (bucket_id = 'music');
```

## Environment
- `/app/frontend/.env` (NEW — frontend is self-contained for Netlify): `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`. Vite reads its default envDir (frontend/).
- `/app/.env` still holds platform-managed vars (MONGO_URL etc.) — NEVER modify.
- Restart frontend: `sudo supervisorctl restart nextjs`

## Netlify deployment (prepared June 2025 session)
- `cd frontend && yarn build` → outputs `dist/` (verified working; env baked from ./.env)
- `frontend/netlify.toml`: build command, publish=dist, SPA redirect, sw.js no-cache headers, NODE_VERSION=22
- `frontend/public/_redirects`: SPA fallback; `.nvmrc`=22
- Cleanup done: removed orphaned prettier/eslint configs + eslint devDeps + lint script,
  dead REACT_APP_* env fallbacks (supabase.ts, vite-env.d.ts), dead `@/convex/*` tsconfig path,
  stale vite watch ignores; fixed pre-existing push.ts TS error (Uint8Array<ArrayBuffer>) —
  `tsc --noEmit` is now fully clean. Dev-only __musicDebug hook verified stripped from prod build.

## Wake Me Up — REAL Twilio phone call (added Aug 2026 session) ✅ WORKING
User requirement (from video + chat): tapping the ⏰ "Wake Me Up" button places an ACTUAL
phone call to Faizan's iPhone (+966503787701) so it rings like a normal call. If answered,
a neutral robot voice says "Good morning" (nothing app/chat-related — privacy by design).
User saves the calling number as contact "Monis" with iPhone Emergency Bypass ON so it
rings even on Silent/DND.

### Architecture (no Supabase Edge Function needed)
- App is a static SPA → the Vite dev server itself hosts the API via a plugin middleware:
  `frontend/server/twilio-wake-up.ts`, registered in `frontend/vite.config.ts`
  (loadEnv merges frontend/.env + root /app/.env for NEXT_PUBLIC_BASE_URL).
- Twilio credentials in `frontend/.env` WITHOUT VITE_ prefix (server-only, never bundled):
  TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER=+17372212163 /
  WAKE_UP_TO_NUMBER=+966503787701
- Endpoints (all under /api so K8s ingress routes them to port 3000):
  - POST /api/wake-up            → places the real call (201 {ok,callSid,status,trialMode})
  - GET  /api/wake-up/status?callSid=CA… → live Twilio status (frontend polls every 3s)
  - GET  /api/wake-up/health     → credential check, NO call placed (safe for tests)
  - GET  /api/wake-up/twiml      → public "Good morning" TwiML XML (used on FULL accounts)

### CRITICAL Twilio TRIAL restrictions (learned the hard way — 2 failed attempts)
- Trial Create-Call allows ONLY: To, Url (must be one of 4 Twilio template URLs), StatusCallback.
  Inline `Twiml`, custom `Url`, `Timeout`, `TimeLimit`, `Method` → 400 "Invalid or disallowed parameters".
- Fix: POST handler is TRIAL-AWARE — fetches account type; Trial → uses
  https://webhooks.twilio.com/v1/Voice/Template/voice_text_to_speech (phone still rings;
  voice = Twilio's standard TTS demo, NOT custom); internal safe retry once without From on 400.
  Full/upgraded account → automatically switches to custom /api/wake-up/twiml
  ("Good morning", Timeout=45, TimeLimit=60). NO code change needed after upgrade.

### Frontend (chat-overlay.tsx)
- startWakeUp(): POST /api/wake-up → poll status every 3s.
  in-progress/completed → "answered 💗"; busy/no-answer/canceled/failed → "noanswer 😴"
  (+ missed-ring web push); placement failure → new "error" overlay state (⚠️ + friendly reason).
- Legacy Supabase RPC `request_wake_up` still attempted (graceful no-op; table was never created).

### Verified 28 Aug 2026 (backend testing agent)
- Real call placed: CAd0d59bd4aca91dc87c62b830537b8657, trialMode:true,
  sequence queued → ringing (~22s) → busy. THE PHONE ACTUALLY RANG in Saudi Arabia.

### Speed optimization (user: wanted 2-3s tap→ring)
- Removed per-tap blocking account-tier lookup; tier cached at server boot (+5min TTL bg refresh,
  stale-while-revalidate). ⏰ tap → ONE Twilio request. Frontend status poll 3s→2s.
- Measured after fix: POST round-trip 1.03s; queued @0.2s; RINGING @9.0s from tap.
- The ~8s queued→ringing is Twilio + international carrier setup to KSA — NOT controllable
  by app code. Physical floor for intl PSTN calls; upgrading Twilio may shave a little.
- NO SQL / Supabase needed for the call feature (old WAKE_ME_UP_SQL.md approach is obsolete).
