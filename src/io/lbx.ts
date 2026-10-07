// Best-effort importer for Brother P-touch Editor .lbx files.
//
// An .lbx file is a ZIP archive containing label.xml (the layout, in Brother's
// undocumented "ptouch/2007/lbx" XML schema), prop.xml (metadata) and any
// embedded bitmaps. Brother has not published the schema, so this reads the
// common objects (text, images, barcodes, frames/shapes) and skips the rest.

import { unzipSync, strFromU8 } from 'fflate';
import { defaultTextStyle, newDoc, uid } from '../model/defaults';
import { TZE_SIZES } from '../model/media';
import type { HAlign, LabelDoc, LabelElement, VAlign } from '../model/types';

const PT = 25.4 / 72;

function pt(v: string | null | undefined, d = 0): number {
  if (!v) return d;
  const m = /(-?[\d.]+)\s*(pt|mm|in)?/.exec(v);
  if (!m) return d;
  const n = parseFloat(m[1]);
  if (m[2] === 'mm') return n;
  if (m[2] === 'in') return n * 25.4;
  return n * PT;
}

const local = (el: Element) => el.localName;
const child = (el: Element, name: string) => Array.from(el.children).find((c) => local(c) === name) ?? null;
const desc = (el: Element, name: string) => el.getElementsByTagNameNS('*', name)[0] ?? null;

const BARCODES: Record<string, string> = {
  QRCODE: 'qrcode',
  DATAMATRIX: 'datamatrix',
  CODE128: 'code128',
  CODE39: 'code39',
  EAN13: 'ean13',
  EAN8: 'ean8',
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

async function bmpToDataUrl(bytes: Uint8Array, name: string): Promise<string | null> {
  try {
    const type = /\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'image/bmp';
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    return c.toDataURL('image/png');
  } catch {
    return null;
  }
}

export interface LbxImportResult {
  doc: LabelDoc;
  warnings: string[];
}

export async function importLbx(buffer: ArrayBuffer, fileName = 'label.lbx'): Promise<LbxImportResult> {
  const files = unzipSync(new Uint8Array(buffer));
  const labelXml = Object.keys(files).find((k) => /(^|\/)label\.xml$/i.test(k));
  if (!labelXml) throw new Error('This does not look like a P-touch Editor .lbx file (no label.xml inside).');
  const xml = new DOMParser().parseFromString(strFromU8(files[labelXml]), 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('label.xml could not be parsed.');
  const warnings: string[] = [];

  const paper = desc(xml.documentElement, 'paper');
  const paperW = pt(paper?.getAttribute('width'), 24);
  const paperH = pt(paper?.getAttribute('height'), 50);
  const landscape = (paper?.getAttribute('orientation') ?? 'landscape') !== 'portrait';
  // Tape width is the paper's short side; length the long side.
  const tapeMm = Math.min(paperW, paperH);
  const tape = TZE_SIZES.reduce((a, b) => (Math.abs(b.width - tapeMm) < Math.abs(a.width - tapeMm) ? b : a));
  const lengthMm = Math.max(paperW, paperH);
  const auto = paper?.getAttribute('autoLength') === 'true';
  const printer = paper?.getAttribute('printerName') ?? '';
  const color = paper?.getAttribute('paperColor');
  const ink = paper?.getAttribute('paperInk');

  const doc = newDoc({
    name: fileName.replace(/\.lbx$/i, ''),
    media: {
      kind: 'tze',
      width: tape.width,
      tapeColor: color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff',
      inkColor: ink && /^#[0-9a-f]{6}$/i.test(ink) ? ink : '#111111',
    },
    orientation: landscape ? 'landscape' : 'portrait',
    lengthMode: auto ? 'auto' : 'fixed',
    length: Math.round(lengthMm * 10) / 10,
    marginStart: pt(paper?.getAttribute(landscape ? 'marginLeft' : 'marginTop'), 2),
    marginEnd: pt(paper?.getAttribute(landscape ? 'marginRight' : 'marginBottom'), 2),
  });
  if (printer) warnings.push(`Designed for ${printer}.`);

  const objects = desc(xml.documentElement, 'objects');
  const elements: LabelElement[] = [];
  const skipped = new Map<string, number>();

  const walk = async (container: Element) => {
    for (const obj of Array.from(container.children)) {
      const name = local(obj);
      if (name === 'group') {
        const inner = child(obj, 'objects') ?? obj;
        await walk(inner);
        continue;
      }
      const style = child(obj, 'objectStyle');
      if (!style) continue;
      const x = pt(style.getAttribute('x'));
      const y = pt(style.getAttribute('y'));
      const w = Math.max(0.5, pt(style.getAttribute('width'), 5));
      const h = Math.max(0.5, pt(style.getAttribute('height'), 5));
      const rotation = Number(style.getAttribute('angle') ?? 0) || 0;
      const base = { id: uid(), x, y, w, h, rotation };
      const data = child(obj, 'data')?.textContent ?? '';

      if (name === 'text') {
        const logFont = desc(obj, 'logFont');
        const ext = desc(obj, 'fontExt');
        const align = desc(obj, 'textAlign');
        const control = desc(obj, 'textControl');
        const hAlign = (align?.getAttribute('horizontalAlignment') ?? 'LEFT').toLowerCase();
        const vAlign = (align?.getAttribute('verticalAlignment') ?? 'CENTER').toLowerCase();
        const ctrl = control?.getAttribute('control') ?? '';
        elements.push({
          ...base,
          type: 'text',
          ...defaultTextStyle(),
          text: data.replace(/\r\n?/g, '\n'),
          font: logFont?.getAttribute('name') || 'Inter',
          bold: Number(logFont?.getAttribute('weight') ?? 400) >= 600,
          italic: logFont?.getAttribute('italic') === 'true',
          underline: Number(ext?.getAttribute('underline') ?? 0) > 0,
          strike: Number(ext?.getAttribute('strikeout') ?? 0) > 0,
          size: pt(ext?.getAttribute('size'), 3.5) / PT,
          align: (hAlign === 'center' ? 'center' : hAlign === 'right' ? 'right' : 'left') as HAlign,
          vAlign: (vAlign === 'top' ? 'top' : vAlign === 'bottom' ? 'bottom' : 'middle') as VAlign,
          autoSize: /AUTO/.test(ctrl) || ctrl === 'FIXEDFRAME',
          autoWidth: ctrl === 'AUTOLEN',
          invert: false,
          frame: 'none',
        });
      } else if (name === 'image') {
        const st = desc(obj, 'imageStyle');
        const file = st?.getAttribute('fileName') ?? '';
        const key = Object.keys(files).find((k) => k.toLowerCase().endsWith(file.toLowerCase()) && file);
        const src = key ? await bmpToDataUrl(files[key], key) : null;
        if (src) elements.push({ ...base, type: 'image', src, dither: 'floyd', threshold: 128, invert: false, keepAspect: false });
        else skipped.set('image', (skipped.get('image') ?? 0) + 1);
      } else if (name === 'barcode') {
        const st = desc(obj, 'barcodeStyle');
        const proto = (st?.getAttribute('protocol') ?? 'CODE128').toUpperCase().replace(/[^A-Z0-9_]/g, '');
        const sym = BARCODES[proto];
        if (!sym) {
          skipped.set(`barcode ${proto}`, (skipped.get(`barcode ${proto}`) ?? 0) + 1);
          continue;
        }
        elements.push({
          ...base,
          type: 'barcode',
          symbology: sym,
          data,
          showText: st?.getAttribute('humanReadable') === 'true',
          textSize: 6,
          font: 'Roboto Mono',
          eclevel: 'M',
        });
      } else if (['frame', 'rect', 'rectangle', 'ellipse', 'line', 'poly', 'polyLine'].includes(name)) {
        const pen = desc(obj, 'pen');
        const brush = desc(obj, 'brush');
        const shapeAttr = (child(obj, 'polyStyle') ?? child(obj, 'frameStyle'))?.getAttribute('shape') ?? '';
        const kind = name === 'ellipse' || /ELLIPSE/i.test(shapeAttr) ? 'ellipse' : name === 'line' || /LINE/i.test(shapeAttr) ? 'line' : /ROUND/i.test(shapeAttr) ? 'roundrect' : 'rect';
        elements.push({
          ...base,
          type: 'shape',
          shape: kind,
          strokeWidth: pt(pen?.getAttribute('widthX'), 0.5) || 0.3,
          stroke: (pen?.getAttribute('style') ?? 'INSIDEFRAME') !== 'NULL',
          fill: (brush?.getAttribute('style') ?? 'NULL') !== 'NULL',
          dash: /DASH/.test(pen?.getAttribute('style') ?? '') ? 'dashed' : /DOT/.test(pen?.getAttribute('style') ?? '') ? 'dotted' : 'solid',
          radius: 1,
        } as LabelElement);
      } else {
        skipped.set(name, (skipped.get(name) ?? 0) + 1);
      }
    }
  };
  if (objects) await walk(objects);
  for (const [k, n] of skipped) warnings.push(`Skipped ${n} unsupported object${n > 1 ? 's' : ''}: ${k}.`);
  if (/database/i.test(strFromU8(files[labelXml]).slice(0, 4000)) || Object.keys(files).some((k) => /\.(csv|mdb|xls)/i.test(k)))
    warnings.push('Database links are not imported; load the CSV in the Data tab and use {{Column}} placeholders.');
  return { doc: { ...doc, elements }, warnings };
}
