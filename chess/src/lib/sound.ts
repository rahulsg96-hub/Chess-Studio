import { getSettings } from './settings';

// Sounds are synthesised with Web Audio, so there are no audio files to ship.
let ctx: AudioContext | null = null;

function ac() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function knock(freq: number, duration: number, gain: number, type: OscillatorType = 'triangle', delay = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.5, t + duration);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

export type SoundName = 'move' | 'capture' | 'check' | 'castle' | 'end' | 'lowtime' | 'notify' | 'error';

export function play(name: SoundName) {
  if (!getSettings().sound) return;
  switch (name) {
    case 'move':
      knock(420, 0.07, 0.35);
      break;
    case 'capture':
      knock(300, 0.09, 0.45);
      knock(600, 0.05, 0.2, 'square', 0.01);
      break;
    case 'castle':
      knock(420, 0.06, 0.3);
      knock(380, 0.06, 0.3, 'triangle', 0.09);
      break;
    case 'check':
      knock(880, 0.12, 0.25, 'sine');
      break;
    case 'end':
      knock(523, 0.18, 0.25, 'sine');
      knock(659, 0.18, 0.25, 'sine', 0.15);
      knock(784, 0.3, 0.25, 'sine', 0.3);
      break;
    case 'lowtime':
      knock(1000, 0.08, 0.2, 'sine');
      break;
    case 'notify':
      knock(740, 0.1, 0.2, 'sine');
      knock(988, 0.14, 0.2, 'sine', 0.1);
      break;
    case 'error':
      knock(200, 0.15, 0.25, 'sawtooth');
      break;
  }
}

export function moveSound(san: string) {
  if (san.includes('#')) play('end');
  else if (san.includes('+')) play('check');
  else if (san.startsWith('O-O')) play('castle');
  else if (san.includes('x')) play('capture');
  else play('move');
}
