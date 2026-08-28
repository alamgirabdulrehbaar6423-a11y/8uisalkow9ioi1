// ─── Chat theme registry ─────────────────────────────────────────────────────
// Performance-first theme system.
//
// HOW IT WORKS (and why it is fast):
// • Every theme is 100% static CSS: design-token variables + an optional
//   inline-SVG wallpaper tile declared in index.css.
// • Applying a theme only changes a data-attribute on the chat container —
//   the browser re-resolves CSS variables and repaints ONCE. No JS runs
//   afterwards, no animation loops, no extra DOM nodes, no network requests.
// • Wallpapers are tiny (~1-2 KB) SVG data-URIs rasterized once by the
//   browser and cached as a repeating tile. Sitting in the chat costs ~0 CPU/GPU.
//
// Adding a theme later = add an entry here + a token block in index.css.

export type ChatThemeId =
  | "light"
  | "dark"
  | "love"
  | "glossy-hearts"
  | "pastel-hearts"
  | "midnight-love"
  | "rose"
  | "minimal-love";

export interface ChatThemeDef {
  id: ChatThemeId;
  name: string;
  tagline: string;
  /** Drives the existing darkMode-derived UI (menus, modals, music page). */
  dark: boolean;
  /** true → CSS variable override block in index.css applies. */
  custom: boolean;
}

export const CHAT_THEMES: ChatThemeDef[] = [
  { id: "light", name: "Light", tagline: "Classic pink", dark: false, custom: false },
  { id: "dark", name: "Dark", tagline: "Late-night black", dark: true, custom: false },
  { id: "love", name: "Love", tagline: "Deep purple hearts", dark: true, custom: true },
  { id: "glossy-hearts", name: "Glossy Hearts", tagline: "Shiny magenta", dark: true, custom: true },
  { id: "pastel-hearts", name: "Pastel Hearts", tagline: "Soft & scattered", dark: false, custom: true },
  { id: "midnight-love", name: "Midnight Love", tagline: "Stars & navy", dark: true, custom: true },
  { id: "rose", name: "Rose", tagline: "Warm burgundy", dark: false, custom: true },
  { id: "minimal-love", name: "Minimal Love", tagline: "Clean & light", dark: false, custom: true },
];

export const CHAT_THEME_KEY = "hb_chat_theme";
export const CHAT_REDUCE_FX_KEY = "hb_chat_reduce_fx";
const LEGACY_DARK_KEY = "hb_chat_dark_mode";

export function getChatTheme(id: string | null | undefined): ChatThemeDef {
  return CHAT_THEMES.find((t) => t.id === id) ?? CHAT_THEMES[0];
}

/** Read synchronously at mount (before first paint of the chat) → no theme flash. */
export function getInitialChatThemeId(): ChatThemeId {
  try {
    const saved = localStorage.getItem(CHAT_THEME_KEY);
    if (saved && CHAT_THEMES.some((t) => t.id === saved)) return saved as ChatThemeId;
    // One-time migration from the old boolean dark-mode key.
    return localStorage.getItem(LEGACY_DARK_KEY) === "1" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function getInitialReduceFx(): boolean {
  try {
    return localStorage.getItem(CHAT_REDUCE_FX_KEY) === "1";
  } catch {
    return false;
  }
}
