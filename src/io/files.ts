import Papa from 'papaparse';
import type { DataSource, LabelDoc } from '../model/types';
import { migrate } from '../state/store';

export const FILE_EXT = '.labelsmith';
const MIME = 'application/json';

type Picker = {
  showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]>;
};
const w = () => window as unknown as Picker;

export const serialize = (doc: LabelDoc) => JSON.stringify({ app: 'labelsmith', ...doc }, null, 1);

export function parseDoc(text: string): LabelDoc {
  const json = JSON.parse(text);
  if (!json || typeof json !== 'object' || !Array.isArray(json.elements)) throw new Error('Not a Labelsmith label file.');
  delete json.app;
  return migrate(json);
}

export function download(name: string, data: BlobPart | Uint8Array, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const safeName = (s: string) => (s.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'label') + FILE_EXT;

/** Save to an existing handle, or ask where (Save As). Returns the handle used. */
export async function saveDoc(doc: LabelDoc, handle: FileSystemFileHandle | null, saveAs: boolean): Promise<{ handle: FileSystemFileHandle | null; name: string }> {
  const text = serialize(doc);
  if (w().showSaveFilePicker) {
    let h = saveAs ? null : handle;
    if (!h) {
      h = await w().showSaveFilePicker!({
        suggestedName: safeName(doc.name),
        types: [{ description: 'Labelsmith label', accept: { [MIME]: [FILE_EXT, '.json'] } }],
      });
    }
    const writable = await (h as FileSystemFileHandle & { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable();
    await writable.write(text);
    await writable.close();
    return { handle: h, name: h.name };
  }
  const name = safeName(doc.name);
  download(name, text, MIME);
  return { handle: null, name };
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export async function openDocFile(): Promise<{ doc: LabelDoc; handle: FileSystemFileHandle | null; name: string; lbx?: ArrayBuffer } | null> {
  if (w().showOpenFilePicker) {
    try {
      const [h] = await w().showOpenFilePicker!({
        types: [{ description: 'Labels', accept: { [MIME]: [FILE_EXT, '.json'], 'application/zip': ['.lbx'] } }],
      });
      const file = await h.getFile();
      if (/\.lbx$/i.test(file.name)) return { doc: null as unknown as LabelDoc, handle: null, name: file.name, lbx: await file.arrayBuffer() };
      return { doc: parseDoc(await file.text()), handle: h, name: h.name };
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      throw e;
    }
  }
  const file = await pickFile(`${FILE_EXT},.json,.lbx`);
  if (!file) return null;
  if (/\.lbx$/i.test(file.name)) return { doc: null as unknown as LabelDoc, handle: null, name: file.name, lbx: await file.arrayBuffer() };
  return { doc: parseDoc(await file.text()), handle: null, name: file.name };
}

/** Parse CSV / TSV / pasted spreadsheet data with a header row. */
export function parseTable(text: string, fileName?: string): DataSource {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', '\t', ';', '|'],
    transformHeader: (h, i) => h.trim() || `Column ${i + 1}`,
  });
  const columns = res.meta.fields ?? [];
  if (!columns.length) throw new Error('No columns found. The first row should contain column names.');
  return { fileName, columns, rows: res.data.map((r) => Object.fromEntries(columns.map((c) => [c, String(r[c] ?? '')]))), selected: null };
}

// ---- Library (IndexedDB)

export interface LibraryItem {
  id: string;
  name: string;
  updated: number;
  thumb: string;
  doc: LabelDoc;
}

// One shared connection, reopened if the browser closes it.
let conn: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  conn ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('labelsmith', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('labels', { keyPath: 'id' });
    req.onsuccess = () => {
      req.result.onclose = () => (conn = null);
      resolve(req.result);
    };
    req.onerror = () => {
      conn = null;
      reject(req.error);
    };
  });
  return conn;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction('labels', mode).objectStore('labels'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const libraryList = () => tx<LibraryItem[]>('readonly', (s) => s.getAll() as IDBRequest<LibraryItem[]>).then((l) => l.sort((a, b) => b.updated - a.updated));
export const libraryPut = (item: LibraryItem) => tx('readwrite', (s) => s.put(item));
export const libraryDelete = (id: string) => tx('readwrite', (s) => s.delete(id));
