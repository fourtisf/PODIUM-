// Sound: the prototype's WebAudio beep() and its three generated songs. Browser only.
import type { SongKey } from '@podium/shared';

const MUTE_KEY = 'podium.mute';
type Wave = 'sine' | 'square' | 'triangle' | 'sawtooth';

let AC: AudioContext | null = null;
let muted = false;
let loaded = false;

export function isMuted(): boolean {
  if (!loaded) {
    loaded = true;
    try {
      muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* private mode */
    }
  }
  return muted;
}

export function setMuted(v: boolean): void {
  loaded = true;
  muted = v;
  try {
    localStorage.setItem(MUTE_KEY, v ? '1' : '0');
  } catch {
    /* private mode */
  }
}

export function beep(f: number, d: number, type?: Wave, v?: number, slide?: number): void {
  if (isMuted()) return;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    AC = AC || new Ctor();
    if (AC.state === 'suspended') void AC.resume();
    const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, f + slide), t + d);
    g.gain.setValueAtTime(v || 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g);
    g.connect(AC.destination);
    o.start(t);
    o.stop(t + d);
  } catch {
    /* no audio */
  }
}

let NOISE: AudioBuffer | null = null;

/** A short percussion hit for milestones: a pitched-down kick, a noise snare or a closed hat. */
export function drum(kind: 'kick' | 'snare' | 'hat' = 'kick', v = 0.08): void {
  if (isMuted()) return;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    AC = AC || new Ctor();
    if (AC.state === 'suspended') void AC.resume();
    const t = AC.currentTime, g = AC.createGain();
    g.connect(AC.destination);
    if (kind === 'kick') {
      const o = AC.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
      g.gain.setValueAtTime(v * 2, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.23);
      return;
    }
    if (!NOISE) {
      NOISE = AC.createBuffer(1, AC.sampleRate * 0.3, AC.sampleRate);
      const d = NOISE.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const n = AC.createBufferSource(), f = AC.createBiquadFilter();
    n.buffer = NOISE;
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 7000 : 1800;
    const d = kind === 'hat' ? 0.05 : 0.14;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    n.connect(f);
    f.connect(g);
    n.start(t);
    n.stop(t + d + 0.01);
  } catch {
    /* no audio */
  }
}

export const SONGS: Record<SongKey, { bpm: number; bass: number[]; arp: number[] }> = {
  a: { bpm: 132, bass: [0, 0, 7, 5], arp: [0, 7, 12, 7, 3, 7, 12, 15] },
  b: { bpm: 112, bass: [0, 5, 3, 7], arp: [0, 3, 7, 10, 12, 10, 7, 3] },
  c: { bpm: 150, bass: [0, 0, 3, 5], arp: [12, 7, 0, 7, 15, 7, 3, 7] },
};

let MUS: ReturnType<typeof setInterval> | null = null;

export function stopMusic(): void {
  if (MUS) {
    clearInterval(MUS);
    MUS = null;
  }
}

/** Starts the song; `playing()` gates each note so a paused run stays silent. */
export function startMusic(song: SongKey, playing: () => boolean): void {
  stopMusic();
  if (isMuted()) return;
  const sg = SONGS[song] || SONGS.a, hz = (n: number) => 110 * Math.pow(2, n / 12), st = 60 / sg.bpm / 2;
  let i = 0;
  MUS = setInterval(() => {
    if (!playing()) return;
    const b = sg.bass[Math.floor(i / 8) % sg.bass.length]!;
    if (i % 4 === 0) beep(hz(b - 12), st * 1.8, 'triangle', 0.05);
    beep(hz(b + sg.arp[i % sg.arp.length]! + 12), st * 0.9, 'square', 0.011);
    if (i % 8 === 4) beep(1800, 0.03, 'square', 0.007);
    i++;
  }, st * 1000);
}
