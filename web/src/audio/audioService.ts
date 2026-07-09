// Small, self-contained audio layer. Sounds are synthesized at runtime with the
// Web Audio API (short oscillator tones), so there are no bundled audio files,
// no downloads, and no third-party/licensed assets. Everything fails silently if
// Web Audio is unavailable or blocked by browser autoplay policy.

export type SoundName =
  | "select"
  | "move"
  | "capture"
  | "sacrifice"
  | "transform"
  | "turn"
  | "victory"
  | "defeat"
  | "confirm";

interface ToneSpec {
  /** Base frequency in Hz. */
  freq: number;
  /** Optional glide target frequency. */
  sweepTo?: number;
  type: OscillatorType;
  /** Seconds. */
  duration: number;
  /** Peak gain multiplier (0..1), scaled by the user volume. */
  gain: number;
}

// Muted, short, tasteful tones. Reuse is intentional where it reads well.
export const SOUND_SPECS: Record<SoundName, ToneSpec> = {
  select: { freq: 440, type: "sine", duration: 0.06, gain: 0.25 },
  move: { freq: 320, sweepTo: 380, type: "sine", duration: 0.1, gain: 0.3 },
  capture: { freq: 180, sweepTo: 120, type: "triangle", duration: 0.16, gain: 0.4 },
  sacrifice: { freq: 150, sweepTo: 90, type: "sawtooth", duration: 0.26, gain: 0.35 },
  transform: { freq: 520, sweepTo: 660, type: "triangle", duration: 0.22, gain: 0.3 },
  turn: { freq: 300, type: "sine", duration: 0.07, gain: 0.22 },
  victory: { freq: 523, sweepTo: 784, type: "sine", duration: 0.5, gain: 0.4 },
  defeat: { freq: 300, sweepTo: 160, type: "sine", duration: 0.5, gain: 0.4 },
  confirm: { freq: 480, type: "sine", duration: 0.05, gain: 0.22 },
};

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Pure gate used by the service and unit tests: decides whether a sound plays. */
export function shouldPlay(opts: { muted: boolean; volume: number; lastAt?: number; now: number; minGapMs?: number }): boolean {
  if (opts.muted) return false;
  if (clampVolume(opts.volume) <= 0) return false;
  const gap = opts.minGapMs ?? 55;
  if (opts.lastAt !== undefined && opts.now - opts.lastAt < gap) return false;
  return true;
}

type ContextFactory = () => AudioContext | null;

const defaultFactory: ContextFactory = () => {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
};

class AudioService {
  private ctx: AudioContext | null = null;
  private muted = false;
  private volume = 0.6;
  private readonly lastAt = new Map<SoundName, number>();
  private factory: ContextFactory = defaultFactory;

  /** Test seam: inject a mock AudioContext factory. */
  _setContextFactory(factory: ContextFactory): void {
    this.factory = factory;
    this.ctx = null;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  setVolume(volume: number): void {
    this.volume = clampVolume(volume);
  }

  getState(): { muted: boolean; volume: number } {
    return { muted: this.muted, volume: this.volume };
  }

  private now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  private ensureContext(): AudioContext | null {
    try {
      if (!this.ctx) this.ctx = this.factory();
      if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
      return this.ctx;
    } catch {
      return null;
    }
  }

  play(name: SoundName): void {
    const now = this.now();
    if (!shouldPlay({ muted: this.muted, volume: this.volume, lastAt: this.lastAt.get(name), now })) return;
    this.lastAt.set(name, now);

    const ctx = this.ensureContext();
    if (!ctx) return; // fail silently when audio is unavailable/blocked

    try {
      const spec = SOUND_SPECS[name];
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      const t0 = ctx.currentTime;
      const peak = spec.gain * this.volume;

      osc.type = spec.type;
      osc.frequency.setValueAtTime(spec.freq, t0);
      if (spec.sweepTo !== undefined) osc.frequency.linearRampToValueAtTime(spec.sweepTo, t0 + spec.duration);

      // Short attack, exponential release — avoids clicks.
      gainNode.gain.setValueAtTime(0.0001, t0);
      gainNode.gain.linearRampToValueAtTime(Math.max(0.0001, peak), t0 + 0.008);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.duration);

      osc.connect(gainNode).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + spec.duration + 0.02);
      osc.onended = () => {
        try {
          osc.disconnect();
          gainNode.disconnect();
        } catch {
          // ignore
        }
      };
    } catch {
      // never let audio break gameplay
    }
  }
}

export const audioService = new AudioService();
