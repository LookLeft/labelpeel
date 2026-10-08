import { useEffect } from 'react';
import { CheckCircle2, AlertTriangle, Info, Shapes, SlidersHorizontal } from 'lucide-react';
import { TopBar } from './ui/TopBar';
import { TabBar } from './ui/TabBar';
import { LeftPanel } from './ui/LeftPanel';
import { EditorCanvas } from './ui/Canvas';
import { Inspector } from './ui/Inspector';
import { Wizard } from './ui/Wizard';
import { PrintDialog } from './ui/PrintDialog';
import { PrinterPanel } from './ui/PrinterPanel';
import { AboutDialog } from './ui/AboutDialog';
import { CalibrateDialog } from './ui/CalibrateDialog';
import { useEditor, copySelection, pasteClipboard } from './state/store';
import { usePrinter, effectiveProfile } from './printer/service';
import { openFile, save, insertText } from './ui/actions';
import { computeLayout } from './render/render';
import { previewContext } from './model/pages';
import { printableBand } from './model/media';
import type { LabelElement, TextElement } from './model/types';

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      const s = useEditor.getState();
      if (s.wizardOpen || s.printOpen || s.printerOpen || s.aboutOpen || s.calibrateOpen) {
        if (e.key === 'Escape') s.set({ wizardOpen: false, printOpen: false, printerOpen: false, aboutOpen: false, calibrateOpen: false });
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const zoom = (detail: string) => window.dispatchEvent(new CustomEvent('labelsmith-zoom', { detail }));
      if (mod && k === 'z' && !e.shiftKey) return void (e.preventDefault(), s.undo());
      if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) return void (e.preventDefault(), s.redo());
      if (mod && k === 's') return void (e.preventDefault(), save(e.shiftKey));
      if (mod && k === 'o') return void (e.preventDefault(), openFile());
      if (mod && k === 'p') return void (e.preventDefault(), s.set({ printOpen: true }));
      if (mod && k === 'n') return void (e.preventDefault(), s.set({ wizardOpen: true }));
      if (mod && k === 'd') return void (e.preventDefault(), s.duplicateSelection());
      if (mod && k === 'c') return void copySelection();
      if (mod && k === 'x') return void (copySelection(), s.deleteSelection());
      if (mod && k === 'v') {
        if (pasteClipboard()) e.preventDefault();
        return;
      }
      if (mod && k === 'a') return void (e.preventDefault(), s.select(s.doc.elements.filter((x) => !x.locked).map((x) => x.id)));
      if (mod && (k === '=' || k === '+')) return void (e.preventDefault(), zoom('in'));
      if (mod && k === '-') return void (e.preventDefault(), zoom('out'));
      if (mod && k === '0') return void (e.preventDefault(), zoom('fit'));
      if (mod && k === '1') return void (e.preventDefault(), zoom('100'));
      const sel = s.doc.elements.filter((x) => s.selection.includes(x.id));
      const texts = sel.filter((x) => x.type === 'text') as TextElement[];
      if (mod && (k === 'b' || k === 'i' || k === 'u') && texts.length) {
        e.preventDefault();
        const prop = k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline';
        s.updateElements(texts.map((x) => x.id), (x) => ({ ...x, [prop]: !(x as TextElement)[prop] }) as LabelElement);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') return void (e.preventDefault(), s.deleteSelection());
      if (e.key === 'Escape') return void s.select([]);
      if (e.key === 'Enter' && texts.length === 1) return void (e.preventDefault(), s.set({ editingTextId: texts[0].id }));
      if (k === 't' && !mod) return void (e.preventDefault(), insertText('Text'));
      if (e.key.startsWith('Arrow') && sel.length) {
        e.preventDefault();
        const d = e.shiftKey ? 1 : 0.1;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        s.updateElements(s.selection, (x) => (x.locked ? x : ({ ...x, x: +(x.x + dx).toFixed(2), y: +(x.y + dy).toFixed(2) } as LabelElement)), 'nudge');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function StatusBar() {
  const doc = useEditor((s) => s.doc);
  const idx = useEditor((s) => s.previewIndex);
  const settings = useEditor((s) => s.settings);
  const transport = usePrinter((s) => s.transport);
  const silent = usePrinter((s) => !!s.transport && s.transport.kind === 'serial' && !s.responded);
  const profile = effectiveProfile(settings.profileId);
  const length = computeLayout(doc, previewContext(doc, idx, settings.dateFormat)).length;
  const band = printableBand(doc.media.kind, doc.media.width, profile.dpi, profile.headPins);
  return (
    <footer className="statusbar">
      <span>
        <span className={`dot ${transport ? (silent ? 'warn' : 'on') : ''}`} /> {transport ? (silent ? 'Port open, printer not responding' : transport.label) : 'No printer connected'}
      </span>
      <span className="status-extra">
        Model <b>{profile.name}</b>
      </span>
      <span>
        Tape <b>{doc.media.width} mm</b> · print area <b>{band.height.toFixed(1)} mm</b> ({band.dots} dots)
      </span>
      <span>
        Length <b>{length.toFixed(1)} mm</b>
      </span>
      <span className="spacer" />
      <span className="status-extra">Double-click text to edit · Space+drag to pan · Ctrl+wheel to zoom</span>
    </footer>
  );
}

/** Switches which side panel sits below the canvas on narrow screens; hidden on desktop. */
function MobilePanelSwitch() {
  const panel = useEditor((s) => s.mobilePanel);
  const count = useEditor((s) => s.selection.length);
  const set = useEditor((s) => s.set);
  return (
    <nav className="mobile-switch seg">
      <button className={panel === 'tools' ? 'on' : ''} onClick={() => set({ mobilePanel: 'tools' })}>
        <Shapes size={14} /> Add &amp; layers
      </button>
      <button className={panel === 'properties' ? 'on' : ''} onClick={() => set({ mobilePanel: 'properties' })}>
        <SlidersHorizontal size={14} /> {count === 0 ? 'Label' : count === 1 ? 'Selection' : `${count} selected`}
      </button>
    </nav>
  );
}

function Toast() {
  const toast = useEditor((s) => s.toast);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} onClick={() => useEditor.getState().set({ toast: null })}>
      {toast.kind === 'success' ? <CheckCircle2 size={16} color="var(--ok)" /> : toast.kind === 'error' ? <AlertTriangle size={16} color="var(--danger)" /> : <Info size={16} />}
      {toast.text}
    </div>
  );
}

export default function App() {
  useShortcuts();
  const theme = useEditor((s) => s.settings.theme);
  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(
    () =>
      // On phones, selecting something on the canvas (or inserting it) brings up its properties.
      useEditor.subscribe((s, prev) => {
        if (s.selection.length && !prev.selection.length && s.leftTab !== 'layers' && matchMedia('(max-width: 860px)').matches) {
          if (s.mobilePanel !== 'properties') s.set({ mobilePanel: 'properties' });
        }
      }),
    [],
  );
  useEffect(() => {
    // Ask the browser to keep storage (open labels, My labels) rather than
    // clearing it when space is short or the site isn't used for a while.
    navigator.storage?.persist?.().catch(() => undefined);
  }, []);
  useEffect(() => {
    // Called by the Android app's back button; true means something was closed.
    (window as unknown as { __labelsmithBack?: () => boolean }).__labelsmithBack = () => {
      const s = useEditor.getState();
      if (s.wizardOpen || s.printOpen || s.printerOpen || s.aboutOpen || s.calibrateOpen || s.editingTextId) {
        s.set({ wizardOpen: false, printOpen: false, printerOpen: false, aboutOpen: false, calibrateOpen: false, editingTextId: null });
        return true;
      }
      if (s.selection.length) {
        s.select([]);
        return true;
      }
      return false;
    };
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      // Any open label with unsaved changes to a file.
      if (useEditor.getState().allTabs().some((t) => t.dirty && t.fileName)) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const mobilePanel = useEditor((s) => s.mobilePanel);
  return (
    <div className={`app mp-${mobilePanel}`}>
      <TopBar />
      <TabBar />
      <LeftPanel />
      <main className="main">
        <EditorCanvas />
      </main>
      <MobilePanelSwitch />
      <Inspector />
      <StatusBar />
      <Wizard />
      <PrintDialog />
      <PrinterPanel />
      <AboutDialog />
      <CalibrateDialog />
      <Toast />
    </div>
  );
}
