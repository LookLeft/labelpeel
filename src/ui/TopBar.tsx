import { useEffect, useRef, useState } from 'react';
import {
  FilePlus2, FolderOpen, Save, Undo2, Redo2, Printer, ChevronDown, Download, FileImage, FileUp, Bluetooth, Usb, Library,
  Sun, Moon, Monitor, Upload, Type as TypeIcon, Info, X, Archive, ArchiveRestore,
} from 'lucide-react';
import { useEditor } from '../state/store';
import { usePrinter } from '../printer/service';
import { closeTab, downloadPrintFile, exportLbxFile, exportPng, importLbxFile, openFile, save, saveToLibrary, loadDataFile } from './actions';
import { loadFontFile, loadLocalFonts } from '../render/fonts';
import { pickFile } from '../io/files';
import { exportBackup, restoreBackup } from '../io/backup';

function Menu({ label, children }: { label: React.ReactNode; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={`btn ghost ${open ? 'active' : ''}`} onClick={() => setOpen(!open)}>
        {label} <ChevronDown size={13} />
      </button>
      {open && <div className="menu-pop">{children(() => setOpen(false))}</div>}
    </div>
  );
}

const Item = ({ icon, label, kbd, onClick }: { icon?: React.ReactNode; label: string; kbd?: string; onClick: () => void }) => (
  <button className="menu-item" onClick={onClick}>
    {icon}
    {label}
    {kbd && <span className="kbd">{kbd}</span>}
  </button>
);

export function TopBar() {
  const name = useEditor((s) => s.doc.name);
  const dirty = useEditor((s) => s.dirty);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const theme = useEditor((s) => s.settings.theme);
  const st = useEditor.getState;
  const transport = usePrinter((s) => s.transport);
  const status = usePrinter((s) => s.status);
  // A serial port can be open with no printer behind it until the printer replies.
  const silent = usePrinter((s) => !!s.transport && s.transport.kind === 'serial' && !s.responded);
  const detected = usePrinter((s) => s.detectedProfile);
  const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';

  return (
    <header className="topbar">
      <button className="brand" onClick={() => st().set({ aboutOpen: true })} title="About Labelsmith">
        <img className="brand-mark" src="./icon-192.png" alt="" />
        <span className="brand-name">Labelsmith</span>
      </button>
      <Menu label="File">
        {(close) => (
          <>
            <Item icon={<FilePlus2 size={15} />} label="New label…" kbd={`${mod}N`} onClick={() => { close(); st().set({ wizardOpen: true }); }} />
            <Item icon={<FolderOpen size={15} />} label="Open…" kbd={`${mod}O`} onClick={() => { close(); openFile(); }} />
            <Item icon={<X size={15} />} label="Close label" onClick={() => { close(); closeTab(st().activeTab); }} />
            <div className="menu-sep" />
            <Item icon={<Save size={15} />} label="Save" kbd={`${mod}S`} onClick={() => { close(); save(false); }} />
            <Item icon={<Save size={15} />} label="Save as…" kbd={`${mod}⇧S`} onClick={() => { close(); save(true); }} />
            <Item icon={<Library size={15} />} label="Save to My labels" onClick={() => { close(); saveToLibrary(); }} />
            <div className="menu-sep" />
            <Item icon={<FileUp size={15} />} label="Import P-touch Editor .lbx…" onClick={() => { close(); importLbxFile(); }} />
            <Item icon={<Download size={15} />} label="Export for P-touch Editor (.lbx)" onClick={() => { close(); exportLbxFile(); }} />
            <div className="menu-sep" />
            <Item icon={<Archive size={15} />} label="Back up everything…" onClick={() => { close(); exportBackup(); }} />
            <Item icon={<ArchiveRestore size={15} />} label="Restore from backup…" onClick={() => { close(); restoreBackup(); }} />
            <Item icon={<Upload size={15} />} label="Load CSV data…" onClick={() => { close(); loadDataFile(); st().set({ leftTab: 'data' }); }} />
            <div className="menu-sep" />
            <Item icon={<FileImage size={15} />} label="Export PNG (preview)" onClick={() => { close(); exportPng('preview'); }} />
            <Item icon={<FileImage size={15} />} label="Export PNG (exact 180 dpi dots)" onClick={() => { close(); exportPng('print'); }} />
            <Item icon={<Download size={15} />} label="Download raw print file (.bin)" onClick={() => { close(); downloadPrintFile(); }} />
          </>
        )}
      </Menu>
      <Menu label="View">
        {(close) => (
          <>
            <Item label="Zoom in" kbd={`${mod}+`} onClick={() => { close(); window.dispatchEvent(new CustomEvent('labelsmith-zoom', { detail: 'in' })); }} />
            <Item label="Zoom out" kbd={`${mod}-`} onClick={() => { close(); window.dispatchEvent(new CustomEvent('labelsmith-zoom', { detail: 'out' })); }} />
            <Item label="Fit label" kbd={`${mod}0`} onClick={() => { close(); window.dispatchEvent(new CustomEvent('labelsmith-zoom', { detail: 'fit' })); }} />
            <Item label="Actual size (100%)" kbd={`${mod}1`} onClick={() => { close(); window.dispatchEvent(new CustomEvent('labelsmith-zoom', { detail: '100' })); }} />
            <Item label="Calibrate actual size…" onClick={() => { close(); st().set({ calibrateOpen: true }); }} />
            <div className="menu-sep" />
            <Item label={`${st().dotPreview ? '✓ ' : ''}Dot preview (exact print)`} onClick={() => { close(); st().set({ dotPreview: !st().dotPreview }); }} />
            <Item label={`${st().settings.showGuides ? '✓ ' : ''}Show guides`} onClick={() => { close(); st().setSettings({ showGuides: !st().settings.showGuides }); }} />
            <Item label={`${st().settings.snap ? '✓ ' : ''}Snap while moving`} onClick={() => { close(); st().setSettings({ snap: !st().settings.snap }); }} />
            <div className="menu-sep" />
            <Item icon={<TypeIcon size={15} />} label="Load font file…" onClick={async () => {
              close();
              const f = await pickFile('.ttf,.otf,.woff,.woff2');
              if (f) loadFontFile(f).then((fam) => st().notify(`Font “${fam}” added`, 'success')).catch((e) => st().notify(e.message, 'error'));
            }} />
            {'queryLocalFonts' in window && <Item icon={<TypeIcon size={15} />} label="Use fonts installed on this computer" onClick={() => {
              close();
              loadLocalFonts().then((n) => st().notify(`${n} installed fonts added to the font list`, 'success')).catch((e) => st().notify(e.message, 'error'));
            }} />}
            <div className="menu-sep" />
            <Item icon={<Monitor size={15} />} label={`${theme === 'system' ? '✓ ' : ''}Theme: system`} onClick={() => { close(); st().setSettings({ theme: 'system' }); }} />
            <Item icon={<Moon size={15} />} label={`${theme === 'dark' ? '✓ ' : ''}Theme: dark`} onClick={() => { close(); st().setSettings({ theme: 'dark' }); }} />
            <Item icon={<Sun size={15} />} label={`${theme === 'light' ? '✓ ' : ''}Theme: light`} onClick={() => { close(); st().setSettings({ theme: 'light' }); }} />
            <div className="menu-sep" />
            <Item icon={<Info size={15} />} label="About Labelsmith" onClick={() => { close(); st().set({ aboutOpen: true }); }} />
          </>
        )}
      </Menu>
      <div className="sep" />
      <button className="btn ghost icon" title={`Undo (${mod}Z)`} disabled={!canUndo} onClick={() => st().undo()}>
        <Undo2 size={16} />
      </button>
      <button className="btn ghost icon" title={`Redo (${mod}⇧Z)`} disabled={!canRedo} onClick={() => st().redo()}>
        <Redo2 size={16} />
      </button>
      <div className="sep" />
      <input
        className="doc-name"
        value={name}
        onChange={(e) => st().update((d) => ({ ...d, name: e.target.value }), 'name')}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        title="Label name"
      />
      {dirty && <span className="hint" title="Unsaved changes">●</span>}
      <div className="spacer" />
      <button className="btn" onClick={() => st().set({ printerOpen: true })} title="Printer connection">
        <span className={`dot ${transport ? (status?.errors.length ? 'err' : silent ? 'warn' : 'on') : ''}`} />
        {transport ? (transport.kind === 'usb' || transport.label.endsWith('(USB)') ? <Usb size={14} /> : <Bluetooth size={14} />) : <Bluetooth size={14} className="mobile-only" />}
        <span className="btn-label">{transport ? (silent ? 'Printer not responding' : `${detected?.name ?? 'Printer'}${status ? ` · ${status.mediaWidth} mm` : ''}`) : 'Connect printer'}</span>
      </button>
      <button className="btn primary" onClick={() => st().set({ printOpen: true })} title={`Print (${mod}P)`}>
        <Printer size={15} /> <span className="btn-label">Print</span>
      </button>
    </header>
  );
}
