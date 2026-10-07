import { describe, expect, it } from 'vitest';
import { buildJob, concat, packBits, unpackBits } from '../src/printer/protocol';
import { bitmapToRaster } from '../src/printer/raster';
import { profileById, lineBytes } from '../src/printer/profiles';
import { findAllStatus } from '../src/printer/status';

const e560 = profileById('pt-e560bt');

describe('PackBits', () => {
  it('round-trips runs, literals and long data', () => {
    const samples = [
      new Uint8Array(0),
      new Uint8Array([1]),
      new Uint8Array(16).fill(0),
      new Uint8Array([1, 2, 3, 3, 3, 3, 4, 5, 5]),
      Uint8Array.from({ length: 700 }, (_, i) => (i % 37 < 20 ? 0xff : i & 0xff)),
    ];
    for (const s of samples) expect(Array.from(unpackBits(packBits(s)))).toEqual(Array.from(s));
  });
  it('compresses a blank line', () => {
    expect(packBits(new Uint8Array(16)).length).toBeLessThan(4);
  });
});

describe('raster mapping', () => {
  it('maps row 0 to the highest pin with the band centred', () => {
    const bytes = lineBytes(e560);
    // 2 columns, 128 rows; ink only at row 0 in column 0 and row 127 in column 1.
    const bits = new Uint8Array(2 * 128);
    bits[0] = 1;
    bits[127 * 2 + 1] = 1;
    const { lines } = bitmapToRaster({ width: 2, height: 128, bits }, e560);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveLength(bytes);
    const offset = Math.floor((e560.headPins - 128) / 2);
    const pin = (line: Uint8Array) => {
      for (let p = 0; p < bytes * 8; p++) if (line[bytes - 1 - (p >> 3)] & (1 << (p & 7))) return p;
      return -1;
    };
    expect(pin(lines[0])).toBe(offset + 127);
    expect(pin(lines[1])).toBe(offset);
  });
});

describe('PT-E560BT minimal job', () => {
  it('matches the known-good minimal byte stream', () => {
    const line = new Uint8Array(lineBytes(e560));
    line[5] = 0xaa;
    const out = concat(buildJob([{ lines: [line, line] }], e560, {
      mediaWidth: 12, autoCut: true, cutEvery: 1, halfCut: false, chain: false, mirror: false, minimal: true,
    }));
    const expected = concat([
      new Uint8Array(100),
      new Uint8Array([0x1b, 0x40]),
      new Uint8Array([0x1b, 0x69, 0x61, 0x01]),
      new Uint8Array([0x1b, 0x69, 0x7a, 0x00, 0x00, 12, 0x00, 2, 0, 0, 0, 0x02, 0x00]),
      new Uint8Array([0x1b, 0x69, 0x64, 0x01, 0x00]),
      new Uint8Array([0x4d, 0x00]),
      new Uint8Array([0x47, line.length, 0]), line,
      new Uint8Array([0x47, line.length, 0]), line,
      new Uint8Array([0x1a]),
    ]);
    expect(Array.from(out)).toEqual(Array.from(expected));
  });

  it('sends cut commands and page flags in full mode', () => {
    const line = new Uint8Array(lineBytes(e560));
    const out = concat(buildJob([{ lines: [line] }, { lines: [line] }], e560, {
      mediaWidth: 24, autoCut: true, cutEvery: 1, halfCut: true, chain: false, mirror: false, minimal: false,
    }));
    const s = Array.from(out);
    const find = (seq: number[], from = 0) => {
      for (let i = from; i <= s.length - seq.length; i++) if (seq.every((b, j) => s[i + j] === b)) return i;
      return -1;
    };
    expect(find([0x1b, 0x69, 0x4d, 0x40])).toBeGreaterThan(0); // auto cut
    expect(find([0x1b, 0x69, 0x4b, 0x0c])).toBeGreaterThan(0); // half cut + no chain
    expect(s.filter((b, i) => b === 0x0c && s[i - 1] !== 0x69 && s[i - 1] !== 0x4b).length).toBeGreaterThanOrEqual(1);
    expect(s[s.length - 1]).toBe(0x1a);
  });
});

describe('status packets', () => {
  const packet = (type: number, err1 = 0) => {
    const b = new Uint8Array(32);
    b[0] = 0x80;
    b[1] = 0x20;
    b[8] = err1;
    b[10] = 24;
    b[18] = type;
    return b;
  };

  it('finds every packet in a stream, including ones after noise', () => {
    const stream = concat([new Uint8Array([0x00, 0x13]), packet(0x06), packet(0x01), new Uint8Array([0x80]), packet(0x02, 0x01)]);
    const all = findAllStatus(stream);
    expect(all.map((s) => s.statusType)).toEqual([0x06, 0x01, 0x02]);
    expect(all[2].errors.length).toBeGreaterThan(0);
  });
});
