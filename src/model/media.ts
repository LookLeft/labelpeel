import type { MediaKind } from './types';

export const DPI = 180;
export const MM_PER_INCH = 25.4;
export const PT_TO_MM = 25.4 / 72;

export const dotsToMm = (dots: number, dpi = DPI) => (dots / dpi) * MM_PER_INCH;
export const mmToDots = (mm: number, dpi = DPI) => (mm / MM_PER_INCH) * dpi;

export interface TapeSize {
  /** Nominal width in mm. */
  width: number;
  /** Width code sent to / reported by the printer. */
  code: number;
  /** Printable dots across the tape at 180 dpi (128-pin heads). */
  dots180: number;
  /** Printable dots at 360 dpi (PT-P900 / PT-9700 class heads). */
  dots360: number;
  label: string;
}

// Print areas from the Brother raster command references (as also used by
// ptouch-print / ptouch-rs). Narrow heads clamp to their pin count.
export const TZE_SIZES: TapeSize[] = [
  { width: 3.5, code: 4, dots180: 24, dots360: 48, label: '3.5 mm' },
  { width: 6, code: 6, dots180: 32, dots360: 64, label: '6 mm' },
  { width: 9, code: 9, dots180: 52, dots360: 106, label: '9 mm' },
  { width: 12, code: 12, dots180: 76, dots360: 150, label: '12 mm' },
  { width: 18, code: 18, dots180: 120, dots360: 234, label: '18 mm' },
  { width: 24, code: 24, dots180: 128, dots360: 320, label: '24 mm' },
  { width: 36, code: 36, dots180: 192, dots360: 454, label: '36 mm' },
];

// Heat-shrink tube (HSe) widths are the flattened tube width. They report the
// nearest TZe width code and print within a reduced area.
export const HSE_SIZES: TapeSize[] = [
  { width: 5.8, code: 6, dots180: 28, dots360: 56, label: '5.8 mm (HSe-211)' },
  { width: 8.8, code: 9, dots180: 48, dots360: 96, label: '8.8 mm (HSe-221)' },
  { width: 11.7, code: 12, dots180: 70, dots360: 140, label: '11.7 mm (HSe-231)' },
  { width: 17.7, code: 18, dots180: 112, dots360: 224, label: '17.7 mm (HSe-241)' },
  { width: 23.6, code: 24, dots180: 128, dots360: 300, label: '23.6 mm (HSe-251)' },
];

// FLe die-cut flag labels: 21 mm wide, 45 mm long, printed on 24 mm raster.
export const FLE_SIZES: TapeSize[] = [
  { width: 21, code: 21, dots180: 124, dots360: 248, label: '21 × 45 mm flag (FLe)' },
];

export function sizesFor(kind: MediaKind): TapeSize[] {
  if (kind === 'hse') return HSE_SIZES;
  if (kind === 'fle') return FLE_SIZES;
  return TZE_SIZES;
}

export function findTape(kind: MediaKind, width: number): TapeSize {
  const list = sizesFor(kind);
  return list.find((t) => t.width === width) ?? list.reduce((a, b) => (Math.abs(b.width - width) < Math.abs(a.width - width) ? b : a));
}

/** Printable dots across the tape for a given head. */
export function printableDots(kind: MediaKind, width: number, dpi: number, headPins: number): number {
  const t = findTape(kind, width);
  return Math.min(dpi >= 360 ? t.dots360 : t.dots180, headPins);
}

/** Printable band in design mm, centred on the tape. */
export function printableBand(kind: MediaKind, width: number, dpi = DPI, headPins = 128) {
  const dots = printableDots(kind, width, dpi, headPins);
  const h = dotsToMm(dots, dpi);
  const top = Math.max(0, (width - h) / 2);
  return { top, height: Math.min(h, width), dots };
}

export const TAPE_COLORS: { name: string; tape: string; ink: string }[] = [
  { name: 'Black on white', tape: '#ffffff', ink: '#111111' },
  { name: 'Black on yellow', tape: '#ffd60a', ink: '#111111' },
  { name: 'Black on clear', tape: '#eef2f5', ink: '#111111' },
  { name: 'White on black', tape: '#1a1a1a', ink: '#ffffff' },
  { name: 'Black on red', tape: '#d62828', ink: '#111111' },
  { name: 'White on red', tape: '#d62828', ink: '#ffffff' },
  { name: 'Black on green', tape: '#2a9d4b', ink: '#111111' },
  { name: 'White on blue', tape: '#1d4ed8', ink: '#ffffff' },
  { name: 'Black on blue', tape: '#3b82f6', ink: '#111111' },
  { name: 'Black on orange', tape: '#ff8a1f', ink: '#111111' },
  { name: 'Black on silver', tape: '#c9ccd1', ink: '#111111' },
  { name: 'Gold on black', tape: '#1a1a1a', ink: '#d4af37' },
  { name: 'Red on white', tape: '#ffffff', ink: '#d62828' },
  { name: 'Blue on white', tape: '#ffffff', ink: '#1d4ed8' },
];
