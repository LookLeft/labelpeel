// Label types (the "Pro" workflows): each has a settings form and a generator
// that lays out elements. Generated elements are replaced whenever settings
// change; anything the user adds by hand is kept.

import { makeBarcode, makeGrid, makeSymbol, makeText, printableRect, uid } from './defaults';
import type { GridCell, LabelDoc, LabelElement, Media } from './types';

export type ParamType = 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'symbol' | 'font';

export interface ParamDef {
  key: string;
  label: string;
  type: ParamType;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  help?: string;
  placeholder?: string;
  /** Show only when this returns true. */
  when?: (p: Record<string, unknown>) => boolean;
}

export interface LabelTypeDef {
  id: string;
  name: string;
  description: string;
  icon: string; // lucide-react icon name
  media?: Partial<Media>;
  params: ParamDef[];
  defaults: Record<string, unknown>;
  generate?: (doc: LabelDoc, p: Record<string, unknown>) => Partial<LabelDoc> & { elements: LabelElement[] };
}

const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : Number(v) || d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));
const bool = (v: unknown) => v === true || v === 'true';
const lines = (v: unknown) => str(v).split('\n');

const fontParams: ParamDef[] = [
  { key: 'font', label: 'Font', type: 'font' },
  { key: 'bold', label: 'Bold', type: 'checkbox' },
];

const DIR_OPTIONS = [
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'up', label: 'Vertical (bottom to top)' },
  { value: 'down', label: 'Vertical (top to bottom)' },
];

function gen(el: LabelElement): LabelElement {
  return { ...el, generated: true };
}

/** Parse "Text | span" lines into grid cells. */
export function parseCells(text: string): GridCell[] {
  return text
    .split('\n')
    .filter((l, i, arr) => l.trim() !== '' || i < arr.length - 1)
    .map((l) => {
      const m = /^(.*?)\s*\|\s*(\d+)\s*$/.exec(l);
      return m ? { text: m[1].replace(/\\n/g, '\n'), span: Math.max(1, Number(m[2])) } : { text: l.replace(/\\n/g, '\n'), span: 1 };
    });
}

export const DB_PRESETS: Record<string, { name: string; circuits: string; pitch: number }> = {
  'uk-10-split': {
    name: 'UK 10-way split-load (dual RCD)',
    pitch: 18,
    circuits: ['Main Switch\\n100A|2', 'RCD 1\\n30mA|2', 'Cooker', 'Ring\\nKitchen', 'Ring\\nDown', 'Lights\\nDown', 'Smoke\\nAlarms', 'RCD 2\\n30mA|2', 'Shower', 'Ring\\nUp', 'Lights\\nUp', 'Immersion', 'Spare'].join('\n'),
  },
  'uk-10-rcbo': {
    name: 'UK 10-way RCBO',
    pitch: 18,
    circuits: ['Main Switch\\n100A|2', 'SPD|2', 'Cooker', 'Ring\\nKitchen', 'Ring\\nDown', 'Ring\\nUp', 'Lights\\nDown', 'Lights\\nUp', 'Shower', 'Immersion', 'Smoke\\nAlarms', 'Spare'].join('\n'),
  },
  'uk-20-rcbo': {
    name: 'UK 20-way RCBO',
    pitch: 18,
    circuits: [
      'Main Switch\\n100A|2', 'SPD|2', 'Cooker', 'Oven', 'Hob', 'Ring\\nKitchen', 'Kitchen\\nAppliances', 'Ring\\nDown', 'Ring\\nUp', 'Lights\\nDown',
      'Lights\\nUp', 'Outside\\nLights', 'Shower', 'Immersion', 'Boiler', 'Smoke\\nAlarms', 'Garage', 'EV\\nCharger', 'Loft', 'Spare', 'Spare', 'Spare',
    ].join('\n'),
  },
  'garage-4': {
    name: 'Garage / outbuilding 4-way',
    pitch: 18,
    circuits: ['Main Switch|2', 'RCD 30mA|2', 'Sockets', 'Lights', 'Spare', 'Spare'].join('\n'),
  },
  'three-phase-12': {
    name: 'Three-phase 12-way (TP&N)',
    pitch: 18,
    circuits: ['Isolator\\nTP&N|4', 'L1', 'L2', 'L3', 'L1', 'L2', 'L3', 'L1', 'L2', 'L3', 'L1', 'L2', 'L3'].join('\n'),
  },
  'din-mixed': {
    name: 'DIN rail, mixed widths',
    pitch: 17.5,
    circuits: ['Isolator|2', 'Contactor|2', 'Timer', 'MCB 1', 'MCB 2', 'MCB 3', 'PSU 24V|3', 'Relay', 'Relay'].join('\n'),
  },
};

const SIGN_HEADERS = ['DANGER', 'WARNING', 'CAUTION', 'NOTICE', 'IMPORTANT', ''];

export const LABEL_TYPES: LabelTypeDef[] = [
  {
    id: 'general',
    name: 'General',
    description: 'Free design: text, symbols, barcodes and shapes.',
    icon: 'Type',
    params: [],
    defaults: {},
  },
  {
    id: 'self-lam',
    name: 'Self-laminating',
    description: 'Wire markers on TZe-SL tape: print on the white band, the clear part wraps over it.',
    icon: 'Layers',
    media: { kind: 'tze', width: 24, tapeColor: '#ffffff', inkColor: '#111111' },
    params: [
      { key: 'text', label: 'Text', type: 'textarea' },
      { key: 'zone', label: 'White print band', type: 'number', unit: 'mm', min: 3, max: 36, step: 0.5, help: 'Height of the white part of the tape. The rest is clear laminate.' },
      { key: 'repeat', label: 'Repeat text', type: 'number', min: 1, max: 6 },
      { key: 'gap', label: 'Gap between repeats', type: 'number', unit: 'mm', min: 0, step: 0.5, when: (p) => num(p.repeat, 1) > 1 },
      ...fontParams,
    ],
    defaults: { text: 'L1-01', zone: 9, repeat: 1, gap: 4, font: 'Roboto Condensed', bold: true },
    generate(doc, p) {
      const r = printableRect(doc);
      const zone = Math.min(num(p.zone, 9), doc.media.width);
      const top = Math.max(r.y, 0.6);
      const h = Math.max(1.5, Math.min(zone - 1, r.y + r.h - top) - 0.4);
      const n = Math.max(1, Math.round(num(p.repeat, 1)));
      const els: LabelElement[] = [];
      let x = doc.marginStart;
      for (let i = 0; i < n; i++) {
        const t = makeText(doc, str(p.text), { x, y: top, h, font: str(p.font, 'Inter'), bold: bool(p.bold), autoWidth: true, autoSize: true });
        els.push(gen(t));
        x += 12 + num(p.gap, 4);
      }
      return { elements: els, guides: [{ axis: 'y', pos: zone, label: 'clear laminate' }], orientation: 'landscape', lengthMode: 'auto' };
    },
  },
  {
    id: 'cable-wrap',
    name: 'Cable wrap',
    description: 'Wraps around a cable. Text is repeated so it reads from any side.',
    icon: 'Cable',
    media: { kind: 'tze', width: 12 },
    params: [
      { key: 'text', label: 'Text', type: 'text' },
      { key: 'diameter', label: 'Cable diameter', type: 'number', unit: 'mm', min: 1, max: 60, step: 0.5 },
      { key: 'repeat', label: 'Repeats (0 = auto)', type: 'number', min: 0, max: 20 },
      { key: 'dir', label: 'Text direction', type: 'select', options: [
        { value: 'along', label: 'Along the cable (rotated)' },
        { value: 'around', label: 'Around the cable (horizontal)' },
      ] },
      { key: 'overlap', label: 'Extra overlap', type: 'number', unit: 'mm', min: 0, max: 40, step: 1, help: 'Added length so the ends overlap and stick.' },
      ...fontParams,
    ],
    defaults: { text: 'PSU-01', diameter: 6, repeat: 0, dir: 'along', overlap: 0, font: 'Roboto Condensed', bold: true },
    generate(doc, p) {
      const r = printableRect(doc);
      const circ = Math.PI * num(p.diameter, 6);
      const len = circ + num(p.overlap, 0);
      const along = str(p.dir) !== 'around';
      const n = num(p.repeat, 0) > 0 ? Math.round(num(p.repeat, 1)) : Math.max(1, Math.min(12, Math.round(circ / (along ? 4.5 : 22))));
      const seg = circ / n;
      const els: LabelElement[] = [];
      for (let i = 0; i < n; i++) {
        const cx = i * seg + seg / 2;
        if (along) {
          // Rotated text: its own width runs across the tape.
          const w = r.h * 0.96;
          const h = seg * 0.82;
          els.push(gen(makeText(doc, str(p.text), { x: cx - w / 2, y: r.y + r.h / 2 - h / 2, w, h, rotation: 270, autoWidth: false, autoSize: true, font: str(p.font), bold: bool(p.bold) })));
        } else {
          els.push(gen(makeText(doc, str(p.text), { x: i * seg + seg * 0.05, y: r.y, w: seg * 0.9, h: r.h, autoWidth: false, autoSize: true, font: str(p.font), bold: bool(p.bold) })));
        }
      }
      return {
        elements: els,
        orientation: 'landscape',
        lengthMode: 'fixed',
        length: Math.round(len * 10) / 10,
        marginStart: 0,
        marginEnd: 0,
        guides: Array.from({ length: n - 1 }, (_, i) => ({ axis: 'x' as const, pos: (i + 1) * seg })),
      };
    },
  },
  {
    id: 'cable-flag',
    name: 'Cable flag',
    description: 'Folds around a cable into a flag, with text on both sides.',
    icon: 'Flag',
    media: { kind: 'tze', width: 12 },
    params: [
      { key: 'textA', label: 'Side A text', type: 'textarea' },
      { key: 'textB', label: 'Side B text', type: 'textarea', placeholder: 'Same as side A' },
      { key: 'diameter', label: 'Cable diameter', type: 'number', unit: 'mm', min: 1, max: 60, step: 0.5 },
      { key: 'flag', label: 'Flag length (each side)', type: 'number', unit: 'mm', min: 8, max: 120, step: 1 },
      { key: 'dir', label: 'Text direction', type: 'select', options: DIR_OPTIONS },
      { key: 'frame', label: 'Frame each side', type: 'checkbox' },
      ...fontParams,
    ],
    defaults: { textA: 'SW1 → PP-A 12', textB: '', diameter: 6, flag: 30, dir: 'horizontal', frame: false, font: 'Inter', bold: true },
    generate(doc, p) {
      const r = printableRect(doc);
      const flag = num(p.flag, 30);
      const wrap = Math.PI * num(p.diameter, 6);
      const a = str(p.textA);
      const b = str(p.textB).trim() ? str(p.textB) : a;
      const dir = str(p.dir, 'horizontal');
      const pad = 1;
      const mk = (text: string, x0: number) => {
        const common = { autoWidth: false, autoSize: true, font: str(p.font), bold: bool(p.bold), frame: bool(p.frame) ? ('rect' as const) : ('none' as const) };
        if (dir === 'horizontal') return gen(makeText(doc, text, { ...common, x: x0 + pad, y: r.y, w: flag - 2 * pad, h: r.h }));
        // Rotated a quarter turn: the unrotated box is (visual height) x (visual width).
        const visW = flag - 2 * pad;
        const visH = r.h;
        return gen(makeText(doc, text, { ...common, rotation: dir === 'up' ? 270 : 90, w: visH, h: visW, x: x0 + flag / 2 - visH / 2, y: r.y + visH / 2 - visW / 2 }));
      };
      const els = [mk(a, 0), mk(b, flag + wrap)];
      return {
        elements: els,
        orientation: 'landscape',
        lengthMode: 'fixed',
        length: Math.round((2 * flag + wrap) * 10) / 10,
        marginStart: 0,
        marginEnd: 0,
        guides: [
          { axis: 'x', pos: flag, label: 'fold' },
          { axis: 'x', pos: flag + wrap, label: 'fold' },
        ],
      };
    },
  },
  {
    id: 'heat-shrink',
    name: 'Heat-shrink tube',
    description: 'HSe heat-shrink tube markers, repeated along the sleeve.',
    icon: 'Flame',
    media: { kind: 'hse', width: 11.7 },
    params: [
      { key: 'text', label: 'Text', type: 'text' },
      { key: 'length', label: 'Sleeve length', type: 'number', unit: 'mm', min: 10, max: 200, step: 1 },
      { key: 'repeat', label: 'Repeat', type: 'number', min: 1, max: 10 },
      ...fontParams,
    ],
    defaults: { text: 'L1', length: 25, repeat: 1, font: 'Roboto Condensed', bold: true },
    generate(doc, p) {
      const r = printableRect(doc);
      const len = num(p.length, 25);
      const n = Math.max(1, Math.round(num(p.repeat, 1)));
      const seg = len / n;
      const els = Array.from({ length: n }, (_, i) =>
        gen(makeText(doc, str(p.text), { x: i * seg + seg * 0.08, y: r.y, w: seg * 0.84, h: r.h, autoWidth: false, autoSize: true, font: str(p.font), bold: bool(p.bold) })),
      );
      return { elements: els, orientation: 'landscape', lengthMode: 'fixed', length: len, marginStart: 0, marginEnd: 0, guides: [] };
    },
  },
  {
    id: 'patch-panel',
    name: 'Patch panel',
    description: 'A strip of equally spaced port labels, with optional groups.',
    icon: 'EthernetPort',
    media: { kind: 'tze', width: 9 },
    params: [
      { key: 'ports', label: 'Ports', type: 'number', min: 1, max: 96 },
      { key: 'pitch', label: 'Port spacing', type: 'number', unit: 'mm', min: 4, max: 60, step: 0.1, help: 'Measure across several ports and divide for accuracy.' },
      { key: 'start', label: 'First number', type: 'number' },
      { key: 'pattern', label: 'Label pattern', type: 'text', help: '{{p}} is the port number, {{p2}} zero-padded. Lines below override individual ports.' },
      { key: 'names', label: 'Port names (one per line, optional)', type: 'textarea' },
      { key: 'group', label: 'Group every', type: 'number', min: 0, max: 48, help: 'Heavier divider every N ports (0 = off).' },
      { key: 'split', label: 'Split into labels of', type: 'number', unit: 'ports', min: 0, max: 96, help: 'Print separate labels, e.g. 24 for each row of a 48-port panel (0 = one label).' },
      { key: 'dir', label: 'Text direction', type: 'select', options: DIR_OPTIONS },
      { key: 'separator', label: 'Dividers', type: 'select', options: [
        { value: 'line', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }, { value: 'none', label: 'None' },
      ] },
      { key: 'border', label: 'Outer border', type: 'checkbox' },
      ...fontParams,
    ],
    defaults: { ports: 24, pitch: 15.9, start: 1, pattern: '{{p}}', names: '', group: 6, split: 0, dir: 'horizontal', separator: 'line', border: false, font: 'Roboto Condensed', bold: true },
    generate(doc, p) {
      const r = printableRect(doc);
      const ports = Math.max(1, Math.round(num(p.ports, 24)));
      const start = num(p.start, 1);
      const names = lines(p.names);
      const pattern = str(p.pattern, '{{p}}');
      const width = String(start + ports - 1).length;
      const cells = Array.from({ length: ports }, (_, i) => {
        const n = start + i;
        const name = names[i]?.trim();
        return { span: 1, text: name || pattern.replace(/\{\{\s*p2\s*\}\}/g, String(n).padStart(Math.max(2, width), '0')).replace(/\{\{\s*p\s*\}\}/g, String(n)) };
      });
      const pitch = num(p.pitch, 15.9);
      const g = gen(makeGrid(doc, {
        x: doc.marginStart,
        y: r.y,
        h: r.h,
        pitch,
        cells,
        textDir: str(p.dir, 'horizontal') as never,
        separator: str(p.separator, 'line') as never,
        border: bool(p.border),
        groupEvery: num(p.group, 0),
        font: str(p.font),
        bold: bool(p.bold),
        numbers: 'none',
        size: 8,
      }));
      g.w = ports * pitch;
      const split = Math.round(num(p.split, 0));
      return {
        elements: [g],
        orientation: 'landscape',
        lengthMode: 'auto',
        guides: [],
        print: { ...doc.print, splitEvery: split > 0 && split < ports ? split * pitch : 0, splitOrigin: doc.marginStart },
      };
    },
  },
  {
    id: 'punch-block',
    name: 'Punch-down block',
    description: 'Labels for 110 / Krone blocks: pairs grouped in blocks.',
    icon: 'Rows4',
    media: { kind: 'tze', width: 6 },
    params: [
      { key: 'blocks', label: 'Blocks', type: 'number', min: 1, max: 50 },
      { key: 'pairs', label: 'Pairs per block', type: 'select', options: [{ value: '4', label: '4 pair' }, { value: '5', label: '5 pair' }, { value: '10', label: '10 pair (Krone)' }] },
      { key: 'pitch', label: 'Block width', type: 'number', unit: 'mm', min: 5, max: 80, step: 0.1 },
      { key: 'start', label: 'First number', type: 'number' },
      { key: 'pattern', label: 'Label pattern', type: 'text', help: '{{p}} = block number, {{a}}–{{b}} = first and last pair.' },
      ...fontParams,
    ],
    defaults: { blocks: 6, pairs: '4', pitch: 21.3, start: 1, pattern: '{{a}}–{{b}}', font: 'Roboto Condensed', bold: true },
    generate(doc, p) {
      const r = printableRect(doc);
      const n = Math.max(1, Math.round(num(p.blocks, 6)));
      const pairs = num(p.pairs, 4);
      const start = num(p.start, 1);
      const cells = Array.from({ length: n }, (_, i) => ({
        span: 1,
        text: str(p.pattern, '{{p}}')
          .replace(/\{\{\s*p\s*\}\}/g, String(start + i))
          .replace(/\{\{\s*a\s*\}\}/g, String((start - 1 + i) * pairs + 1))
          .replace(/\{\{\s*b\s*\}\}/g, String((start + i) * pairs)),
      }));
      const g = gen(makeGrid(doc, { x: doc.marginStart, y: r.y, h: r.h, pitch: num(p.pitch, 21.3), cells, border: false, font: str(p.font), bold: bool(p.bold), numbers: 'none' }));
      return { elements: [g], orientation: 'landscape', lengthMode: 'auto', guides: [] };
    },
  },
  {
    id: 'faceplate',
    name: 'Faceplate',
    description: 'Wall outlet / faceplate labels with one box per port.',
    icon: 'PanelTop',
    media: { kind: 'tze', width: 9 },
    params: [
      { key: 'texts', label: 'Port labels (one per line)', type: 'textarea' },
      { key: 'length', label: 'Label length', type: 'number', unit: 'mm', min: 10, max: 150, step: 0.5 },
      { key: 'boxes', label: 'Box around each port', type: 'checkbox' },
      ...fontParams,
    ],
    defaults: { texts: 'D1-01\nD1-02', length: 40, boxes: true, font: 'Inter', bold: true },
    generate(doc, p) {
      const r = printableRect(doc);
      const items = lines(p.texts).filter((t) => t.trim() !== '');
      const n = Math.max(1, items.length);
      const len = num(p.length, 40);
      const g = gen(makeGrid(doc, {
        x: 1, y: r.y, h: r.h, pitch: (len - 2) / n,
        cells: (items.length ? items : ['']).map((text) => ({ span: 1, text })),
        border: bool(p.boxes), separator: bool(p.boxes) ? 'line' : 'none', font: str(p.font), bold: bool(p.bold), numbers: 'none',
      }));
      return { elements: [g], orientation: 'landscape', lengthMode: 'fixed', length: len, marginStart: 1, marginEnd: 1, guides: [] };
    },
  },
  {
    id: 'distribution-board',
    name: 'Distribution board',
    description: 'Consumer unit / DIN rail circuit labels with numbering and multi-way devices.',
    icon: 'LayoutPanelLeft',
    media: { kind: 'tze', width: 12 },
    params: [
      { key: 'preset', label: 'Preset', type: 'select', options: [{ value: '', label: 'Custom' }, ...Object.entries(DB_PRESETS).map(([value, v]) => ({ value, label: v.name }))] },
      { key: 'circuits', label: 'Circuits', type: 'textarea', help: 'One device per line. Add "|2" for a device two ways wide, "\\n" for a line break. E.g. "Main Switch|2".' },
      { key: 'pitch', label: 'Way (module) width', type: 'number', unit: 'mm', min: 9, max: 36, step: 0.1, help: 'Usually 17.5–18 mm per MCB/RCBO.' },
      { key: 'numbers', label: 'Way numbers', type: 'select', options: [{ value: 'top', label: 'Above' }, { value: 'bottom', label: 'Below' }, { value: 'none', label: 'None' }] },
      { key: 'numberStart', label: 'First way number', type: 'number' },
      { key: 'numberInvert', label: 'White-on-black numbers', type: 'checkbox' },
      { key: 'dir', label: 'Text direction', type: 'select', options: DIR_OPTIONS },
      { key: 'pos', label: 'Text position', type: 'select', options: [{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }] },
      { key: 'group', label: 'Block dividers every', type: 'number', unit: 'ways', min: 0, max: 24, help: 'Heavier divider every N ways (0 = off).' },
      { key: 'perRow', label: 'Ways per label', type: 'number', min: 0, max: 72, help: 'Split long boards into one label per rail row (0 = single label).' },
      { key: 'separator', label: 'Dividers', type: 'select', options: [{ value: 'line', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }, { value: 'none', label: 'None' }] },
      { key: 'border', label: 'Outer border', type: 'checkbox' },
      { key: 'autoSize', label: 'Auto text size', type: 'checkbox' },
      { key: 'size', label: 'Text size', type: 'number', unit: 'pt', min: 3, max: 40, step: 0.5, when: (p) => !bool(p.autoSize) },
      ...fontParams,
    ],
    defaults: {
      preset: 'uk-10-split',
      circuits: DB_PRESETS['uk-10-split'].circuits,
      pitch: 18,
      numbers: 'top',
      numberStart: 1,
      numberInvert: false,
      dir: 'horizontal',
      pos: 'middle',
      group: 0,
      perRow: 0,
      separator: 'line',
      border: true,
      autoSize: true,
      size: 7,
      font: 'Roboto Condensed',
      bold: true,
    },
    generate(doc, p) {
      const r = printableRect(doc);
      const cells = parseCells(str(p.circuits));
      const pitch = num(p.pitch, 18);
      const g = gen(makeGrid(doc, {
        x: doc.marginStart,
        y: r.y,
        h: r.h,
        pitch,
        cells: cells.length ? cells : [{ span: 1, text: '' }],
        numbers: str(p.numbers, 'top') as never,
        numberStart: num(p.numberStart, 1),
        numberInvert: bool(p.numberInvert),
        numberSize: Math.max(4, Math.min(7, r.h * 0.9)),
        textDir: str(p.dir, 'horizontal') as never,
        textPos: str(p.pos, 'middle') as never,
        groupEvery: num(p.group, 0),
        separator: str(p.separator, 'line') as never,
        border: bool(p.border),
        autoSize: bool(p.autoSize),
        size: num(p.size, 7),
        font: str(p.font),
        bold: bool(p.bold),
        lineHeight: 1.0,
      }));
      const ways = cells.reduce((s, c) => s + c.span, 0);
      const perRow = Math.round(num(p.perRow, 0));
      return {
        elements: [g],
        orientation: 'landscape',
        lengthMode: 'auto',
        guides: [],
        print: { ...doc.print, splitEvery: perRow > 0 && perRow < ways ? perRow * pitch : 0, splitOrigin: doc.marginStart },
      };
    },
  },
  {
    id: 'safety-sign',
    name: 'Safety signage',
    description: 'Hazard symbol, signal word and message, e.g. DANGER 230 V.',
    icon: 'TriangleAlert',
    media: { kind: 'tze', width: 24, tapeColor: '#ffd60a', inkColor: '#111111' },
    params: [
      { key: 'symbol', label: 'Symbol', type: 'symbol' },
      { key: 'header', label: 'Signal word', type: 'select', options: SIGN_HEADERS.map((h) => ({ value: h, label: h || 'None' })) },
      { key: 'message', label: 'Message', type: 'textarea' },
      { key: 'headerStyle', label: 'Signal word style', type: 'select', options: [{ value: 'invert', label: 'White on black bar' }, { value: 'plain', label: 'Bold text' }] },
      { key: 'layout', label: 'Layout', type: 'select', options: [{ value: 'stack', label: 'Signal word above message' }, { value: 'inline', label: 'Signal word beside message' }] },
      { key: 'symbolRight', label: 'Symbol on both ends', type: 'checkbox' },
      ...fontParams,
    ],
    defaults: { symbol: 'custom:w012', header: 'DANGER', message: '230 VOLTS', headerStyle: 'invert', layout: 'stack', symbolRight: false, font: 'Inter', bold: true },
    generate(doc, p) {
      const r = printableRect(doc);
      const h = r.h;
      const els: LabelElement[] = [];
      const symSize = h * 0.96;
      els.push(gen(makeSymbol(doc, str(p.symbol, 'custom:w001'), { x: doc.marginStart, y: r.y + (h - symSize) / 2, w: symSize, h: symSize })));
      const x0 = doc.marginStart + symSize + 1.5;
      const header = str(p.header);
      const msg = str(p.message);
      const font = str(p.font, 'Inter');
      const inline = str(p.layout) === 'inline';
      let end = x0;
      if (header) {
        const hh = inline || !msg ? h : h * 0.42;
        const t = makeText(doc, header, { x: x0, y: r.y, h: hh, font, bold: true, autoWidth: true, autoSize: true, invert: str(p.headerStyle) === 'invert', framePadding: 0.7, align: 'center' });
        els.push(gen(t));
        end = x0 + 20;
      }
      if (msg) {
        const my = header && !inline ? r.y + h * 0.46 : r.y;
        const mh = header && !inline ? h * 0.54 : h;
        els.push(gen(makeText(doc, msg, { x: header && inline ? end + 1.5 : x0, y: my, h: mh, font, bold: bool(p.bold), autoWidth: true, autoSize: true, align: 'left', name: header && inline ? '__after' : undefined })));
      }
      if (bool(p.symbolRight)) {
        // Positioned after layout by the post-pass in applyLabelType.
        els.push(gen({ ...makeSymbol(doc, str(p.symbol, 'custom:w001'), { y: r.y + (h - symSize) / 2, w: symSize, h: symSize }), name: '__right' }));
      }
      return { elements: els, orientation: 'landscape', lengthMode: 'auto', guides: [] };
    },
  },
  {
    id: 'asset',
    name: 'Asset management',
    description: 'Asset tags with QR/Data Matrix/barcode and serial numbers.',
    icon: 'QrCode',
    media: { kind: 'tze', width: 24 },
    params: [
      { key: 'owner', label: 'Owner line', type: 'text' },
      { key: 'id', label: 'Asset ID', type: 'text', help: '{{n}} is the serial number. Set the range in Data → Serialise.' },
      { key: 'code', label: 'Code type', type: 'select', options: [{ value: 'qrcode', label: 'QR code' }, { value: 'datamatrix', label: 'Data Matrix' }, { value: 'code128', label: 'Code 128 barcode' }, { value: 'none', label: 'None' }] },
      { key: 'codeData', label: 'Code contents', type: 'text', help: 'Leave blank to encode the asset ID. URLs work well for QR.' },
      { key: 'extra', label: 'Extra line', type: 'text' },
      ...fontParams,
    ],
    defaults: { owner: 'PROPERTY OF ACME LTD', id: 'IT-{{n}}', code: 'qrcode', codeData: '', extra: 'Added {{date:MMM YYYY}}', font: 'Inter', bold: true },
    generate(doc, p) {
      const r = printableRect(doc);
      const h = r.h;
      const els: LabelElement[] = [];
      const code = str(p.code, 'qrcode');
      const id = str(p.id, '{{n}}');
      let x = doc.marginStart;
      if (code !== 'none' && code !== 'code128') {
        const b = makeBarcode(doc, code, str(p.codeData).trim() || id);
        Object.assign(b, { x, y: r.y + (h - h * 0.96) / 2, w: h * 0.96, h: h * 0.96 });
        els.push(gen(b));
        x += h + 1;
      }
      const owner = str(p.owner);
      const extra = str(p.extra);
      const font = str(p.font, 'Inter');
      const rows = [owner ? 0.24 : 0, 0.46, extra ? 0.22 : 0];
      const total = rows.reduce((a, b) => a + b, 0);
      let y = r.y;
      const scale = h / total;
      if (owner) {
        els.push(gen(makeText(doc, owner, { x, y, h: rows[0] * scale * 0.95, font, bold: false, align: 'left', autoWidth: true })));
        y += rows[0] * scale;
      }
      els.push(gen(makeText(doc, id, { x, y, h: rows[1] * scale * 0.95, font, bold: bool(p.bold), align: 'left', autoWidth: true })));
      y += rows[1] * scale;
      if (extra) els.push(gen(makeText(doc, extra, { x, y, h: rows[2] * scale * 0.95, font, bold: false, align: 'left', autoWidth: true })));
      if (code === 'code128') {
        const b = makeBarcode(doc, 'code128', str(p.codeData).trim() || id);
        Object.assign(b, { name: '__right', y: r.y + h * 0.08, h: h * 0.84, w: 34, showText: false });
        els.push(gen(b));
      }
      return {
        elements: els,
        orientation: 'landscape',
        lengthMode: 'auto',
        guides: [],
        serial: { ...doc.serial, enabled: true, pad: Math.max(doc.serial.pad, 4) },
      };
    },
  },
  {
    id: 'inspection',
    name: 'Inspection / test tag',
    description: 'PAT, periodic inspection and service labels with automatic due dates.',
    icon: 'ClipboardCheck',
    media: { kind: 'tze', width: 24 },
    params: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'result', label: 'Result', type: 'text' },
      { key: 'months', label: 'Retest interval', type: 'number', unit: 'months', min: 1, max: 120 },
      { key: 'tester', label: 'Tested by', type: 'text' },
      { key: 'id', label: 'Appliance ID', type: 'text' },
      ...fontParams,
    ],
    defaults: { title: 'PAT TESTED', result: 'PASS', months: 12, tester: 'A. Electrician', id: 'A{{n}}', font: 'Inter', bold: true },
    generate(doc, p) {
      const r = printableRect(doc);
      const h = r.h;
      const font = str(p.font, 'Inter');
      const x = doc.marginStart;
      const els: LabelElement[] = [];
      els.push(gen(makeText(doc, `${str(p.title)}\n${str(p.result)}`, { x, y: r.y, h, font, bold: true, invert: true, autoWidth: true, lineHeight: 1.15, framePadding: 0.8 })));
      const x2 = x + 22;
      const lines2 = [`Tested: {{date}}`, `Next test: {{date+${Math.round(num(p.months, 12))}m}}`, `By: ${str(p.tester)}`, str(p.id) ? `ID: ${str(p.id)}` : '']
        .filter(Boolean)
        .join('\n');
      els.push(gen(makeText(doc, lines2, { x: x2, y: r.y, h, font, bold: bool(p.bold), align: 'left', autoWidth: true, lineHeight: 1.15, name: '__after' })));
      return { elements: els, orientation: 'landscape', lengthMode: 'auto', guides: [] };
    },
  },
];

export function labelType(id: string): LabelTypeDef {
  return LABEL_TYPES.find((t) => t.id === id) ?? LABEL_TYPES[0];
}

/**
 * Apply (or re-apply) a label type. Keeps user-added elements, replaces
 * generated ones and lays out follow-on elements that depend on measured text.
 */
export function applyLabelType(doc: LabelDoc, typeId: string, params?: Record<string, unknown>): LabelDoc {
  const def = labelType(typeId);
  const p = { ...def.defaults, ...(params ?? (doc.labelType === typeId ? doc.typeParams : {})) };
  const keep = doc.elements.filter((e) => !e.generated);
  let next: LabelDoc = { ...doc, labelType: def.id, typeParams: p };
  if (!def.generate) return { ...next, elements: doc.labelType === def.id ? doc.elements : keep, guides: [] };
  const out = def.generate(next, p);
  next = { ...next, ...out, elements: [...out.elements, ...keep] };
  return layoutPostPass(next);
}

/**
 * Elements named "__after" sit after the widest preceding generated element;
 * "__right" elements go at the end of the label. Uses measured widths when a
 * measuring canvas is available.
 */
export function layoutPostPass(doc: LabelDoc): LabelDoc {
  if (typeof document === 'undefined') return doc;
  const needs = doc.elements.some((e) => e.name === '__after' || e.name === '__right');
  if (!needs) return doc;
  return measurePass(doc);
}

let measurePass: (doc: LabelDoc) => LabelDoc = (d) => d;
export function setMeasurePass(fn: (doc: LabelDoc) => LabelDoc) {
  measurePass = fn;
}

export { uid };
