import { crc32 } from './crc32';

/**
 * Minimal ZIP writer (STORE method – tiles are PNG/JPEG/WebP and already compressed).
 * Files are added one by one, so only one tile has to be in memory at a time besides the final Blob parts.
 */
export class ZipWriter {
  private readonly parts: BlobPart[] = [];
  private readonly central: Uint8Array[] = [];
  private offset = 0;
  private count = 0;

  async add(name: string, data: Blob | Uint8Array): Promise<void> {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(bytes);
    if (this.offset + bytes.length > 0xfffffff0) {
      throw new Error('Das ZIP-Archiv würde größer als 4 GB. Bitte eine kleinere Exportauflösung wählen.');
    }
    const { time, date } = dosDateTime(new Date());
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, bytes.length, true);
    lv.setUint32(22, bytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, bytes.length, true);
    cv.setUint32(24, bytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, this.offset, true);
    cen.set(nameBytes, 46);

    this.parts.push(local, bytes);
    this.central.push(cen);
    this.offset += local.length + bytes.length;
    this.count++;
  }

  finish(): Blob {
    const size = this.central.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, this.count, true);
    ev.setUint16(10, this.count, true);
    ev.setUint32(12, size, true);
    ev.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, end], { type: 'application/zip' });
  }
}

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
