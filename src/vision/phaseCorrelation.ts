import { fft2d, nextPowerOfTwo } from './fft';
import type { Level } from './zncc';

/** Fourier spectrum of a mean-free, edge-tapered image, zero padded to powers of two. */
export interface Spectrum {
  re: Float64Array;
  im: Float64Array;
  fw: number;
  fh: number;
  w: number;
  h: number;
}

export interface Peak {
  x: number;
  y: number;
  value: number;
}

/** Tukey window: flat in the middle, cosine taper on the outer `alpha/2` of each side. */
function tukey(n: number, alpha: number): Float64Array {
  const w = new Float64Array(n);
  const edge = Math.max(1, Math.floor((alpha * (n - 1)) / 2));
  for (let i = 0; i < n; i++) {
    if (i < edge) w[i] = 0.5 * (1 - Math.cos((Math.PI * i) / edge));
    else if (i > n - 1 - edge) w[i] = 0.5 * (1 - Math.cos((Math.PI * (n - 1 - i)) / edge));
    else w[i] = 1;
  }
  return w;
}

export function computeSpectrum(level: Level, fw?: number, fh?: number): Spectrum {
  const { image, mask } = level;
  const w = image.width;
  const h = image.height;
  fw = fw ?? nextPowerOfTwo(w);
  fh = fh ?? nextPowerOfTwo(h);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < image.data.length; i++) {
    if (mask && mask.data[i] < 128) continue;
    sum += image.data[i];
    n++;
  }
  const mean = n ? sum / n : 0;
  const wx = tukey(w, 0.16);
  const wy = tukey(h, 0.16);
  const re = new Float64Array(fw * fh);
  const im = new Float64Array(fw * fh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask && mask.data[i] < 128) continue;
      re[y * fw + x] = (image.data[i] - mean) * wx[x] * wy[y];
    }
  }
  fft2d(re, im, fw, fh);
  return { re, im, fw, fh, w, h };
}

/**
 * Normalised cross-power spectrum FA·conj(FB)/|…| written into (outRe, outIm) with an optional
 * multiplication by i (used to pack two real correlations into one inverse FFT).
 */
function crossPower(A: Spectrum, B: Spectrum, outRe: Float64Array, outIm: Float64Array, timesI: boolean): void {
  const n = A.re.length;
  for (let k = 0; k < n; k++) {
    const ar = A.re[k];
    const ai = A.im[k];
    const br = B.re[k];
    const bi = B.im[k];
    // A * conj(B): if B(x) = A(x + d) the inverse transform peaks at +d.
    const r = ar * br + ai * bi;
    const i = ai * br - ar * bi;
    const mag = Math.sqrt(r * r + i * i) + 1e-9;
    if (timesI) {
      outRe[k] -= i / mag;
      outIm[k] += r / mag;
    } else {
      outRe[k] += r / mag;
      outIm[k] += i / mag;
    }
  }
}

/**
 * Phase correlation surfaces of up to two image pairs with a single inverse FFT.
 * Peak at (x, y) means pos(B) - pos(A) ≡ (x, y) modulo the FFT size.
 */
export function phaseCorrelate2(
  p1: [Spectrum, Spectrum],
  p2: [Spectrum, Spectrum] | null,
): [Float64Array, Float64Array | null] {
  const { fw, fh } = p1[0];
  const re = new Float64Array(fw * fh);
  const im = new Float64Array(fw * fh);
  crossPower(p1[0], p1[1], re, im, false);
  if (p2) crossPower(p2[0], p2[1], re, im, true);
  fft2d(re, im, fw, fh, true);
  return [re, p2 ? im : null];
}

/** Top-k local maxima (3×3, circular neighbourhood) of a correlation surface. */
export function findPeaks(surface: Float64Array, fw: number, fh: number, k: number): Peak[] {
  const peaks: Peak[] = [];
  let minVal = -Infinity;
  for (let y = 0; y < fh; y++) {
    const ym = ((y - 1 + fh) % fh) * fw;
    const y0 = y * fw;
    const yp = ((y + 1) % fh) * fw;
    for (let x = 0; x < fw; x++) {
      const v = surface[y0 + x];
      if (v <= minVal) continue;
      const xm = (x - 1 + fw) % fw;
      const xp = (x + 1) % fw;
      if (
        v < surface[y0 + xm] ||
        v < surface[y0 + xp] ||
        v < surface[ym + x] ||
        v < surface[yp + x] ||
        v < surface[ym + xm] ||
        v < surface[ym + xp] ||
        v < surface[yp + xm] ||
        v < surface[yp + xp]
      )
        continue;
      peaks.push({ x, y, value: v });
      if (peaks.length > k * 4) {
        peaks.sort((a, b) => b.value - a.value);
        peaks.length = k;
        minVal = peaks[k - 1].value;
      }
    }
  }
  peaks.sort((a, b) => b.value - a.value);
  return peaks.slice(0, k);
}

/** All translations compatible with a (wrapped) peak position. */
export function unwrapPeak(p: Peak, s: Spectrum, sB: Spectrum): { dx: number; dy: number }[] {
  const out: { dx: number; dy: number }[] = [];
  const xs = [p.x, p.x - s.fw];
  const ys = [p.y, p.y - s.fh];
  for (const dx of xs) {
    if (dx <= -sB.w || dx >= s.w) continue;
    for (const dy of ys) {
      if (dy <= -sB.h || dy >= s.h) continue;
      out.push({ dx, dy });
    }
  }
  return out;
}
