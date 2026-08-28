// ─────────────────────────────────────────────────────────────────────────────
// Supabase Edge Function: wake-up — the "Wake Me Up" phone-call API.
//
// Why here? The app is a static SPA (deployable by drag-and-dropping `dist/`
// onto Netlify — no server anywhere), so the Twilio call MUST be placed from
// a server the app can always reach. Supabase Edge Functions are included in
// the project's free plan and live next to the chat database.
//
//   POST /wake-up          → places a REAL phone call via the Twilio Voice API
//   GET  /wake-up/status   → live call status (?callSid=CA…)
//   GET  /wake-up/health   → verifies Twilio credentials WITHOUT placing a call
//   GET  /wake-up/twiml    → neutral "Good morning" call script (full accounts)
//
// Twilio credentials are stored as Supabase function secrets
// (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER,
//  WAKE_UP_TO_NUMBER) — they never reach browser code.
//
// This mirrors frontend/server/twilio-wake-up.ts (the local dev middleware)
// so both environments behave identically, including the response shapes the
// ringing overlay expects: { ok, callSid, status } / { ok, code, error }.
// ─────────────────────────────────────────────────────────────────────────────

// Deno globals, accessed via globalThis so repo-wide (Node-centric) linters
// don't flag an undefined `Deno` identifier. At runtime this IS Deno.
type DenoRuntime = {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};
const deno = (globalThis as unknown as { Deno: DenoRuntime }).Deno;

const TWILIO_API = "https://api.twilio.com/2010-04-01";

// Twilio's pre-approved trial template (the ONLY voice content trial accounts
// may use). Plays Twilio's standard text-to-speech demo — the phone still
// rings like a normal call, which is what "Wake Me Up" needs.
const TRIAL_TTS_TEMPLATE_URL =
  "https://webhooks.twilio.com/v1/Voice/Template/voice_text_to_speech";

// What the robot voice says when a FULL-account call is answered. Neutral —
// nothing app- or chat-related (privacy by design).
const WAKE_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/><Say voice="alice" loop="3">Good morning.</Say></Response>';

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

// Every response carries permissive CORS headers because the SPA is served
// from a different origin (Netlify / localhost) than this Supabase domain.
// They must be present on ERROR responses too, or the browser hides the
// friendly message from the app.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-store",
};

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string; // Twilio number (saved on the iPhone as "Monis")
  toNumber: string; // Faizan's real iPhone number (E.164)
}

function getConfig(): TwilioConfig {
  return {
    accountSid: deno.env.get("TWILIO_ACCOUNT_SID") ?? "",
    authToken: deno.env.get("TWILIO_AUTH_TOKEN") ?? "",
    fromNumber: deno.env.get("TWILIO_PHONE_NUMBER") ?? "",
    toNumber: deno.env.get("WAKE_UP_TO_NUMBER") ?? "",
  };
}

function missingConfigKeys(cfg: TwilioConfig): string[] {
  const missing: string[] = [];
  if (!cfg.accountSid) missing.push("TWILIO_ACCOUNT_SID");
  if (!cfg.authToken) missing.push("TWILIO_AUTH_TOKEN");
  if (!cfg.fromNumber) missing.push("TWILIO_PHONE_NUMBER");
  if (!cfg.toNumber) missing.push("WAKE_UP_TO_NUMBER");
  return missing;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
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
  const auth = btoa(`${cfg.accountSid}:${cfg.authToken}`);
  const resp = await fetch(`${TWILIO_API}${path}`, {
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

// ── Account-tier cache ─────────────────────────────────────────────────────────
// Module scope survives across warm invocations. The tier is refreshed in the
// BACKGROUND (never blocking a call) and also by every /health ping — the
// frontend pings /health on load and every couple of minutes, so a ⏰ tap hits
// a hot isolate, a warm TLS connection to Twilio AND a cached tier: the ONLY
// request between tap and ring is the call itself.
let cachedIsTrial: boolean | null = null;
let tierCheckedAt = 0;
const TIER_TTL_MS = 5 * 60_000;

function cacheTierFromAccount(data: Record<string, unknown>): void {
  cachedIsTrial = String(data.type ?? "").toLowerCase() === "trial";
  tierCheckedAt = Date.now();
}

async function refreshAccountTier(cfg: TwilioConfig): Promise<void> {
  try {
    const account = await twilioFetch(cfg, `/Accounts/${cfg.accountSid}.json`);
    if (account.ok) cacheTierFromAccount(account.data);
  } catch {
    /* network hiccup — keep the previous cached value */
  }
}

// Schedules background work that outlives the response (Supabase Edge
// Runtime's waitUntil), falling back to fire-and-forget.
function runInBackground(p: Promise<unknown>): void {
  const edgeRuntime = (
    globalThis as unknown as {
      EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void };
    }
  ).EdgeRuntime;
  if (edgeRuntime && typeof edgeRuntime.waitUntil === "function") {
    edgeRuntime.waitUntil(p);
  } else {
    void p;
  }
}

// ── Request handler ─────────────────────────────────────────────────────────────
deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  // Robust sub-route detection regardless of how the platform prefixes the
  // path (/wake-up/status vs /functions/v1/wake-up/status).
  const path = url.pathname.replace(/\/+$/, "");
  const sub = path.endsWith("/status")
    ? "status"
    : path.endsWith("/twiml")
      ? "twiml"
      : path.endsWith("/health")
        ? "health"
        : "root";

  // ── GET/POST /wake-up/twiml — the call script Twilio fetches ───────────
  // No secrets required here — just the neutral "Good morning" script.
  if (sub === "twiml") {
    return new Response(WAKE_TWIML, {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "text/xml; charset=utf-8" },
    });
  }

  const cfg = getConfig();
  const missing = missingConfigKeys(cfg);
  if (missing.length > 0) {
    return json(500, {
      ok: false,
      error: `Twilio isn't configured — missing ${missing.join(", ")} in the Supabase function secrets.`,
    });
  }

  // ── GET /wake-up/health — credential check, NO call is placed ──────────
  if (sub === "health" && req.method === "GET") {
    const account = await twilioFetch(cfg, `/Accounts/${cfg.accountSid}.json`);
    if (!account.ok) {
      const err = twilioErrorMessage(account.data);
      return json(account.httpStatus, {
        ok: false,
        code: err.code,
        error: err.message,
      });
    }
    // KEEP-WARM: this lookup doubles as the account-tier cache refresh, so
    // the frontend's periodic /health ping keeps the POST path pre-flight-free.
    cacheTierFromAccount(account.data);
    return json(200, {
      ok: true,
      accountStatus: account.data.status ?? null, // "active"
      accountType: account.data.type ?? null, // "Trial" | "Full"
      fromNumber: cfg.fromNumber,
      toNumber: `${cfg.toNumber.slice(0, 7)}•••••`,
      host: "supabase-edge",
      note: "Credentials verified. No call was placed.",
    });
  }

  // ── GET /wake-up/status?callSid=CA… — live status from Twilio ──────────
  if (sub === "status" && req.method === "GET") {
    const callSid = url.searchParams.get("callSid") ?? "";
    if (!/^CA[0-9a-f]{32}$/i.test(callSid)) {
      return json(400, { ok: false, error: "A valid callSid is required." });
    }
    const call = await twilioFetch(
      cfg,
      `/Accounts/${cfg.accountSid}/Calls/${callSid}.json`,
    );
    if (!call.ok) {
      const err = twilioErrorMessage(call.data);
      return json(call.httpStatus, {
        ok: false,
        code: err.code,
        error: err.message,
      });
    }
    return json(200, {
      ok: true,
      callSid: call.data.sid,
      // queued | initiated | ringing | in-progress | completed | busy |
      // no-answer | failed | canceled
      status: call.data.status ?? null,
      duration: call.data.duration ?? null,
    });
  }

  // ── POST /wake-up — place the REAL phone call ───────────────────────
  //
  // TRIAL-AWARE (per https://www.twilio.com/docs/usage/trials/try-out-voice):
  // Trial accounts may ONLY send To / From / Url (one of Twilio's template
  // URLs) — everything else (Timeout/TimeLimit/custom TwiML URLs) is rejected
  // with "Invalid or disallowed parameters". So on Trial we use Twilio's
  // official text-to-speech template (the phone still RINGS — the wake-up
  // works); once the account is upgraded to Full, the exact same button
  // automatically switches to our own /wake-up/twiml "Good morning" script
  // with the 45s ring timeout.
  if (sub === "root" && req.method === "POST") {
    // ZERO pre-flight requests — SPEED CRITICAL. Use the cached account tier
    // (kept hot by /health pings); if it's stale, refresh it in the
    // BACKGROUND without delaying this call. Defaulting to the Trial path is
    // safe on any tier — the Twilio template URL is valid for Full accounts.
    if (cachedIsTrial === null || Date.now() - tierCheckedAt > TIER_TTL_MS) {
      runInBackground(refreshAccountTier(cfg));
    }
    const isTrial = cachedIsTrial ?? true;

    let call: TwilioResult;
    if (isTrial) {
      // Minimal trial-allowed parameters.
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
      const supabaseUrl = (deno.env.get("SUPABASE_URL") ?? url.origin).replace(
        /\/+$/,
        "",
      );
      const form = new URLSearchParams({
        To: cfg.toNumber,
        From: cfg.fromNumber,
        Url: `${supabaseUrl}/functions/v1/wake-up/twiml`,
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
      return json(call.httpStatus >= 400 ? call.httpStatus : 502, {
        ok: false,
        code: err.code,
        error: err.message,
      });
    }
    console.log(
      `[wake-up] Call placed → ${cfg.toNumber.slice(0, 7)}••••• (sid: ${String(call.data.sid)}, trial: ${isTrial})`,
    );
    return json(201, {
      ok: true,
      callSid: call.data.sid,
      status: call.data.status ?? "queued",
      trialMode: isTrial,
    });
  }

  return json(404, { ok: false, error: "Not found." });
});
