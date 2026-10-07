import { create } from 'zustand';
import { cloneElement, newDoc } from '../model/defaults';
import type { LabelDoc, LabelElement } from '../model/types';
import { applyLabelType } from '../model/labelTypes';

const HISTORY_LIMIT = 200;
const AUTOSAVE_KEY = 'labelsmith:autosave';
const SETTINGS_KEY = 'labelsmith:settings';

export interface Settings {
  profileId: string;
  /** Send only the known-good minimal command set (no cut/mode commands). */
  minimalProtocol: boolean;
  dateFormat: string;
  theme: 'dark' | 'light' | 'system';
  showGuides: boolean;
  snap: boolean;
}

const defaultSettings: Settings = {
  profileId: 'pt-e560bt',
  minimalProtocol: false,
  dateFormat: 'DD/MM/YYYY',
  theme: 'system',
  showGuides: true,
  snap: true,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return defaultSettings;
}

function loadAutosave(): LabelDoc | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch {
    /* corrupted or unavailable */
  }
  return null;
}

/** Fill in fields added in later versions. */
export function migrate(input: Partial<LabelDoc>): LabelDoc {
  const base = newDoc();
  return {
    ...base,
    ...input,
    media: { ...base.media, ...input.media },
    frame: { ...base.frame, ...input.frame },
    print: { ...base.print, ...input.print },
    serial: { ...base.serial, ...input.serial },
    elements: (input.elements ?? []) as LabelElement[],
    guides: input.guides ?? [],
    typeParams: input.typeParams ?? {},
    data: input.data ?? null,
  };
}

export type LeftTab = 'insert' | 'templates' | 'clipart' | 'data' | 'layers' | 'library';
/** Which side panel is shown below the canvas on narrow screens. */
export type MobilePanel = 'tools' | 'properties';

interface EditorState {
  doc: LabelDoc;
  past: LabelDoc[];
  future: LabelDoc[];
  selection: string[];
  /** Coalesce consecutive edits with the same key into one undo step. */
  lastKey: string | null;
  lastTime: number;
  txStart: LabelDoc | null;

  fileName: string | null;
  fileHandle: FileSystemFileHandle | null;
  dirty: boolean;

  previewIndex: number;
  dotPreview: boolean;
  zoom: number;
  fitRequest: number;
  editingTextId: string | null;
  leftTab: LeftTab;
  mobilePanel: MobilePanel;
  wizardOpen: boolean;
  printOpen: boolean;
  printerOpen: boolean;
  aboutOpen: boolean;
  settings: Settings;
  toast: { id: number; text: string; kind: 'info' | 'error' | 'success' } | null;

  setDoc: (doc: LabelDoc, opts?: { key?: string; resetHistory?: boolean }) => void;
  update: (fn: (doc: LabelDoc) => LabelDoc, key?: string) => void;
  updateElement: (id: string, patch: Partial<LabelElement>, key?: string) => void;
  updateElements: (ids: string[], fn: (el: LabelElement) => LabelElement, key?: string) => void;
  begin: () => void;
  transient: (fn: (doc: LabelDoc) => LabelDoc) => void;
  commit: () => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[]) => void;
  addElement: (el: LabelElement) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  reorder: (dir: 'front' | 'back' | 'forward' | 'backward') => void;
  setTypeParams: (params: Record<string, unknown>) => void;
  setFile: (name: string | null, handle: FileSystemFileHandle | null) => void;
  markSaved: () => void;
  setSettings: (patch: Partial<Settings>) => void;
  set: (patch: Partial<EditorState>) => void;
  notify: (text: string, kind?: 'info' | 'error' | 'success') => void;
}

let clipboard: LabelElement[] = [];
let toastId = 0;

export const useEditor = create<EditorState>((set, get) => {
  const push = (prev: LabelDoc, next: LabelDoc, key?: string) => {
    const now = Date.now();
    const s = get();
    const coalesce = key && s.lastKey === key && now - s.lastTime < 1200;
    set({
      doc: next,
      past: coalesce ? s.past : [...s.past, prev].slice(-HISTORY_LIMIT),
      future: [],
      lastKey: key ?? null,
      lastTime: now,
      dirty: true,
    });
  };

  return {
    doc: loadAutosave() ?? newDoc(),
    past: [],
    future: [],
    selection: [],
    lastKey: null,
    lastTime: 0,
    txStart: null,
    fileName: null,
    fileHandle: null,
    dirty: false,
    previewIndex: 0,
    dotPreview: false,
    zoom: 0,
    fitRequest: 0,
    editingTextId: null,
    leftTab: 'insert',
    mobilePanel: 'tools',
    wizardOpen: !loadAutosave(),
    printOpen: false,
    printerOpen: false,
    aboutOpen: false,
    settings: loadSettings(),
    toast: null,

    setDoc: (doc, opts = {}) => {
      if (opts.resetHistory) {
        set({ doc, past: [], future: [], selection: [], lastKey: null, previewIndex: 0, fitRequest: get().fitRequest + 1 });
      } else push(get().doc, doc, opts.key);
    },
    update: (fn, key) => push(get().doc, fn(get().doc), key),
    updateElement: (id, patch, key) =>
      get().update(
        (d) => ({ ...d, elements: d.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as LabelElement) : e)) }),
        key ?? `el:${id}:${Object.keys(patch).join(',')}`,
      ),
    updateElements: (ids, fn, key) =>
      get().update((d) => ({ ...d, elements: d.elements.map((e) => (ids.includes(e.id) ? fn(e) : e)) }), key),
    begin: () => set({ txStart: get().doc }),
    transient: (fn) => set({ doc: fn(get().doc) }),
    commit: () => {
      const { txStart, doc } = get();
      if (txStart && txStart !== doc) push(txStart, doc);
      set({ txStart: null, lastKey: null });
    },
    undo: () => {
      const { past, doc, future } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      set({
        doc: prev,
        past: past.slice(0, -1),
        future: [doc, ...future],
        lastKey: null,
        selection: get().selection.filter((id) => prev.elements.some((e) => e.id === id)),
        dirty: true,
      });
    },
    redo: () => {
      const { past, doc, future } = get();
      if (!future.length) return;
      const next = future[0];
      set({
        doc: next,
        past: [...past, doc],
        future: future.slice(1),
        lastKey: null,
        selection: get().selection.filter((id) => next.elements.some((e) => e.id === id)),
        dirty: true,
      });
    },
    select: (ids) => set({ selection: ids }),
    addElement: (el) => {
      get().update((d) => ({ ...d, elements: [...d.elements, el] }));
      set({ selection: [el.id] });
    },
    deleteSelection: () => {
      const sel = get().selection;
      if (!sel.length) return;
      get().update((d) => ({ ...d, elements: d.elements.filter((e) => !sel.includes(e.id) || e.locked) }));
      set({ selection: [] });
    },
    duplicateSelection: () => {
      const { selection, doc } = get();
      const copies = doc.elements.filter((e) => selection.includes(e.id)).map((e) => cloneElement(e));
      if (!copies.length) return;
      get().update((d) => ({ ...d, elements: [...d.elements, ...copies] }));
      set({ selection: copies.map((c) => c.id) });
    },
    reorder: (dir) => {
      const sel = new Set(get().selection);
      get().update((d) => {
        const els = [...d.elements];
        if (dir === 'front') return { ...d, elements: [...els.filter((e) => !sel.has(e.id)), ...els.filter((e) => sel.has(e.id))] };
        if (dir === 'back') return { ...d, elements: [...els.filter((e) => sel.has(e.id)), ...els.filter((e) => !sel.has(e.id))] };
        if (dir === 'forward') {
          for (let i = els.length - 2; i >= 0; i--)
            if (sel.has(els[i].id) && !sel.has(els[i + 1].id)) [els[i], els[i + 1]] = [els[i + 1], els[i]];
        } else {
          for (let i = 1; i < els.length; i++)
            if (sel.has(els[i].id) && !sel.has(els[i - 1].id)) [els[i], els[i - 1]] = [els[i - 1], els[i]];
        }
        return { ...d, elements: els };
      });
    },
    setTypeParams: (params) => {
      get().update((d) => applyLabelType(d, d.labelType, params), 'typeParams');
    },
    setFile: (name, handle) => set({ fileName: name, fileHandle: handle }),
    markSaved: () => set({ dirty: false }),
    setSettings: (patch) => {
      const settings = { ...get().settings, ...patch };
      set({ settings });
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        /* ignore */
      }
    },
    set: (patch) => set(patch),
    notify: (text, kind = 'info') => {
      const id = ++toastId;
      set({ toast: { id, text, kind } });
      setTimeout(() => {
        if (get().toast?.id === id) set({ toast: null });
      }, kind === 'error' ? 7000 : 3500);
    },
  };
});

export function copySelection() {
  const { doc, selection } = useEditor.getState();
  clipboard = doc.elements.filter((e) => selection.includes(e.id)).map((e) => structuredClone(e));
}

export function pasteClipboard() {
  if (!clipboard.length) return false;
  const copies = clipboard.map((e) => cloneElement(e, 3, 0));
  clipboard = copies.map((e) => structuredClone(e));
  useEditor.getState().update((d) => ({ ...d, elements: [...d.elements, ...copies] }));
  useEditor.getState().select(copies.map((c) => c.id));
  return true;
}

// Autosave (debounced).
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useEditor.subscribe((s, prev) => {
  if (s.doc === prev.doc) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(s.doc));
    } catch {
      /* quota exceeded (large images) */
    }
  }, 400);
});
