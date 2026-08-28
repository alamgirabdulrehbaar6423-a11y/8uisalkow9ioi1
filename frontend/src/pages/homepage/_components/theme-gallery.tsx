// ─── Theme gallery ────────────────────────────────────────────────────────────
// Lightweight theme picker. Deliberately does NOT use framer-motion:
// one-shot CSS animations only (defined in index.css), zero JS animation loops.
// Rendered ONLY while open / previewing — costs nothing the rest of the time.
import { CHAT_THEMES, getChatTheme, type ChatThemeId } from "@/lib/chat-themes.ts";

interface ThemeGalleryProps {
  open: boolean;
  activeId: ChatThemeId;
  previewId: ChatThemeId | null;
  reduceFx: boolean;
  onPreview: (id: ChatThemeId) => void;
  onApply: () => void;
  onCancelPreview: () => void;
  onClose: () => void;
  onToggleReduceFx: () => void;
}

const serif = "'Cormorant Garamond', serif";

export default function ThemeGallery({
  open,
  activeId,
  previewId,
  reduceFx,
  onPreview,
  onApply,
  onCancelPreview,
  onClose,
  onToggleReduceFx,
}: ThemeGalleryProps) {
  // ── Live-preview bar (gallery hides so the real chat shows the theme) ──
  if (previewId) {
    const t = getChatTheme(previewId);
    return (
      <div
        className="hb-theme-previewbar"
        data-testid="theme-preview-bar"
        style={{
          position: "fixed",
          left: 12,
          right: 12,
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)",
          zIndex: 90,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderRadius: 18,
          background: "rgba(20,12,22,0.94)",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontFamily: serif,
              fontSize: 16,
              fontWeight: 700,
              color: "#fff",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Previewing {t.name}
          </p>
          <p style={{ margin: 0, fontSize: 11.5, color: "rgba(255,255,255,0.55)" }}>
            Look around, then apply or cancel
          </p>
        </div>
        <button
          data-testid="theme-preview-cancel"
          onClick={onCancelPreview}
          style={{
            height: 40,
            padding: "0 16px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.16)",
            background: "rgba(255,255,255,0.08)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          Cancel
        </button>
        <button
          data-testid="theme-preview-apply"
          onClick={onApply}
          style={{
            height: 40,
            padding: "0 18px",
            borderRadius: 12,
            border: "none",
            background: "linear-gradient(135deg, #ff5f8a, #c9184a)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          Apply
        </button>
      </div>
    );
  }

  if (!open) return null;

  // ── Gallery sheet ──
  return (
    <div
      className="hb-theme-backdrop"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,0.5)" }}
    >
      <div
        className="hb-theme-sheet"
        data-testid="theme-gallery"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: "80dvh",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          background: "#16101c",
          borderRadius: "22px 22px 0 0",
          border: "1px solid rgba(255,255,255,0.08)",
          borderBottom: "none",
          padding: "16px 16px",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 18px)",
        }}
      >
        {/* Grab handle */}
        <div
          aria-hidden
          style={{
            width: 42,
            height: 4,
            borderRadius: 999,
            background: "rgba(255,255,255,0.18)",
            margin: "0 auto 12px",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ margin: 0, fontFamily: serif, fontSize: 22, fontWeight: 700, color: "#fff" }}>
              Chat Themes
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
              Tap a theme to preview it live
            </p>
          </div>
          <button
            data-testid="theme-gallery-close"
            onClick={onClose}
            aria-label="Close theme gallery"
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.07)",
              color: "#fff",
              fontSize: 15,
              lineHeight: 1,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Theme cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 10,
            marginTop: 14,
          }}
        >
          {CHAT_THEMES.map((t) => {
            const active = t.id === activeId;
            return (
              <button
                key={t.id}
                data-testid={`theme-card-${t.id}`}
                onClick={() => onPreview(t.id)}
                style={{
                  position: "relative",
                  display: "block",
                  padding: 0,
                  border: active ? "2px solid #ff5f8a" : "2px solid rgba(255,255,255,0.10)",
                  borderRadius: 16,
                  overflow: "hidden",
                  cursor: "pointer",
                  background: "#221a2a",
                  textAlign: "left",
                }}
              >
                {/* Mini live swatch — wallpaper + bubbles come from the same
                    CSS tokens the real theme uses (see index.css). */}
                <div className="hb-theme-swatch" data-swatch={t.id} style={{ height: 76, width: "100%" }} />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 6,
                    padding: "7px 10px 8px",
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#fff",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {t.name}
                    </span>
                    <span style={{ display: "block", fontSize: 10.5, color: "rgba(255,255,255,0.45)" }}>
                      {t.tagline}
                    </span>
                  </span>
                  {active && (
                    <span
                      aria-label="Current theme"
                      style={{
                        flexShrink: 0,
                        width: 20,
                        height: 20,
                        borderRadius: 999,
                        background: "linear-gradient(135deg, #ff5f8a, #c9184a)",
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 800,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      ✓
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Reduce visual effects */}
        <button
          data-testid="reduce-fx-toggle"
          role="switch"
          aria-checked={reduceFx}
          onClick={onToggleReduceFx}
          style={{
            marginTop: 14,
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 12px",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.04)",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: "#fff" }}>
              Reduce visual effects
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
              Plain backgrounds & fewer shadows — maximum battery life
            </p>
          </div>
          <span
            aria-hidden
            style={{
              flexShrink: 0,
              width: 44,
              height: 26,
              borderRadius: 999,
              padding: 3,
              display: "inline-flex",
              background: reduceFx ? "linear-gradient(135deg, #ff5f8a, #c9184a)" : "rgba(255,255,255,0.15)",
              transition: "background 160ms ease",
            }}
          >
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: 999,
                background: "#fff",
                transform: reduceFx ? "translateX(18px)" : "translateX(0)",
                transition: "transform 160ms ease",
              }}
            />
          </span>
        </button>

        <p style={{ margin: "10px 2px 0", fontSize: 10.5, color: "rgba(255,255,255,0.35)" }}>
          All themes use static, battery-friendly backgrounds — no live animations.
        </p>
      </div>
    </div>
  );
}
