# Wake Me Up — Supabase Database Design (analysis + SQL, NOT yet executed)

Designed June 2025 session. The existing web-push system (push_subscriptions,
save/delete_push_subscription, send-push-notification, push_log, notify_push_on_message)
is preserved EXACTLY as-is. Everything below is additive and isolated.

## Identity model (matches existing architecture)
No Supabase Auth. Identity = persona ('faizan' | 'habiba'). The iOS companion
app registers with persona + a stable per-install device_id (UUID persisted by
the app) + the APNs VoIP device_token. Multiple devices per persona allowed.

## New tables
1. voip_devices  — APNs VoIP tokens for the native iOS app (separate from push_subscriptions)
2. wake_up_requests — one row per wake-up "call"; id doubles as the CallKit call UUID

## RPCs (SECURITY DEFINER, EXECUTE granted to anon — same posture as web push)
- register_voip_device(p_persona, p_device_id, p_device_token, p_app_identifier, p_apns_environment, p_device_model)
- unregister_voip_device(p_device_token)
- request_wake_up(p_caller, p_recipient, p_caller_display) returns uuid  ← ALREADY CALLED by the website's ⏰ button (fails silently until SQL is run)
- update_wake_up_status(p_request_id, p_status)
- cleanup_stale_voip_data()  (service-role/manual only)

## RLS posture
- voip_devices: RLS on, ZERO anon policies (write via RPC only, read via service role only)
- wake_up_requests: RLS on, anon SELECT only (website watches status via Realtime); writes via RPC only

## Frontend already wired (this session)
- ⏰ header button (left of 🎵, same 36px style) → "Ringing Faizan's mobile…" overlay (45 s)
- Calls supabase.rpc("request_wake_up", { p_caller:'habiba', p_recipient:'faizan', p_caller_display:'Umme Habiba 💗' })
- Soft ring tone: src/lib/ring-tone.ts — Web Audio oscillators (440+554 Hz double-ring
  every 2.6 s), no asset file, started on the ⏰ tap (user gesture), fully isolated
  from the music singleton. stopRingTone() on stop/answer/timeout/unmount.
- LIVE answer status: after request_wake_up returns the call UUID, the site subscribes
  to Realtime UPDATEs on wake_up_requests (filter id=eq.<uuid>). status transitions:
  answered → "Faizan answered 💗" (💗 pulse, haptics.success, auto-close 6 s);
  declined → "Faizan declined the call 💔"; expired/failed/ended or 45 s local
  timeout → "No answer 😴 — missed-ring alert sent to his phone 📲" (verified live).
  First transition wins (channel removed) so 'ended' after 'answered' can't
  overwrite the outcome. Requires the SQL (anon SELECT + realtime publication on
  wake_up_requests) to be run — until then the overlay just rings with a console
  warning (verified graceful).
- MISSED RING ALERT (verified end-to-end): lib/push.ts → notifyMissedWakeUp() reuses
  the EXISTING send-push-notification Edge Function (untouched) with
  message_id "wakeup-missed-<requestId|Date.now()>" (push_log dedupes the local-timer
  vs Realtime-'expired' double-send), sender habiba → recipient faizan, text
  "📞 Missed wake-up ring! I tried to wake you up… 💗". Sent ONLY on genuine timeout
  (manual Stop cancels the timer; 'declined' does NOT send). Live test delivered
  {"ok":true,"sent":43} to Faizan's registered endpoints.

## Run LATER (only after the iOS app + send-wake-up-call Edge Function exist)
- AFTER INSERT trigger on wake_up_requests → pg_net POST to /functions/v1/send-wake-up-call
  (mirror of notify_push_on_message). Do NOT create it earlier (would POST to a 404).
- Edge Function secrets (names only): APNS_TEAM_ID, APNS_KEY_ID, APNS_AUTH_KEY_P8,
  APNS_TOPIC_VOIP (bundle id + ".voip"), optional APNS_DEFAULT_ENVIRONMENT.
  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase.
- apns_environment is stored PER DEVICE ('development' = api.sandbox.push.apple.com,
  'production' = api.push.apple.com). Mismatch causes BadDeviceToken.
- Edge function must prune tokens on APNs 410 "Unregistered" (mirror of web-push 404/410 pruning).

The full runnable SQL was delivered in the chat (sections C–H). Keep this file as the reference.
