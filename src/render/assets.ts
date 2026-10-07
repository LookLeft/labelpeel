// Async asset cache (SVG symbols, user images, fonts) with change
// notifications so the editor can re-render when something finishes loading.

import { loadCatalog, needsCatalog, symbolSvg } from '../clipart';
import type { LabelDoc } from '../model/types';
import { ensureFont } from './fonts';

const images = new Map<string, HTMLImageElement | 'loading' | 'error'>();
const listeners = new Set<() => void>();
let scheduled = false;

export function onAssetsChanged(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const l of listeners) l();
  });
}

function loadImage(key: string, src: string): Promise<void> {
  const cur = images.get(key);
  if (cur && cur !== 'error') return cur === 'loading' ? waitFor(key) : Promise.resolve();
  images.set(key, 'loading');
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      images.set(key, img);
      notify();
      resolve();
    };
    img.onerror = () => {
      images.set(key, 'error');
      notify();
      resolve();
    };
    img.src = src;
  });
}

function waitFor(key: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => (images.get(key) === 'loading' ? setTimeout(check, 30) : resolve());
    check();
  });
}

const svgKey = (symbol: string, color: string, stroke?: number) => `sym|${symbol}|${color}|${stroke ?? ''}`;

function svgDataUrl(svg: string, color: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/currentColor/g, color))}`;
}

/** Synchronous lookup; kicks off a load and returns null if not ready. */
export function getSymbolImage(symbol: string, color: string, stroke?: number): HTMLImageElement | null {
  const key = svgKey(symbol, color, stroke);
  const cur = images.get(key);
  if (cur instanceof HTMLImageElement) return cur;
  if (cur === undefined) {
    if (needsCatalog(symbol)) {
      loadCatalog().then(() => notify());
      return null;
    }
    const svg = symbolSvg(symbol, stroke);
    if (svg) void loadImage(key, svgDataUrl(svg, color));
  }
  return null;
}

export function getImage(src: string): HTMLImageElement | null {
  const key = `img|${src.length}|${src.slice(-64)}|${src.slice(0, 96)}`;
  const cur = images.get(key);
  if (cur instanceof HTMLImageElement) return cur;
  if (cur === undefined) void loadImage(key, src);
  return null;
}

async function preloadSymbol(symbol: string, color: string, stroke?: number) {
  if (needsCatalog(symbol)) await loadCatalog();
  const svg = symbolSvg(symbol, stroke);
  if (svg) await loadImage(svgKey(symbol, color, stroke), svgDataUrl(svg, color));
}

/** Load everything a document needs before a synchronous print render. */
export async function preloadDoc(doc: LabelDoc, colors: string[] = ['#000000', '#ffffff']) {
  const tasks: Promise<unknown>[] = [];
  for (const el of doc.elements) {
    if (el.type === 'symbol') for (const c of colors) tasks.push(preloadSymbol(el.symbol, c, el.strokeWidth));
    if (el.type === 'image') {
      getImage(el.src);
      tasks.push(waitFor(`img|${el.src.length}|${el.src.slice(-64)}|${el.src.slice(0, 96)}`));
    }
    if (el.type === 'text' || el.type === 'grid') tasks.push(ensureFont(el.font, el.bold, el.italic));
    if (el.type === 'barcode' && el.showText) tasks.push(ensureFont(el.font, false, false));
  }
  await Promise.all(tasks);
}
