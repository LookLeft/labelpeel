// Physical size on screen. CSS's "mm" assumes 96 px per inch, which on most
// screens isn't a real millimetre, so "actual size" comes from a calibration
// (or, in the Mac app, the display's measured size).

import type { Settings } from '../state/store';

/** CSS's nominal pixels per mm (96 dpi). */
export const NOMINAL_PX_PER_MM = 96 / 25.4;

declare global {
  interface Window {
    /** Set by the Mac app from the display's physical size: CSS px per mm. */
    __labelsmithScreen?: { pxPerMm: number };
  }
}

/** Screen pixels per mm measured by the Mac app, if it's hosting the page. */
export const measuredPxPerMm = () => (typeof window !== 'undefined' ? window.__labelsmithScreen?.pxPerMm : undefined);

/**
 * CSS pixels per real millimetre on this screen. Calibration is stored in
 * device pixels, so it still holds when the page is zoomed in or out.
 */
export function actualPxPerMm(settings: Pick<Settings, 'screenDevicePxPerMm'>): number {
  if (settings.screenDevicePxPerMm) return settings.screenDevicePxPerMm / (window.devicePixelRatio || 1);
  return measuredPxPerMm() ?? NOMINAL_PX_PER_MM;
}

/** Whether "actual size" is really calibrated (by the user or the Mac app). */
export const isCalibrated = (settings: Pick<Settings, 'screenDevicePxPerMm'>) => !!settings.screenDevicePxPerMm || !!measuredPxPerMm();
