// Bundled fonts (self-hosted via @fontsource so the app works offline) plus
// common system fonts and any fonts the user loads.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-400-italic.css';
import '@fontsource/inter/latin-700-italic.css';
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-700.css';
import '@fontsource/roboto/latin-400-italic.css';
import '@fontsource/roboto-condensed/latin-400.css';
import '@fontsource/roboto-condensed/latin-700.css';
import '@fontsource/roboto-mono/latin-400.css';
import '@fontsource/roboto-mono/latin-700.css';
import '@fontsource/oswald/latin-400.css';
import '@fontsource/oswald/latin-700.css';
import '@fontsource/bebas-neue/latin-400.css';
import '@fontsource/barlow-condensed/latin-400.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/archivo-narrow/latin-400.css';
import '@fontsource/archivo-narrow/latin-700.css';
import '@fontsource/open-sans/latin-400.css';
import '@fontsource/open-sans/latin-700.css';
import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-700.css';
import '@fontsource/source-serif-4/latin-400.css';
import '@fontsource/source-serif-4/latin-700.css';
import '@fontsource/permanent-marker/latin-400.css';

export interface FontInfo {
  family: string;
  category: 'Sans' | 'Condensed' | 'Mono' | 'Serif' | 'Display' | 'System' | 'Custom';
}

export const BUNDLED_FONTS: FontInfo[] = [
  { family: 'Inter', category: 'Sans' },
  { family: 'Roboto', category: 'Sans' },
  { family: 'Open Sans', category: 'Sans' },
  { family: 'Montserrat', category: 'Sans' },
  { family: 'Roboto Condensed', category: 'Condensed' },
  { family: 'Barlow Condensed', category: 'Condensed' },
  { family: 'Archivo Narrow', category: 'Condensed' },
  { family: 'Oswald', category: 'Condensed' },
  { family: 'Bebas Neue', category: 'Display' },
  { family: 'Permanent Marker', category: 'Display' },
  { family: 'Roboto Mono', category: 'Mono' },
  { family: 'Source Serif 4', category: 'Serif' },
];

export const SYSTEM_FONTS: FontInfo[] = [
  'Arial', 'Arial Narrow', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Calibri',
  'Impact', 'Georgia', 'Times New Roman', 'Courier New', 'Consolas',
].map((family) => ({ family, category: 'System' as const }));

const custom: FontInfo[] = [];
const listeners = new Set<() => void>();

export function allFonts(): FontInfo[] {
  return [...BUNDLED_FONTS, ...custom, ...SYSTEM_FONTS];
}

export function onFontsChanged(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const l of listeners) l();
}

/** Register a user-supplied font file (TTF/OTF/WOFF). */
export async function loadFontFile(file: File): Promise<string> {
  const family = file.name.replace(/\.(ttf|otf|woff2?)$/i, '');
  const face = new FontFace(family, await file.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  if (!custom.some((f) => f.family === family)) custom.push({ family, category: 'Custom' });
  notify();
  return family;
}

/** Use the Local Font Access API (Chrome) to list installed fonts. */
export async function loadLocalFonts(): Promise<number> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
  if (!q) throw new Error('This browser cannot list installed fonts. Type the font name instead, or load a font file.');
  const fonts = await q();
  const families = Array.from(new Set(fonts.map((f) => f.family))).sort();
  let added = 0;
  for (const family of families) {
    if (allFonts().some((f) => f.family === family)) continue;
    custom.push({ family, category: 'Custom' });
    added++;
  }
  notify();
  return added;
}

export function fontString(family: string, sizePx: number, bold: boolean, italic: boolean): string {
  return `${italic ? 'italic ' : ''}${bold ? '700' : '400'} ${sizePx}px "${family}", sans-serif`;
}

export async function ensureFont(family: string, bold: boolean, italic: boolean): Promise<void> {
  try {
    await document.fonts.load(fontString(family, 20, bold, italic), 'AHgjy09');
  } catch {
    /* unknown font: canvas falls back */
  }
}
