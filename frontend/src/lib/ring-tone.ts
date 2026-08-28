// Soft "ring-ring" tone for the Wake Me Up overlay.
//
// Pure Web Audio — no asset files, nothing to download. The AudioContext is
// created lazily inside startRingTone(), which is always invoked from the ⏰
// button tap (a user gesture), so mobile autoplay policies are satisfied.
//
// Completely separate from the music engine in lib/music.ts: it never touches
// the app's single <audio> element, so music playback state is unaffected.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let timer: number | null = null;

/** One gentle dual-tone pulse with a soft fade-in/out envelope. */
function pulse(at: number, freqs: number[], dur: number): void {
  if (!ctx || !master) return;
  for (const f of freqs) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.05, at + 0.05); // soft fade in
    g.gain.setValueAtTime(0.05, at + dur - 0.14);
    g.gain.linearRampToValueAtTime(0, at + dur); // soft fade out
    osc.connect(g);
    g.connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }
}

/** Classic soft double-ring: two pleasant A/C# pulses. */
function ringOnce(): void {
  if (!ctx) return;
  const t = ctx.currentTime + 0.02;
  pulse(t, [440, 554.37], 0.42);
  pulse(t + 0.56, [440, 554.37], 0.42);
}

export function startRingTone(): void {
  stopRingTone();
  try {
    type W = Window & { webkitAudioContext?: typeof AudioContext };
    const AC = window.AudioContext ?? (window as W).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    if (ctx.state === "suspended") void ctx.resume();
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    ringOnce();
    timer = window.setInterval(ringOnce, 2600);
  } catch {
    /* audio unavailable — ring silently, never break the overlay */
  }
}

export function stopRingTone(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (master) {
    try {
      master.disconnect();
    } catch {
      /* noop */
    }
    master = null;
  }
}
