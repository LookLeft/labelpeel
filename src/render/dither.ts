import type { DitherMode } from '../model/types';

/** Convert RGBA pixels to a 0/1 ink mask (1 = ink) using the chosen method. */
export function ditherToMask(img: ImageData, mode: DitherMode, threshold: number, invert: boolean): Uint8Array {
  const { width: w, height: h, data } = img;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    // Transparent areas count as white paper.
    const lum = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) * a + 255 * (1 - a);
    g[i] = invert ? 255 - lum : lum;
  }
  const out = new Uint8Array(w * h);
  if (mode === 'threshold') {
    for (let i = 0; i < g.length; i++) out[i] = g[i] < threshold ? 1 : 0;
    return out;
  }
  if (mode === 'ordered') {
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const bias = threshold - 128;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const t = ((bayer[(y & 3) * 4 + (x & 3)] + 0.5) / 16) * 255 + bias;
        out[y * w + x] = g[y * w + x] < t ? 1 : 0;
      }
    return out;
  }
  const kernel: [number, number, number][] =
    mode === 'floyd'
      ? [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]]
      : [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = g[i];
      const nv = old < threshold ? 0 : 255;
      out[i] = nv === 0 ? 1 : 0;
      const err = old - nv;
      for (const [dx, dy, f] of kernel) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < w && yy < h) g[yy * w + xx] += err * f;
      }
    }
  return out;
}
