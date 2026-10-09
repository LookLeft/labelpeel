import { makeBarcode, makeImage, makeShape, makeSymbol, makeTable, makeText, newDoc, printableRect, uid } from '../model/defaults';
import { applyLabelType, labelType, layoutPostPass } from '../model/labelTypes';
import { previewContext } from '../model/pages';
import type { LabelDoc, LabelElement, Media, ShapeKind } from '../model/types';
import { findTape, isDk } from '../model/media';
import { download, libraryPut, openDocFile, parseTable, pickFile, saveDoc } from '../io/files';
import { exportLbx, importLbx } from '../io/lbx';
import { preloadDoc } from '../render/assets';
import { computeLayout, renderLabel, renderPrintBitmap } from '../render/render';
import { concat } from '../printer/protocol';
import { prepareJob, effectiveProfile } from '../printer/service';
import { useEditor } from '../state/store';
import { TAPE_RGB, TEXT_RGB, type PrinterStatus } from '../printer/status';

const S = () => useEditor.getState();

/** Close a tab, asking first if it has unsaved changes. */
export function closeTab(id: string) {
  const tab = S().allTabs().find((t) => t.id === id);
  if (tab?.dirty && !confirm(`Close “${tab.doc.name || 'Untitled label'}” without saving your changes?`)) return;
  S().closeTab(id);
}

/** Open a label in a new tab, or in the current one if it's blank and untouched. */
export function loadDoc(doc: LabelDoc, name: string | null = null, handle: FileSystemFileHandle | null = null) {
  const laid = layoutPostPass(doc);
  if (!S().pristine) return S().newTab(laid, { name, handle });
  S().setDoc(laid, { resetHistory: true });
  S().setFile(name, handle);
  S().set({ dirty: false, selection: [], pristine: false });
}

export function createFromType(typeId: string, media: LabelDoc['media'], params?: Record<string, unknown>) {
  const def = labelType(typeId);
  let doc = newDoc({ name: def.id === 'general' ? 'Untitled label' : def.name, media });
  doc = applyLabelType(doc, typeId, params);
  if (typeId === 'general') doc = { ...doc, elements: [makeText(doc, 'Hello', { bold: true })] };
  loadDoc(doc);
}

export async function openFile() {
  try {
    const res = await openDocFile();
    if (!res) return;
    if (res.lbx) return importLbxBuffer(res.lbx, res.name);
    loadDoc(res.doc, res.name, res.handle);
    S().notify(`Opened ${res.name}`, 'success');
  } catch (e) {
    S().notify(`Could not open file: ${(e as Error).message}`, 'error');
  }
}

async function importLbxBuffer(buf: ArrayBuffer, name: string) {
  try {
    const { doc, warnings } = await importLbx(buf, name);
    loadDoc(doc);
    S().notify(`Imported ${name}${warnings.length ? ` — ${warnings.join(' ')}` : ''}`, warnings.length ? 'info' : 'success');
  } catch (e) {
    S().notify(`Import failed: ${(e as Error).message}`, 'error');
  }
}

/** Save the label as a P-touch Editor .lbx file. */
export async function exportLbxFile() {
  const s = S();
  try {
    if (isDk(s.doc.media.kind)) throw new Error('.lbx export is for P-touch tape labels; DK labels for QL printers aren\'t supported yet.');
    await preloadDoc(s.doc);
    const { data, warnings } = await exportLbx(s.doc, s.settings.dateFormat);
    download(`${(s.doc.name || 'label').replace(/[\\/:*?"<>|]+/g, '-')}.lbx`, data, 'application/zip');
    s.notify(warnings.length ? `Exported for P-touch Editor. ${warnings.join(' ')}` : 'Exported for P-touch Editor.', warnings.length ? 'info' : 'success');
  } catch (e) {
    s.notify(`Export failed: ${(e as Error).message}`, 'error');
  }
}

export async function importLbxFile() {
  const f = await pickFile('.lbx');
  if (f) await importLbxBuffer(await f.arrayBuffer(), f.name);
}

export async function save(saveAs = false) {
  const s = S();
  try {
    const { handle, name } = await saveDoc(s.doc, s.fileHandle, saveAs);
    s.setFile(name, handle);
    s.markSaved();
    s.notify(`Saved ${name}`, 'success');
  } catch (e) {
    if ((e as Error).name !== 'AbortError') s.notify(`Save failed: ${(e as Error).message}`, 'error');
  }
}

export async function thumbnail(doc: LabelDoc, maxW = 360, maxH = 80): Promise<HTMLCanvasElement> {
  await preloadDoc(doc, [doc.media.inkColor]);
  const pctx = previewContext(doc, 0, S().settings.dateFormat);
  const layout = computeLayout(doc, pctx);
  const W = doc.orientation === 'portrait' ? doc.media.width : layout.length;
  const H = doc.orientation === 'portrait' ? layout.length : doc.media.width;
  const scale = Math.min(maxW / W, maxH / H, 12);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(W * scale));
  c.height = Math.max(1, Math.round(H * scale));
  renderLabel(c.getContext('2d')!, doc, layout, { scale, ink: doc.media.inkColor, paper: doc.media.tapeColor, pctx, background: true });
  return c;
}

export async function saveToLibrary() {
  const s = S();
  const thumb = (await thumbnail(s.doc)).toDataURL('image/png');
  const id = (s.doc as LabelDoc & { libraryId?: string }).libraryId ?? uid();
  const doc = { ...s.doc, libraryId: id } as LabelDoc;
  await libraryPut({ id, name: doc.name, updated: Date.now(), thumb, doc });
  s.setDoc(doc, { key: 'library' });
  s.markSaved();
  s.notify(`Saved “${doc.name}” to My labels`, 'success');
}

export async function exportPng(mode: 'print' | 'preview') {
  const s = S();
  const doc = s.doc;
  await preloadDoc(doc, [doc.media.inkColor, '#000']);
  const pctx = previewContext(doc, s.previewIndex, s.settings.dateFormat);
  let canvas: HTMLCanvasElement;
  if (mode === 'print') {
    const p = effectiveProfile(s.settings.profileId);
    const bmp = renderPrintBitmap(doc, pctx, p.dpi, p.headPins);
    canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const cx = canvas.getContext('2d')!;
    const img = cx.createImageData(bmp.width, bmp.height);
    for (let i = 0; i < bmp.bits.length; i++) {
      const v = bmp.bits[i] ? 0 : 255;
      img.data.set([v, v, v, 255], i * 4);
    }
    cx.putImageData(img, 0, 0);
  } else {
    canvas = await thumbnail(doc, 4000, 1200);
  }
  canvas.toBlob((b) => b && download(`${doc.name || 'label'}${mode === 'print' ? '-180dpi' : ''}.png`, b, 'image/png'));
}

export async function downloadPrintFile() {
  const s = S();
  try {
    const job = await prepareJob(s.doc, effectiveProfile(s.settings.profileId), s.settings.minimalProtocol, s.settings.dateFormat);
    download(`${s.doc.name || 'label'}.bin`, concat(job.chunks));
    s.notify('Downloaded raw print file. Send it with: lp -o raw file.bin  (or copy /b file.bin to the printer port)', 'info');
  } catch (e) {
    s.notify((e as Error).message, 'error');
  }
}

// ---------- inserting

function place(el: LabelElement): LabelElement {
  // Drop new elements after the existing content so they don't overlap.
  const { doc } = S();
  const r = printableRect(doc);
  if (doc.orientation === 'portrait' || !doc.elements.length) return el;
  const right = Math.max(...doc.elements.map((e) => e.x + e.w));
  const x = Math.max(doc.marginStart, right + 2);
  if (doc.lengthMode === 'fixed' && x + el.w > doc.length) return { ...el, x: Math.max(r.x, doc.length / 2 - el.w / 2) };
  return { ...el, x };
}

export function insertText(text = 'Text') {
  S().addElement(place(makeText(S().doc, text)));
}

export function insertTable() {
  S().addElement(place(makeTable(S().doc)));
}

export function insertShape(kind: ShapeKind) {
  const doc = S().doc;
  if (kind === 'frame') {
    // A new frame goes around the whole printable area, behind everything else.
    const length = computeLayout(doc, previewContext(doc, S().previewIndex, S().settings.dateFormat)).length;
    const r = printableRect(doc, length);
    const inset = 0.5;
    const box = doc.orientation === 'portrait' ? { x: r.x, w: r.w, y: inset, h: length - 2 * inset } : { x: inset, w: length - 2 * inset, y: r.y, h: r.h };
    const frame = makeShape(doc, 'frame', { ...box, frameStyle: 'rect' });
    S().update((d) => ({ ...d, elements: [frame, ...d.elements] }));
    S().select([frame.id]);
    return;
  }
  S().addElement(place(makeShape(doc, kind)));
}

export function insertSymbol(key: string) {
  S().addElement(place(makeSymbol(S().doc, key)));
}

export function insertBarcode(symbology: string, data: string) {
  S().addElement(place(makeBarcode(S().doc, symbology, data)));
}

export async function insertImage(file?: File | null) {
  const f = file ?? (await pickFile('image/*'));
  if (!f) return;
  const src = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
  const img = new Image();
  img.src = src;
  await img.decode().catch(() => undefined);
  S().addElement(place(makeImage(S().doc, src, img.naturalWidth / Math.max(1, img.naturalHeight) || 1)));
}

/** Insert a placeholder into the selected text, or as new text. */
export function insertPlaceholder(token: string) {
  const s = S();
  const sel = s.doc.elements.find((e) => s.selection.includes(e.id));
  if (sel && sel.type === 'text') s.updateElement(sel.id, { text: sel.text ? `${sel.text} ${token}` : token });
  else if (sel && sel.type === 'barcode') s.updateElement(sel.id, { data: token });
  else insertText(token);
}

export async function loadDataFile(file?: File | null) {
  const f = file ?? (await pickFile('.csv,.tsv,.txt,text/csv,text/plain'));
  if (!f) return;
  try {
    const data = parseTable(await f.text(), f.name);
    S().update((d) => ({ ...d, data }));
    S().set({ previewIndex: 0 });
    S().notify(`Loaded ${data.rows.length} rows, ${data.columns.length} columns from ${f.name}`, 'success');
  } catch (e) {
    S().notify((e as Error).message, 'error');
  }
}

/**
 * Switch the design to the tape the printer reports. Label types re-run their
 * layout so generated content fits the new width.
 */
export function matchLoadedTape(status: PrinterStatus) {
  const s = useEditor.getState();
  s.update((d) => {
    const next: LabelDoc = { ...d, media: reportedMedia(status, d.media) };
    return labelType(next.labelType).generate ? applyLabelType(next, next.labelType, next.typeParams) : next;
  });
}

/** The media the printer reports, as design media (keeping what it doesn't report). */
export function reportedMedia(status: PrinterStatus, current: Media): Media {
  const paper = { tapeColor: '#ffffff', inkColor: '#111111' };
  if (status.mediaType === 0x0a) return { ...current, ...paper, kind: 'dk', width: status.mediaWidth, length: undefined };
  if (status.mediaType === 0x0b) {
    const length = status.mediaLength || undefined;
    return { ...current, ...paper, kind: 'dkdie', width: status.mediaWidth, length: findTape('dkdie', status.mediaWidth, length).length ?? length };
  }
  return {
    ...current,
    kind: status.mediaType === 0x11 || status.mediaType === 0x17 ? 'hse' : isDk(current.kind) || current.kind === 'hse' ? 'tze' : current.kind,
    width: status.mediaWidth === 4 ? 3.5 : status.mediaWidth,
    length: undefined,
    tapeColor: TAPE_RGB[status.tapeColor] ?? current.tapeColor,
    inkColor: TEXT_RGB[status.textColor] ?? current.inkColor,
  };
}

/** Whether the label is designed for different DK media than the QL printer has loaded. */
export function dkMismatch(status: PrinterStatus | null, media: Media): boolean {
  if (!status?.mediaWidth || !isDk(media.kind)) return false;
  const loaded = reportedMedia(status, media);
  return loaded.kind !== media.kind || loaded.width !== media.width || (media.kind === 'dkdie' && !!loaded.length && loaded.length !== media.length);
}

/** Short name for some media, e.g. "62 mm DK roll" or "29 × 90 mm DK labels". */
export function mediaName(media: Media): string {
  if (media.kind === 'dkdie') return `${findTape('dkdie', media.width, media.length).label.replace(/ \(.*\)$/, '')} DK labels`;
  if (media.kind === 'dk') return `${media.width} mm DK roll`;
  return `${media.width} mm ${media.kind === 'hse' ? 'heat-shrink' : 'tape'}`;
}
