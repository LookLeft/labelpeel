import type {
  BarcodeElement,
  GridElement,
  ImageElement,
  LabelDoc,
  LabelElement,
  ShapeElement,
  SymbolElement,
  TextElement,
  TextStyle,
} from './types';
import { printableBand } from './media';

let counter = 0;
export const uid = () => `e${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const DEFAULT_FONT = 'Inter';

export const defaultTextStyle = (): TextStyle => ({
  font: DEFAULT_FONT,
  size: 14,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  align: 'center',
  vAlign: 'middle',
  lineHeight: 1.1,
  letterSpacing: 0,
});

export function newDoc(partial: Partial<LabelDoc> = {}): LabelDoc {
  return {
    version: 1,
    name: 'Untitled label',
    labelType: 'general',
    typeParams: {},
    media: { kind: 'tze', width: 12, tapeColor: '#ffffff', inkColor: '#111111' },
    orientation: 'landscape',
    lengthMode: 'auto',
    length: 40,
    marginStart: 2,
    marginEnd: 2,
    frame: { style: 'none', inset: 0.5, thickness: 0.4 },
    elements: [],
    guides: [],
    print: { copies: 1, cut: 'each', cutEvery: 1, halfCut: false, chain: false, mirror: false, reverse: false, cutMarks: false, splitEvery: 0, splitOrigin: 0 },
    serial: { enabled: false, start: 1, step: 1, count: 10, pad: 0, format: 'number' },
    data: null,
    ...partial,
  };
}

/** Design-space size of the label: [width, height] in mm. */
export function designSize(doc: LabelDoc, length = doc.length): [number, number] {
  return doc.orientation === 'portrait' ? [doc.media.width, length] : [length, doc.media.width];
}

/** The printable region in design space. */
export function printableRect(doc: LabelDoc, length = doc.length, dpi?: number, headPins?: number) {
  const band = printableBand(doc.media.kind, doc.media.width, dpi, headPins);
  return doc.orientation === 'portrait'
    ? { x: band.top, y: 0, w: band.height, h: length }
    : { x: 0, y: band.top, w: length, h: band.height };
}

/** The clear laminate part of self-laminating tape in design space, or null. */
export function clearRect(doc: LabelDoc, length = doc.length) {
  const from = doc.media.clearFrom;
  if (from == null || from >= doc.media.width) return null;
  const clear = doc.media.width - from;
  // Portrait designs are rotated onto the tape: its top edge is the design's right side.
  return doc.orientation === 'portrait' ? { x: 0, y: 0, w: clear, h: length } : { x: 0, y: from, w: length, h: clear };
}

export function makeText(doc: LabelDoc, text = 'Text', over: Partial<TextElement> = {}): TextElement {
  const r = printableRect(doc);
  const cross = doc.orientation === 'portrait' ? r.w : r.h;
  return {
    id: uid(),
    type: 'text',
    x: doc.orientation === 'portrait' ? r.x : doc.marginStart,
    y: doc.orientation === 'portrait' ? doc.marginStart : r.y,
    w: doc.orientation === 'portrait' ? cross : 20,
    h: doc.orientation === 'portrait' ? 8 : cross,
    rotation: 0,
    text,
    ...defaultTextStyle(),
    autoSize: true,
    autoWidth: doc.orientation !== 'portrait',
    invert: false,
    frame: 'none',
    framePadding: 0.6,
    ...over,
  };
}

export function makeShape(doc: LabelDoc, shape: ShapeElement['shape'], over: Partial<ShapeElement> = {}): ShapeElement {
  const r = printableRect(doc);
  const s = Math.min(r.w, r.h) * 0.8;
  return {
    id: uid(),
    type: 'shape',
    shape,
    x: r.x + 2,
    y: r.y + (r.h - (shape === 'line' ? 0 : s)) / 2,
    w: shape === 'line' ? 15 : s,
    h: shape === 'line' ? 0 : s,
    rotation: 0,
    strokeWidth: 0.4,
    stroke: true,
    fill: false,
    dash: 'solid',
    radius: 1,
    ...over,
  };
}

export function makeSymbol(doc: LabelDoc, symbol: string, over: Partial<SymbolElement> = {}): SymbolElement {
  const r = printableRect(doc);
  const s = Math.min(r.w, r.h) * 0.9;
  return {
    id: uid(),
    type: 'symbol',
    symbol,
    x: r.x + 1,
    y: r.y + (r.h - s) / 2,
    w: s,
    h: s,
    rotation: 0,
    invert: false,
    keepAspect: true,
    ...over,
  };
}

export function makeImage(doc: LabelDoc, src: string, aspect: number): ImageElement {
  const r = printableRect(doc);
  const h = r.h * 0.9;
  return {
    id: uid(),
    type: 'image',
    src,
    x: r.x + 1,
    y: r.y + (r.h - h) / 2,
    w: h * aspect,
    h,
    rotation: 0,
    dither: 'floyd',
    threshold: 128,
    invert: false,
    keepAspect: true,
  };
}

export function makeBarcode(doc: LabelDoc, symbology: string, data: string): BarcodeElement {
  const r = printableRect(doc);
  const twoD = ['qrcode', 'datamatrix', 'azteccode', 'microqrcode', 'pdf417'].includes(symbology);
  const h = r.h * (twoD ? 0.92 : 0.85);
  return {
    id: uid(),
    type: 'barcode',
    symbology,
    data,
    x: r.x + 1,
    y: r.y + (r.h - h) / 2,
    w: twoD ? (symbology === 'pdf417' ? h * 3 : h) : 30,
    h,
    rotation: 0,
    showText: !twoD,
    textSize: 6,
    font: 'Roboto Mono',
    eclevel: 'M',
  };
}

export function makeGrid(doc: LabelDoc, over: Partial<GridElement> = {}): GridElement {
  const r = printableRect(doc);
  const ts = defaultTextStyle();
  return {
    id: uid(),
    type: 'grid',
    x: doc.marginStart,
    y: r.y,
    w: 18 * 6,
    h: r.h,
    rotation: 0,
    pitch: 18,
    cells: Array.from({ length: 6 }, (_, i) => ({ span: 1, text: `Circuit ${i + 1}` })),
    separator: 'line',
    separatorWidth: 0.3,
    border: true,
    textDir: 'horizontal',
    textPos: 'middle',
    align: 'center',
    autoSize: true,
    numbers: 'none',
    numberStart: 1,
    numberStep: 1,
    numberSize: 5,
    numberInvert: false,
    groupEvery: 0,
    font: ts.font,
    size: 8,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    lineHeight: 1.05,
    letterSpacing: 0,
    ...over,
  };
}

export function gridWidth(g: Pick<GridElement, 'cells' | 'pitch'>): number {
  return g.cells.reduce((s, c) => s + Math.max(1, c.span), 0) * g.pitch;
}

export function cloneElement<T extends LabelElement>(el: T, dx = 2, dy = 2): T {
  return { ...structuredClone(el), id: uid(), x: el.x + dx, y: el.y + dy, generated: false };
}
