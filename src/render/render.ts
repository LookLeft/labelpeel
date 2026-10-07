// Label renderer shared by the editor (screen) and the printer (1-bit raster).
// Coordinates are converted from mm to pixels by multiplying with `s`.

import { designSize, gridWidth, printableRect } from '../model/defaults';
import { DPI, MM_PER_INCH, PT_TO_MM, printableBand } from '../model/media';
import { resolve, type PlaceholderContext } from '../model/placeholders';
import type {
  BarcodeElement,
  GridElement,
  HAlign,
  ImageElement,
  LabelDoc,
  LabelElement,
  ShapeElement,
  SymbolElement,
  TextElement,
  VAlign,
} from '../model/types';
import { encodeBarcode } from './barcode';
import { getImage, getSymbolImage } from './assets';
import { ditherToMask } from './dither';
import { fontString } from './fonts';

export interface RenderOptions {
  /** Pixels per mm. */
  scale: number;
  ink: string;
  paper: string;
  pctx: PlaceholderContext;
  /** Printer dots per mm, used to snap barcode modules and dither images. */
  dpm?: number;
  /** Fill the tape background. */
  background?: boolean;
  /** Draw error placeholders (editor only). */
  editor?: boolean;
  /** Skip these element ids (e.g. while inline editing). */
  skip?: Set<string>;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  length: number;
  boxes: Map<string, Box>;
}

// ---------------------------------------------------------------- metrics

let measureCtx: CanvasRenderingContext2D | null = null;
function mctx(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

interface FontMetrics {
  cap: number;
  desc: number;
}
const metricsCache = new Map<string, FontMetrics>();

export function fontMetrics(font: string, bold: boolean, italic: boolean): FontMetrics {
  const key = `${font}|${bold}|${italic}|${document.fonts?.status}`;
  let m = metricsCache.get(key);
  if (!m) {
    const c = mctx();
    c.font = fontString(font, 100, bold, italic);
    const cap = c.measureText('H').actualBoundingBoxAscent / 100 || 0.72;
    const desc = c.measureText('gjpqy').actualBoundingBoxDescent / 100 || 0.22;
    m = { cap, desc };
    metricsCache.set(key, m);
  }
  return m;
}

export function clearMetrics() {
  metricsCache.clear();
}

interface TextStyleLike {
  font: string;
  bold: boolean;
  italic: boolean;
  lineHeight: number;
  letterSpacing: number;
  underline?: boolean;
  strike?: boolean;
}

function measureLine(line: string, st: TextStyleLike): number {
  const c = mctx();
  c.font = fontString(st.font, 100, st.bold, st.italic);
  return c.measureText(line).width / 100;
}

/** How far a line's glyphs actually reach above and below the baseline, in em. */
function measureInk(line: string, st: TextStyleLike): { ascent: number; descent: number } {
  // Measured large: browsers round glyph bounds to whole pixels.
  const c = mctx();
  c.font = fontString(st.font, 1000, st.bold, st.italic);
  const m = c.measureText(line);
  return { ascent: (m.actualBoundingBoxAscent || 0) / 1000, descent: (m.actualBoundingBoxDescent || 0) / 1000 };
}

const DESCENDERS = /[gjpqyQ,;()[\]{}|/\\@_µ]/;

/**
 * Space kept clear above and below text, in mm (under one dot at 180 dpi).
 * Browsers snap glyph outlines to the pixel grid at print size, which can
 * make text render up to half a dot taller than measured.
 */
const TEXT_SAFETY = 0.1;

interface TextFit {
  lines: string[];
  em: number;
  width: number;
  blockH: number;
  cap: number;
  /** Distance from the top of the block to the first baseline, in em. */
  ascent: number;
  hasDesc: boolean;
}

/** Fit text lines into a box (mm). `autoWidth` ignores the width limit. */
export function fitText(
  text: string,
  st: TextStyleLike,
  boxW: number,
  boxH: number,
  autoSize: boolean,
  sizePt: number,
  autoWidth: boolean,
  stacked = false,
): TextFit {
  const lines = stacked ? Array.from(text.replace(/\n/g, '')) : text.split('\n');
  const { cap, desc } = fontMetrics(st.font, st.bold, st.italic);
  const hasDesc = DESCENDERS.test(text);
  const n = Math.max(1, lines.length);
  // Round glyphs (O, S, 3) overshoot the cap height and baseline, and ascenders
  // (b, d, l) rise above it, so size the block from the actual glyphs. The cap
  // and descender metrics stay the minimum so typing doesn't make text jump.
  const ascent = Math.max(cap, measureInk(lines[0] ?? '', st).ascent);
  const descent = Math.max(hasDesc ? desc : 0, measureInk(lines[n - 1] ?? '', st).descent);
  const unitH = (n - 1) * st.lineHeight + ascent + descent;
  const widths = lines.map((l) => measureLine(l, st));
  const maxChars = Math.max(0, ...lines.map((l) => Array.from(l).length - 1));
  const unitW = Math.max(0, ...widths);
  let em: number;
  if (autoSize) {
    em = Math.max(0, boxH - 2 * TEXT_SAFETY) / unitH;
    if (!autoWidth && unitW > 0) em = Math.min(em, (boxW - st.letterSpacing * maxChars) / unitW);
    em = Math.max(0.5, em);
  } else {
    em = sizePt * PT_TO_MM;
  }
  return {
    lines,
    em,
    width: unitW * em + st.letterSpacing * maxChars,
    blockH: unitH * em,
    cap,
    ascent,
    hasDesc,
  };
}

// ---------------------------------------------------------------- layout

function rotatedExtent(b: Box, deg: number): Box {
  const r = ((deg % 360) + 360) % 360;
  if (r === 0) return b;
  const rad = (r * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = b.w * cos + b.h * sin;
  const h = b.w * sin + b.h * cos;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function textPadding(el: TextElement) {
  return el.invert || (el.frame && el.frame !== 'none') ? (el.framePadding ?? 0.6) : 0;
}

export function elementBox(el: LabelElement, pctx: PlaceholderContext): Box {
  if (el.type === 'text' && el.autoWidth) {
    const text = resolve(el.text, pctx);
    const pad = textPadding(el);
    const vertical = Math.abs(el.rotation % 180) === 90;
    // When rotated a quarter turn, the "height" the text must fit is the box height still.
    const fit = fitText(text, el, el.w - 2 * pad, el.h - 2 * pad, el.autoSize, el.size, true, el.stacked);
    const w = Math.max(1, fit.width + 2 * pad);
    void vertical;
    return { x: el.x, y: el.y, w, h: el.h };
  }
  if (el.type === 'grid') return { x: el.x, y: el.y, w: gridWidth(el), h: el.h };
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

export function computeLayout(doc: LabelDoc, pctx: PlaceholderContext): Layout {
  const boxes = new Map<string, Box>();
  let extent = 0;
  for (const el of doc.elements) {
    const b = elementBox(el, pctx);
    boxes.set(el.id, b);
    if (el.hidden) continue;
    const e = rotatedExtent(b, el.rotation);
    extent = Math.max(extent, doc.orientation === 'portrait' ? e.y + e.h : e.x + e.w);
  }
  let length = doc.length;
  if (doc.lengthMode === 'auto') {
    length = Math.max(4, (doc.elements.length ? extent : 20) + doc.marginEnd);
  }
  return { length: Math.round(length * 10) / 10, boxes };
}

// ---------------------------------------------------------------- drawing

function dash(ctx: CanvasRenderingContext2D, kind: string, lw: number) {
  if (kind === 'dashed') ctx.setLineDash([lw * 3, lw * 2]);
  else if (kind === 'dotted') ctx.setLineDash([lw, lw * 1.5]);
  else ctx.setLineDash([]);
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rr);
}

interface DrawTextArgs {
  text: string;
  st: TextStyleLike;
  /** Box in px, already in the element's local (unrotated) frame. */
  x: number;
  y: number;
  w: number;
  h: number;
  s: number;
  autoSize: boolean;
  sizePt: number;
  align: HAlign;
  vAlign: VAlign;
  color: string;
  stacked?: boolean;
  /** Extra rotation of the text inside the box: 0, 90 or -90. */
  turn?: number;
}

function drawTextBox(ctx: CanvasRenderingContext2D, a: DrawTextArgs) {
  if (!a.text) return;
  ctx.save();
  let { x, y, w, h } = a;
  if (a.turn) {
    // Rotate the text inside the box; swap the box axes.
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((a.turn * Math.PI) / 180);
    [w, h] = [h, w];
    x = -w / 2;
    y = -h / 2;
  }
  const s = a.s;
  const fit = fitText(a.text, a.st, w / s, h / s, a.autoSize, a.sizePt, false, a.stacked);
  const em = fit.em * s;
  const blockH = fit.blockH * s;
  const safe = TEXT_SAFETY * s;
  const top = a.vAlign === 'top' ? y + safe : a.vAlign === 'bottom' ? y + h - blockH - safe : y + (h - blockH) / 2;
  ctx.font = fontString(a.st.font, em, a.st.bold, a.st.italic);
  const ls = a.st.letterSpacing * s;
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${ls}px`;
  ctx.fillStyle = a.color;
  ctx.strokeStyle = a.color;
  ctx.textBaseline = 'alphabetic';
  const align = a.stacked ? 'center' : a.align;
  ctx.textAlign = align;
  const tx = align === 'left' ? x : align === 'right' ? x + w : x + w / 2;
  fit.lines.forEach((line, i) => {
    const baseline = top + fit.ascent * em + i * a.st.lineHeight * em;
    // letterSpacing adds trailing space after the last glyph; compensate for alignment.
    const shift = align === 'center' ? ls / 2 : align === 'right' ? ls : 0;
    ctx.fillText(line, tx + shift, baseline);
    if (a.st.underline || a.st.strike) {
      const lw = Math.max(1, em * 0.07);
      const width = ctx.measureText(line).width;
      const lx = align === 'left' ? tx : align === 'right' ? tx - width : tx - width / 2;
      ctx.lineWidth = lw;
      ctx.setLineDash([]);
      ctx.beginPath();
      if (a.st.underline) {
        ctx.moveTo(lx, baseline + em * 0.12);
        ctx.lineTo(lx + width, baseline + em * 0.12);
      }
      if (a.st.strike) {
        ctx.moveTo(lx, baseline - fit.cap * em * 0.45);
        ctx.lineTo(lx + width, baseline - fit.cap * em * 0.45);
      }
      ctx.stroke();
    }
  });
  (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, el: TextElement, b: Box, o: RenderOptions) {
  const s = o.scale;
  const text = resolve(el.text, o.pctx);
  const pad = textPadding(el) * s;
  const x = -b.w * s / 2;
  const y = -b.h * s / 2;
  const w = b.w * s;
  const h = b.h * s;
  const radius = el.frame === 'round' ? Math.min(w, h) * 0.25 : Math.min(w, h) * 0.04;
  let color = o.ink;
  if (el.invert) {
    ctx.fillStyle = o.ink;
    roundRectPath(ctx, x, y, w, h, el.frame === 'round' ? radius : 0);
    ctx.fill();
    color = o.paper;
  }
  if (el.frame && el.frame !== 'none' && !el.invert) {
    const lw = Math.max(1, 0.3 * s);
    ctx.lineWidth = lw;
    ctx.strokeStyle = o.ink;
    ctx.setLineDash([]);
    roundRectPath(ctx, x + lw / 2, y + lw / 2, w - lw, h - lw, radius);
    ctx.stroke();
  }
  drawTextBox(ctx, {
    text,
    st: el,
    x: x + pad,
    y: y + pad,
    w: w - 2 * pad,
    h: h - 2 * pad,
    s,
    autoSize: el.autoSize,
    sizePt: el.size,
    align: el.align,
    vAlign: el.vAlign,
    color,
    stacked: el.stacked,
  });
}

function drawShape(ctx: CanvasRenderingContext2D, el: ShapeElement, b: Box, o: RenderOptions) {
  const s = o.scale;
  const lw = Math.max(0.5, el.strokeWidth * s);
  const w = b.w * s;
  const h = b.h * s;
  const x = -w / 2;
  const y = -h / 2;
  ctx.lineWidth = lw;
  ctx.strokeStyle = o.ink;
  ctx.fillStyle = o.ink;
  ctx.lineJoin = 'miter';
  dash(ctx, el.dash, lw);
  const ix = x + lw / 2;
  const iy = y + lw / 2;
  const iw = Math.max(0, w - lw);
  const ih = Math.max(0, h - lw);
  ctx.beginPath();
  switch (el.shape) {
    case 'rect':
      ctx.rect(ix, iy, iw, ih);
      break;
    case 'roundrect':
      ctx.roundRect(ix, iy, iw, ih, Math.max(0, Math.min(el.radius * s, iw / 2, ih / 2)));
      break;
    case 'ellipse':
      ctx.ellipse(0, 0, iw / 2, ih / 2, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo(0, iy);
      ctx.lineTo(ix + iw, iy + ih);
      ctx.lineTo(ix, iy + ih);
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(0, iy);
      ctx.lineTo(ix + iw, 0);
      ctx.lineTo(0, iy + ih);
      ctx.lineTo(ix, 0);
      ctx.closePath();
      break;
    case 'arrow': {
      const head = Math.min(iw * 0.4, ih);
      const shaft = ih * 0.36;
      ctx.moveTo(ix, -shaft / 2);
      ctx.lineTo(ix + iw - head, -shaft / 2);
      ctx.lineTo(ix + iw - head, iy);
      ctx.lineTo(ix + iw, 0);
      ctx.lineTo(ix + iw - head, iy + ih);
      ctx.lineTo(ix + iw - head, shaft / 2);
      ctx.lineTo(ix, shaft / 2);
      ctx.closePath();
      break;
    }
    case 'line':
      ctx.lineCap = el.dash === 'dotted' ? 'round' : 'butt';
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
  }
  if (el.fill) ctx.fill();
  if (el.stroke && !el.fill) ctx.stroke();
  else if (el.stroke && el.fill) ctx.stroke();
  ctx.setLineDash([]);
}

function drawSymbol(ctx: CanvasRenderingContext2D, el: SymbolElement, b: Box, o: RenderOptions) {
  const s = o.scale;
  let w = b.w * s;
  let h = b.h * s;
  if (el.invert) {
    ctx.fillStyle = o.ink;
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  const img = getSymbolImage(el.symbol, el.invert ? o.paper : o.ink, el.strokeWidth);
  if (el.keepAspect) w = h = Math.min(w, h);
  if (el.invert) {
    w *= 0.86;
    h *= 0.86;
  }
  if (img) ctx.drawImage(img, -w / 2, -h / 2, w, h);
  else if (o.editor) {
    ctx.strokeStyle = o.ink;
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.setLineDash([]);
  }
}

const ditherCache = new Map<string, HTMLCanvasElement>();

function drawImageEl(ctx: CanvasRenderingContext2D, el: ImageElement, b: Box, o: RenderOptions) {
  const s = o.scale;
  const img = getImage(el.src);
  const w = b.w * s;
  const h = b.h * s;
  if (!img) return;
  const dpm = o.dpm ?? DPI / MM_PER_INCH;
  const wd = Math.max(1, Math.round(b.w * dpm));
  const hd = Math.max(1, Math.round(b.h * dpm));
  const key = `${el.src.length}|${el.src.slice(-48)}|${wd}x${hd}|${el.dither}|${el.threshold}|${el.invert}|${el.keepAspect}|${o.ink}`;
  let c = ditherCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = wd;
    c.height = hd;
    const cx = c.getContext('2d', { willReadFrequently: true })!;
    cx.fillStyle = '#fff';
    cx.fillRect(0, 0, wd, hd);
    let dw = wd;
    let dh = hd;
    if (el.keepAspect) {
      const r = Math.min(wd / img.naturalWidth, hd / img.naturalHeight);
      dw = img.naturalWidth * r;
      dh = img.naturalHeight * r;
    }
    cx.drawImage(img, (wd - dw) / 2, (hd - dh) / 2, dw, dh);
    const data = cx.getImageData(0, 0, wd, hd);
    const mask = ditherToMask(data, el.dither, el.threshold, el.invert);
    const out = cx.createImageData(wd, hd);
    const rgb = hexToRgb(o.ink);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      out.data[i * 4] = rgb[0];
      out.data[i * 4 + 1] = rgb[1];
      out.data[i * 4 + 2] = rgb[2];
      out.data[i * 4 + 3] = 255;
    }
    cx.clearRect(0, 0, wd, hd);
    cx.putImageData(out, 0, 0);
    if (ditherCache.size > 60) ditherCache.clear();
    ditherCache.set(key, c);
  }
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, -w / 2, -h / 2, w, h);
  ctx.imageSmoothingEnabled = prev;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

function drawBarcode(ctx: CanvasRenderingContext2D, el: BarcodeElement, b: Box, o: RenderOptions) {
  const s = o.scale;
  const dpm = o.dpm ?? DPI / MM_PER_INCH;
  const data = resolve(el.data, o.pctx);
  const enc = encodeBarcode(el.symbology, data, el.eclevel);
  const x0 = -b.w / 2;
  const y0 = -b.h / 2;
  if (enc instanceof Error) {
    if (o.editor) {
      ctx.strokeStyle = '#e11d48';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x0 * s, y0 * s, b.w * s, b.h * s);
      ctx.setLineDash([]);
      ctx.fillStyle = '#e11d48';
      ctx.font = `${Math.max(9, Math.min(12, b.h * s * 0.25))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`⚠ ${enc.message}`.slice(0, 40), 0, 0, b.w * s - 4);
    }
    return;
  }
  ctx.fillStyle = o.ink;
  const px = (mm: number) => Math.round(mm * s);
  if (enc.kind === '1d') {
    const textH = el.showText ? el.textSize * PT_TO_MM * 1.1 : 0;
    const barsH = Math.max(1, b.h - textH);
    const dots = Math.max(1, Math.floor((b.w * dpm) / enc.width));
    const mod = dots / dpm;
    const total = mod * enc.width;
    const bx = x0 + (b.w - total) / 2;
    let i = 0;
    while (i < enc.width) {
      if (!enc.modules[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < enc.width && enc.modules[j]) j++;
      const xa = px(bx + i * mod);
      const xb = px(bx + j * mod);
      ctx.fillRect(xa, px(y0), xb - xa, px(y0 + barsH) - px(y0));
      i = j;
    }
    if (el.showText) {
      drawTextBox(ctx, {
        text: data,
        st: { font: el.font, bold: false, italic: false, lineHeight: 1, letterSpacing: 0 },
        x: x0 * s,
        y: (y0 + barsH + textH * 0.08) * s,
        w: b.w * s,
        h: textH * 0.92 * s,
        s,
        autoSize: false,
        sizePt: el.textSize,
        align: 'center',
        vAlign: 'middle',
        color: o.ink,
      });
    }
  } else {
    const dots = Math.max(1, Math.floor(Math.min((b.w * dpm) / enc.width, (b.h * dpm) / enc.height)));
    const mod = dots / dpm;
    const tw = mod * enc.width;
    const th = mod * enc.height;
    const bx = x0 + (b.w - tw) / 2;
    const by = y0 + (b.h - th) / 2;
    for (let r = 0; r < enc.height; r++) {
      let c = 0;
      while (c < enc.width) {
        if (!enc.bits[r * enc.width + c]) {
          c++;
          continue;
        }
        let e = c;
        while (e < enc.width && enc.bits[r * enc.width + e]) e++;
        const xa = px(bx + c * mod);
        const xb = px(bx + e * mod);
        const ya = px(by + r * mod);
        const yb = px(by + (r + 1) * mod);
        ctx.fillRect(xa, ya, xb - xa, yb - ya);
        c = e;
      }
    }
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, el: GridElement, b: Box, o: RenderOptions) {
  const s = o.scale;
  const x0 = (-b.w / 2) * s;
  const y0 = (-b.h / 2) * s;
  const h = b.h * s;
  const lw = Math.max(1, el.separatorWidth * s);
  const numH = el.numbers !== 'none' ? el.numberSize * PT_TO_MM * 1.35 * s : 0;
  const textTop = el.numbers === 'top' ? y0 + numH : y0;
  const textH = h - numH;
  ctx.strokeStyle = o.ink;
  ctx.fillStyle = o.ink;

  let module = 0;
  let cx = x0;
  const pad = 0.5 * s;
  el.cells.forEach((cell, i) => {
    const span = Math.max(1, cell.span);
    const cw = span * el.pitch * s;
    const first = el.numberStart + module * el.numberStep;
    const last = el.numberStart + (module + span - 1) * el.numberStep;
    if (el.numbers !== 'none') {
      const ny = el.numbers === 'top' ? y0 : y0 + h - numH;
      let color = o.ink;
      if (el.numberInvert) {
        ctx.fillStyle = o.ink;
        ctx.fillRect(cx, ny, cw, numH);
        color = o.paper;
      }
      drawTextBox(ctx, {
        text: span > 1 ? `${first}–${last}` : String(first),
        st: { font: el.font, bold: true, italic: false, lineHeight: 1, letterSpacing: 0 },
        x: cx,
        y: ny + numH * 0.12,
        w: cw,
        h: numH * 0.76,
        s,
        autoSize: true,
        sizePt: el.numberSize,
        align: 'center',
        vAlign: 'middle',
        color,
      });
      if (!el.numberInvert) {
        ctx.lineWidth = Math.max(1, lw * 0.6);
        ctx.setLineDash([]);
        ctx.beginPath();
        const ly = el.numbers === 'top' ? y0 + numH : y0 + h - numH;
        ctx.moveTo(cx, ly);
        ctx.lineTo(cx + cw, ly);
        ctx.stroke();
      }
    }
    const turn = el.textDir === 'up' ? -90 : el.textDir === 'down' ? 90 : 0;
    // For rotated text the "vertical" position runs along the cell width.
    drawTextBox(ctx, {
      text: resolve(cell.text, o.pctx),
      st: el,
      x: cx + pad,
      y: textTop + pad,
      w: cw - 2 * pad,
      h: textH - 2 * pad,
      s,
      autoSize: el.autoSize,
      sizePt: el.size,
      align: turn ? (el.textPos === 'top' ? 'left' : el.textPos === 'bottom' ? 'right' : 'center') : el.align,
      vAlign: turn ? 'middle' : el.textPos,
      color: o.ink,
      turn: turn === 90 ? 90 : turn === -90 ? -90 : 0,
    });
    // Separator after this cell.
    if (i < el.cells.length - 1 && el.separator !== 'none') {
      const boundary = module + span;
      const heavy = el.groupEvery > 0 && boundary % el.groupEvery === 0;
      ctx.lineWidth = heavy ? lw * 2.2 : lw;
      dash(ctx, el.separator, lw);
      ctx.beginPath();
      ctx.moveTo(cx + cw, y0);
      ctx.lineTo(cx + cw, y0 + h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    module += span;
    cx += cw;
  });
  if (el.border) {
    ctx.lineWidth = lw;
    ctx.setLineDash([]);
    ctx.strokeRect(x0 + lw / 2, y0 + lw / 2, b.w * s - lw, h - lw);
  }
}

function drawFrame(ctx: CanvasRenderingContext2D, doc: LabelDoc, length: number, o: RenderOptions) {
  const f = doc.frame;
  if (f.style === 'none') return;
  const s = o.scale;
  const r = printableRect(doc, length);
  const lw = Math.max(1, f.thickness * s * (f.style === 'thick' ? 2.5 : 1));
  const x = (r.x + f.inset) * s + lw / 2;
  const y = (r.y + f.inset) * s + lw / 2;
  const w = (r.w - 2 * f.inset) * s - lw;
  const h = (r.h - 2 * f.inset) * s - lw;
  ctx.strokeStyle = o.ink;
  ctx.lineWidth = lw;
  dash(ctx, f.style === 'dashed' ? 'dashed' : 'solid', lw);
  if (f.style === 'brackets') {
    const k = Math.min(h * 0.6, w * 0.2);
    ctx.beginPath();
    ctx.moveTo(x + k, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + k, y + h);
    ctx.moveTo(x + w - k, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w - k, y + h);
    ctx.stroke();
  } else {
    roundRectPath(ctx, x, y, w, h, f.style === 'round' ? Math.min(w, h) * 0.3 : 0);
    ctx.stroke();
    if (f.style === 'double') {
      const g = lw * 2;
      roundRectPath(ctx, x + g, y + g, w - 2 * g, h - 2 * g, 0);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
}

/** Draw the whole label into ctx with (0,0) at the design origin. */
export function renderLabel(ctx: CanvasRenderingContext2D, doc: LabelDoc, layout: Layout, o: RenderOptions) {
  const s = o.scale;
  const [W, H] = designSize(doc, layout.length);
  if (o.background) {
    ctx.fillStyle = o.paper;
    ctx.fillRect(0, 0, W * s, H * s);
  }
  for (const el of doc.elements) {
    if (el.hidden || o.skip?.has(el.id)) continue;
    const b = layout.boxes.get(el.id) ?? el;
    ctx.save();
    ctx.translate((b.x + b.w / 2) * s, (b.y + b.h / 2) * s);
    if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
    switch (el.type) {
      case 'text':
        drawText(ctx, el, b, o);
        break;
      case 'shape':
        drawShape(ctx, el, b, o);
        break;
      case 'symbol':
        drawSymbol(ctx, el, b, o);
        break;
      case 'image':
        drawImageEl(ctx, el, b, o);
        break;
      case 'barcode':
        drawBarcode(ctx, el, b, o);
        break;
      case 'grid':
        drawGrid(ctx, el, b, o);
        break;
    }
    ctx.restore();
  }
  drawFrame(ctx, doc, layout.length, o);
}

// ---------------------------------------------------------------- printing

export interface PrintBitmap {
  width: number;
  height: number;
  bits: Uint8Array;
  lengthMm: number;
  /** Rows of tape above and below the printable band, which the head can't reach. */
  margin: number;
  /**
   * Ink that falls in those margins and won't print: `margin` rows above the
   * band then `margin` rows below it, `width` columns each. Null when none.
   */
  spill: Uint8Array | null;
  spillDots: number;
}

/**
 * Render one label at printer resolution and return a 1-bit bitmap in tape
 * orientation: width = columns along the tape, height = printable dots.
 */
export function renderPrintBitmap(
  doc: LabelDoc,
  pctx: PlaceholderContext,
  dpi = DPI,
  headPins = 128,
  opts: { cutMark?: boolean; mirror?: boolean } = {},
): PrintBitmap {
  const dpm = dpi / MM_PER_INCH;
  const layout = computeLayout(doc, pctx);
  const [W, H] = designSize(doc, layout.length);
  const portrait = doc.orientation === 'portrait';
  const band = printableBand(doc.media.kind, doc.media.width, dpi, headPins);
  const rows = band.dots;
  // Shift the design by under half a dot so the printable band starts exactly
  // on a dot row; otherwise content flush with its edge loses a row.
  const margin = Math.round(band.top * dpm);
  const shift = margin - band.top * dpm;
  const th = margin * 2 + rows; // across tape
  const tw = Math.max(1, Math.round((portrait ? H : W) * dpm)); // along tape
  const cw = portrait ? th : tw;
  const ch = portrait ? tw : th;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.translate(portrait ? shift : 0, portrait ? 0 : shift);
  renderLabel(ctx, doc, layout, { scale: dpm, ink: '#000', paper: '#fff', pctx, dpm });
  const px = ctx.getImageData(0, 0, cw, ch).data;

  const bits = new Uint8Array(tw * rows);
  let spill: Uint8Array | null = null;
  let spillDots = 0;
  for (let tr = 0; tr < th; tr++) {
    // tr is the row across the tape, 0 = top edge.
    const inBand = tr >= margin && tr < margin + rows;
    for (let c = 0; c < tw; c++) {
      // Portrait designs are rotated 90° counter-clockwise onto the tape.
      const dx = portrait ? th - 1 - tr : c;
      const dy = portrait ? c : tr;
      const i = (dy * cw + dx) * 4;
      if (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114 >= 128) continue;
      const col = opts.mirror ? tw - 1 - c : c;
      if (inBand) {
        bits[(tr - margin) * tw + col] = 1;
      } else {
        spill ??= new Uint8Array(tw * margin * 2);
        spill[(tr < margin ? tr : tr - rows) * tw + col] = 1;
        spillDots++;
      }
    }
  }
  if (opts.cutMark) {
    for (let r = 0; r < rows; r++) if (r % 6 < 3) bits[r * tw + tw - 1] = 1;
  }
  return { width: tw, height: rows, bits, lengthMm: layout.length, margin, spill, spillDots };
}
