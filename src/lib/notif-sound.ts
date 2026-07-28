// Petit son de notification via WebAudio (aucun asset requis).
// Deux "bips" doux façon message entrant.

let ctx: AudioContext | null = null;
let lastPlayed = 0;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function isMuted(): boolean {
  try {
    return localStorage.getItem("notif-sound-muted") === "1";
  } catch {
    return false;
  }
}

export function setNotifSoundMuted(muted: boolean) {
  try {
    localStorage.setItem("notif-sound-muted", muted ? "1" : "0");
  } catch {}
}

export function isNotifSoundMuted(): boolean {
  return isMuted();
}

function beep(context: AudioContext, freq: number, start: number, duration: number, gain = 0.08) {
  const osc = context.createOscillator();
  const g = context.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(g).connect(context.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** Joue un petit son de notification. Anti-spam 800ms. Respecte le mute utilisateur. */
export function playNotifSound() {
  if (isMuted()) return;
  const now = Date.now();
  if (now - lastPlayed < 800) return;
  lastPlayed = now;
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime + 0.01;
  beep(c, 880, t, 0.12);
  beep(c, 1320, t + 0.13, 0.16);
}
