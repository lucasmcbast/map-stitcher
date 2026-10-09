import { inflateSync } from 'node:zlib';
import { crc32 } from '../../src/export/crc32';

/** Decodes a PNG produced by PngStreamEncoder (RGBA, 8 bit, any filter) back to pixels. */
export function decodePng(buf: Uint8Array): { width: number; height: number; data: Uint8Array } {
  const view = new DataView(buf.buffer, buf.byteOffset);
  let p = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (p < buf.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(...buf.subarray(p + 4, p + 8));
    const data = buf.subarray(p + 8, p + 8 + len);
    if (view.getUint32(p + 8 + len) !== crc32(buf.subarray(p + 4, p + 8 + len))) throw new Error(`PNG CRC mismatch in ${type}`);
    if (type === 'IHDR') {
      width = new DataView(data.buffer, data.byteOffset).getUint32(0);
      height = new DataView(data.buffer, data.byteOffset).getUint32(4);
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= 4 ? out[y * stride + i - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = i >= 4 && y > 0 ? out[(y - 1) * stride + i - 4] : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + i] = (x + pred) & 0xff;
    }
  }
  return { width, height, data: out };
}
