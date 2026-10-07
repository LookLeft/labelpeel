// 32-byte status packet, Brother raster command reference section "Status information".

export interface PrinterStatus {
  model: number;
  battery: number;
  errors: string[];
  mediaWidth: number;
  mediaType: number;
  mediaTypeName: string;
  statusType: number;
  statusTypeName: string;
  phase: number;
  tapeColor: number;
  tapeColorName: string;
  textColor: number;
  textColorName: string;
  raw: Uint8Array;
}

const ERR1: [number, string][] = [
  [0x01, 'No media'],
  [0x02, 'End of media'],
  [0x04, 'Cutter jam'],
  [0x08, 'Weak batteries'],
  [0x10, 'Printer in use'],
  [0x20, 'Printer turned off'],
  [0x40, 'High-voltage adapter'],
  [0x80, 'Fan motor error'],
];
const ERR2: [number, string][] = [
  [0x01, 'Replace media'],
  [0x02, 'Expansion buffer full'],
  [0x04, 'Communication error'],
  [0x08, 'Communication buffer full'],
  [0x10, 'Cover open'],
  [0x20, 'Overheating'],
  [0x40, 'Feed error'],
  [0x80, 'System error'],
];

export const MEDIA_TYPES: Record<number, string> = {
  0x00: 'No media',
  0x01: 'Laminated tape',
  0x03: 'Non-laminated tape',
  0x04: 'Fabric tape',
  0x11: 'Heat-shrink tube (2:1)',
  0x13: 'Flexible ID tape',
  0x14: 'Flexible ID tape',
  0x15: 'Satin tape',
  0x17: 'Heat-shrink tube (3:1)',
  0xff: 'Incompatible tape',
};

export const TAPE_COLOR_NAMES: Record<number, string> = {
  0x01: 'White', 0x02: 'Other', 0x03: 'Clear', 0x04: 'Red', 0x05: 'Blue', 0x06: 'Yellow',
  0x07: 'Green', 0x08: 'Black', 0x09: 'Clear (white text)', 0x20: 'Matte white', 0x21: 'Matte clear',
  0x22: 'Matte silver', 0x23: 'Satin gold', 0x24: 'Satin silver', 0x30: 'Blue (D)', 0x31: 'Red (D)',
  0x40: 'Fluorescent orange', 0x41: 'Fluorescent yellow', 0x50: 'Berry pink', 0x51: 'Light grey',
  0x52: 'Lime green', 0x60: 'Yellow (F)', 0x61: 'Pink (F)', 0x62: 'Blue (F)', 0x70: 'White (heat-shrink)',
  0x90: 'White (flex ID)', 0x91: 'Yellow (flex ID)', 0xf0: 'Cleaning', 0xf1: 'Stencil', 0xff: 'Incompatible',
};

export const TEXT_COLOR_NAMES: Record<number, string> = {
  0x01: 'White', 0x02: 'Other', 0x04: 'Red', 0x05: 'Blue', 0x08: 'Black', 0x0a: 'Gold',
  0x62: 'Blue (F)', 0xf0: 'Cleaning', 0xf1: 'Stencil', 0xff: 'Incompatible',
};

/** Approximate on-screen colours for reported tape / text colours. */
export const TAPE_RGB: Record<number, string> = {
  0x01: '#ffffff', 0x03: '#eef2f5', 0x04: '#d62828', 0x05: '#3b82f6', 0x06: '#ffd60a', 0x07: '#2a9d4b',
  0x08: '#1a1a1a', 0x09: '#eef2f5', 0x20: '#f7f7f5', 0x21: '#eef2f5', 0x22: '#c9ccd1', 0x23: '#d4af37',
  0x24: '#c0c0c0', 0x40: '#ff8a1f', 0x41: '#f4ff3a', 0x50: '#e75480', 0x51: '#d1d5db', 0x52: '#a3e635',
  0x60: '#ffd60a', 0x61: '#f9a8d4', 0x62: '#93c5fd', 0x70: '#ffffff', 0x90: '#ffffff', 0x91: '#ffd60a',
};
export const TEXT_RGB: Record<number, string> = {
  0x01: '#ffffff', 0x04: '#d62828', 0x05: '#1d4ed8', 0x08: '#111111', 0x0a: '#d4af37', 0x62: '#1d4ed8',
};

const STATUS_TYPES: Record<number, string> = {
  0x00: 'Status reply',
  0x01: 'Printing completed',
  0x02: 'Error occurred',
  0x04: 'Turned off',
  0x05: 'Notification',
  0x06: 'Phase change',
};

export function parseStatus(b: Uint8Array): PrinterStatus | null {
  if (b.length < 32 || b[0] !== 0x80 || b[1] !== 0x20) return null;
  const errors: string[] = [];
  for (const [bit, name] of ERR1) if (b[8] & bit) errors.push(name);
  for (const [bit, name] of ERR2) if (b[9] & bit) errors.push(name);
  const name = (t: Record<number, string>, v: number) => t[v] ?? `Unknown (0x${v.toString(16).padStart(2, '0')})`;
  return {
    model: b[4],
    battery: b[6],
    errors,
    mediaWidth: b[10],
    mediaType: b[11],
    mediaTypeName: name(MEDIA_TYPES, b[11]),
    statusType: b[18],
    statusTypeName: name(STATUS_TYPES, b[18]),
    phase: b[19],
    tapeColor: b[24],
    tapeColorName: name(TAPE_COLOR_NAMES, b[24]),
    textColor: b[25],
    textColorName: name(TEXT_COLOR_NAMES, b[25]),
    raw: b.slice(0, 32),
  };
}

/** Every status packet in a stream of bytes, in order. */
export function findAllStatus(buf: Uint8Array): PrinterStatus[] {
  const out: PrinterStatus[] = [];
  for (let i = 0; i + 32 <= buf.length; ) {
    const s = buf[i] === 0x80 && buf[i + 1] === 0x20 ? parseStatus(buf.subarray(i, i + 32)) : null;
    if (s) {
      out.push(s);
      i += 32;
    } else i++;
  }
  return out;
}

/** Find a status packet inside a stream of bytes. */
export function findStatus(buf: Uint8Array): { status: PrinterStatus; end: number } | null {
  for (let i = 0; i + 32 <= buf.length; i++) {
    if (buf[i] === 0x80 && buf[i + 1] === 0x20) {
      const s = parseStatus(buf.subarray(i, i + 32));
      if (s) return { status: s, end: i + 32 };
    }
  }
  return null;
}
