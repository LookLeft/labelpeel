// Brother P-touch Editor .lbx files: import and export.
//
// An .lbx file is a ZIP archive containing label.xml (the layout, in Brother's
// undocumented "ptouch/2007/lbx" XML schema), prop.xml (metadata) and any
// embedded bitmaps (24-bit BMPs). The mapping below follows files written by
// P-touch Editor (see examples/). All geometry is in points; the paper's width
// is the tape width and, in landscape, objects' x runs along the tape, which
// matches Labelpeel's design space, so coordinates map one to one.
//
// Export writes the objects P-touch Editor can represent the same way it does
// (text, rectangles, plain tables, Code 128), so they stay editable there.
// Anything else (symbols, other shapes, frames, QR codes, filled cells…) is
// rendered exactly as Labelpeel prints it and embedded as an image.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { defaultTextStyle, makeTable, newDoc, printableRect, uid } from '../model/defaults';
import { findTape, printableBand, TZE_SIZES } from '../model/media';
import { previewContext } from '../model/pages';
import { hasPlaceholders, resolve } from '../model/placeholders';
import { tableAreas, tableEdges } from '../model/table';
import type { HAlign, LabelDoc, LabelElement, ShapeElement, TableCell, TableElement, TextElement, VAlign } from '../model/types';

const PT = 25.4 / 72; // mm per point
/** Normal line spacing, which P-touch Editor's lineSpace percentages are relative to. */
const LINE = 1.1;

// ---------------------------------------------------------------- helpers

function pt(v: string | null | undefined, d = 0): number {
  if (!v) return d;
  const m = /(-?[\d.]+)\s*(pt|mm|in)?/.exec(v);
  if (!m) return d;
  const n = parseFloat(m[1]);
  if (m[2] === 'mm') return n;
  if (m[2] === 'in') return n * 25.4;
  return n * PT;
}

/** mm to Brother's "12.3pt". */
const toPt = (mm: number) => `${Math.round((mm / PT) * 10) / 10}pt`;

// childNodes rather than children: also works with Node XML parsers in tests.
const elementsOf = (el: Element) => Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1);
const local = (el: Element) => el.localName;
const child = (el: Element, name: string) => elementsOf(el).find((c) => local(c) === name) ?? null;
const desc = (el: Element, name: string) => (el.getElementsByTagNameNS('*', name)[0] as Element | undefined) ?? null;
const attr = (el: Element | null, name: string) => el?.getAttribute(name) ?? null;

const BARCODES: Record<string, string> = {
  QRCODE: 'qrcode',
  DATAMATRIX: 'datamatrix',
  CODE128: 'code128',
  CODE39: 'code39',
  EAN13: 'ean13',
  JAN13: 'ean13',
  EAN8: 'ean8',
  JAN8: 'ean8',
  UPCA: 'upca',
  UPCE: 'upce',
  ITF: 'interleaved2of5',
  ITF25: 'interleaved2of5',
  CODABAR: 'rationalizedCodabar',
  NW7: 'rationalizedCodabar',
  PDF417: 'pdf417',
  MAXICODE: 'maxicode',
  GS1_128: 'gs1-128',
  UCC_EAN128: 'gs1-128',
};

// Brother's fonts (installed with P-touch Editor) and common system fonts,
// mapped to the closest bundled font. Checked in order.
const FONT_IMPORT: [RegExp, string][] = [
  [/narrow|condensed|compressed/i, 'Roboto Condensed'],
  [/^(courier|letter gothic|consolas|menlo|monaco|.*mono)/i, 'Roboto Mono'],
  [/^(times|brussels|georgia|garamond|belgium|germany|century|cambria|.*serif$)/i, 'Source Serif 4'],
  [/^(san diego|.*script|brush|comic|marker)/i, 'Permanent Marker'],
  [/^(pt )?(utah|univers|frutiger|gill|segoe|calibri|open sans)/i, 'Open Sans'],
];
const BUNDLED = ['Inter', 'Roboto', 'Roboto Condensed', 'Roboto Mono', 'Open Sans', 'Montserrat', 'Oswald', 'Bebas Neue', 'Barlow Condensed', 'Archivo Narrow', 'Source Serif 4', 'Permanent Marker'];

function importFont(name: string): string {
  const exact = BUNDLED.find((f) => f.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  return FONT_IMPORT.find(([re]) => re.test(name))?.[1] ?? 'Inter';
}

/** Fonts P-touch Editor installs on Windows and Mac, for exported text. */
function exportFont(el: { font: string; sourceFont?: string }): string {
  if (el.sourceFont && importFont(el.sourceFont) === el.font) return el.sourceFont;
  if (/condensed|narrow|oswald|bebas/i.test(el.font)) return 'Helsinki Narrow';
  if (/serif/i.test(el.font)) return 'Brussels';
  if (/mono/i.test(el.font)) return 'Letter Gothic';
  return 'Helsinki';
}

// Media "format" codes P-touch Editor writes for TZe widths (260 = 18 mm and
// 261 = 24 mm are in the examples; the rest follow the same sequence).
const FORMAT: Record<number, number> = { 3.5: 264, 6: 257, 9: 258, 12: 259, 18: 260, 24: 261, 36: 262 };

// ---------------------------------------------------------------- import

export interface LbxImportResult {
  doc: LabelDoc;
  warnings: string[];
}

/** Decodes and crops an embedded image to a PNG data URL (browser only). */
async function imageToDataUrl(bytes: Uint8Array, name: string, crop: { x: number; y: number; w: number; h: number } | null, outW: number, outH: number): Promise<string | null> {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  try {
    const type = /\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'image/bmp';
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
    const sx = crop ? crop.x * bmp.width : 0;
    const sy = crop ? crop.y * bmp.height : 0;
    const sw = crop ? crop.w * bmp.width : bmp.width;
    const sh = crop ? crop.h * bmp.height : bmp.height;
    // Keep embedded images small: 360 dpi at their printed size is plenty.
    const scale = Math.min(1, (outW * (360 / 25.4)) / sw, (outH * (360 / 25.4)) / sh);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * scale));
    c.height = Math.max(1, Math.round(sh * scale));
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } catch {
    return null;
  }
}

interface FontInfo {
  font: string;
  sourceFont: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  sizePt: number;
  effect: string;
}

function fontInfo(info: Element | null): FontInfo {
  const logFont = info && desc(info, 'logFont');
  const ext = info && desc(info, 'fontExt');
  const source = attr(logFont, 'name') || 'Helsinki';
  return {
    font: importFont(source),
    sourceFont: source,
    bold: Number(attr(logFont, 'weight') ?? 400) >= 600,
    italic: attr(logFont, 'italic') === 'true',
    underline: Number(attr(ext, 'underline') ?? 0) > 0,
    strike: Number(attr(ext, 'strikeout') ?? 0) > 0,
    sizePt: pt(attr(ext, 'size'), 9 * PT) / PT,
    effect: attr(ext, 'effect') ?? 'NOEFFECT',
  };
}

/** The style used by most of a text's characters, and whether runs differ. */
function textRuns(textEl: Element): { main: FontInfo; mixed: boolean } {
  const base = fontInfo(child(textEl, 'ptFontInfo'));
  const runs = elementsOf(textEl)
    .filter((c) => local(c) === 'stringItem')
    .map((r) => ({ len: Number(attr(r, 'charLen') ?? 0), info: fontInfo(child(r, 'ptFontInfo')) }))
    // Line breaks are runs of their own; they don't decide the style.
    .filter((r) => r.len > 0);
  if (!runs.length) return { main: base, mixed: false };
  const key = (f: FontInfo) => `${f.sourceFont}|${f.bold}|${f.italic}|${f.underline}|${f.strike}`;
  const weight = new Map<string, { n: number; info: FontInfo }>();
  for (const r of runs) {
    const k = key(r.info);
    const w = weight.get(k) ?? { n: 0, info: r.info };
    w.n += r.len;
    weight.set(k, w);
  }
  const main = [...weight.values()].sort((a, b) => b.n - a.n)[0].info;
  return { main, mixed: weight.size > 1 };
}

const hAlignOf = (v: string | null): HAlign => (v === 'CENTER' ? 'center' : v === 'RIGHT' ? 'right' : 'left');
const vAlignOf = (v: string | null): VAlign => (v === 'TOP' ? 'top' : v === 'BOTTOM' ? 'bottom' : 'middle');

export async function importLbx(buffer: ArrayBuffer, fileName = 'label.lbx'): Promise<LbxImportResult> {
  const files = unzipSync(new Uint8Array(buffer));
  const labelXml = Object.keys(files).find((k) => /(^|\/)label\.xml$/i.test(k));
  if (!labelXml) throw new Error('This does not look like a P-touch Editor .lbx file (no label.xml inside).');
  const xml = new DOMParser().parseFromString(strFromU8(files[labelXml]), 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('label.xml could not be parsed.');
  const warnings: string[] = [];
  const notes = new Map<string, number>();
  const note = (msg: string) => notes.set(msg, (notes.get(msg) ?? 0) + 1);

  const root = xml.documentElement;
  const paper = desc(root, 'paper');
  const tapeMm = pt(attr(paper, 'width'), 24);
  const tape = TZE_SIZES.reduce((a, b) => (Math.abs(b.width - tapeMm) < Math.abs(a.width - tapeMm) ? b : a));
  const landscape = (attr(paper, 'orientation') ?? 'landscape') !== 'portrait';
  const auto = attr(paper, 'autoLength') === 'true';
  const color = attr(paper, 'paperColor');
  const ink = attr(paper, 'paperInk');
  const printer = attr(paper, 'printerName') ?? '';

  const doc = newDoc({
    name: fileName.replace(/\.lbx$/i, ''),
    media: {
      kind: 'tze',
      width: tape.width,
      tapeColor: color && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '#ffffff',
      inkColor: ink && /^#[0-9a-f]{6}$/i.test(ink) ? ink.toLowerCase() : '#111111',
    },
    orientation: landscape ? 'landscape' : 'portrait',
    lengthMode: auto ? 'auto' : 'fixed',
    length: Math.round(pt(attr(paper, 'height'), 50) * 10) / 10,
    // Margins are named as if the tape were upright: top/bottom run along it.
    marginStart: pt(attr(paper, 'marginTop'), 2),
    marginEnd: pt(attr(paper, 'marginBottom'), 2),
  });
  if (printer && !/E560BT/i.test(printer)) warnings.push(`Designed for ${printer}.`);

  const elements: LabelElement[] = [];

  const box = (style: Element | null) => ({
    x: pt(attr(style, 'x')),
    y: pt(attr(style, 'y')),
    w: Math.max(0.5, pt(attr(style, 'width'), 5)),
    h: Math.max(0.5, pt(attr(style, 'height'), 5)),
    rotation: Number(attr(style, 'angle') ?? 0) || 0,
  });

  const readText = (obj: Element): TextElement => {
    const style = child(obj, 'objectStyle');
    const { main, mixed } = textRuns(obj);
    if (mixed) note('Text with mixed styles in one box uses its most common style.');
    if (main.effect !== 'NOEFFECT' && main.effect !== 'OUTLINE') note(`The "${main.effect.toLowerCase()}" text effect isn't supported and was left out.`);
    const align = child(obj, 'textAlign');
    const control = attr(child(obj, 'textControl'), 'control') ?? '';
    const tStyle = child(obj, 'textStyle');
    const lineSpace = Number(attr(tStyle, 'lineSpace') ?? 0) || 0;
    if (attr(align, 'horizontalAlignment') === 'JUSTIFY') note('Justified text is aligned left.');
    return {
      id: uid(),
      type: 'text',
      ...box(style),
      ...defaultTextStyle(),
      text: (child(obj, 'data')?.textContent ?? '').replace(/\r\n?/g, '\n'),
      font: main.font,
      sourceFont: main.sourceFont,
      bold: main.bold,
      italic: main.italic,
      underline: main.underline,
      strike: main.strike,
      size: Math.round(main.sizePt * 10) / 10,
      align: hAlignOf(attr(align, 'horizontalAlignment')),
      vAlign: vAlignOf(attr(align, 'verticalAlignment')),
      // lineSpace is a percentage of normal spacing (about 1.1× the font size).
      lineHeight: Math.max(0.6, Math.round(LINE * (1 + lineSpace / 100) * 100) / 100),
      autoSize: false,
      shrink: attr(child(obj, 'textControl'), 'shrink') !== 'false' || undefined,
      // "AUTOLEN" frames grow with their text.
      autoWidth: /AUTOLEN|FREE/.test(control),
      invert: false,
      frame: 'none',
      stacked: attr(tStyle, 'vertical') === 'true' || undefined,
      outline: main.effect === 'OUTLINE' || undefined,
    };
  };

  const readShape = (obj: Element, name: string): ShapeElement => {
    const style = child(obj, 'objectStyle');
    const pen = style && child(style, 'pen');
    const brush = style && child(style, 'brush');
    const rectStyle = child(obj, 'rectStyle');
    const shapeAttr = attr(rectStyle, 'shape') ?? '';
    const penStyle = attr(pen, 'style') ?? 'INSIDEFRAME';
    const brushId = Number(attr(brush, 'id') ?? 0);
    const filled = attr(brush, 'style') === 'PATTERN' && brushId !== 0;
    if (filled && brushId !== 1) note('Patterned fills are printed solid.');
    const kind: ShapeElement['shape'] =
      name === 'frame' ? 'frame' : name === 'ellipse' || /ELLIPSE/.test(shapeAttr) ? 'ellipse' : name === 'line' ? 'line' : /ROUND/.test(shapeAttr) ? 'roundrect' : 'rect';
    if (name === 'frame') note("P-touch Editor's decorative frames are imported as plain frames.");
    return {
      id: uid(),
      type: 'shape',
      ...box(style),
      shape: kind,
      strokeWidth: Math.max(0.1, Math.round(pt(attr(pen, 'widthX'), 0.5 * PT) * 100) / 100),
      stroke: penStyle !== 'NULL',
      fill: filled,
      dash: /DASH/.test(penStyle) ? 'dashed' : /DOT/.test(penStyle) ? 'dotted' : 'solid',
      radius: Math.round(Math.min(pt(attr(rectStyle, 'roundnessX'), 0), pt(attr(rectStyle, 'roundnessY'), 0)) * 100) / 100 || 1,
      frameStyle: name === 'frame' ? 'rect' : undefined,
    };
  };

  const readTable = (obj: Element): TableElement => {
    const style = child(obj, 'objectStyle');
    const pen = style && child(style, 'pen');
    const grid = child(obj, 'gridPosition');
    const xs = (attr(grid, 'x') ?? '0pt').split(/\s+/).map((v) => pt(v));
    const ys = (attr(grid, 'y') ?? '0pt').split(/\s+/).map((v) => pt(v));
    const diffs = (a: number[]) => a.slice(1).map((v, i) => Math.max(0.1, Math.round((v - a[i]) * 100) / 100));
    const cols = diffs(xs);
    const rows = diffs(ys);
    const cells: TableCell[][] = rows.map(() => cols.map(() => ({ text: '' })));
    let first: TextElement | null = null;
    const cellsEl = child(obj, 'cells');
    for (const cell of cellsEl ? elementsOf(cellsEl).filter((c) => local(c) === 'cell') : []) {
      const c = Number(attr(cell, 'addressX') ?? 1) - 1;
      const r = Number(attr(cell, 'addressY') ?? 1) - 1;
      if (!cells[r]?.[c]) continue;
      const textEl = child(cell, 'text');
      const t = textEl ? readText(textEl) : null;
      if (t?.stacked) note('Vertical text in table cells is shown horizontally.');
      first ??= t;
      const brush = child(cell, 'brush');
      cells[r][c] = {
        text: t?.text ?? '',
        rowSpan: Number(attr(cell, 'spanY') ?? 1) > 1 ? Number(attr(cell, 'spanY')) : undefined,
        colSpan: Number(attr(cell, 'spanX') ?? 1) > 1 ? Number(attr(cell, 'spanX')) : undefined,
        fill: attr(brush, 'style') === 'PATTERN' && Number(attr(brush, 'id') ?? 0) !== 0 ? 'black' : undefined,
        align: t?.align,
        bold: t?.bold,
      };
    }
    const width = Math.max(0.1, pt(attr(pen, 'widthX'), 0.5 * PT));
    const penOn = (attr(pen, 'style') ?? 'INSIDEFRAME') !== 'NULL';
    const base = makeTable(doc);
    return {
      ...base,
      ...box(style),
      cols,
      rows,
      cells,
      font: first?.font ?? base.font,
      bold: false,
      italic: first?.italic ?? false,
      underline: first?.underline ?? false,
      size: first?.size ?? base.size,
      autoSize: false,
      shrink: true,
      align: 'left',
      vAlign: first?.vAlign ?? 'middle',
      border: penOn ? 'solid' : 'none',
      inner: penOn ? 'solid' : 'none',
      borderWidth: width,
      innerWidth: width,
    };
  };

  const walk = async (container: Element) => {
    for (const obj of elementsOf(container)) {
      const name = local(obj);
      if (name === 'group') {
        await walk(child(obj, 'objects') ?? obj);
        continue;
      }
      const style = child(obj, 'objectStyle');
      if (!style) continue;
      if (name === 'text') {
        elements.push(readText(obj));
      } else if (name === 'image') {
        const st = child(obj, 'imageStyle');
        const file = attr(st, 'fileName') ?? '';
        const key = Object.keys(files).find((k) => file && k.toLowerCase().endsWith(file.toLowerCase()));
        // The embedded file is the original image; "trimming" crops it.
        const trim = st && child(st, 'trimming');
        const org = st && child(st, 'orgPos');
        let crop: { x: number; y: number; w: number; h: number } | null = null;
        if (attr(trim, 'flag') === 'true' && org) {
          const ow = pt(attr(org, 'width'), 1) / PT;
          const oh = pt(attr(org, 'height'), 1) / PT;
          crop = {
            x: pt(attr(trim, 'trimOrgX')) / PT / ow,
            y: pt(attr(trim, 'trimOrgY')) / PT / oh,
            w: Math.min(1, pt(attr(trim, 'trimOrgWidth'), ow * PT) / PT / ow),
            h: Math.min(1, pt(attr(trim, 'trimOrgHeight'), oh * PT) / PT / oh),
          };
        }
        const b = box(style);
        const src = key ? await imageToDataUrl(files[key], key, crop, b.w, b.h) : null;
        const mono = st && desc(st, 'mono');
        if (src) {
          elements.push({
            id: uid(),
            type: 'image',
            ...b,
            src,
            dither: attr(mono, 'operationKind') === 'BINARY' ? 'threshold' : 'floyd',
            threshold: Number(attr(mono, 'threshold') ?? 128) || 128,
            invert: attr(mono, 'reverse') === '1',
            keepAspect: false,
          });
        } else note('Images that could not be read were left out.');
      } else if (name === 'barcode') {
        const st = child(obj, 'barcodeStyle');
        const proto = (attr(st, 'protocol') ?? 'CODE128').toUpperCase().replace(/[^A-Z0-9_]/g, '');
        const sym = BARCODES[proto];
        if (!sym) {
          note(`${proto} barcodes aren't supported and were left out.`);
          continue;
        }
        elements.push({
          id: uid(),
          type: 'barcode',
          ...box(style),
          symbology: sym,
          data: child(obj, 'data')?.textContent ?? '',
          showText: attr(st, 'humanReadable') === 'true',
          textSize: 6,
          font: 'Roboto Mono',
          eclevel: 'M',
        });
      } else if (['frame', 'rect', 'ellipse', 'line'].includes(name)) {
        elements.push(readShape(obj, name));
      } else if (name === 'table') {
        elements.push(readTable(obj));
      } else {
        note(`Unsupported "${name}" objects were left out.`);
      }
    }
  };
  const objects = desc(root, 'objects');
  if (objects) await walk(objects);
  for (const [msg, n] of notes) warnings.push(n > 1 ? `${msg} (${n}×)` : msg);
  if (desc(root, 'databaseInfo') || Object.keys(files).some((k) => /\.(csv|mdb|xls)/i.test(k)))
    warnings.push('Database links are not imported; load the CSV in the Data tab and use {{Column}} placeholders.');
  return { doc: { ...doc, elements }, warnings };
}

// ---------------------------------------------------------------- export

export interface LbxExportResult {
  data: Uint8Array;
  warnings: string[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NS =
  'xmlns:pt="http://schemas.brother.info/ptouch/2007/lbx/main" xmlns:style="http://schemas.brother.info/ptouch/2007/lbx/style" ' +
  'xmlns:text="http://schemas.brother.info/ptouch/2007/lbx/text" xmlns:draw="http://schemas.brother.info/ptouch/2007/lbx/draw" ' +
  'xmlns:image="http://schemas.brother.info/ptouch/2007/lbx/image" xmlns:barcode="http://schemas.brother.info/ptouch/2007/lbx/barcode" ' +
  'xmlns:database="http://schemas.brother.info/ptouch/2007/lbx/database" xmlns:table="http://schemas.brother.info/ptouch/2007/lbx/table" ' +
  'xmlns:cable="http://schemas.brother.info/ptouch/2007/lbx/cable"';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function objectStyle(b: Box, id: number, pen: { style: string; width: number }, brush: { style: string; id: number }) {
  return (
    `<pt:objectStyle x="${toPt(b.x)}" y="${toPt(b.y)}" width="${toPt(b.w)}" height="${toPt(b.h)}" backColor="#FFFFFF" backPrintColorNumber="0" ropMode="COPYPEN" angle="0" anchor="TOPLEFT" flip="NONE">` +
    `<pt:pen style="${pen.style}" widthX="${toPt(pen.width)}" widthY="${toPt(pen.width)}" color="#000000" printColorNumber="1"/>` +
    `<pt:brush style="${brush.style}" color="#000000" printColorNumber="1" id="${brush.id}"/>` +
    `<pt:expanded objectName="" ID="${id}" lock="0" templateMergeTarget="LABELLIST" templateMergeType="NONE" templateMergeID="0" linkStatus="NONE" linkID="0"/>` +
    `</pt:objectStyle>`
  );
}

interface TextOut {
  text: string;
  font: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  sizePt: number;
  outline: boolean;
  align: HAlign;
  vAlign: VAlign;
  lineHeight: number;
  vertical: boolean;
  control: 'FIXEDFRAME' | 'AUTOLEN' | 'LONGTEXTFIXED';
}

function fontInfoXml(t: TextOut) {
  return (
    `<text:ptFontInfo><text:logFont name="${esc(t.font)}" width="0" italic="${t.italic}" weight="${t.bold ? 700 : 400}" charSet="0" pitchAndFamily="2"/>` +
    `<text:fontExt effect="${t.outline ? 'OUTLINE' : 'NOEFFECT'}" underline="${t.underline ? 1 : 0}" strikeout="${t.strike ? 1 : 0}" size="${Math.round(t.sizePt * 10) / 10}pt" orgSize="28.8pt" textColor="#000000" textPrintColorNumber="1"/></text:ptFontInfo>`
  );
}

/** A text object, as P-touch Editor writes it: style, data, then one run per line (or character, for vertical text). */
function textXml(b: Box, id: number, t: TextOut) {
  const runs: number[] = [];
  if (t.vertical) for (const _ of t.text) runs.push(1);
  else
    for (const part of t.text.split(/(\n)/)) {
      if (part) runs.push(part.length);
    }
  const info = fontInfoXml(t);
  const h = t.align === 'center' ? 'CENTER' : t.align === 'right' ? 'RIGHT' : 'LEFT';
  const v = t.vAlign === 'top' ? 'TOP' : t.vAlign === 'bottom' ? 'BOTTOM' : 'CENTER';
  return (
    `<text:text>${objectStyle(b, id, { style: 'NULL', width: 0.5 * PT }, { style: 'NULL', id: 0 })}${info}` +
    `<text:textControl control="${t.control}" clipFrame="false" aspectNormal="true" shrink="true" autoLF="${t.control === 'LONGTEXTFIXED'}" avoidImage="false"/>` +
    `<text:textAlign horizontalAlignment="${h}" verticalAlignment="${v}" inLineAlignment="BASELINE"/>` +
    `<text:textStyle vertical="${t.vertical}" nullBlock="false" charSpace="0" lineSpace="${Math.round((t.lineHeight / LINE - 1) * 100)}" orgPoint="${Math.round(t.sizePt * 10) / 10}pt" combinedChars="false"/>` +
    `<pt:data>${esc(t.text)}</pt:data>` +
    runs.map((n) => `<text:stringItem charLen="${n}">${info}</text:stringItem>`).join('') +
    `</text:text>`
  );
}

function rectXml(b: Box, id: number, el: ShapeElement) {
  const round = el.shape === 'roundrect';
  return (
    `<draw:rect>${objectStyle(b, id, { style: el.stroke ? 'INSIDEFRAME' : 'NULL', width: el.strokeWidth }, { style: el.fill ? 'PATTERN' : 'NULL', id: el.fill ? 1 : 0 })}` +
    `<draw:rectStyle shape="${round ? 'ROUNDRECTANGLE' : 'RECTANGLE'}" roundnessX="${toPt(round ? el.radius : 0.04)}" roundnessY="${toPt(round ? el.radius : 0.04)}"/></draw:rect>`
  );
}

function barcodeXml(b: Box, id: number, data: string, showText: boolean, moduleMm: number) {
  return (
    `<barcode:barcode>${objectStyle(b, id, { style: 'INSIDEFRAME', width: 0.5 * PT }, { style: 'PATTERN', id: 1 })}` +
    `<barcode:barcodeStyle protocol="CODE128" lengths="${Math.max(1, data.length)}" zeroFill="false" barWidth="${toPt(moduleMm)}" barRatio="1:2" humanReadable="${showText}" humanReadableAlignment="CENTER" checkDigit="true" autoLengths="true" margin="true" sameLengthBar="false" bearerBar="false"/>` +
    `<pt:data>${esc(data)}</pt:data></barcode:barcode>`
  );
}

function imageXml(b: Box, id: number, file: string) {
  return (
    `<image:image>${objectStyle(b, id, { style: 'NULL', width: 0.5 * PT }, { style: 'NULL', id: 0 })}` +
    `<image:imageStyle originalName="${file}" alignInText="LEFT" firstMerge="true" IpName="" fileName="${file}">` +
    `<image:transparent flag="false" color="#FFFFFF"/>` +
    `<image:trimming flag="false" shape="RECTANGLE" trimOrgX="0pt" trimOrgY="0pt" trimOrgWidth="${toPt(b.w)}" trimOrgHeight="${toPt(b.h)}"/>` +
    `<image:orgPos x="${toPt(b.x)}" y="${toPt(b.y)}" width="${toPt(b.w)}" height="${toPt(b.h)}"/>` +
    `<image:effect effect="MONO" brightness="50" contrast="50" photoIndex="4"/>` +
    `<image:mono operationKind="BINARY" reverse="0" ditherKind="MESH" threshold="128" gamma="100" ditherEdge="0" rgbconvProportionRed="30" rgbconvProportionGreen="59" rgbconvProportionBlue="11" rgbconvProportionReversed="0"/>` +
    `</image:imageStyle></image:image>`
  );
}

/** 24-bit BMP of a black-and-white bitmap, as P-touch Editor embeds images. */
export function encodeBmp(width: number, height: number, bits: Uint8Array): Uint8Array {
  const row = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + row * height;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  out.set([0x42, 0x4d]);
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, width, true);
  v.setInt32(22, height, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, row * height, true);
  v.setInt32(38, 14173, true); // 360 dpi
  v.setInt32(42, 14173, true);
  for (let y = 0; y < height; y++) {
    const o = 54 + (height - 1 - y) * row; // rows are stored bottom-up
    for (let x = 0; x < width; x++) {
      const c = bits[y * width + x] ? 0 : 255;
      out[o + x * 3] = c;
      out[o + x * 3 + 1] = c;
      out[o + x * 3 + 2] = c;
    }
  }
  return out;
}

/** Why an element can't be written as an editable P-touch Editor object, or null if it can. */
function needsImage(el: LabelElement): string | null {
  if (el.rotation % 360 !== 0) return 'rotated';
  switch (el.type) {
    case 'text':
      if (el.invert || (el.frame && el.frame !== 'none')) return 'white-on-black or framed text';
      if (el.letterSpacing) return 'letter-spaced text';
      return null;
    case 'shape':
      if ((el.shape !== 'rect' && el.shape !== 'roundrect') || el.dash !== 'solid') return el.shape === 'frame' ? 'frames' : `${el.shape} shapes`;
      return null;
    case 'barcode':
      return el.symbology === 'code128' ? null : `${el.symbology} codes`;
    case 'table':
      if (el.inner !== el.border || el.inner === 'dashed' || el.inner === 'dotted' || el.innerWidth !== el.borderWidth) return 'tables with mixed or dashed lines';
      if (el.cells.some((r) => r.some((c) => c.fill && c.fill !== 'none'))) return 'tables with filled cells';
      return null;
    case 'symbol':
      return 'symbols';
    case 'grid':
      return 'blocks';
    case 'image':
      return null;
  }
}

/**
 * Writes the label as a P-touch Editor .lbx file. Must run in the browser:
 * elements without a P-touch Editor equivalent are rendered to images.
 */
export async function exportLbx(doc: LabelDoc, dateFormat?: string): Promise<LbxExportResult> {
  const render = await import('../render/render');
  const { encodeBarcode } = await import('../render/barcode');
  const pctx = previewContext(doc, 0, dateFormat);
  const layout = render.computeLayout(doc, pctx);
  const warnings = new Map<string, number>();
  const warn = (msg: string) => warnings.set(msg, (warnings.get(msg) ?? 0) + 1);
  const files: Record<string, Uint8Array> = {};
  const objects: string[] = [];
  let nextId = 1;
  const dpm = 360 / 25.4;

  // Renders elements (and optionally the label frame) to an embedded image.
  const asImage = (els: LabelElement[], b: Box, frame = false) => {
    const w = Math.max(1, Math.round(b.w * dpm));
    const h = Math.max(1, Math.round(b.h * dpm));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(-b.x * dpm, -b.y * dpm);
    const part = { ...doc, elements: els, frame: frame ? doc.frame : { ...doc.frame, style: 'none' as const } };
    render.renderLabel(ctx, part, { ...layout, boxes: layout.boxes }, { scale: dpm, ink: '#000', paper: '#fff', pctx, dpm });
    const px = ctx.getImageData(0, 0, w, h).data;
    const bits = new Uint8Array(w * h);
    for (let i = 0; i < bits.length; i++) bits[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114 < 128 ? 1 : 0;
    const file = `Object${Object.keys(files).length}.bmp`;
    files[file] = encodeBmp(w, h, bits);
    objects.push(imageXml(b, nextId++, file));
  };

  const textOut = (el: TextElement, text: string): TextOut => {
    let sizePt = el.size;
    if (el.autoSize) {
      // P-touch Editor stores a font size, so fix the size Labelpeel fits.
      const b = layout.boxes.get(el.id) ?? el;
      sizePt = render.fitText(text, el, b.w, b.h, true, el.size, el.autoWidth, el.stacked).em / PT;
    }
    return {
      text,
      font: exportFont(el),
      bold: el.bold,
      italic: el.italic,
      underline: el.underline,
      strike: el.strike,
      sizePt,
      outline: !!el.outline,
      align: el.align,
      vAlign: el.vAlign,
      lineHeight: el.lineHeight,
      vertical: !!el.stacked,
      control: el.autoWidth ? 'AUTOLEN' : 'FIXEDFRAME',
    };
  };

  const resolved = (s: string) => {
    if (!hasPlaceholders(s)) return s;
    warn('Smart fields (dates, serial numbers, data columns) were written as their current values.');
    return resolve(s, pctx);
  };

  // The label frame first, so it's behind everything.
  if (doc.frame.style !== 'none') {
    const r = printableRect(doc, layout.length);
    asImage([], r, true);
    warn('The label frame was written as an image.');
  }

  for (const el of doc.elements) {
    if (el.hidden) continue;
    const b = layout.boxes.get(el.id) ?? el;
    const reason = needsImage(el);
    if (reason) {
      // Rotated content needs its whole rotated footprint.
      const r = ((el.rotation % 360) + 360) % 360;
      const rad = (r * Math.PI) / 180;
      const w = Math.abs(b.w * Math.cos(rad)) + Math.abs(b.h * Math.sin(rad));
      const h = Math.abs(b.w * Math.sin(rad)) + Math.abs(b.h * Math.cos(rad));
      asImage([el], { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h });
      warn(`Written as images (not editable in P-touch Editor): ${reason}.`);
      continue;
    }
    const id = nextId++;
    switch (el.type) {
      case 'text':
        objects.push(textXml(b, id, textOut(el, resolved(el.text))));
        break;
      case 'shape':
        objects.push(rectXml(b, id, el));
        break;
      case 'barcode': {
        const data = resolved(el.data);
        // Labelpeel's module width (whole 180 dpi dots), so P-touch Editor
        // draws the code the same width.
        const enc = encodeBarcode('code128', data);
        const dots = enc instanceof Error || enc.kind !== '1d' ? 2 : Math.max(1, Math.floor((b.w * (180 / 25.4)) / enc.width));
        objects.push(barcodeXml(b, id, data, el.showText, dots * (25.4 / 180)));
        break;
      }
      case 'table':
        objects.push(
          tableXml(el, b, id, () => nextId++, (t, cell) => {
            // Each cell's text has a fixed size in P-touch Editor; fit it per cell.
            const text = resolved(t.text);
            const st = { ...el, bold: t.bold };
            const sizePt = el.autoSize ? render.fitText(text, st, cell.w, cell.h, true, el.size, false).em / PT : el.size;
            return { ...textOut({ ...el, ...st, autoSize: false, autoWidth: false, letterSpacing: 0, stacked: false, outline: false } as unknown as TextElement, text), sizePt, align: t.align };
          }),
        );
        if (el.cells.some((row) => row.some((c) => (c.rowSpan ?? 1) > 1 || (c.colSpan ?? 1) > 1))) warn('Tables with merged cells: check the merges in P-touch Editor.');
        break;
      case 'image': {
        nextId--;
        asImage([el], b);
        break;
      }
    }
  }

  const band = printableBand(doc.media.kind, doc.media.width);
  const tape = findTape(doc.media.kind, doc.media.width);
  const length = layout.length;
  const paper =
    `<style:paper media="0" width="${toPt(doc.media.width)}" height="${doc.lengthMode === 'auto' ? '2834.4pt' : toPt(length)}" ` +
    `marginLeft="${toPt(band.top)}" marginTop="${toPt(doc.marginStart)}" marginRight="${toPt(band.top)}" marginBottom="${toPt(doc.marginEnd)}" ` +
    `orientation="${doc.orientation}" autoLength="${doc.lengthMode === 'auto'}" monochromeDisplay="true" printColorDisplay="false" printColorsID="0" ` +
    `paperColor="${doc.media.tapeColor.toUpperCase()}" paperInk="${doc.media.inkColor.toUpperCase()}" split="1" format="${FORMAT[tape.width] ?? 261}" backgroundTheme="0" printerID="32560" printerName="Brother PT-E560BT"/>`;
  const background = `<style:backGround x="${toPt(doc.marginStart)}" y="${toPt(band.top)}" width="${toPt(Math.max(1, length - doc.marginStart - doc.marginEnd))}" height="${toPt(band.height)}" brushStyle="NULL" brushId="0" userPattern="NONE" userPatternId="0" color="#000000" printColorNumber="1" backColor="#FFFFFF" backPrintColorNumber="0"/>`;
  const label =
    `<?xml version="1.0" encoding="UTF-8"?>\n<pt:document ${NS} version="1.9" generator="com.brother.PtouchEditor">` +
    `<pt:body currentSheet="Sheet 1" direction="LTR"><style:sheet name="Sheet 1">${paper}<style:cutLine regularCut="0pt" freeCut=""/>${background}` +
    `<pt:objects>${objects.join('')}</pt:objects></style:sheet></pt:body></pt:document>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const prop =
    `<?xml version="1.0" encoding="UTF-8"?>\n<meta:properties xmlns:meta="http://schemas.brother.info/ptouch/2007/lbx/meta" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">` +
    `<meta:appName>P-touch Editor</meta:appName><dc:title>${esc(doc.name)}</dc:title><dc:subject></dc:subject><dc:creator>Labelpeel</dc:creator><meta:keyword></meta:keyword><dc:description></dc:description><meta:template></meta:template>` +
    `<dcterms:created>${now}</dcterms:created><dcterms:modified>${now}</dcterms:modified><meta:lastPrinted></meta:lastPrinted><meta:modifiedBy>Labelpeel</meta:modifiedBy><meta:revision>1</meta:revision><meta:editTime>0</meta:editTime>` +
    `<meta:numPages>1</meta:numPages><meta:numWords>0</meta:numWords><meta:numChars>0</meta:numChars><meta:security>0</meta:security><meta:transferScript></meta:transferScript></meta:properties>`;
  // label.xml first, then images, then prop.xml, as P-touch Editor writes them.
  const zip: Record<string, Uint8Array> = { 'label.xml': strToU8(label) };
  for (const [k, v] of Object.entries(files)) zip[k] = v;
  zip['prop.xml'] = strToU8(prop);
  return { data: zipSync(zip, { level: 6 }), warnings: [...warnings.keys()] };
}

/** A table as P-touch Editor writes it: the grid, then one cell entry (with its text) per visible cell. */
function tableXml(
  el: TableElement,
  b: Box,
  id: number,
  newId: () => number,
  text: (t: { text: string; bold: boolean; align: HAlign }, cell: Box) => TextOut,
): string {
  const { xs, ys } = tableEdges(el, b.w, b.h);
  const pen = { style: el.border === 'none' ? 'NULL' : 'INSIDEFRAME', width: el.borderWidth };
  const pad = 1.7 * PT;
  const cells = tableAreas(el)
    .map((a) => {
      const cell = el.cells[a.r]?.[a.c] ?? { text: '' };
      const cb = { x: b.x + xs[a.c] + pad, y: b.y + ys[a.r] + pad, w: Math.max(1, xs[a.c + a.cs] - xs[a.c] - 2 * pad), h: Math.max(1, ys[a.r + a.rs] - ys[a.r] - 2 * pad) };
      const inner = cell.text ? textXml(cb, newId(), { ...text({ text: cell.text, bold: cell.bold ?? el.bold, align: cell.align ?? el.align }, cb), control: 'LONGTEXTFIXED' }) : '';
      return (
        `<table:cell addressX="${a.c + 1}" addressY="${a.r + 1}" spanX="${a.cs}" spanY="${a.rs}" backColor="#FFFFFF" backPrintColorNumber="0">${inner}` +
        `<pt:brush style="NULL" color="#000000" printColorNumber="1" id="0"/></table:cell>`
      );
    })
    .join('');
  return (
    `<table:table>${objectStyle(b, id, pen, { style: 'NULL', id: 0 })}` +
    `<table:tableStyle row="${el.rows.length}" column="${el.cols.length}" autoSize="false" keepSize="true"/>` +
    `<table:gridPosition x="${xs.map((v) => toPt(v)).join(' ')}" y="${ys.map((v) => toPt(v)).join(' ')}"/>` +
    `<table:cells>${cells}</table:cells></table:table>`
  );
}
