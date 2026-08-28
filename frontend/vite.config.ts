import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, loadEnv } from "vite";
import { twilioWakeUpPlugin } from "./server/twilio-wake-up";

// https://vite.dev/config/
// The frontend folder is fully self-contained: env vars are read from the
// local ./.env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
// VITE_VAPID_PUBLIC_KEY), so `cd frontend && yarn build` works anywhere.
//
// Server-only secrets (TWILIO_*) are loaded with an empty prefix filter so the
// wake-up middleware can read them — Vite still only exposes VITE_* variables
// to browser code, so the Twilio Auth Token never reaches the client bundle.
export default defineConfig(({ mode }) => {
  // Frontend vars from ./.env, plus the platform root ../.env so the
  // middleware knows the app's public URL (NEXT_PUBLIC_BASE_URL) for the
  // TwiML callback Twilio fetches. Frontend values win on conflicts.
  const env = {
    ...loadEnv(mode, path.resolve(__dirname, ".."), ""),
    ...loadEnv(mode, __dirname, ""),
  };
  return {
    server: {
      host: "0.0.0.0",
      port: 3000,
      allowedHosts: true,
      hmr: {
        overlay: false,
      },
      watch: {
        usePolling: true,
        interval: 1000,
        ignored: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
      },
    },
    plugins: [react(), tailwindcss(), twilioWakeUpPlugin(env)],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    build: {
      chunkSizeWarningLimit: 1000,
    },
  };
});
