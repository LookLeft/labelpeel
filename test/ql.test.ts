import { describe, expect, it } from 'vitest';
import { fitMedia, headOffset, printableBand } from '../src/model/media';
import type { Media } from '../src/model/types';
import { buildJob, concat, QL_CONTINUOUS, QL_DIE_CUT } from '../src/printer/protocol';
import { lineBytes, profileById, profileByPid } from '../src/printer/profiles';
import { bitmapToRaster } from '../src/printer/raster';
import { findAllStatus } from '../src/printer/status';

const ql = profileById('ql-800');
const opts = { autoCut: true, cutEvery: 1, halfCut: false, chain: false, mirror: false, minimal: false };

describe('QL-800 profile', () => {
  it('is detected by USB id and has a 300 dpi, 720-pin head', () => {
    expect(profileByPid(0x209b)?.id).toBe('ql-800');
    expect(ql.dpi).toBe(300);
    expect(lineBytes(ql)).toBe(90);
  });
});

describe('QL job', () => {
  it('sends the QL command sequence for a continuous roll', () => {
    const line = new Uint8Array(90);
    line[0] = 0x81;
    const out = concat(buildJob([{ lines: [line, line] }], ql, { ...opts, mediaWidth: 62, mediaType: QL_CONTINUOUS }));
    const expected = concat([
      new Uint8Array(400),
      new Uint8Array([0x1b, 0x40]),
      new Uint8Array([0x1b, 0x69, 0x61, 0x01]),
      // valid flags: recovery, quality, type, width (no length for a roll); 2 lines; first page.
      new Uint8Array([0x1b, 0x69, 0x7a, 0xc6, 0x0a, 62, 0, 2, 0, 0, 0, 0, 0]),
      new Uint8Array([0x1b, 0x69, 0x4d, 0x40]),
      new Uint8Array([0x1b, 0x69, 0x41, 0x01]),
      new Uint8Array([0x1b, 0x69, 0x4b, 0x08]),
      new Uint8Array([0x1b, 0x69, 0x64, 35, 0]),
      new Uint8Array([0x67, 0x00, 90]), line,
      new Uint8Array([0x67, 0x00, 90]), line,
      new Uint8Array([0x1a]),
    ]);
    expect(Array.from(out)).toEqual(Array.from(expected));
  });

  it('gives die-cut labels their length, no feed margin, and page flags', () => {
    const line = new Uint8Array(90);
    const out = Array.from(concat(buildJob([{ lines: [line] }, { lines: [line] }], ql, { ...opts, mediaWidth: 29, mediaType: QL_DIE_CUT, mediaLength: 90 })));
    const at = (seq: number[]) => {
      for (let i = 0; i <= out.length - seq.length; i++) if (seq.every((b, j) => out[i + j] === b)) return i;
      return -1;
    };
    expect(at([0x1b, 0x69, 0x7a, 0xce, 0x0b, 29, 90, 1, 0, 0, 0, 0, 0])).toBeGreaterThan(0); // first label
    expect(at([0x1b, 0x69, 0x7a, 0xce, 0x0b, 29, 90, 1, 0, 0, 0, 1, 0])).toBeGreaterThan(0); // second label
    expect(at([0x1b, 0x69, 0x64, 0, 0])).toBeGreaterThan(0);
    expect(out[out.length - 1]).toBe(0x1a);
  });

  it("doesn't cut at the end when cutting is off or chained", () => {
    const line = new Uint8Array(90);
    for (const o of [{ noCut: true }, { chain: true }]) {
      const out = Array.from(concat(buildJob([{ lines: [line] }], ql, { ...opts, autoCut: false, ...o, mediaWidth: 62, mediaType: QL_CONTINUOUS })));
      expect(out.join(',')).toContain([0x1b, 0x69, 0x4b, 0x00].join(','));
    }
  });
});

describe('QL head placement', () => {
  // Head column, numbered from the first bit sent (MSB of byte 0), as the
  // brother_ql driver lays out its 720-dot lines.
  const columns = (line: Uint8Array) => {
    const out: number[] = [];
    for (let c = 0; c < line.length * 8; c++) if (line[c >> 3] & (0x80 >> (c & 7))) out.push(c);
    return out;
  };
  const place = (media: Media) => {
    const band = printableBand(media.kind, media.width, ql.dpi, ql.headPins, media.length);
    const bits = new Uint8Array(band.dots);
    bits[0] = 1; // top row of the design
    bits[band.dots - 1] = 1; // bottom row
    const offset = headOffset(media.kind, media.width, ql.headPins, band.dots, media.length);
    return columns(bitmapToRaster({ width: 1, height: band.dots, bits }, ql, offset).lines[0]);
  };
  const m = (kind: Media['kind'], width: number, length?: number): Media => ({ kind, width, length, tapeColor: '#fff', inkColor: '#000' });

  it('puts a 62 mm roll on columns 12–707', () => expect(place(m('dk', 62))).toEqual([12, 707]));
  it('puts a 29 mm roll on columns 6–311', () => expect(place(m('dk', 29))).toEqual([6, 311]));
  it('puts 23 × 23 mm labels on columns 42–243', () => expect(place(m('dkdie', 23, 23))).toEqual([42, 243]));
});

describe('DK media', () => {
  it('works out the printable length of die-cut labels', () => {
    const band = printableBand('dkdie', 29, 300, 720, 90);
    expect(band.lengthDots).toBe(991);
    expect(band.ends).toBeCloseTo((90 - (991 / 300) * 25.4) / 2, 5);
    expect(printableBand('dk', 62, 300, 720).ends).toBe(0);
  });

  it("isn't clamped to a P-touch head when no printer is given", () => {
    expect(printableBand('dk', 62).height).toBeCloseTo((696 / 300) * 25.4, 0);
  });

  it('fits media to what a printer takes', () => {
    const tze = m('tze', 24);
    expect(fitMedia(tze, ql.media, ql.maxTape)).toMatchObject({ kind: 'dk', width: 29 });
    expect(fitMedia(m('tze', 12), ql.media, ql.maxTape)).toMatchObject({ kind: 'dk', width: 12 });
    expect(fitMedia(m('dk', 62), ['tze'], 24)).toMatchObject({ kind: 'tze', width: 24 });
    expect(fitMedia(tze, ['tze', 'hse'], 24)).toBe(tze);
  });

  function m(kind: Media['kind'], width: number): Media {
    return { kind, width, tapeColor: '#fff', inkColor: '#000' };
  }
});

describe('QL status', () => {
  it('reads die-cut label length', () => {
    const b = new Uint8Array(32);
    b[0] = 0x80;
    b[1] = 0x20;
    b[10] = 29;
    b[11] = 0x0b;
    b[17] = 90;
    const [s] = findAllStatus(b);
    expect(s).toMatchObject({ mediaWidth: 29, mediaLength: 90, mediaType: 0x0b, mediaTypeName: 'Die-cut DK labels' });
  });
});
