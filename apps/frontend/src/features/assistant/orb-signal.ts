export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

/** Deterministic pseudo-noise, smooth in time (no Math.random flicker). */
function noise(i: number, t: number): number {
  return (
    Math.sin(i * 1.7 + t * 2.3) * 0.5 +
    Math.sin(i * 0.43 - t * 3.1) * 0.3 +
    Math.sin(i * 2.9 + t * 5.7) * 0.2
  );
}

/** Bar amplitudes (0..1) for a state at time t (seconds). */
export function synthesizeLevels(state: OrbState, t: number, out: Float32Array): void {
  for (let i = 0; i < out.length; i += 1) {
    const n = (noise(i, t) + 1) / 2;
    let level: number;
    switch (state) {
      case 'speaking': {
        // Syllable-like envelope over a spectrum that is louder in the low/mid bands.
        const syllables =
          0.55 + 0.45 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 2.1 + 1));
        const band = 1 - Math.abs(Math.sin((i / out.length) * Math.PI * 2)) * 0.35;
        level = (0.25 + n * 0.75) * syllables * band;
        break;
      }
      case 'listening':
        level = 0.18 + n * 0.45 * (0.6 + 0.4 * Math.sin(t * 4));
        break;
      case 'thinking': {
        // A bright comet running around the ring.
        const head = (t * 1.6) % 1;
        const distance = Math.abs(i / out.length - head);
        const wrapped = Math.min(distance, 1 - distance);
        level = 0.08 + Math.max(0, 1 - wrapped * 9) * 0.7 + n * 0.06;
        break;
      }
      case 'error':
        level = 0.05 + n * 0.08;
        break;
      default:
        level = 0.07 + n * 0.1 * (0.7 + 0.3 * Math.sin(t * 1.4));
    }
    out[i] = Math.min(1, Math.max(0, level));
  }
}
