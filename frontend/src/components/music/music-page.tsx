// ─────────────────────────────────────────────────────────────────────────────
// MusicPage — full-screen song list + fixed bottom player.
//
// Performance contract:
//   • Mounted ONLY while open; unmounting removes every listener it added.
//     The audio element itself lives in the module singleton (lib/music.ts)
//     so playback continues after closing — with ZERO chat re-renders.
//   • Playback progress is painted straight onto DOM refs from the native
//     "timeupdate" event (~4×/s) — NO React state updates per tick.
//   • Song rows are memoized; inactive rows receive identical props so a
//     play/pause toggle re-renders only the 1-2 rows that changed.
//   • Rows use content-visibility:auto (browser-native virtualization) so
//     huge libraries stay cheap.
//   • Animations: one 0.18s fade on open. Nothing loops.
// ─────────────────────────────────────────────────────────────────────────────

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { musicStore, fmtTime, volumeAdjustable, type Song } from "@/lib/music.ts";
import { haptics } from "@/lib/haptics.ts";

type RowState = "idle" | "playing" | "paused" | "loading";

const PINK_GRAD = "linear-gradient(135deg, #ff8fab, #ff4d7a, #c9184a)";

const SongRow = memo(function SongRow({
  song,
  rowState,
  dark,
  onPlay,
}: {
  song: Song;
  rowState: RowState;
  dark: boolean;
  onPlay: (i: number) => void;
}) {
  const active = rowState !== "idle";
  return (
    <button
      type="button"
      data-testid="music-song-row"
      className="hb-music-row"
      onClick={() => onPlay(song.n - 1)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        textAlign: "left",
        padding: "0 16px",
        height: 56,
        background: active
          ? dark
            ? "rgba(255,77,122,0.16)"
            : "#fff0f5"
          : "transparent",
        border: "none",
        borderBottom: dark
          ? "1px solid rgba(255,150,180,0.12)"
          : "1px solid rgba(255,150,180,0.22)",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span
        style={{
          width: 30,
          flexShrink: 0,
          fontSize: 13,
          fontWeight: 700,
          fontFamily: "'Cormorant Garamond', serif",
          color: active ? "#ff4d7a" : dark ? "rgba(245,217,226,0.5)" : "#c98da1",
        }}
      >
        {song.n}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 17,
          fontWeight: 600,
          color: active ? "#e0316b" : dark ? "#f5d9e2" : "#3d1522",
        }}
      >
        {song.title}
      </span>
      {active && (
        <span
          style={{
            flexShrink: 0,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#fff",
            background: PINK_GRAD,
            borderRadius: 999,
            padding: "4px 10px",
          }}
        >
          {rowState === "playing"
            ? "♪ Playing"
            : rowState === "loading"
              ? "Loading…"
              : "Paused"}
        </span>
      )}
    </button>
  );
});

function BottomPlayer({
  title,
  playing,
  buffering,
  dark,
}: {
  title: string;
  playing: boolean;
  buffering: boolean;
  dark: boolean;
}) {
  const fillRef = useRef<HTMLDivElement>(null);
  const curRef = useRef<HTMLSpanElement>(null);
  const durRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Paint progress straight onto the DOM — zero React state per tick.
  useEffect(() => {
    const a = musicStore.audioEl();
    const paint = () => {
      const d = a.duration;
      if (!draggingRef.current && fillRef.current) {
        const p = Number.isFinite(d) && d > 0 ? a.currentTime / d : 0;
        fillRef.current.style.transform = `scaleX(${p})`;
      }
      if (curRef.current) curRef.current.textContent = fmtTime(a.currentTime);
      if (durRef.current) durRef.current.textContent = fmtTime(a.duration);
    };
    paint();
    a.addEventListener("timeupdate", paint);
    a.addEventListener("loadedmetadata", paint);
    a.addEventListener("seeked", paint);
    return () => {
      a.removeEventListener("timeupdate", paint);
      a.removeEventListener("loadedmetadata", paint);
      a.removeEventListener("seeked", paint);
    };
  }, []);

  const fracFromEvent = (e: ReactPointerEvent) => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (fillRef.current)
      fillRef.current.style.transform = `scaleX(${fracFromEvent(e)})`;
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!draggingRef.current) return;
    if (fillRef.current)
      fillRef.current.style.transform = `scaleX(${fracFromEvent(e)})`;
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const a = musicStore.audioEl();
    if (Number.isFinite(a.duration) && a.duration > 0) {
      musicStore.seek(fracFromEvent(e) * a.duration);
    }
  };

  const btnStyle = (size: number, primary = false): CSSProperties => ({
    width: size,
    height: size,
    borderRadius: 999,
    border: primary
      ? "none"
      : dark
        ? "1px solid rgba(255,150,180,0.3)"
        : "1px solid rgba(255,150,180,0.5)",
    background: primary ? PINK_GRAD : "transparent",
    color: primary ? "#fff" : dark ? "#f5d9e2" : "#c9184a",
    fontSize: primary ? 18 : 15,
    lineHeight: 1,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    WebkitTapHighlightColor: "transparent",
    boxShadow: primary ? "0 4px 14px rgba(255,77,122,0.4)" : "none",
  });

  return (
    <div
      data-testid="music-bottom-player"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        background: dark ? "#2e181f" : "rgba(255,255,255,0.98)",
        borderTop: dark
          ? "1px solid rgba(255,150,180,0.2)"
          : "1.5px solid rgba(255,150,180,0.4)",
        boxShadow: "0 -6px 24px rgba(201,24,74,0.18)",
        padding: "10px 16px",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
      }}
    >
      {/* Title row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          data-testid="music-player-title"
          style={{
            flex: 1,
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 16,
            fontWeight: 700,
            color: dark ? "#f5d9e2" : "#3d1522",
          }}
        >
          ♪ {title}
          {buffering && (
            <span style={{ opacity: 0.55, fontWeight: 600 }}> · loading…</span>
          )}
        </span>
        <button
          type="button"
          data-testid="music-player-close"
          aria-label="Stop music"
          title="Stop music"
          onClick={() => {
            haptics.light();
            musicStore.stop();
          }}
          style={btnStyle(30)}
        >
          ✕
        </button>
      </div>

      {/* Progress row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: 8,
        }}
      >
        <span
          ref={curRef}
          data-testid="music-current-time"
          style={{
            fontSize: 11,
            fontVariantNumeric: "tabular-nums",
            color: dark ? "rgba(245,217,226,0.7)" : "#a4506b",
            width: 36,
            flexShrink: 0,
          }}
        >
          0:00
        </span>
        <div
          ref={trackRef}
          data-testid="music-progress-track"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            flex: 1,
            height: 22, // generous touch target
            display: "flex",
            alignItems: "center",
            cursor: "pointer",
            touchAction: "none",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              height: 5,
              borderRadius: 999,
              background: dark
                ? "rgba(255,150,180,0.18)"
                : "rgba(255,150,180,0.3)",
              overflow: "hidden",
            }}
          >
            <div
              ref={fillRef}
              style={{
                position: "absolute",
                inset: 0,
                background: PINK_GRAD,
                transform: "scaleX(0)",
                transformOrigin: "left center",
                borderRadius: 999,
              }}
            />
          </div>
        </div>
        <span
          ref={durRef}
          data-testid="music-duration"
          style={{
            fontSize: 11,
            fontVariantNumeric: "tabular-nums",
            color: dark ? "rgba(245,217,226,0.7)" : "#a4506b",
            width: 36,
            flexShrink: 0,
            textAlign: "right",
          }}
        >
          0:00
        </span>
      </div>

      {/* Controls row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          marginTop: 6,
        }}
      >
        <button
          type="button"
          data-testid="music-prev"
          aria-label="Previous song"
          onClick={() => {
            haptics.light();
            musicStore.prev();
          }}
          style={btnStyle(40)}
        >
          ⏮
        </button>
        <button
          type="button"
          data-testid="music-play-pause"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => {
            haptics.light();
            musicStore.toggle();
          }}
          style={btnStyle(52, true)}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <button
          type="button"
          data-testid="music-next"
          aria-label="Next song"
          onClick={() => {
            haptics.light();
            musicStore.next();
          }}
          style={btnStyle(40)}
        >
          ⏭
        </button>
        {/* Volume — hidden on iOS, where the OS forbids web pages from
            changing media volume (hardware buttons control it instead). */}
        {volumeAdjustable && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginLeft: 6,
            }}
          >
            <span aria-hidden style={{ fontSize: 13 }}>
              🔉
            </span>
            <input
              type="range"
              data-testid="music-volume"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.01}
              defaultValue={musicStore.getVolume()}
              onInput={(e) =>
                musicStore.setVolume(
                  Number((e.target as HTMLInputElement).value),
                )
              }
              style={{ width: 84, accentColor: "#ff4d7a" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function MusicPage({
  dark = false,
  onClose,
}: {
  dark?: boolean;
  onClose: () => void;
}) {
  const st = useSyncExternalStore(musicStore.subscribe, musicStore.getSnapshot);

  // Fetch lightweight file metadata (stale-while-revalidate). Audio bytes are
  // NOT touched here — they stream only when a song is tapped.
  useEffect(() => {
    musicStore.loadSongs();
  }, []);

  const onPlay = useCallback((i: number) => {
    haptics.light();
    musicStore.playIndex(i);
  }, []);

  const current = st.index >= 0 ? st.songs[st.index] : null;

  const node = (
    <div
      data-testid="music-page"
      className="hb-music-page"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        display: "flex",
        flexDirection: "column",
        background: dark ? "#241318" : "#fff7f9",
        overscrollBehavior: "contain",
      }}
    >
      {/* Header — matches the chat header style */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px",
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)",
          background: PINK_GRAD,
          boxShadow:
            "0 4px 20px rgba(255,80,130,0.28), inset 0 -1px 0 rgba(255,255,255,0.15)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontFamily: "'Great Vibes', cursive",
              fontSize: 27,
              color: "white",
              // Roomy line-height + padding so the cursive swashes are never
              // clipped (Great Vibes ascenders overflow a 1.0 line box).
              lineHeight: 1.4,
              padding: "2px 4px 0 2px",
              textShadow: "0 2px 10px rgba(0,0,0,0.15)",
              whiteSpace: "nowrap",
            }}
          >
            Our Songs 🎵
          </p>
          <p
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 12,
              color: "rgba(255,255,255,0.86)",
              letterSpacing: "0.02em",
              marginTop: 3,
            }}
          >
            {st.songsLoaded
              ? `• ${st.songs.length} song${st.songs.length === 1 ? "" : "s"} • tap one to play •`
              : "• loading songs •"}
          </p>
        </div>
        <button
          type="button"
          data-testid="music-close"
          aria-label="Back to chat"
          title="Back to chat"
          onClick={() => {
            haptics.light();
            onClose();
          }}
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            background: "rgba(255,255,255,0.28)",
            border: "1px solid rgba(255,255,255,0.4)",
            color: "white",
            fontSize: 16,
            lineHeight: 1,
            cursor: "pointer",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          ✕
        </button>
      </div>

      {/* Song list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          paddingBottom: current
            ? "calc(env(safe-area-inset-bottom, 0px) + 178px)"
            : "calc(env(safe-area-inset-bottom, 0px) + 24px)",
        }}
      >
        {!st.songsLoaded && (
          <p
            style={{
              textAlign: "center",
              marginTop: 48,
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 16,
              color: dark ? "rgba(245,217,226,0.6)" : "#a4506b",
            }}
          >
            Loading songs…
          </p>
        )}
        {st.songsLoaded && st.songsError && st.songs.length === 0 && (
          <div style={{ textAlign: "center", marginTop: 48, padding: "0 24px" }}>
            <p
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: 16,
                color: dark ? "#f5d9e2" : "#3d1522",
              }}
            >
              Couldn't load songs — {st.songsError}
            </p>
            <RetryButton />
          </div>
        )}
        {st.songsLoaded && !st.songsError && st.songs.length === 0 && (
          <div style={{ textAlign: "center", marginTop: 48, padding: "0 24px" }}>
            <p
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: 17,
                fontWeight: 600,
                color: dark ? "#f5d9e2" : "#3d1522",
              }}
            >
              No songs found yet 🎶
            </p>
            <p
              style={{
                marginTop: 8,
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: 14,
                color: dark ? "rgba(245,217,226,0.6)" : "#a4506b",
              }}
            >
              Add MP3 files to the “music” bucket in Supabase Storage, then tap
              retry.
            </p>
            <RetryButton />
          </div>
        )}
        {st.songs.map((s, i) => (
          <SongRow
            key={s.path}
            song={s}
            dark={dark}
            onPlay={onPlay}
            rowState={
              i !== st.index
                ? "idle"
                : st.buffering
                  ? "loading"
                  : st.playing
                    ? "playing"
                    : "paused"
            }
          />
        ))}
      </div>

      {/* Bottom player — only when a song is selected */}
      {current && (
        <BottomPlayer
          title={current.title}
          playing={st.playing}
          buffering={st.buffering}
          dark={dark}
        />
      )}
    </div>
  );

  return createPortal(node, document.body);
}

function RetryButton() {
  return (
    <button
      type="button"
      data-testid="music-retry"
      onClick={() => {
        haptics.light();
        musicStore.loadSongs();
      }}
      style={{
        marginTop: 16,
        padding: "10px 22px",
        borderRadius: 999,
        border: "none",
        background: PINK_GRAD,
        color: "#fff",
        fontFamily: "'Cormorant Garamond', serif",
        fontWeight: 700,
        fontSize: 14,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        cursor: "pointer",
        boxShadow: "0 4px 14px rgba(255,77,122,0.4)",
      }}
    >
      Retry
    </button>
  );
}
