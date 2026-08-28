// ─────────────────────────────────────────────────────────────────────────────
// Twilio "Wake Me Up" API — served by the Vite dev server itself.
//
// Why here? This app is a static SPA (no Next.js / Express backend), but the
// Vite server IS a Node server, so we mount three tiny same-origin endpoints:
//
//   POST /api/wake-up               → places a REAL phone call to Faizan's
//                                     iPhone via the Twilio Voice REST API.
//                                     If he answers, a neutral robot voice
//                                     says "Good morning" (nothing app- or
//                                     chat-related — privacy by design).
//   GET  /api/wake-up/status?callSid=CA… → live call status straight from
//                                     Twilio (ringing / in-progress /
//                                     completed / no-answer / busy / failed).
//   GET  /api/wake-up/health        → verifies the Twilio credentials WITHOUT
//                                     placing a call (safe for automated
//                                     tests — the phone never rings).
//
// The Twilio credentials live in frontend/.env WITHOUT the VITE_ prefix, so
// Vite never bundles them into browser code. Only this Node middleware can
// read them.
// ─────────────────────────────────────────────────────────────────────────────
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
// SPEED: undici with a custom Agent so the HTTPS connection to api.twilio.com
// is kept alive between taps (Node's built-in fetch closes idle sockets after
// ~4s, forcing a fresh DNS + TCP + TLS handshake — several hundred ms — on
// every ⏰ tap). Combined with the keep-warm ping below, the socket is always
// hot, so tapping ⏰ sends the call request over an ALREADY-OPEN connection.
import { fetch as undiciFetch, Agent } from "undici";

const twilioAgent = new Agent({
  keepAliveTimeout: 55_000, // keep idle sockets open ~55s (refreshed by ping)
  keepAliveMaxTimeout: 55_000,
  connections: 2,
  connect: { timeout: 5_000 },
});

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string; // Twilio number (saved on the iPhone as "Monis")
  toNumber: string; // Faizan's real iPhone number (E.164)
  publicBaseUrl: string; // public URL of this app — Twilio fetches TwiML here
}

// Human-friendly explanations for the Twilio error codes we're most likely
// to hit, so the ringing overlay can tell the user exactly what to fix.
const FRIENDLY_TWILIO_ERRORS: Record<number, string> = {
  20003:
    "Twilio login failed — the Account SID or Auth Token looks wrong. Double-check them in the Twilio Console.",
  20429: "Twilio is rate-limiting us — wait a few seconds and try again.",
  21211: "The destination phone number is invalid.",
  21215:
    "Twilio isn't allowed to call Saudi Arabia yet. In the Twilio Console open Voice → Settings → Geo Permissions and enable Saudi Arabia (+966), then try again.",
  21219:
    "That number isn't verified on your Twilio trial account. Add it under Phone Numbers → Verified Caller IDs.",
  21606:
    "The Twilio 'From' number isn't valid or isn't owned by this account.",
  21608:
    "Twilio trial accounts can only call VERIFIED numbers. Verify the iPhone number under Phone Numbers → Verified Caller IDs in the Twilio Console.",
};

const TWILIO_API = "https://api.twilio.com/2010-04-01";

// What the robot voice says when the call is answered. Deliberately neutral —
// nothing app-related, nothing chat-related (see the privacy requirement).
// NOTE: Twilio TRIAL accounts reject the inline `Twiml` parameter
// ("Invalid or disallowed parameters"), so this XML is served from the public
// GET/POST /api/wake-up/twiml endpoint and passed to Twilio via `Url` instead.
const WAKE_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/><Say voice="alice" loop="3">Good morning.</Say></Response>';

// Twilio's pre-approved trial template (the ONLY voice content trial accounts
// may use). Plays Twilio's standard text-to-speech demo — the phone still
// rings like a normal call, which is what "Wake Me Up" needs.
const TRIAL_TTS_TEMPLATE_URL =
  "https://webhooks.twilio.com/v1/Voice/Template/voice_text_to_speech";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

interface TwilioResult {
  ok: boolean;
  httpStatus: number;
  data: Record<string, unknown>;
}

async function twilioFetch(
  cfg: TwilioConfig,
  path: string,
  init?: { method?: string; form?: URLSearchParams },
): Promise<TwilioResult> {
  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString(
    "base64",
  );
  const resp = await undiciFetch(`${TWILIO_API}${path}`, {
    dispatcher: twilioAgent,
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      ...(init?.form
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    body: init?.form ? init.form.toString() : undefined,
  });
  const data = (await resp.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return { ok: resp.ok, httpStatus: resp.status, data };
}

function twilioErrorMessage(data: Record<string, unknown>): {
  code: number | null;
  message: string;
} {
  const code = typeof data.code === "number" ? data.code : null;
  const friendly = code !== null ? FRIENDLY_TWILIO_ERRORS[code] : undefined;
  const raw =
    typeof data.message === "string" && data.message.length > 0
      ? data.message
      : "Twilio rejected the request.";
  if (!friendly && /disallowed parameters/i.test(raw)) {
    return {
      code,
      message:
        "Twilio trial restriction — this call option isn't allowed on trial accounts. Upgrade the Twilio account (add billing) to unlock it.",
    };
  }
  return { code, message: friendly ?? raw };
}

function missingConfigKeys(cfg: TwilioConfig): string[] {
  const missing: string[] = [];
  if (!cfg.accountSid) missing.push("TWILIO_ACCOUNT_SID");
  if (!cfg.authToken) missing.push("TWILIO_AUTH_TOKEN");
  if (!cfg.fromNumber) missing.push("TWILIO_PHONE_NUMBER");
  if (!cfg.toNumber) missing.push("WAKE_UP_TO_NUMBER");
  return missing;
}

// ── Account-tier cache — SPEED CRITICAL ─────────────────────────────────────
// Looked up once at server start (also warms DNS/TLS to api.twilio.com) and
// refreshed in the background every 5 minutes. Tapping ⏰ therefore makes
// EXACTLY ONE Twilio request — the call itself — with zero pre-flight lookups.
let cachedIsTrial: boolean | null = null;
let tierCheckedAt = 0;
let tierRefreshInFlight = false;
const TIER_TTL_MS = 5 * 60_000;

async function refreshAccountTier(cfg: TwilioConfig): Promise<void> {
  if (tierRefreshInFlight || missingConfigKeys(cfg).length > 0) return;
  tierRefreshInFlight = true;
  try {
    const account = await twilioFetch(cfg, `/Accounts/${cfg.accountSid}.json`);
    if (account.ok) {
      const isTrial =
        String(account.data.type ?? "").toLowerCase() === "trial";
      if (isTrial !== cachedIsTrial) {
        console.log(
          `[wake-up] Twilio account tier cached: ${isTrial ? "Trial" : "Full"} (connection warmed)`,
        );
      }
      cachedIsTrial = isTrial;
      tierCheckedAt = Date.now();
    }
  } catch {
    /* network hiccup — keep the previous cached value */
  } finally {
    tierRefreshInFlight = false;
  }
}

async function handleWakeUp(
  cfg: TwilioConfig,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const missing = missingConfigKeys(cfg);
  if (missing.length > 0) {
    sendJson(res, 500, {
      ok: false,
      error: `Twilio isn't configured — missing ${missing.join(", ")} in frontend/.env.`,
    });
    return;
  }

  // ── GET /api/wake-up/health — credential check, NO call is placed ────────
  if (req.method === "GET" && url.pathname === "/api/wake-up/health") {
    const account = await twilioFetch(cfg, `/Accounts/${cfg.accountSid}.json`);
    if (!account.ok) {
      const err = twilioErrorMessage(account.data);
      sendJson(res, account.httpStatus, {
        ok: false,
        code: err.code,
        error: err.message,
      });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      accountStatus: account.data.status ?? null, // "active"
      accountType: account.data.type ?? null, // "Trial" | "Full"
      fromNumber: cfg.fromNumber,
      toNumber: `${cfg.toNumber.slice(0, 7)}•••••`,
      note: "Credentials verified. No call was placed.",
    });
    return;
  }

  // ── GET/POST /api/wake-up/twiml — the call script Twilio fetches ─────────
  // Must be publicly reachable (Twilio's servers request it when the call
  // connects). No secrets here — just the neutral "Good morning" script.
  if (url.pathname === "/api/wake-up/twiml") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(WAKE_TWIML);
    return;
  }

  // ── POST /api/wake-up — place the REAL phone call ────────────────────────
  //
  // TRIAL-AWARE (per https://www.twilio.com/docs/usage/trials/try-out-voice):
  // Trial accounts may ONLY send `To`, `Url` (one of four Twilio template
  // URLs) and `StatusCallback` — everything else (From/Timeout/TimeLimit/
  // custom TwiML URLs) is rejected with "Invalid or disallowed parameters".
  // So: on Trial we use Twilio's official text-to-speech template (the phone
  // still RINGS — the wake-up works); once the account is upgraded to Full,
  // the exact same button automatically switches to our own /api/wake-up/twiml
  // "Good morning" script with the 45s ring timeout.
  if (req.method === "POST" && url.pathname === "/api/wake-up") {
    // ZERO pre-flight requests: use the cached account tier (warmed at server
    // start). If the cache is stale, refresh it in the background WITHOUT
    // blocking this call. Defaulting to the Trial path is safe on any tier —
    // the Twilio template URL is valid for Full accounts too.
    if (cachedIsTrial === null || Date.now() - tierCheckedAt > TIER_TTL_MS) {
      void refreshAccountTier(cfg);
    }
    const isTrial = cachedIsTrial ?? true;

    let call: TwilioResult;
    if (isTrial) {
      // Minimal trial-allowed parameters. Twilio places the call from the
      // account's trial number automatically.
      let form = new URLSearchParams({
        To: cfg.toNumber,
        From: cfg.fromNumber,
        Url: TRIAL_TTS_TEMPLATE_URL,
      });
      call = await twilioFetch(cfg, `/Accounts/${cfg.accountSid}/Calls.json`, {
        method: "POST",
        form,
      });
      if (!call.ok && call.httpStatus === 400) {
        // Some trials reject `From` too. A 400 means NO call was placed, so
        // one retry with the absolute minimum parameters is safe.
        form = new URLSearchParams({
          To: cfg.toNumber,
          Url: TRIAL_TTS_TEMPLATE_URL,
        });
        call = await twilioFetch(
          cfg,
          `/Accounts/${cfg.accountSid}/Calls.json`,
          { method: "POST", form },
        );
      }
    } else {
      // Full account → our own TwiML: neutral "Good morning", 45s ring.
      const forwardedProto =
        (req.headers["x-forwarded-proto"] as string | undefined)?.split(
          ",",
        )[0] ?? "https";
      const host = req.headers.host ?? "";
      const base =
        cfg.publicBaseUrl.replace(/\/+$/, "") ||
        (host ? `${forwardedProto}://${host}` : "");
      const form = new URLSearchParams({
        To: cfg.toNumber,
        From: cfg.fromNumber,
        Url: `${base}/api/wake-up/twiml`,
        Method: "GET",
        Timeout: "45", // ring the iPhone for up to 45s (matches the UI timer)
        TimeLimit: "60", // hard cap on call length — protects Twilio credit
      });
      call = await twilioFetch(cfg, `/Accounts/${cfg.accountSid}/Calls.json`, {
        method: "POST",
        form,
      });
    }

    if (!call.ok) {
      const err = twilioErrorMessage(call.data);
      console.error(
        `[wake-up] Twilio call failed (HTTP ${call.httpStatus}, code ${err.code}):`,
        call.data.message ?? err.message,
      );
      sendJson(res, call.httpStatus >= 400 ? call.httpStatus : 502, {
        ok: false,
        code: err.code,
        error: err.message,
      });
      return;
    }
    console.log(
      `[wake-up] Call placed → ${cfg.toNumber} (sid: ${String(call.data.sid)}, trial: ${isTrial})`,
    );
    sendJson(res, 201, {
      ok: true,
      callSid: call.data.sid,
      status: call.data.status ?? "queued",
      trialMode: isTrial,
    });
    return;
  }

  // ── GET /api/wake-up/status?callSid=CA… — live status from Twilio ────────
  if (req.method === "GET" && url.pathname === "/api/wake-up/status") {
    const callSid = url.searchParams.get("callSid") ?? "";
    if (!/^CA[0-9a-f]{32}$/i.test(callSid)) {
      sendJson(res, 400, { ok: false, error: "A valid callSid is required." });
      return;
    }
    const call = await twilioFetch(
      cfg,
      `/Accounts/${cfg.accountSid}/Calls/${callSid}.json`,
    );
    if (!call.ok) {
      const err = twilioErrorMessage(call.data);
      sendJson(res, call.httpStatus, {
        ok: false,
        code: err.code,
        error: err.message,
      });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      callSid: call.data.sid,
      // queued | initiated | ringing | in-progress | completed | busy |
      // no-answer | failed | canceled
      status: call.data.status ?? null,
      duration: call.data.duration ?? null,
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found." });
}

/**
 * Vite plugin that mounts the wake-up API on the dev server.
 * `env` must be the result of `loadEnv(mode, __dirname, "")` so that
 * non-VITE_-prefixed (server-only) variables are included.
 */
export function twilioWakeUpPlugin(env: Record<string, string>): Plugin {
  const cfg: TwilioConfig = {
    accountSid: env.TWILIO_ACCOUNT_SID ?? "",
    authToken: env.TWILIO_AUTH_TOKEN ?? "",
    fromNumber: env.TWILIO_PHONE_NUMBER ?? "",
    toNumber: env.WAKE_UP_TO_NUMBER ?? "",
    publicBaseUrl: env.NEXT_PUBLIC_BASE_URL ?? "",
  };
  return {
    name: "twilio-wake-up-api",
    configureServer(server) {
      // Warm-up at boot: caches the account tier AND primes DNS/TLS to
      // api.twilio.com so the first ⏰ tap goes straight to placing the call.
      void refreshAccountTier(cfg);
      // KEEP-WARM — SPEED CRITICAL: ping Twilio every 45s (one tiny GET) so
      // the keep-alive socket above NEVER goes cold. Every ⏰ tap therefore
      // reuses an open TLS connection instead of paying DNS + TCP + TLS
      // handshake (hundreds of ms) before the call can even be requested.
      const keepWarm = setInterval(() => void refreshAccountTier(cfg), 45_000);
      keepWarm.unref?.();
      server.httpServer?.once("close", () => clearInterval(keepWarm));
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/wake-up")) {
          next();
          return;
        }
        handleWakeUp(cfg, req, res).catch((err: unknown) => {
          console.error("[wake-up] unexpected middleware error:", err);
          sendJson(res, 500, {
            ok: false,
            error: "Unexpected server error while contacting Twilio.",
          });
        });
      });
    },
  };
}
