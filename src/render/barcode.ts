// Barcode encoding via bwip-js (Barcode Writer in Pure PostScript), reduced to
// a module matrix so we can draw every module on whole printer dots.
import bwipjs from 'bwip-js';

export type Encoded =
  | { kind: '1d'; modules: Uint8Array; width: number }
  | { kind: '2d'; bits: Uint8Array; width: number; height: number };

export interface Symbology {
  id: string;
  name: string;
  twoD: boolean;
  sample: string;
}

export const SYMBOLOGIES: Symbology[] = [
  { id: 'qrcode', name: 'QR Code', twoD: true, sample: 'https://example.com' },
  { id: 'microqrcode', name: 'Micro QR', twoD: true, sample: '12345' },
  { id: 'datamatrix', name: 'Data Matrix', twoD: true, sample: 'ASSET-0001' },
  { id: 'azteccode', name: 'Aztec', twoD: true, sample: 'ASSET-0001' },
  { id: 'pdf417', name: 'PDF417', twoD: true, sample: 'ASSET-0001' },
  { id: 'code128', name: 'Code 128', twoD: false, sample: 'ABC-12345' },
  { id: 'code39', name: 'Code 39', twoD: false, sample: 'ABC12345' },
  { id: 'code93', name: 'Code 93', twoD: false, sample: 'ABC12345' },
  { id: 'ean13', name: 'EAN-13', twoD: false, sample: '5012345678900' },
  { id: 'ean8', name: 'EAN-8', twoD: false, sample: '96385074' },
  { id: 'upca', name: 'UPC-A', twoD: false, sample: '012345678905' },
  { id: 'upce', name: 'UPC-E', twoD: false, sample: '01234565' },
  { id: 'itf14', name: 'ITF-14', twoD: false, sample: '15012345678907' },
  { id: 'interleaved2of5', name: 'Interleaved 2 of 5', twoD: false, sample: '1234567890' },
  { id: 'rationalizedCodabar', name: 'Codabar', twoD: false, sample: 'A123456B' },
  { id: 'gs1-128', name: 'GS1-128', twoD: false, sample: '(01)95012345678903' },
];

export const isTwoD = (id: string) => SYMBOLOGIES.find((s) => s.id === id)?.twoD ?? false;

const cache = new Map<string, Encoded | Error>();

export function encodeBarcode(symbology: string, data: string, eclevel?: string): Encoded | Error {
  const key = `${symbology}|${eclevel ?? ''}|${data}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let result: Encoded | Error;
  try {
    if (!data) throw new Error('No data');
    const opts: Record<string, unknown> = { bcid: symbology, text: data };
    if (symbology === 'qrcode' && eclevel) opts.eclevel = eclevel;
    if (symbology === 'gs1-128') opts.parse = false;
    const raw = (bwipjs as unknown as { raw: (o: unknown) => Array<Record<string, unknown>> }).raw(opts);
    const r = raw[0];
    if (Array.isArray(r.pixs)) {
      const w = r.pixx as number;
      const h = r.pixy as number;
      result = { kind: '2d', bits: Uint8Array.from(r.pixs as number[]), width: w, height: h };
    } else if (Array.isArray(r.sbs)) {
      const sbs = r.sbs as number[];
      const mods: number[] = [];
      sbs.forEach((wid, i) => {
        const n = Math.max(1, Math.round(wid));
        for (let k = 0; k < n; k++) mods.push(i % 2 === 0 ? 1 : 0);
      });
      result = { kind: '1d', modules: Uint8Array.from(mods), width: mods.length };
    } else {
      throw new Error('Unsupported symbology output');
    }
  } catch (e) {
    const msg = typeof e === 'string' ? e : (e as Error).message;
    result = new Error(msg.replace(/^bwipp\.\w+:\s*/, ''));
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, result);
  return result;
}
