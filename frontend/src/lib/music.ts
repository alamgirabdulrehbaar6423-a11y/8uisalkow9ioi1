// ─────────────────────────────────────────────────────────────────────────────
// music.ts — ultra-lightweight singleton music engine.
//
// Architecture (per product requirements):
//   • ONE HTMLAudioElement for the whole app, created lazily, reused forever.
//     It lives at module scope so music keeps playing while the user chats
//     WITHOUT any React involvement — the chat tree never re-renders because
//     of music.
//   • The song list is lightweight metadata only (number / title / path /
//     public URL). Audio bytes are streamed by the browser ONLY when a song
//     is actually selected. Nothing is preloaded.
//   • No Web Audio API, no FFT, no visualizers, no timers, no polling loops,
//     no Supabase realtime subscriptions — a plain <audio> element + native
//     media events only.
//   • Auto-advance on "ended". Broken files are skipped with a bounded
//     counter (never an infinite retry loop).
//   • Song order: deterministic hash "shuffle" — NOT alphabetical, stable
//     across sessions/devices, and adding new files later doesn't reshuffle
//     the ones already there.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase.ts";

export interface Song {
  n: number; // 1-based number in the shuffled order
  title: string; // filename WITHOUT the .mp3/extension
  path: string; // storage object path inside the bucket
  url: string; // public streaming URL (computed locally — no network call)
}

export interface MusicState {
  songs: Song[];
  songsLoaded: boolean;
  songsError: string | null;
  index: number; // -1 = nothing selected
  playing: boolean;
  buffering: boolean;
}

const BUCKET = "music";
const AUDIO_RE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/i;
const VOL_KEY = "hb_music_volume";

// ── Internal state + immutable snapshot (for useSyncExternalStore) ──────────
const state: MusicState = {
  songs: [],
  songsLoaded: false,
  songsError: null,
  index: -1,
  playing: false,
  buffering: false,
};
let snap: MusicState = { ...state };
const listeners = new Set<() => void>();

function notify(): void {
  snap = { ...state };
  listeners.forEach((l) => l());
}

// ── The single audio element ────────────────────────────────────────────────
let audio: HTMLAudioElement | null = null;
let intentPlaying = false; // true only while the user WANTS playback
let errorStreak = 0; // consecutive failed tracks — bounded skip guard

// ── iOS volume detection ─────────────────────────────────────────────────────
// iOS does NOT allow web pages to change media volume (hardware buttons only):
// assignments to audio.volume are silently ignored. Detect it once so the UI
// can hide the useless slider on iPhones/iPads.
export const volumeAdjustable: boolean = (() => {
  if (typeof document === "undefined") return true;
  try {
    const probe = document.createElement("audio");
    probe.volume = 0.5;
    return Math.abs(probe.volume - 0.5) < 0.01;
  } catch {
    return true;
  }
})();

// ── Connection warm-up ───────────────────────────────────────────────────────
// One <link rel="preconnect"> to the storage origin so the first tap skips
// DNS + TLS setup. Injected once, zero recurring cost.
let preconnected = false;
function injectPreconnect(origin: string): void {
  if (preconnected || typeof document === "undefined") return;
  preconnected = true;
  try {
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = origin;
    document.head.appendChild(link);
  } catch {
    /* noop */
  }
}

// ── Next-song prefetch (exactly ONE song ahead, never more) ─────────────────
// While a song is playing we quietly download the NEXT song in the list into
// a Blob. Auto-advance (and tapping that next song) then starts INSTANTLY
// from memory with zero network wait. Only one prefetched blob ever exists;
// old ones are revoked immediately. Skipped when the user enables data-saver.
let prefetched: { path: string; blobUrl: string } | null = null;
let prefetchCtl: AbortController | null = null;
let prefetchTargetPath: string | null = null;
let activeBlobUrl: string | null = null; // blob currently assigned to audio.src

function clearPrefetched(): void {
  if (prefetched) {
    URL.revokeObjectURL(prefetched.blobUrl);
    prefetched = null;
  }
}

function schedulePrefetchNext(): void {
  if (state.songs.length < 2 || state.index < 0) return;
  const nextSong = state.songs[(state.index + 1) % state.songs.length];
  if (!nextSong) return;
  if (
    prefetched?.path === nextSong.path ||
    prefetchTargetPath === nextSong.path
  ) {
    return; // already have it / already fetching it
  }
  const conn = (
    navigator as unknown as { connection?: { saveData?: boolean } }
  ).connection;
  if (conn?.saveData) return; // respect data-saver mode
  prefetchCtl?.abort();
  const ctl = new AbortController();
  prefetchCtl = ctl;
  prefetchTargetPath = nextSong.path;
  fetch(nextSong.url, { signal: ctl.signal })
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("bad status"))))
    .then((b) => {
      if (ctl.signal.aborted) return;
      clearPrefetched();
      prefetched = { path: nextSong.path, blobUrl: URL.createObjectURL(b) };
      prefetchTargetPath = null;
    })
    .catch(() => {
      if (prefetchTargetPath === nextSong.path) prefetchTargetPath = null;
    });
}

function takePrefetched(path: string): string | null {
  if (prefetched?.path === path) {
    const u = prefetched.blobUrl;
    prefetched = null; // ownership moves to the audio element
    return u;
  }
  return null;
}

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = "auto"; // only matters once a src is set (i.e. user picked a song)
  try {
    const v = Number(localStorage.getItem(VOL_KEY));
    if (Number.isFinite(v) && v >= 0 && v <= 1) a.volume = v;
  } catch {
    /* private mode */
  }

  a.addEventListener("playing", () => {
    errorStreak = 0;
    state.playing = true;
    state.buffering = false;
    notify();
    // Current song is rolling — quietly warm up the NEXT one (one song only).
    schedulePrefetchNext();
  });
  a.addEventListener("pause", () => {
    if (state.playing) {
      state.playing = false;
      notify();
    }
  });
  a.addEventListener("waiting", () => {
    if (!state.buffering) {
      state.buffering = true;
      notify();
    }
  });
  a.addEventListener("canplay", () => {
    if (state.buffering) {
      state.buffering = false;
      notify();
    }
  });
  a.addEventListener("ended", () => {
    // Auto-roll to the next song, wrapping at the end of the list.
    if (intentPlaying && state.songs.length > 0) {
      playIndex((state.index + 1) % state.songs.length, true);
    }
  });
  a.addEventListener("error", () => {
    if (!a.getAttribute("src")) return; // fired by unload — ignore
    errorStreak += 1;
    if (
      intentPlaying &&
      state.songs.length > 1 &&
      errorStreak < state.songs.length
    ) {
      // Skip a broken file once — bounded, can never loop forever.
      playIndex((state.index + 1) % state.songs.length, true);
    } else {
      intentPlaying = false;
      state.playing = false;
      state.buffering = false;
      notify();
    }
  });

  // Native lock-screen / notification-shade controls (zero CPU cost).
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.setActionHandler("play", () => toggle());
      navigator.mediaSession.setActionHandler("pause", () => toggle());
      navigator.mediaSession.setActionHandler("previoustrack", () => prev());
      navigator.mediaSession.setActionHandler("nexttrack", () => next());
    } catch {
      /* older browsers */
    }
  }

  audio = a;
  return a;
}

function safePlay(a: HTMLAudioElement): void {
  const p = a.play();
  if (p) {
    p.catch(() => {
      // Autoplay blocked or src switched mid-flight. NEVER retry in a loop.
      if (a.paused) {
        state.playing = false;
        state.buffering = false;
        notify();
      }
    });
  }
}

// ── Playback controls ────────────────────────────────────────────────────────
export function playIndex(i: number, auto = false): void {
  const s = state.songs[i];
  if (!s) return;
  const a = ensureAudio();
  if (!auto && i === state.index && a.getAttribute("src")) {
    // Tapping the current song toggles play/pause.
    toggle();
    return;
  }
  intentPlaying = true;
  state.index = i;
  state.playing = true;
  state.buffering = true;
  notify();
  // Instant start if this song was already prefetched (auto-advance / next tap).
  const pre = takePrefetched(s.path);
  const oldBlob = activeBlobUrl;
  activeBlobUrl = pre;
  a.src = pre ?? s.url; // new src aborts the previous download automatically
  if (oldBlob && oldBlob !== pre) URL.revokeObjectURL(oldBlob); // free memory
  safePlay(a);
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: s.title,
        artist: "Our Songs 💌",
      });
    } catch {
      /* noop */
    }
  }
}

export function toggle(): void {
  const a = ensureAudio();
  if (state.index < 0 || !a.getAttribute("src")) {
    if (state.songs.length > 0) playIndex(Math.max(state.index, 0), true);
    return;
  }
  if (a.paused) {
    intentPlaying = true;
    state.playing = true;
    notify();
    safePlay(a);
  } else {
    intentPlaying = false;
    a.pause();
  }
}

export function next(): void {
  if (state.songs.length === 0) return;
  playIndex((state.index + 1) % state.songs.length, true);
}

export function prev(): void {
  if (state.songs.length === 0) return;
  const a = ensureAudio();
  if (a.currentTime > 3 && state.index >= 0) {
    a.currentTime = 0; // restart current song (standard behaviour)
    return;
  }
  playIndex((state.index - 1 + state.songs.length) % state.songs.length, true);
}

export function seek(t: number): void {
  const a = ensureAudio();
  if (Number.isFinite(t) && t >= 0) a.currentTime = t;
}

export function stop(): void {
  const a = ensureAudio();
  intentPlaying = false;
  a.pause();
  a.removeAttribute("src");
  a.load(); // frees the decoded buffer + network connection
  // Free all prefetch/blob memory.
  if (activeBlobUrl) {
    URL.revokeObjectURL(activeBlobUrl);
    activeBlobUrl = null;
  }
  prefetchCtl?.abort();
  prefetchTargetPath = null;
  clearPrefetched();
  state.index = -1;
  state.playing = false;
  state.buffering = false;
  notify();
}

export function setVolume(v: number): void {
  const clamped = Math.min(1, Math.max(0, v));
  ensureAudio().volume = clamped;
  try {
    localStorage.setItem(VOL_KEY, String(clamped));
  } catch {
    /* private mode */
  }
}

export function getVolume(): number {
  if (audio) return audio.volume;
  try {
    const v = Number(localStorage.getItem(VOL_KEY));
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  } catch {
    /* noop */
  }
  return 1;
}

// ── Song list (lightweight metadata only) ────────────────────────────────────
function hashName(s: string): number {
  // FNV-1a — tiny, deterministic. Used to "shuffle" the order stably.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function buildSongs(names: string[]): Song[] {
  const sorted = [...names].sort(
    (x, y) => hashName(x) - hashName(y) || (x < y ? -1 : 1),
  );
  // Build the public URL ourselves with proper per-segment encoding so
  // filenames containing #, ?, %, + etc. can never break the stream URL.
  const base = supabase.storage.from(BUCKET).getPublicUrl("x").data.publicUrl;
  const prefix = base.slice(0, base.length - 1); // ".../object/public/music/"
  try {
    injectPreconnect(new URL(prefix).origin); // warm DNS+TLS for first tap
  } catch {
    /* noop */
  }
  return sorted.map((name, i) => ({
    n: i + 1,
    title: name.replace(/\.[^.]+$/, ""), // strip .mp3 / any extension
    path: name,
    url:
      prefix +
      name
        .split("/")
        .map((seg) => encodeURIComponent(seg))
        .join("/"),
  }));
}

async function listAllFiles(): Promise<string[]> {
  const names: string[] = [];
  const LIMIT = 1000;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list("", {
      limit: LIMIT,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    for (const f of batch) {
      // Folders come back with id === null; skip hidden/placeholder files.
      if (f.id && !f.name.startsWith(".") && AUDIO_RE.test(f.name)) {
        names.push(f.name);
      }
    }
    if (batch.length < LIMIT) break;
    offset += batch.length;
    if (offset > 20000) break; // hard safety cap
  }
  return names;
}

let lastSig = "";
let inflight: Promise<void> | null = null;

/**
 * Stale-while-revalidate: cached songs render instantly when the page opens;
 * a single background refresh picks up any newly-uploaded files. Only ONE
 * list request is ever in flight.
 */
export function loadSongs(): void {
  if (inflight) return;
  inflight = (async () => {
    try {
      const names = await listAllFiles();
      const songs = buildSongs(names);
      const sig = songs.map((s) => s.path).join("\n");
      if (sig !== lastSig) {
        lastSig = sig;
        const curPath =
          state.index >= 0 ? state.songs[state.index]?.path : null;
        state.songs = songs;
        state.index = curPath
          ? songs.findIndex((s) => s.path === curPath)
          : state.index >= 0
            ? -1
            : state.index;
      }
      state.songsError = null;
    } catch (e) {
      if (state.songs.length === 0) {
        state.songsError =
          e instanceof Error ? e.message : "Could not load songs";
      }
    } finally {
      state.songsLoaded = true;
      inflight = null;
      notify();
    }
  })();
}

export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

// ── Store facade (consumed only by the music UI components) ─────────────────
export const musicStore = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  getSnapshot(): MusicState {
    return snap;
  },
  loadSongs,
  playIndex,
  toggle,
  next,
  prev,
  seek,
  stop,
  setVolume,
  getVolume,
  audioEl: ensureAudio,
};

// ─── Dev-only test hook (vite strips this from production builds) ───────────
// Lets automated UI tests inject a song list without needing bucket-listing
// permissions. Never runs in a `vite build` output.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__musicDebug = {
    injectSongs(items: { name: string; url?: string }[]): void {
      state.songs = items.map((it, i) => ({
        n: i + 1,
        title: it.name.replace(/\.[^.]+$/, ""),
        path: it.name,
        url:
          it.url ??
          supabase.storage.from(BUCKET).getPublicUrl(it.name).data.publicUrl,
      }));
      state.songsLoaded = true;
      state.songsError = null;
      notify();
    },
  };
}
