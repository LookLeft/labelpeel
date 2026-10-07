import type { PrinterProfile } from './profiles';
import { lineBytes } from './profiles';
import type { RasterPage } from './protocol';

/**
 * A monochrome bitmap in tape orientation: `width` columns along the tape
 * (one raster line each) by `height` rows across the printable band.
 * `bits[y * width + x]` is 1 for ink.
 */
export interface Bitmap {
  width: number;
  height: number;
  bits: Uint8Array;
}

/**
 * Convert a bitmap to raster lines. Row 0 (top of the label as designed)
 * maps to the highest head pin, matching ptouch-print:
 *   pixel = offset + (height - 1 - row)
 *   line[(bytes - 1) - (pixel >> 3)] |= 1 << (pixel & 7)
 * The printable band is centred on the head.
 */
export function bitmapToRaster(bmp: Bitmap, profile: PrinterProfile): RasterPage {
  const bytes = lineBytes(profile);
  const height = Math.min(bmp.height, profile.headPins);
  const offset = Math.floor((profile.headPins - height) / 2);
  const lines: Uint8Array[] = [];
  for (let x = 0; x < bmp.width; x++) {
    const line = new Uint8Array(bytes);
    for (let row = 0; row < height; row++) {
      if (!bmp.bits[row * bmp.width + x]) continue;
      const pixel = offset + (height - 1 - row);
      line[bytes - 1 - (pixel >> 3)] |= 1 << (pixel & 7);
    }
    lines.push(line);
  }
  return { lines };
}

/** Threshold RGBA image data into a bitmap (dark = ink). */
export function imageDataToBitmap(data: ImageData | { width: number; height: number; data: Uint8ClampedArray }, threshold = 128): Bitmap {
  const { width, height } = data;
  const px = data.data;
  const bits = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = px[i * 4 + 3];
    if (a < 128) continue;
    const lum = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
    if (lum < threshold) bits[i] = 1;
  }
  return { width, height, bits };
}
