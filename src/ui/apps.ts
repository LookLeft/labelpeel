// Links to the native apps, for suggesting them from the website. Releases
// attach Labelpeel.dmg and Labelpeel.apk, so "latest/download" always gets the newest.

import { supportsNative } from '../printer/native';

export const REPO_URL = 'https://github.com/LookLeft/labelpeel';
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
export const MAC_DOWNLOAD = `${REPO_URL}/releases/latest/download/Labelpeel.dmg`;
export const ANDROID_DOWNLOAD = `${REPO_URL}/releases/latest/download/Labelpeel.apk`;

/** The app worth suggesting on this device, if the page isn't already running in one. */
export function appForThisDevice(): 'macos' | 'android' | null {
  if (typeof navigator === 'undefined' || supportsNative()) return null;
  if (/Android/i.test(navigator.userAgent)) return 'android';
  // iPads also report "MacIntel", but have a touch screen.
  if (/Mac/.test(navigator.platform) && navigator.maxTouchPoints < 2) return 'macos';
  return null;
}
