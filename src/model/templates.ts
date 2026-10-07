// Built-in template library.
import { makeBarcode, makeShape, makeSymbol, makeText, newDoc, printableRect } from './defaults';
import { applyLabelType, DB_PRESETS } from './labelTypes';
import type { LabelDoc, Media } from './types';

export interface Template {
  id: string;
  name: string;
  category: string;
  description?: string;
  build: () => LabelDoc;
}

const YELLOW: Partial<Media> = { tapeColor: '#ffd60a', inkColor: '#111111' };
const WHITE: Partial<Media> = { tapeColor: '#ffffff', inkColor: '#111111' };
const RED: Partial<Media> = { tapeColor: '#d62828', inkColor: '#ffffff' };

function typed(type: string, name: string, media: Partial<Media>, params: Record<string, unknown> = {}, extra: Partial<LabelDoc> = {}): LabelDoc {
  const doc = newDoc({ name, ...extra, media: { ...newDoc().media, kind: 'tze', ...media } });
  return applyLabelType(doc, type, params);
}

function sign(name: string, symbol: string, header: string, message: string, media: Partial<Media> = { width: 24, ...YELLOW }, extra: Record<string, unknown> = {}) {
  return () => typed('safety-sign', name, media, { symbol, header, message, ...extra });
}

/** A long multi-line notice in a fixed-length label. */
function notice(name: string, title: string, body: string, length: number, media: Partial<Media> = { width: 24, ...WHITE }, symbol?: string) {
  return () => {
    const doc = newDoc({ name, media: { ...newDoc().media, ...media }, lengthMode: 'fixed', length });
    const r = printableRect(doc);
    let x = 1.5;
    const els = [];
    if (symbol) {
      els.push(makeSymbol(doc, symbol, { x, y: r.y + r.h * 0.04, w: r.h * 0.92, h: r.h * 0.92 }));
      x += r.h + 1;
    }
    const w = length - x - 1.5;
    els.push(makeText(doc, title, { x, y: r.y, w, h: r.h * 0.26, autoWidth: false, bold: true, invert: true, framePadding: 0.4 }));
    els.push(makeText(doc, body, { x, y: r.y + r.h * 0.3, w, h: r.h * 0.7, autoWidth: false, align: 'left', lineHeight: 1.12 }));
    return { ...doc, elements: els };
  };
}

function plain(name: string, text: string, media: Partial<Media>, over: Record<string, unknown> = {}) {
  return () => {
    const doc = newDoc({ name, media: { ...newDoc().media, ...media } });
    return { ...doc, elements: [makeText(doc, text, { bold: true, ...over })] };
  };
}

export const TEMPLATES: Template[] = [
  // ---- Electrical (BS 7671 / general)
  { id: 'danger-230', name: 'Danger 230 V', category: 'Electrical', build: sign('Danger 230 V', 'custom:w012', 'DANGER', '230 VOLTS') },
  { id: 'danger-400', name: 'Danger 400 V', category: 'Electrical', description: 'BS 7671 514.10.1 for three-phase equipment', build: sign('Danger 400 V', 'custom:w012', 'DANGER', '400 VOLTS') },
  { id: 'isolate-before', name: 'Isolate before removing cover', category: 'Electrical', build: sign('Isolate before removing cover', 'custom:w012', 'WARNING', 'ISOLATE BEFORE\nREMOVING COVER') },
  { id: 'isolate-elsewhere', name: 'Isolate elsewhere', category: 'Electrical', build: sign('Isolate elsewhere', 'custom:w012', 'DANGER', 'ISOLATE ELSEWHERE\nBEFORE WORKING') },
  { id: 'do-not-switch-off', name: 'Do not switch off', category: 'Electrical', build: sign('Do not switch off', 'custom:p031', '', 'DO NOT\nSWITCH OFF', { width: 18, ...RED }) },
  { id: 'fridge-freezer', name: 'Fridge / freezer – do not switch off', category: 'Electrical', build: plain('Fridge freezer', 'FRIDGE / FREEZER\nDO NOT SWITCH OFF', { width: 12, ...RED }, { lineHeight: 1.05 }) },
  { id: 'safety-connection', name: 'Safety electrical connection', category: 'Electrical', description: 'BS 7671 514.13.1 earthing/bonding clamp label', build: plain('Safety electrical connection', 'SAFETY ELECTRICAL CONNECTION\nDO NOT REMOVE', { width: 12, ...YELLOW }, { lineHeight: 1.05 }) },
  { id: 'met', name: 'Main earthing terminal', category: 'Electrical', build: () => {
    const doc = newDoc({ name: 'Main earthing terminal', media: { ...newDoc().media, width: 12 } });
    return { ...doc, elements: [makeSymbol(doc, 'custom:protective-earth'), makeText(doc, 'MAIN EARTHING TERMINAL', { x: 11, bold: true })] };
  } },
  { id: 'rcd-test', name: 'RCD quarterly test notice', category: 'Electrical', description: 'BS 7671 514.12.2', build: notice(
    'RCD test notice', 'RCD – TEST QUARTERLY',
    'This installation, or part of it, is protected by a device which automatically switches off the supply\nif an earth fault develops. Test quarterly by pressing the button marked ‘T’ or ‘Test’. The device should\nswitch off the supply and should then be switched on to restore the supply. If the device does not\nswitch off the supply when the button is pressed, seek expert advice.',
    150, { width: 24, ...WHITE }, 'custom:rcd') },
  { id: 'periodic', name: 'Periodic inspection notice', category: 'Electrical', description: 'BS 7671 514.12.1, next date filled automatically', build: notice(
    'Periodic inspection', 'IMPORTANT',
    'This installation should be periodically inspected and tested and a report on its condition obtained,\nas prescribed in the IET Wiring Regulations BS 7671.\nDate of last inspection: {{date}}     Recommended date of next inspection: {{date+5y}}',
    150) },
  { id: 'two-versions', name: 'Wiring colours – two versions', category: 'Electrical', description: 'BS 7671 514.14.1', build: notice(
    'Wiring colours caution', 'CAUTION',
    'This installation has wiring colours to two versions of BS 7671. Great care should be taken before\nundertaking extension, alteration or repair that all conductors are correctly identified.',
    130, { width: 24, ...YELLOW }, 'custom:w001') },
  { id: 'dual-supply', name: 'Dual supply (solar PV)', category: 'Electrical', description: 'BS 7671 514.15 / PV installations', build: notice(
    'Dual supply', 'WARNING – DUAL SUPPLY',
    'Isolate both mains and on-site generation before carrying out work.\nIsolate the mains supply at: ___________\nIsolate the PV supply at: ___________',
    110, { width: 24, ...YELLOW }, 'custom:solar') },
  { id: 'pv-dc', name: 'PV DC cables – live in daylight', category: 'Electrical', build: sign('PV DC', 'custom:w012', 'DANGER', 'PV DC CABLES\nLIVE DURING DAYLIGHT') },
  { id: 'ev-isolator', name: 'EV charger isolator', category: 'Electrical', build: () => {
    const doc = newDoc({ name: 'EV charger isolator', media: { ...newDoc().media, width: 12 } });
    return { ...doc, elements: [makeSymbol(doc, 'custom:ev'), makeText(doc, 'EV CHARGER ISOLATOR', { x: 11, bold: true })] };
  } },
  { id: 'smoke-alarms', name: 'Smoke alarm circuit', category: 'Electrical', build: plain('Smoke alarms', 'SMOKE ALARMS\nDO NOT SWITCH OFF', { width: 12, ...RED }) },
  { id: 'main-switch', name: 'Main switch', category: 'Electrical', build: plain('Main switch', 'MAIN SWITCH', { width: 12, ...RED }) },
  { id: 'cu-10', name: 'Consumer unit, 10-way split load', category: 'Distribution boards', build: () => typed('distribution-board', 'Consumer unit 10-way', { width: 12 }, { preset: 'uk-10-split', circuits: DB_PRESETS['uk-10-split'].circuits }) },
  { id: 'cu-10-rcbo', name: 'Consumer unit, 10-way RCBO', category: 'Distribution boards', build: () => typed('distribution-board', 'Consumer unit 10-way RCBO', { width: 12 }, { preset: 'uk-10-rcbo', circuits: DB_PRESETS['uk-10-rcbo'].circuits }) },
  { id: 'cu-20', name: 'Consumer unit, 20-way RCBO (2 rows)', category: 'Distribution boards', build: () => typed('distribution-board', 'Consumer unit 20-way', { width: 12 }, { preset: 'uk-20-rcbo', circuits: DB_PRESETS['uk-20-rcbo'].circuits, perRow: 12 }) },
  { id: 'cu-vertical', name: 'DB with vertical text', category: 'Distribution boards', build: () => typed('distribution-board', 'DB vertical', { width: 24 }, { preset: 'uk-20-rcbo', circuits: DB_PRESETS['uk-20-rcbo'].circuits.replace(/\\n/g, ' '), dir: 'up', numbers: 'bottom', numberInvert: true }) },
  { id: 'three-phase', name: 'Three-phase board (TP&N)', category: 'Distribution boards', build: () => typed('distribution-board', 'Three-phase board', { width: 12 }, { preset: 'three-phase-12', circuits: DB_PRESETS['three-phase-12'].circuits }) },
  { id: 'din', name: 'DIN rail control panel', category: 'Distribution boards', build: () => typed('distribution-board', 'DIN rail', { width: 9 }, { preset: 'din-mixed', circuits: DB_PRESETS['din-mixed'].circuits, pitch: 17.5, numbers: 'none' }) },

  // ---- Safety
  { id: 'general-warning', name: 'Warning', category: 'Safety', build: sign('Warning', 'custom:w001', 'WARNING', 'MESSAGE HERE') },
  { id: 'caution-hot', name: 'Caution hot surface', category: 'Safety', build: sign('Hot surface', 'custom:w017', 'CAUTION', 'HOT SURFACE') },
  { id: 'battery', name: 'Battery charging area', category: 'Safety', build: sign('Battery charging', 'custom:w026', 'WARNING', 'BATTERY CHARGING') },
  { id: 'no-smoking', name: 'No smoking', category: 'Safety', build: sign('No smoking', 'custom:p002', '', 'NO SMOKING', { width: 18, ...WHITE }) },
  { id: 'loto', name: 'Lock out / tag out', category: 'Safety', build: sign('Lock out', 'custom:m-lock', 'DANGER', 'LOCKED OUT\nDO NOT OPERATE', { width: 24, ...RED }) },
  { id: 'eye', name: 'Wear eye protection', category: 'Safety', build: sign('Eye protection', 'custom:m004', '', 'WEAR EYE\nPROTECTION', { width: 18, ...WHITE }) },
  { id: 'first-aid', name: 'First aid kit', category: 'Safety', build: sign('First aid', 'custom:e003', '', 'FIRST AID KIT', { width: 18, tapeColor: '#2a9d4b', inkColor: '#ffffff' }) },
  { id: 'fire-ext', name: 'Fire extinguisher', category: 'Safety', build: sign('Fire extinguisher', 'custom:f001', '', 'FIRE\nEXTINGUISHER', { width: 18, ...RED }) },

  // ---- Network & cables
  { id: 'pp-24', name: 'Patch panel, 24 port', category: 'Network & cables', build: () => typed('patch-panel', 'Patch panel 24', { width: 9 }, { ports: 24 }) },
  { id: 'pp-48', name: 'Patch panel, 48 port (2 labels)', category: 'Network & cables', build: () => typed('patch-panel', 'Patch panel 48', { width: 9 }, { ports: 48, split: 24 }) },
  { id: 'switch-24', name: 'Switch, 24 port pairs', category: 'Network & cables', build: () => typed('patch-panel', 'Switch ports', { width: 6 }, { ports: 12, pitch: 14.5, pattern: '{{p}}', start: 1, group: 0 }) },
  { id: 'faceplate-2', name: 'Faceplate, 2 port', category: 'Network & cables', build: () => typed('faceplate', 'Faceplate', { width: 9 }, { texts: 'D1-01\nD1-02', length: 40 }) },
  { id: 'flag-serial', name: 'Cable flags, numbered 1–24', category: 'Network & cables', build: () => {
    const d = typed('cable-flag', 'Cable flags', { width: 12 }, { textA: 'CAB-{{n}}', textB: '' });
    return { ...d, serial: { ...d.serial, enabled: true, start: 1, count: 24, pad: 3 } };
  } },
  { id: 'wrap-serial', name: 'Cable wraps, numbered', category: 'Network & cables', build: () => {
    const d = typed('cable-wrap', 'Cable wraps', { width: 12 }, { text: '{{n}}', diameter: 6 });
    return { ...d, serial: { ...d.serial, enabled: true, start: 1, count: 24, pad: 2 } };
  } },
  { id: 'rack-u', name: 'Rack unit numbers', category: 'Network & cables', build: () => {
    const d = newDoc({ name: 'Rack U', media: { ...newDoc().media, width: 6 }, orientation: 'portrait', lengthMode: 'fixed', length: 44.45 * 4 });
    const els = Array.from({ length: 4 }, (_, i) => makeText(d, `U{{n+${i}}}`, { x: 0.5, y: i * 44.45 + 18, w: 5, h: 8, autoWidth: false }));
    return { ...d, elements: els, serial: { ...d.serial, enabled: true, start: 1, step: 4, count: 11 } };
  } },

  // ---- Asset & inspection
  { id: 'asset-qr', name: 'Asset tag with QR', category: 'Asset & inspection', build: () => {
    const d = typed('asset', 'Asset tag', { width: 24 });
    return { ...d, serial: { ...d.serial, enabled: true, start: 1, count: 10, pad: 4 } };
  } },
  { id: 'asset-barcode', name: 'Asset tag with barcode', category: 'Asset & inspection', build: () => {
    const d = typed('asset', 'Asset barcode', { width: 18 }, { code: 'code128', owner: 'ACME LTD', extra: '' });
    return { ...d, serial: { ...d.serial, enabled: true, start: 1, count: 10, pad: 5 } };
  } },
  { id: 'pat', name: 'PAT test pass', category: 'Asset & inspection', build: () => {
    const d = typed('inspection', 'PAT test', { width: 18 });
    return { ...d, serial: { ...d.serial, enabled: true, start: 1, count: 10, pad: 3 } };
  } },
  { id: 'calibrated', name: 'Calibration due', category: 'Asset & inspection', build: plain('Calibration', 'CALIBRATED {{date}}\nDUE {{date+12m}}', { width: 12, ...WHITE }, { lineHeight: 1.1 }) },
  { id: 'service', name: 'Next service due', category: 'Asset & inspection', build: plain('Service due', 'NEXT SERVICE DUE: {{date+6m:MMM YYYY}}', { width: 12, ...WHITE }) },
  { id: 'if-found', name: 'If found, please return', category: 'Asset & inspection', build: () => {
    const d = newDoc({ name: 'If found', media: { ...newDoc().media, width: 12 } });
    const r = printableRect(d);
    return { ...d, elements: [makeText(d, 'IF FOUND PLEASE CALL', { y: r.y, h: r.h * 0.42, bold: true }), makeText(d, '07700 900000', { y: r.y + r.h * 0.48, h: r.h * 0.52 })] };
  } },

  // ---- Office & home
  { id: 'food', name: 'Food: made / use by', category: 'Office & home', build: plain('Food date', 'MADE {{date:ddd D MMM}}\nUSE BY {{date+3d:ddd D MMM}}', { width: 12, ...WHITE }, { lineHeight: 1.1 }) },
  { id: 'freezer', name: 'Freezer: frozen / eat by', category: 'Office & home', build: plain('Freezer', 'FROZEN {{date:DD/MM/YY}} · EAT BY {{date+3m:DD/MM/YY}}', { width: 9, tapeColor: '#3b82f6', inkColor: '#ffffff' }) },
  { id: 'folder', name: 'Folder spine', category: 'Office & home', build: () => {
    const d = newDoc({ name: 'Folder spine', media: { ...newDoc().media, width: 24 }, orientation: 'portrait', lengthMode: 'fixed', length: 180 });
    return { ...d, elements: [makeText(d, 'INVOICES\n{{date:YYYY}}', { x: 3, y: 10, w: 18, h: 40, autoWidth: false, bold: true })] };
  } },
  { id: 'name', name: 'Name badge', category: 'Office & home', build: () => {
    const d = newDoc({ name: 'Name badge', media: { ...newDoc().media, width: 24 } });
    const r = printableRect(d);
    return { ...d, frame: { style: 'round', inset: 0.4, thickness: 0.4 }, elements: [makeText(d, 'Alex Smith', { x: 4, y: r.y + 1, h: r.h * 0.55, bold: true }), makeText(d, 'Electrical Engineer', { x: 4, y: r.y + r.h * 0.62, h: r.h * 0.3 })], marginEnd: 4 };
  } },
  { id: 'shelf', name: 'Shelf label with barcode', category: 'Office & home', build: () => {
    const d = newDoc({ name: 'Shelf label', media: { ...newDoc().media, width: 18 } });
    const r = printableRect(d);
    const b = makeBarcode(d, 'code128', 'SKU-0001');
    Object.assign(b, { x: 2, y: r.y, w: 30, h: r.h });
    return { ...d, elements: [b, makeText(d, 'M6 × 20 bolts', { x: 34, bold: true })] };
  } },
  { id: 'wifi', name: 'Wi-Fi details with QR', category: 'Office & home', build: () => {
    const d = newDoc({ name: 'Wi-Fi', media: { ...newDoc().media, width: 24 } });
    const r = printableRect(d);
    const q = makeBarcode(d, 'qrcode', 'WIFI:T:WPA;S:MyNetwork;P:password123;;');
    Object.assign(q, { x: 2, y: r.y, w: r.h, h: r.h });
    return {
      ...d,
      elements: [
        q,
        makeSymbol(d, 'lucide:wifi', { x: r.h + 4, y: r.y + 1, w: r.h * 0.4, h: r.h * 0.4 }),
        makeText(d, 'MyNetwork', { x: r.h + 4 + r.h * 0.45, y: r.y, h: r.h * 0.48, bold: true, align: 'left' }),
        makeText(d, 'password123', { x: r.h + 4, y: r.y + r.h * 0.52, h: r.h * 0.44, font: 'Roboto Mono', align: 'left' }),
      ],
    };
  } },
  { id: 'arrow', name: 'Direction arrow', category: 'Office & home', build: () => {
    const d = newDoc({ name: 'Arrow', media: { ...newDoc().media, width: 12 } });
    const r = printableRect(d);
    return { ...d, elements: [makeText(d, 'THIS WAY', { bold: true }), makeShape(d, 'arrow', { x: 30, y: r.y + 1, w: 14, h: r.h - 2, fill: true, name: '__after' })] };
  } },
];

export const TEMPLATE_CATEGORIES = Array.from(new Set(TEMPLATES.map((t) => t.category)));
