/**
 * Minimal radix-2 complex FFT (1D + 2D) on split real/imaginary Float64Arrays.
 * Tables are cached per size, so repeated transforms of the same size are cheap.
 */

interface FftTables {
  n: number;
  rev: Uint32Array;
  cos: Float64Array;
  sin: Float64Array;
}

const tableCache = new Map<number, FftTables>();

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function tables(n: number): FftTables {
  let t = tableCache.get(n);
  if (t) return t;
  if (!isPowerOfTwo(n)) throw new Error(`FFT size must be a power of two, got ${n}`);
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n);
    sin[i] = Math.sin((-2 * Math.PI * i) / n);
  }
  t = { n, rev, cos, sin };
  tableCache.set(n, t);
  return t;
}

/** In-place FFT of length n starting at offset with given stride. inverse=true computes the unnormalised inverse. */
export function fft1d(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  const { rev, cos, sin } = tables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  const sign = inverse ? -1 : 1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sign * sin[k * step];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/** In-place 2D FFT of a width×height (both powers of two) row-major complex array. */
export function fft2d(re: Float64Array, im: Float64Array, width: number, height: number, inverse = false): void {
  const rowRe = new Float64Array(width);
  const rowIm = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    const o = y * width;
    for (let x = 0; x < width; x++) {
      rowRe[x] = re[o + x];
      rowIm[x] = im[o + x];
    }
    fft1d(rowRe, rowIm, inverse);
    for (let x = 0; x < width; x++) {
      re[o + x] = rowRe[x];
      im[o + x] = rowIm[x];
    }
  }
  const colRe = new Float64Array(height);
  const colIm = new Float64Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      colRe[y] = re[y * width + x];
      colIm[y] = im[y * width + x];
    }
    fft1d(colRe, colIm, inverse);
    for (let y = 0; y < height; y++) {
      re[y * width + x] = colRe[y];
      im[y * width + x] = colIm[y];
    }
  }
  if (inverse) {
    const s = 1 / (width * height);
    for (let i = 0; i < re.length; i++) {
      re[i] *= s;
      im[i] *= s;
    }
  }
}
