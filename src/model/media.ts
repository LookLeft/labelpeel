import type { Media, MediaKind } from './types';

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
  /** Die-cut labels: length along the roll in mm. */
  length?: number;
  /** QL (300 dpi, 720 pins): printable dots across the roll. */
  dots300?: number;
  /** QL die-cut labels: printable dots along the label. */
  lengthDots300?: number;
  /** QL: unused pins between the print area and the head's first pin. */
  qlMargin?: number;
}

// Print areas from the Brother raster command references. Narrow heads clamp
// to their pin count.
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

// DK rolls for QL printers (300 dpi, 720 pins). Print areas and pin offsets
// from Brother's QL-800 series raster command reference, as used by the
// open-source brother_ql driver. dots180/dots360 are unused for these.
const dk = (width: number, dots300: number, qlMargin: number, label: string, length?: number, lengthDots300?: number): TapeSize => ({
  width, code: width, dots180: 0, dots360: 0, label, length, dots300, lengthDots300, qlMargin,
});
export const DK_ROLLS: TapeSize[] = [
  dk(12, 106, 29, '12 mm (DK-22214)'),
  dk(29, 306, 6, '29 mm (DK-22210)'),
  dk(38, 413, 12, '38 mm (DK-22225)'),
  dk(50, 554, 12, '50 mm (DK-22223)'),
  dk(54, 590, 0, '54 mm'),
  dk(62, 696, 12, '62 mm (DK-22205)'),
];
export const DK_LABELS: TapeSize[] = [
  dk(17, 165, 0, '17 × 54 mm (DK-11204)', 54, 566),
  dk(17, 165, 0, '17 × 87 mm (DK-11203)', 87, 956),
  dk(23, 202, 42, '23 × 23 mm (DK-11221)', 23, 202),
  dk(24, 236, 42, '24 mm round (DK-11218)', 24, 236),
  dk(29, 306, 6, '29 × 42 mm', 42, 425),
  dk(29, 306, 6, '29 × 90 mm (DK-11201)', 90, 991),
  dk(38, 413, 12, '38 × 90 mm (DK-11208)', 90, 991),
  dk(58, 618, 51, '58 mm round (DK-11207)', 58, 618),
  dk(62, 696, 12, '62 × 29 mm (DK-11209)', 29, 271),
  dk(62, 696, 12, '62 × 100 mm (DK-11202)', 100, 1109),
];

export const isDk = (kind: MediaKind) => kind === 'dk' || kind === 'dkdie';

export function sizesFor(kind: MediaKind): TapeSize[] {
  if (kind === 'hse') return HSE_SIZES;
  if (kind === 'fle') return FLE_SIZES;
  if (kind === 'dk') return DK_ROLLS;
  if (kind === 'dkdie') return DK_LABELS;
  return TZE_SIZES;
}

/** The size entry for some media; die-cut labels also match on length. */
export function findTape(kind: MediaKind, width: number, length?: number): TapeSize {
  const list = sizesFor(kind);
  const exact = list.filter((t) => t.width === width);
  if (exact.length) return exact.find((t) => length == null || t.length === length) ?? exact[0];
  return list.reduce((a, b) => (Math.abs(b.width - width) < Math.abs(a.width - width) ? b : a));
}

/** Printable dots across the tape for a given head. */
export function printableDots(kind: MediaKind, width: number, dpi: number, headPins: number, length?: number): number {
  const t = findTape(kind, width, length);
  // DK sizes are for the QL's own 720-pin head, whatever head is asked about.
  if (t.dots300 != null) return Math.round((t.dots300 * dpi) / 300);
  return Math.min(dpi >= 360 ? t.dots360 : dpi > 180 ? Math.round((t.dots180 * dpi) / 180) : t.dots180, headPins);
}

/**
 * Printable band in design mm, centred on the tape. For die-cut labels, `ends`
 * is the unprintable length at each end and `lengthDots` the printable length.
 */
export function printableBand(kind: MediaKind, width: number, dpi = DPI, headPins = 128, length?: number) {
  const dots = printableDots(kind, width, dpi, headPins, length);
  const h = dotsToMm(dots, dpi);
  const top = Math.max(0, (width - h) / 2);
  const t = findTape(kind, width, length);
  const lengthDots = t.lengthDots300 != null ? Math.round((t.lengthDots300 * dpi) / 300) : null;
  const ends = lengthDots != null && t.length ? Math.max(0, (t.length - dotsToMm(lengthDots, dpi)) / 2) : 0;
  return { top, height: Math.min(h, width), dots, ends, lengthDots };
}

/**
 * The first head pin the printable band uses. P-touch tape is centred on the
 * head; QL rolls sit a fixed number of pins in from one end.
 */
export function headOffset(kind: MediaKind, width: number, headPins: number, rows: number, length?: number): number {
  const t = findTape(kind, width, length);
  return t.qlMargin != null ? Math.max(0, headPins - rows - t.qlMargin) : Math.floor((headPins - rows) / 2);
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

export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  tze: 'TZe tape',
  hse: 'Heat-shrink',
  fle: 'FLe flag',
  fabric: 'Fabric',
  dk: 'DK roll',
  dkdie: 'DK labels',
};

/** The size to start with after switching to a kind of media. */
export function defaultSize(kind: MediaKind): TapeSize {
  const list = sizesFor(kind);
  if (kind === 'dk') return list.find((t) => t.width === 62)!;
  if (kind === 'dkdie') return list.find((t) => t.width === 29 && t.length === 90)!;
  return list[Math.min(3, list.length - 1)];
}

/** Media of `kind` in its default size: DK media is black on white paper. */
export function mediaOfKind(media: Media, kind: MediaKind): Media {
  const t = defaultSize(kind);
  const next: Media = { ...media, kind, width: t.width, length: t.length };
  return isDk(kind) ? { ...next, tapeColor: '#ffffff', inkColor: '#111111', clearFrom: undefined } : next;
}

/**
 * Media a printer can use, as close as possible to `media`: P-touch tape for a
 * QL printer becomes the narrowest DK roll at least as wide, and DK media for
 * a P-touch printer becomes the widest tape it takes.
 */
export function fitMedia(media: Media, kinds: MediaKind[], maxTape: number): Media {
  if (kinds.includes(media.kind)) return media;
  const kind = kinds[0];
  const list = sizesFor(kind).filter((t) => t.width <= maxTape + 0.5 && t.length == null);
  const pick = list.find((t) => t.width >= media.width - 0.5) ?? list[list.length - 1] ?? defaultSize(kind);
  return { ...mediaOfKind(media, kind), width: pick.width, length: pick.length };
}
