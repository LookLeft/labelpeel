import { create } from 'zustand';
import { cloneElement, newDoc, uid } from '../model/defaults';
import type { LabelDoc, LabelElement } from '../model/types';
import { applyLabelType } from '../model/labelTypes';

const HISTORY_LIMIT = 200;
const AUTOSAVE_KEY = 'labelpeel:autosave';
/** Open tabs: an index plus one entry per tab, so one large label can't stop the rest saving. */
const SESSION_KEY = 'labelpeel:session';
const tabKey = (id: string) => `labelpeel:tab:${id}`;
const SETTINGS_KEY = 'labelpeel:settings';

export interface Settings {
  profileId: string;
  /** Send only the known-good minimal command set (no cut/mode commands). */
  minimalProtocol: boolean;
  dateFormat: string;
  theme: 'dark' | 'light' | 'system';
  showGuides: boolean;
  snap: boolean;
  /** Screen calibration for "actual size": device pixels per real mm (null = not calibrated). */
  screenDevicePxPerMm?: number | null;
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

/** One open label. The active tab's live state is in the editor's top-level fields. */
export interface Tab {
  id: string;
  doc: LabelDoc;
  past: LabelDoc[];
  future: LabelDoc[];
  selection: string[];
  fileName: string | null;
  fileHandle: FileSystemFileHandle | null;
  dirty: boolean;
  previewIndex: number;
  /** A new blank tab nobody has edited: opening a label reuses it. */
  pristine: boolean;
}

const blankTab = (doc = newDoc()): Tab => ({
  id: uid(),
  doc,
  past: [],
  future: [],
  selection: [],
  fileName: null,
  fileHandle: null,
  dirty: false,
  previewIndex: 0,
  pristine: true,
});

/** The open tabs saved last time, or null if there are none. */
function loadSession(): { tabs: Tab[]; active: string } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const index = JSON.parse(raw) as { tabs: { id: string; fileName: string | null }[]; active: string };
      const tabs: Tab[] = [];
      for (const t of index.tabs) {
        const doc = localStorage.getItem(tabKey(t.id));
        if (doc) tabs.push({ ...blankTab(migrate(JSON.parse(doc))), id: t.id, fileName: t.fileName, pristine: false });
      }
      if (tabs.length) return { tabs, active: tabs.some((t) => t.id === index.active) ? index.active : tabs[0].id };
    }
    // Before tabs, a single label was autosaved.
    const old = localStorage.getItem(AUTOSAVE_KEY);
    if (old) {
      const tab = { ...blankTab(migrate(JSON.parse(old))), pristine: false };
      return { tabs: [tab], active: tab.id };
    }
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
  calibrateOpen: boolean;
  /** Open labels; the entry for the active one is refreshed when switching away. */
  tabs: Tab[];
  activeTab: string;
  pristine: boolean;
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
  /** Open a label in a new tab (a blank one if no doc), after the current tab. */
  newTab: (doc?: LabelDoc, file?: { name: string | null; handle: FileSystemFileHandle | null }) => void;
  switchTab: (id: string) => void;
  /** Close a tab without asking; callers confirm unsaved changes first. */
  closeTab: (id: string) => void;
  /** All tabs with the active one's current state, e.g. for printing them all. */
  allTabs: () => Tab[];
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
      pristine: false,
    });
  };

  // The active tab's live state, saved into its entry when switching away.
  const current = (): Tab => {
    const s = get();
    return {
      id: s.activeTab,
      doc: s.doc,
      past: s.past,
      future: s.future,
      selection: s.selection,
      fileName: s.fileName,
      fileHandle: s.fileHandle,
      dirty: s.dirty,
      previewIndex: s.previewIndex,
      pristine: s.pristine,
    };
  };
  const show = (t: Tab) => ({
    activeTab: t.id,
    doc: t.doc,
    past: t.past,
    future: t.future,
    selection: t.selection,
    fileName: t.fileName,
    fileHandle: t.fileHandle,
    dirty: t.dirty,
    previewIndex: t.previewIndex,
    pristine: t.pristine,
    lastKey: null,
    txStart: null,
    editingTextId: null,
  });
  const withCurrent = () => get().tabs.map((t) => (t.id === get().activeTab ? current() : t));
  const session = loadSession();
  const first = session?.tabs.find((t) => t.id === session.active) ?? blankTab();

  return {
    ...show(first),
    lastTime: 0,
    dotPreview: false,
    zoom: 0,
    fitRequest: 0,
    leftTab: 'insert',
    mobilePanel: 'tools',
    wizardOpen: !session,
    tabs: session?.tabs ?? [first],
    printOpen: false,
    printerOpen: false,
    aboutOpen: false,
    calibrateOpen: false,
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
    newTab: (doc, file) => {
      const tabs = withCurrent();
      const tab: Tab = { ...blankTab(doc), fileName: file?.name ?? null, fileHandle: file?.handle ?? null, pristine: !doc };
      const at = tabs.findIndex((t) => t.id === get().activeTab) + 1;
      tabs.splice(at, 0, tab);
      set({ tabs, ...show(tab), fitRequest: get().fitRequest + 1 });
    },
    switchTab: (id) => {
      if (id === get().activeTab) return;
      const tabs = withCurrent();
      const tab = tabs.find((t) => t.id === id);
      if (tab) set({ tabs, ...show(tab) });
    },
    closeTab: (id) => {
      const before = withCurrent();
      const at = before.findIndex((t) => t.id === id);
      let tabs = before.filter((t) => t.id !== id);
      if (!tabs.length) tabs = [blankTab()];
      if (id !== get().activeTab) return set({ tabs });
      const next = tabs[Math.min(Math.max(0, at), tabs.length - 1)];
      set({ tabs, ...show(next), fitRequest: get().fitRequest + 1 });
    },
    allTabs: () => withCurrent(),
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

// Autosave (debounced): each open tab under its own key, plus the list of tabs.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let warnedFull = false;
useEditor.subscribe((s, prev) => {
  if (s.doc === prev.doc && s.tabs === prev.tabs && s.activeTab === prev.activeTab && s.fileName === prev.fileName) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tabs = useEditor.getState().allTabs();
    let full = false;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ tabs: tabs.map((t) => ({ id: t.id, fileName: t.fileName })), active: s.activeTab }));
      // Drop saved labels whose tabs were closed.
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith('labelpeel:tab:') && !tabs.some((t) => tabKey(t.id) === k)) localStorage.removeItem(k);
      }
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      full = true;
    }
    for (const t of tabs) {
      try {
        localStorage.setItem(tabKey(t.id), JSON.stringify(t.doc));
      } catch {
        full = true; // quota exceeded, usually large images
      }
    }
    if (full && !warnedFull) {
      warnedFull = true;
      useEditor.getState().notify("Browser storage is full, so some open labels can't be restored after reloading. Save them to a file or close tabs you don't need.", 'error');
    }
  }, 400);
});
