import { useEffect, useRef } from 'react';
import { usePrefersReducedMotion } from './motion';
import { type OrbState, synthesizeLevels } from './orb-signal';

export type { OrbState } from './orb-signal';

interface VoiceOrbProps {
  state: OrbState;
  /** CSS pixels (the canvas is drawn at device resolution). */
  size: number;
  /**
   * Real spectrum (voice, PASSO 17). Without it the bars are synthesized from the state,
   * so the orb "speaks" while a reply is being written on screen.
   */
  analyser?: AnalyserNode | null;
  className?: string;
}

const BARS = 72;

interface Palette {
  a: string;
  b: string;
  c: string;
  danger: string;
}

function readPalette(element: Element): Palette {
  const style = getComputedStyle(element);
  const value = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    a: value('--accent', '#3ef2ff'),
    b: value('--accent-2', '#8b5cff'),
    c: value('--accent-3', '#ff4fd8'),
    danger: value('--danger', '#ff7a8f'),
  };
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  size: number,
  levels: Float32Array,
  palette: Palette,
  state: OrbState,
  t: number,
): void {
  const center = size / 2;
  const inner = size * 0.26;
  const maxBar = size * 0.2;
  ctx.clearRect(0, 0, size, size);

  // Halo
  const energy = levels.reduce((sum, level) => sum + level, 0) / levels.length;
  const halo = ctx.createRadialGradient(
    center,
    center,
    inner * 0.2,
    center,
    center,
    center,
  );
  halo.addColorStop(0, state === 'error' ? palette.danger : palette.a);
  halo.addColorStop(0.45, `${state === 'error' ? palette.danger : palette.b}55`);
  halo.addColorStop(1, 'transparent');
  ctx.globalAlpha = 0.18 + energy * 0.5;
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 1;

  // Frequency ring
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, state === 'error' ? palette.danger : palette.a);
  gradient.addColorStop(0.55, palette.b);
  gradient.addColorStop(1, palette.c);
  ctx.strokeStyle = gradient;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.5, size / 110);
  // Interpreting speech spins the comet the other way, so the two phases read differently.
  const rotation =
    state === 'thinking' ? t * 0.6 : state === 'transcribing' ? -t * 0.9 : t * 0.08;
  for (let i = 0; i < levels.length; i += 1) {
    const angle = (i / levels.length) * Math.PI * 2 + rotation;
    const length = 2 + (levels[i] ?? 0) * maxBar;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(center + cos * inner, center + sin * inner);
    ctx.lineTo(center + cos * (inner + length), center + sin * (inner + length));
    ctx.stroke();
  }

  // Core
  const pulse = 1 + energy * 0.25;
  const core = ctx.createRadialGradient(
    center - inner * 0.3,
    center - inner * 0.35,
    inner * 0.1,
    center,
    center,
    inner * 0.86 * pulse,
  );
  core.addColorStop(0, '#ffffff');
  core.addColorStop(0.25, state === 'error' ? palette.danger : palette.a);
  core.addColorStop(0.75, palette.b);
  core.addColorStop(1, 'transparent');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(center, center, inner * 0.86 * pulse, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The assistant's "face": a ring of frequency bars around a glowing core. It breathes when
 * idle, runs a comet while thinking and pulses like a voice spectrum while speaking.
 * Purely decorative (aria-hidden); the state is announced as text elsewhere. With reduced
 * motion it draws a single static frame.
 */
export function VoiceOrb({ state, size, analyser = null, className }: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const reducedMotion = usePrefersReducedMotion();
  // With reduced motion each state change redraws the single static frame.
  const staticState = reducedMotion ? state : null;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return; // no canvas support (tests, very old browsers)

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const palette = readPalette(canvas);
    const levels = new Float32Array(BARS);
    const smoothed = new Float32Array(BARS);
    const spectrum = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const start = performance.now();
    let frame = 0;

    const render = (now: number) => {
      const t = (now - start) / 1000;
      if (analyser && spectrum) {
        analyser.getByteFrequencyData(spectrum);
        const step = Math.max(1, Math.floor(spectrum.length / BARS));
        for (let i = 0; i < BARS; i += 1) levels[i] = (spectrum[i * step] ?? 0) / 255;
      } else {
        synthesizeLevels(stateRef.current, t, levels);
      }
      for (let i = 0; i < BARS; i += 1) {
        smoothed[i] = (smoothed[i] ?? 0) * 0.7 + (levels[i] ?? 0) * 0.3;
      }
      drawFrame(ctx, size, smoothed, palette, stateRef.current, t);
      if (!reducedMotion) frame = requestAnimationFrame(render);
    };

    if (reducedMotion) {
      synthesizeLevels(stateRef.current, 0.6, levels);
      drawFrame(ctx, size, levels, palette, stateRef.current, 0);
      return;
    }
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [size, analyser, reducedMotion, staticState]);

  return (
    <canvas
      ref={canvasRef}
      className={className ? `voice-orb ${className}` : 'voice-orb'}
      data-state={state}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
