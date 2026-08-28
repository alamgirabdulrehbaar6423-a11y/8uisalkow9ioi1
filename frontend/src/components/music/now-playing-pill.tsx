// ─────────────────────────────────────────────────────────────────────────────
// NowPlayingPill — tiny "now playing" pill inside the chat header.
//
// Performance contract:
//   • Fully isolated: it subscribes to the music store BY ITSELF, so
//     play/pause/song changes re-render ONLY this pill — never the chat.
//   • Wrapped in memo() with stable props, so chat re-renders (typing,
//     messages, scrolling) skip it entirely.
//   • No timers, no progress updates, no animations — it only reacts to the
//     rare play/pause/track-change events.
//   • Renders null when no song is selected (header looks exactly as before).
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useSyncExternalStore } from "react";
import { musicStore } from "@/lib/music.ts";
import { haptics } from "@/lib/haptics.ts";

const NowPlayingPill = memo(function NowPlayingPill({
  onOpen,
}: {
  onOpen: () => void;
}) {
  const st = useSyncExternalStore(musicStore.subscribe, musicStore.getSnapshot);
  const song = st.index >= 0 ? st.songs[st.index] : null;
  if (!song) return null;

  return (
    // flexBasis:100% wraps this onto its own row inside the (flex-wrap) header.
    <div
      style={{
        flexBasis: "100%",
        minWidth: 0,
        marginTop: 10,
        display: "flex",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        data-testid="now-playing-pill"
        aria-label={`Now playing: ${song.title}. Open music page`}
        title="Open music"
        onClick={() => {
          haptics.light();
          onOpen();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          maxWidth: "100%",
          minWidth: 0,
          background: "rgba(255,255,255,0.28)",
          border: "1px solid rgba(255,255,255,0.4)",
          borderRadius: 999,
          padding: "3px 4px 3px 12px",
          cursor: "pointer",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span aria-hidden style={{ fontSize: 12, lineHeight: 1, color: "#fff" }}>
          ♪
        </span>
        <span
          data-testid="now-playing-title"
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.01em",
            color: "#fff",
          }}
        >
          {song.title}
          {st.buffering ? " · loading…" : ""}
        </span>
        <button
          type="button"
          data-testid="now-playing-toggle"
          aria-label={st.playing ? "Pause music" : "Play music"}
          title={st.playing ? "Pause" : "Play"}
          onClick={(e) => {
            e.stopPropagation(); // don't open the music page
            haptics.light();
            musicStore.toggle();
          }}
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            border: "none",
            flexShrink: 0,
            background: "rgba(255,255,255,0.9)",
            color: "#c9184a",
            fontSize: 10,
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {st.playing ? "❚❚" : "▶"}
        </button>
      </div>
    </div>
  );
});

export default NowPlayingPill;
