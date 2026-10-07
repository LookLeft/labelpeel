// Printer model table. Capability flags follow ptouch-print / ptouch-rs, which
// were verified against real hardware; extra capabilities (half cut, HSe/FLe
// media) come from Brother's published specifications.

import type { MediaKind } from '../model/types';

export const BROTHER_VID = 0x04f9;

export interface PrinterProfile {
  id: string;
  name: string;
  /** USB product ids (normal mode). */
  pids: number[];
  dpi: number;
  /** Print head pins = dots per raster line. */
  headPins: number;
  /** Max tape width in mm. */
  maxTape: number;
  media: MediaKind[];
  /** "ESC i a 01" (dynamic command mode switch) instead of "ESC i R 01". */
  p700Init: boolean;
  /** Sends ESC i z print information. */
  infoCmd: boolean;
  /** D460BT family framing: ESC i d 01 00 + M 00 before raster data. */
  d460bt: boolean;
  /** Supports TIFF/PackBits raster compression. */
  packbits: boolean;
  autoCut: boolean;
  halfCut: boolean;
  bluetooth: boolean;
  /** Raster printing unsupported over this connection (e.g. P-Lite mode). */
  unsupported?: string;
  notes?: string;
}

const base = {
  dpi: 180,
  headPins: 128,
  maxTape: 24,
  media: ['tze'] as MediaKind[],
  p700Init: false,
  infoCmd: false,
  d460bt: false,
  packbits: true,
  autoCut: true,
  halfCut: false,
  bluetooth: false,
};

export const PROFILES: PrinterProfile[] = [
  {
    ...base,
    id: 'pt-e560bt',
    name: 'PT-E560BT',
    pids: [0x2203],
    media: ['tze', 'hse', 'fle'],
    p700Init: true,
    infoCmd: true,
    d460bt: true,
    packbits: false,
    halfCut: true,
    bluetooth: true,
    notes: 'Verified framing from ptouch-print (D460BT family).',
  },
  { ...base, id: 'pt-e510', name: 'PT-E510', pids: [0x2202], media: ['tze', 'hse'], p700Init: true, infoCmd: true, d460bt: true, packbits: false, halfCut: true },
  { ...base, id: 'pt-e310bt', name: 'PT-E310BT', pids: [0x2201], maxTape: 18, media: ['tze', 'hse'], p700Init: true, infoCmd: true, d460bt: true, packbits: false, bluetooth: true },
  { ...base, id: 'pt-d610bt', name: 'PT-D610BT', pids: [0x20e1], p700Init: true, infoCmd: true, d460bt: true, packbits: false, bluetooth: true },
  { ...base, id: 'pt-d460bt', name: 'PT-D460BT', pids: [0x20e0], maxTape: 18, p700Init: true, infoCmd: true, d460bt: true, packbits: false, bluetooth: true },
  { ...base, id: 'pt-d410', name: 'PT-D410', pids: [0x20df], maxTape: 18, infoCmd: true, d460bt: true, packbits: false },
  { ...base, id: 'pt-d450', name: 'PT-D450', pids: [0x2073], maxTape: 18, infoCmd: true, packbits: false },
  { ...base, id: 'pt-d600', name: 'PT-D600', pids: [0x2074] },
  { ...base, id: 'pt-p710bt', name: 'PT-P710BT', pids: [0x20af], halfCut: true, bluetooth: true },
  { ...base, id: 'pt-p700', name: 'PT-P700', pids: [0x2061], p700Init: true, halfCut: true },
  { ...base, id: 'pt-p750w', name: 'PT-P750W', pids: [0x2062], p700Init: true, halfCut: true },
  {
    ...base,
    id: 'pt-e550w',
    name: 'PT-E550W',
    pids: [0x2060],
    media: ['tze', 'hse'],
    p700Init: true,
    halfCut: true,
    unsupported: 'Raster mode is reported unsupported over USB by ptouch-print. Try the P700-class settings at your own risk.',
  },
  { ...base, id: 'pt-e500', name: 'PT-E500', pids: [0x205f], media: ['tze', 'hse'] },
  { ...base, id: 'pt-h500', name: 'PT-H500', pids: [0x205e] },
  { ...base, id: 'pt-2730', name: 'PT-2730', pids: [0x2041], packbits: false },
  { ...base, id: 'pt-2700', name: 'PT-2700', pids: [0x201f], packbits: false },
  { ...base, id: 'pt-2430pc', name: 'PT-2430PC', pids: [0x202d], packbits: false },
  { ...base, id: 'pt-1230pc', name: 'PT-1230PC', pids: [0x202c], maxTape: 12, packbits: false },
  { ...base, id: 'pt-2450pc', name: 'PT-2450PC', pids: [0x2011] },
  { ...base, id: 'pt-2420pc', name: 'PT-2420PC', pids: [0x2007] },
  { ...base, id: 'pt-2300', name: 'PT-2300', pids: [0x2004], headPins: 112, maxTape: 18 },
  { ...base, id: 'pt-1950', name: 'PT-1950', pids: [0x2019], headPins: 112, maxTape: 18 },
  { ...base, id: 'pt-18r', name: 'PT-18R', pids: [0x201a], maxTape: 18 },
  {
    ...base,
    id: 'pt-9700pc',
    name: 'PT-9700PC',
    pids: [0x203c],
    dpi: 360,
    headPins: 384,
    maxTape: 36,
    media: ['tze', 'hse'],
    p700Init: true,
    halfCut: true,
  },
  { ...base, id: 'pt-9500pc', name: 'PT-9500PC', pids: [0x200f], dpi: 360, headPins: 384, maxTape: 36 },
  { ...base, id: 'pt-9200dx', name: 'PT-9200DX', pids: [0x2001, 0x2002], dpi: 360, headPins: 384, maxTape: 36 },
  {
    ...base,
    id: 'pt-p1230pc-plite',
    name: 'P-Lite mode printer',
    pids: [0x2030, 0x2031, 0x2064, 0x2065],
    unsupported: 'The printer is in P-Lite (Editor Lite) mode. Switch the Editor Lite switch off or hold the Editor Lite button until the LED goes out, then reconnect.',
  },
];

export const DEFAULT_PROFILE = PROFILES[0];

export function profileById(id: string | null | undefined): PrinterProfile {
  return PROFILES.find((p) => p.id === id) ?? DEFAULT_PROFILE;
}

export function profileByPid(pid: number): PrinterProfile | undefined {
  return PROFILES.find((p) => p.pids.includes(pid));
}

/** Bytes per raster line for a profile. */
export const lineBytes = (p: PrinterProfile) => Math.ceil(p.headPins / 8);
