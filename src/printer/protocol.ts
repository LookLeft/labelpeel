// Brother P-touch raster command protocol.
//
// Command set per Brother's "Software Developer's Manual — Raster Command
// Reference" (PT-E550W / P750W / P710BT / E560BT generation), cross-checked
// against byte streams known to work on real printers:
//
//   invalidate     100 × 0x00
//   ESC @          initialise
//   ESC i a 01     switch to raster mode (ESC i R 01 on older models)
//   per page:
//     ESC i z ...  print information (media width, raster count, page n9)
//     ESC i M n    various mode: bit6 auto cut, bit7 mirror
//     ESC i A n    cut every n labels
//     ESC i K n    advanced mode: bit2 half cut, bit3 no chain printing,
//                  bit4 special tape (no cutting)
//     ESC i d n n  margin (feed) amount in dots
//     M n          compression: 0x00 none, 0x02 TIFF/PackBits
//     G len data   raster line, Z = blank line
//     0x0C         print (more pages follow), 0x1A print + feed (last page)
//
// For the D460BT family (PT-E560BT, E510, E310BT, D610BT, D460BT) the
// known-good stream sends "ESC i d 01 00" + "M 00" right after ESC i z, with
// n9 = 0x02. The "minimal" mode below reproduces that byte stream exactly.
//
// QL printers (profile.ql) use the same family with a few differences, per
// Brother's QL-800 series raster command reference:
//   400 × 0x00 invalidate; ESC i z with valid flags, media type (0x0A
//   continuous, 0x0B die-cut), width and length, n9 0 = first page, 1 = other;
//   ESC i K bit3 = cut at end; feed margin 35 dots on continuous rolls, 0 on
//   die-cut; no compression; raster lines are "g 00 n data" with no blank-line
//   shortcut.

import type { PrinterProfile } from './profiles';
import { lineBytes } from './profiles';

export interface RasterPage {
  /** One entry per raster line (label column), each lineBytes(profile) long. */
  lines: Uint8Array[];
}

export interface JobOptions {
  /** Media width code in mm (from the tape table). */
  mediaWidth: number;
  /** Media type for ESC i z n2 (0 = not specified). */
  mediaType?: number;
  /** QL die-cut labels: label length in mm for ESC i z n4. */
  mediaLength?: number;
  autoCut: boolean;
  cutEvery: number;
  halfCut: boolean;
  /** Keep the last label in the printer (chain printing). */
  chain: boolean;
  mirror: boolean;
  /** Special tape mode: disables all cutting (fabric, some HSe). */
  noCut?: boolean;
  /** Only send the known-good minimal sequence (no cut/mode commands). */
  minimal: boolean;
}

export const ESC = 0x1b;

export const cmdInvalidate = (n = 100) => new Uint8Array(n);
export const cmdInit = () => new Uint8Array([ESC, 0x40]);
export const cmdStatusRequest = () => new Uint8Array([ESC, 0x69, 0x53]);
export const cmdRasterMode = (p: PrinterProfile) =>
  p.p700Init ? new Uint8Array([ESC, 0x69, 0x61, 0x01]) : new Uint8Array([ESC, 0x69, 0x52, 0x01]);

export function cmdPrintInfo(widthMm: number, rasterLines: number, n9: number, mediaType = 0): Uint8Array {
  // n1 valid flags: 0x00 matches the known-good minimal stream; the printer
  // then uses the installed media. n2 media type, n3 width, n4 length (0).
  return new Uint8Array([
    ESC, 0x69, 0x7a,
    0x00,
    mediaType & 0xff,
    widthMm & 0xff,
    0x00,
    rasterLines & 0xff,
    (rasterLines >> 8) & 0xff,
    (rasterLines >> 16) & 0xff,
    (rasterLines >> 24) & 0xff,
    n9 & 0xff,
    0x00,
  ]);
}

/** QL print information: media type, width and length are checked against the loaded roll. */
export function cmdQlPrintInfo(mediaType: number, widthMm: number, lengthMm: number, rasterLines: number, firstPage: boolean): Uint8Array {
  // n1: 0x02 type, 0x04 width, 0x08 length valid; 0x40 quality priority; 0x80 printer recovery on.
  const flags = 0x80 | 0x40 | 0x02 | 0x04 | (lengthMm ? 0x08 : 0);
  return new Uint8Array([
    ESC, 0x69, 0x7a,
    flags,
    mediaType & 0xff,
    widthMm & 0xff,
    lengthMm & 0xff,
    rasterLines & 0xff,
    (rasterLines >> 8) & 0xff,
    (rasterLines >> 16) & 0xff,
    (rasterLines >> 24) & 0xff,
    firstPage ? 0 : 1,
    0x00,
  ]);
}
export const QL_CONTINUOUS = 0x0a;
export const QL_DIE_CUT = 0x0b;
/** QL raster line: "g", 0x00, byte count, then the uncompressed line. */
export const cmdQlRasterLine = (data: Uint8Array) => concat([new Uint8Array([0x67, 0x00, data.length]), data]);

export const cmdVariousMode = (autoCut: boolean, mirror: boolean) =>
  new Uint8Array([ESC, 0x69, 0x4d, (autoCut ? 0x40 : 0) | (mirror ? 0x80 : 0)]);
export const cmdCutEvery = (n: number) => new Uint8Array([ESC, 0x69, 0x41, Math.max(1, Math.min(99, n))]);
export const cmdAdvancedMode = (halfCut: boolean, noChain: boolean, specialTape: boolean) =>
  new Uint8Array([ESC, 0x69, 0x4b, (halfCut ? 0x04 : 0) | (noChain ? 0x08 : 0) | (specialTape ? 0x10 : 0)]);
export const cmdMargin = (dots: number) => new Uint8Array([ESC, 0x69, 0x64, dots & 0xff, (dots >> 8) & 0xff]);
export const cmdCompression = (packbits: boolean) => new Uint8Array([0x4d, packbits ? 0x02 : 0x00]);
/** D460BT-family chain command: ESC i K 00 + NUL. */
export const cmdD460btChain = () => new Uint8Array([ESC, 0x69, 0x4b, 0x00, 0x00]);
export const cmdPrint = () => new Uint8Array([0x0c]);
export const cmdPrintFeed = () => new Uint8Array([0x1a]);
export const cmdBlankLine = () => new Uint8Array([0x5a]);

export function cmdRasterLine(data: Uint8Array, packbits: boolean): Uint8Array {
  const payload = packbits ? packBits(data) : data;
  const out = new Uint8Array(3 + payload.length);
  out[0] = 0x47; // G
  out[1] = payload.length & 0xff;
  out[2] = (payload.length >> 8) & 0xff;
  out.set(payload, 3);
  return out;
}

/** TIFF PackBits encoder. */
export function packBits(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    // Run of identical bytes?
    let run = 1;
    while (i + run < src.length && run < 128 && src[i + run] === src[i]) run++;
    if (run >= 2) {
      out.push((257 - run) & 0xff, src[i]);
      i += run;
      continue;
    }
    // Literal run until the next repeat of 2+ bytes.
    const start = i;
    let len = 0;
    while (i < src.length && len < 128) {
      if (i + 1 < src.length && src[i] === src[i + 1]) break;
      i++;
      len++;
    }
    out.push(len - 1, ...src.subarray(start, start + len));
  }
  return Uint8Array.from(out);
}

export function unpackBits(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    const n = src[i++];
    if (n < 128) {
      for (let k = 0; k <= n; k++) out.push(src[i++]);
    } else if (n > 128) {
      const v = src[i++];
      for (let k = 0; k < 257 - n; k++) out.push(v);
    }
  }
  return Uint8Array.from(out);
}

const isBlank = (line: Uint8Array) => line.every((b) => b === 0);

export function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * Build a complete job for one or more pages (labels). Returned as a list of
 * chunks in send order so transports can pace the transfer.
 */
export function buildJob(pages: RasterPage[], profile: PrinterProfile, opts: JobOptions): Uint8Array[] {
  if (profile.ql) return buildQlJob(pages, profile, opts);
  const chunks: Uint8Array[] = [];
  chunks.push(concat([cmdInvalidate(), cmdInit()]));
  chunks.push(cmdRasterMode(profile));
  const packbits = profile.packbits && !opts.minimal;
  const bytesPerLine = lineBytes(profile);

  pages.forEach((page, idx) => {
    const last = idx === pages.length - 1;
    const first = idx === 0;
    const header: Uint8Array[] = [];
    // In minimal mode every page is a self-contained job.
    if (opts.minimal && !first) header.push(cmdRasterMode(profile));
    if (profile.infoCmd) {
      // n9: 0 = first page, 1 = middle, 2 = last. The minimal stream always
      // sends 2 on D460BT models; a single page is first and last.
      const n9 = opts.minimal ? (profile.d460bt ? 2 : 0) : last ? 2 : first ? 0 : 1;
      header.push(cmdPrintInfo(opts.mediaWidth, page.lines.length, n9, opts.minimal ? 0 : opts.mediaType ?? 0));
    }
    if (!opts.minimal) {
      header.push(cmdVariousMode(opts.autoCut && !opts.noCut, opts.mirror));
      if (opts.autoCut && !opts.noCut) header.push(cmdCutEvery(opts.cutEvery));
      header.push(cmdAdvancedMode(opts.halfCut && profile.halfCut && !opts.noCut, !opts.chain, !!opts.noCut));
    }
    if (profile.d460bt) {
      header.push(cmdMargin(1));
      header.push(cmdCompression(false));
      if (opts.minimal && opts.chain) header.push(cmdD460btChain());
    } else {
      if (!opts.minimal) header.push(cmdMargin(0));
      if (packbits) header.push(cmdCompression(true));
    }
    chunks.push(concat(header));

    // Raster data in ~4 KB chunks.
    let buf: Uint8Array[] = [];
    let size = 0;
    for (const line of page.lines) {
      if (line.length !== bytesPerLine) throw new Error(`Raster line is ${line.length} bytes, expected ${bytesPerLine}`);
      const cmd = isBlank(line) && !profile.d460bt ? cmdBlankLine() : cmdRasterLine(line, packbits);
      buf.push(cmd);
      size += cmd.length;
      if (size >= 4096) {
        chunks.push(concat(buf));
        buf = [];
        size = 0;
      }
    }
    if (buf.length) chunks.push(concat(buf));

    if (profile.d460bt && opts.minimal) {
      chunks.push(cmdPrintFeed());
    } else {
      chunks.push(last ? cmdPrintFeed() : cmdPrint());
    }
  });
  return chunks;
}

function buildQlJob(pages: RasterPage[], profile: PrinterProfile, opts: JobOptions): Uint8Array[] {
  const chunks: Uint8Array[] = [concat([cmdInvalidate(400), cmdInit()]), cmdRasterMode(profile)];
  const dieCut = opts.mediaType === QL_DIE_CUT;
  const bytesPerLine = lineBytes(profile);
  pages.forEach((page, idx) => {
    const last = idx === pages.length - 1;
    const header = [cmdQlPrintInfo(opts.mediaType ?? QL_CONTINUOUS, opts.mediaWidth, dieCut ? opts.mediaLength ?? 0 : 0, page.lines.length, idx === 0)];
    header.push(cmdVariousMode(opts.autoCut && !opts.noCut, false));
    if (opts.autoCut && !opts.noCut) header.push(cmdCutEvery(opts.cutEvery));
    // ESC i K bit3: cut after the last label.
    header.push(new Uint8Array([ESC, 0x69, 0x4b, !opts.chain && !opts.noCut ? 0x08 : 0]));
    header.push(cmdMargin(dieCut ? 0 : 35));
    chunks.push(concat(header));
    let buf: Uint8Array[] = [];
    let size = 0;
    for (const line of page.lines) {
      if (line.length !== bytesPerLine) throw new Error(`Raster line is ${line.length} bytes, expected ${bytesPerLine}`);
      const cmd = cmdQlRasterLine(line);
      buf.push(cmd);
      size += cmd.length;
      if (size >= 4096) {
        chunks.push(concat(buf));
        buf = [];
        size = 0;
      }
    }
    if (buf.length) chunks.push(concat(buf));
    chunks.push(last ? cmdPrintFeed() : cmdPrint());
  });
  return chunks;
}

/** A job that only feeds and cuts the tape. */
export function buildFeedCutJob(profile: PrinterProfile, media: Pick<JobOptions, 'mediaWidth' | 'mediaType' | 'mediaLength'>, lines = 1): Uint8Array[] {
  const blank = new Uint8Array(lineBytes(profile));
  return buildJob([{ lines: Array(lines).fill(blank) }], profile, {
    ...media,
    autoCut: true,
    cutEvery: 1,
    halfCut: false,
    chain: false,
    mirror: false,
    minimal: profile.d460bt,
  });
}

/** Hex dump for the protocol log. */
export function hex(bytes: Uint8Array, max = 64): string {
  const s = Array.from(bytes.subarray(0, max), (b) => b.toString(16).padStart(2, '0')).join(' ');
  return bytes.length > max ? `${s} … (+${bytes.length - max} bytes)` : s;
}
