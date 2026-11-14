import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Chess } from 'chess.js';
import { readStored } from './storage';

// Short board sounds, made in the browser with Web Audio (no files to download, works offline).
// One global on/off switch, remembered in localStorage.

export type Sound = 'move' | 'capture' | 'check' | 'error' | 'success';

const KEY = 'chess-trainer:sound';
let on = readStored('sound', true);
const listeners = new Set<() => void>();

export function setSoundOn(v: boolean) {
  on = v;
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable — ignore */
  }
  listeners.forEach((l) => l());
}

export function useSoundOn() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => on,
  );
}

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** A wooden "tock": a filtered noise click over a low thump. */
function knock(c: AudioContext, at: number, freq: number, gain: number, len: number) {
  const src = c.createBufferSource();
  src.buffer = noise;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + len);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(at);
  src.stop(at + len);

  const osc = c.createOscillator();
  osc.frequency.setValueAtTime(170, at);
  osc.frequency.exponentialRampToValueAtTime(90, at + len);
  const og = c.createGain();
  og.gain.setValueAtTime(gain * 0.8, at);
  og.gain.exponentialRampToValueAtTime(0.001, at + len);
  osc.connect(og).connect(c.destination);
  osc.start(at);
  osc.stop(at + len);
}

/** A soft tone, for "wrong" and "well done". */
function tone(c: AudioContext, at: number, freq: number, len: number, gain = 0.12) {
  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  osc.connect(g).connect(c.destination);
  osc.start(at);
  osc.stop(at + len);
}

export function playSound(kind: Sound, delay = 0) {
  if (!on) return;
  const c = audio();
  if (!c) return;
  const t = c.currentTime + 0.01 + delay;
  switch (kind) {
    case 'move':
      knock(c, t, 1900, 0.35, 0.07);
      break;
    case 'capture':
      knock(c, t, 1300, 0.5, 0.11);
      knock(c, t + 0.035, 2200, 0.25, 0.06);
      break;
    case 'check':
      knock(c, t, 1900, 0.35, 0.07);
      tone(c, t + 0.03, 988, 0.18, 0.07);
      break;
    case 'error':
      tone(c, t, 330, 0.16);
      tone(c, t + 0.13, 247, 0.24);
      break;
    case 'success':
      tone(c, t, 523, 0.14, 0.09);
      tone(c, t + 0.1, 659, 0.14, 0.09);
      tone(c, t + 0.2, 784, 0.3, 0.09);
      break;
  }
}

const board = (fen: string) => fen.split(' ')[0];

/** The sound for going from one position to the next, or null if it was not a single move (undo, reset, jump). */
export function soundBetween(prevFen: string, nextFen: string): Sound | null {
  if (prevFen === nextFen) return null;
  try {
    const target = board(nextFen);
    for (const m of new Chess(prevFen).moves({ verbose: true })) {
      if (board(m.after) !== target) continue;
      if (m.san.includes('+') || m.san.includes('#')) return 'check';
      return m.captured ? 'capture' : 'move';
    }
  } catch {
    /* not a legal position — stay quiet */
  }
  return null;
}

/** Plays a move sound whenever the board shows the next move (by either side). */
export function useMoveSound(fen: string, active = true) {
  const prev = useRef(fen);
  useEffect(() => {
    const before = prev.current;
    prev.current = fen;
    if (!active) return;
    const s = soundBetween(before, fen);
    if (s) playSound(s);
  }, [fen, active]);
}
