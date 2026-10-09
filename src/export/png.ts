import { crc32 } from './crc32';

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Streaming PNG encoder (RGBA, 8 bit, Paeth filter, zlib via CompressionStream).
 * Rows are fed strip by strip, so images far larger than the browser's maximum canvas size can be
 * written without ever holding the full bitmap in memory.
 */
export class PngStreamEncoder {
  private readonly parts: BlobPart[] = [];
  private readonly writer: WritableStreamDefaultWriter<BufferSource>;
  private readonly reading: Promise<void>;
  private prev: Uint8Array;
  private rowsWritten = 0;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    if (typeof CompressionStream === 'undefined') {
      throw new Error('Dieser Browser unterstützt keine Kompression (CompressionStream). Bitte einen aktuellen Browser verwenden.');
    }
    const ihdr = new Uint8Array(13);
    const v = new DataView(ihdr.buffer);
    v.setUint32(0, width);
    v.setUint32(4, height);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    this.parts.push(SIGNATURE, chunk('IHDR', ihdr));
    const cs = new CompressionStream('deflate');
    this.writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();
    this.reading = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value?.length) this.parts.push(chunk('IDAT', value));
      }
    })();
    this.prev = new Uint8Array(width * 4);
  }

  /** Appends `rows` rows of RGBA pixels (row-major, width * 4 bytes per row). */
  async writeRows(rgba: Uint8Array | Uint8ClampedArray, rows: number): Promise<void> {
    const stride = this.width * 4;
    const out = new Uint8Array(rows * (stride + 1));
    let prev = this.prev;
    for (let r = 0; r < rows; r++) {
      const row = rgba.subarray(r * stride, (r + 1) * stride);
      const o = r * (stride + 1);
      out[o] = 4; // Paeth
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? row[i - 4] : 0;
        const b = prev[i];
        const c = i >= 4 ? prev[i - 4] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        out[o + 1 + i] = (row[i] - pred) & 0xff;
      }
      prev = row instanceof Uint8Array ? row : new Uint8Array(row.buffer, row.byteOffset, row.length);
    }
    this.prev = new Uint8Array(prev); // copy: caller may reuse its buffer
    this.rowsWritten += rows;
    await this.writer.write(out);
  }

  async finish(): Promise<Blob> {
    if (this.rowsWritten !== this.height) throw new Error(`PNG: ${this.rowsWritten} von ${this.height} Zeilen geschrieben`);
    await this.writer.close();
    await this.reading;
    this.parts.push(chunk('IEND', new Uint8Array(0)));
    return new Blob(this.parts, { type: 'image/png' });
  }
}
