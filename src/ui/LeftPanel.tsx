import { useEffect, useMemo, useState } from 'react';
import {
  Type, Square, Circle, Minus, Triangle, Diamond, ArrowRight, Image as ImageIcon, QrCode, Barcode, CalendarDays, CalendarClock,
  Hash, LayoutGrid, Shapes, Database, Layers as LayersIcon, LayoutTemplate, Library, Eye, EyeOff, Lock, Unlock, Trash2, Upload,
  ClipboardPaste, Search, RectangleHorizontal, FolderOpen, Frame, Table,
} from 'lucide-react';
import { useEditor, type LeftTab } from '../state/store';
import { insertTable, insertBarcode, insertImage, insertPlaceholder, insertShape, insertSymbol, insertText, loadDataFile, thumbnail, loadDoc } from './actions';
import { TEMPLATES, TEMPLATE_CATEGORIES, type Template } from '../model/templates';
import { CATEGORIES, customCatalog, loadCatalog, type ClipArtItem } from '../clipart';
import { svgUrl } from './Inspector';
import { makeGrid } from '../model/defaults';
import { Check, Field, NumberInput, Select, TextArea } from './fields';
import { parseTable, libraryDelete, libraryList, type LibraryItem } from '../io/files';
import { formatSerial } from '../model/pages';
import { symbolName } from '../clipart';
import type { LabelElement, SymbolElement } from '../model/types';

const TABS: { id: LeftTab; label: string; icon: React.ReactNode }[] = [
  { id: 'insert', label: 'Insert', icon: <Shapes size={14} /> },
  { id: 'templates', label: 'Templates', icon: <LayoutTemplate size={14} /> },
  { id: 'clipart', label: 'Symbols', icon: <ImageIcon size={14} /> },
  { id: 'data', label: 'Data', icon: <Database size={14} /> },
  { id: 'layers', label: 'Layers', icon: <LayersIcon size={14} /> },
  { id: 'library', label: 'Saved', icon: <Library size={14} /> },
];

export function LeftPanel() {
  const tab = useEditor((s) => s.leftTab);
  const set = useEditor((s) => s.set);
  return (
    <aside className="left">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => set({ leftTab: t.id })}>
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div className="scroll">
        {tab === 'insert' && <InsertTab />}
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'clipart' && <ClipArtTab />}
        {tab === 'data' && <DataTab />}
        {tab === 'layers' && <LayersTab />}
        {tab === 'library' && <LibraryTab />}
      </div>
    </aside>
  );
}

function InsertTab() {
  const doc = useEditor((s) => s.doc);
  const addElement = useEditor((s) => s.addElement);
  return (
    <>
      <div className="section">
        <div className="section-title">Content</div>
        <div className="tile-grid">
          <button className="tile" onClick={() => insertText('Text')}>
            <Type size={20} />
            Text
          </button>
          <button className="tile" onClick={() => insertBarcode('qrcode', 'https://example.com')}>
            <QrCode size={20} />
            QR code
          </button>
          <button className="tile" onClick={() => insertBarcode('code128', 'ABC-12345')}>
            <Barcode size={20} />
            Barcode
          </button>
          <button className="tile" onClick={() => insertImage()}>
            <ImageIcon size={20} />
            Image
          </button>
          <button className="tile" onClick={() => useEditor.getState().set({ leftTab: 'clipart' })}>
            <Shapes size={20} />
            Symbol
          </button>
          <button className="tile" onClick={() => addElement({ ...makeGrid(doc), x: doc.marginStart })}>
            <LayoutGrid size={20} />
            Blocks
          </button>
          <button className="tile" onClick={() => insertTable()}>
            <Table size={20} />
            Table
          </button>
        </div>
      </div>
      <div className="section">
        <div className="section-title">Smart fields</div>
        <div className="tile-grid">
          <button className="tile" onClick={() => insertText('{{date}}')}>
            <CalendarDays size={20} />
            Today
          </button>
          <button className="tile" onClick={() => insertText('Due {{date+12m}}')}>
            <CalendarClock size={20} />
            +12 months
          </button>
          <button className="tile" onClick={() => {
            insertText('{{n}}');
            const s = useEditor.getState();
            if (!s.doc.serial.enabled) s.update((d) => ({ ...d, serial: { ...d.serial, enabled: true } }));
          }}>
            <Hash size={20} />
            Counter
          </button>
        </div>
        <div className="hint" style={{ marginTop: 10 }}>
          Smart fields work in any text or barcode: <code>{'{{date+1y:MMM YYYY}}'}</code>, <code>{'{{date-7d}}'}</code>, <code>{'{{time}}'}</code>, <code>{'{{n}}'}</code>, <code>{'{{Column}}'}</code>.
        </div>
      </div>
      <div className="section">
        <div className="section-title">Shapes</div>
        <div className="tile-grid">
          <button className="tile" onClick={() => insertShape('rect')}><Square size={20} />Rectangle</button>
          <button className="tile" onClick={() => insertShape('roundrect')}><RectangleHorizontal size={20} />Rounded</button>
          <button className="tile" onClick={() => insertShape('ellipse')}><Circle size={20} />Ellipse</button>
          <button className="tile" onClick={() => insertShape('line')}><Minus size={20} />Line</button>
          <button className="tile" onClick={() => insertShape('triangle')}><Triangle size={20} />Triangle</button>
          <button className="tile" onClick={() => insertShape('diamond')}><Diamond size={20} />Diamond</button>
          <button className="tile" onClick={() => insertShape('arrow')}><ArrowRight size={20} />Arrow</button>
          <button className="tile" onClick={() => insertShape('frame')}><Frame size={20} />Frame</button>
        </div>
      </div>
    </>
  );
}

const thumbCache = new Map<string, string>();

function TemplateThumb({ t }: { t: Template }) {
  const [src, setSrc] = useState(thumbCache.get(t.id) ?? '');
  useEffect(() => {
    if (src) return;
    let alive = true;
    thumbnail(t.build(), 520, 92).then((c) => {
      const url = c.toDataURL();
      thumbCache.set(t.id, url);
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [t, src]);
  return src ? <img src={src} alt="" /> : <div style={{ height: 46 }} />;
}

function TemplatesTab() {
  const [cat, setCat] = useState<string>('All');
  const [q, setQ] = useState('');
  const list = TEMPLATES.filter((t) => (cat === 'All' || t.category === cat) && (!q || `${t.name} ${t.description ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="section">
      <div className="num has-prefix" style={{ marginBottom: 8 }}>
        <span className="prefix"><Search size={12} /></span>
        <input className="input" placeholder="Search templates" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      <div className="chips" style={{ marginBottom: 10 }}>
        {['All', ...TEMPLATE_CATEGORIES].map((c) => (
          <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {list.map((t) => (
          <button
            key={t.id}
            className="template-card"
            style={{ textAlign: 'left' }}
            onClick={() => {
              loadDoc(t.build());
              useEditor.getState().notify(`Loaded template “${t.name}”`, 'success');
            }}
          >
            <TemplateThumb t={t} />
            <div className="name">{t.name}</div>
            {t.description && <div className="desc">{t.description}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

function ClipArtTab() {
  const [items, setItems] = useState<ClipArtItem[]>(customCatalog());
  const [cat, setCat] = useState<string>('Safety');
  const [q, setQ] = useState('');
  const selection = useEditor((s) => s.selection);
  const doc = useEditor((s) => s.doc);
  const selectedSymbol = doc.elements.find((e) => selection.includes(e.id) && e.type === 'symbol') as SymbolElement | undefined;

  useEffect(() => {
    loadCatalog().then(setItems);
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = items.filter((i) => (needle ? `${i.name} ${i.tags.join(' ')}`.toLowerCase().includes(needle) : cat === 'All' || i.category === cat));
    return list.slice(0, 400);
  }, [items, cat, q]);

  const pick = (key: string) => {
    if (selectedSymbol) useEditor.getState().updateElement(selectedSymbol.id, { symbol: key } as Partial<LabelElement>);
    else insertSymbol(key);
  };

  return (
    <div className="section">
      <div className="num has-prefix" style={{ marginBottom: 8 }}>
        <span className="prefix"><Search size={12} /></span>
        <input className="input" placeholder={`Search ${items.length} symbols`} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      {!q && (
        <div className="chips" style={{ marginBottom: 10 }}>
          {['All', ...CATEGORIES].map((c) => (
            <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      {selectedSymbol && <div className="hint" style={{ marginBottom: 8 }}>Click a symbol to replace “{symbolName(selectedSymbol.symbol)}”.</div>}
      <div className="icon-grid">
        {filtered.map((i) => (
          <button key={i.key} className={`icon-cell ${selectedSymbol?.symbol === i.key ? 'on' : ''}`} title={i.name} onClick={() => pick(i.key)}>
            <img src={svgUrl(i.key)} alt={i.name} loading="lazy" />
          </button>
        ))}
      </div>
      {filtered.length === 400 && <div className="hint" style={{ marginTop: 8 }}>Showing the first 400. Search to narrow down.</div>}
      <div className="hint" style={{ marginTop: 10 }}>
        Safety and electrical symbols follow ISO 7010 / IEC 60417 conventions. Line icons from Lucide (ISC licence).
      </div>
    </div>
  );
}

function DataTab() {
  const doc = useEditor((s) => s.doc);
  const update = useEditor((s) => s.update);
  const previewIndex = useEditor((s) => s.previewIndex);
  const [paste, setPaste] = useState('');
  const data = doc.data;
  const serial = doc.serial;
  const setSerial = (patch: Partial<typeof serial>) => update((d) => ({ ...d, serial: { ...d.serial, ...patch } }), 'serial');
  const selected = data ? (data.selected ?? data.rows.map((_, i) => i)) : [];
  // Label number for a data row, in print order (which "Reverse order" flips).
  const labelOf = (row: number) => {
    const pos = selected.indexOf(row);
    return pos < 0 ? -1 : doc.print.reverse ? selected.length - 1 - pos : pos;
  };

  return (
    <>
      <div className="section">
        <div className="section-title">Spreadsheet data</div>
        {!data ? (
          <>
            <button className="btn block" onClick={() => loadDataFile()}>
              <Upload size={14} /> Load CSV / TSV file
            </button>
            <div className="hint" style={{ margin: '10px 0 6px' }}>Or paste from Excel / Google Sheets (first row = column names):</div>
            <TextArea value={paste} onChange={setPaste} rows={4} placeholder={'Circuit\tRating\nLights\t6A'} />
            <button
              className="btn sm"
              style={{ marginTop: 6 }}
              disabled={!paste.trim()}
              onClick={() => {
                try {
                  const d = parseTable(paste, 'Pasted data');
                  update((x) => ({ ...x, data: d }));
                  setPaste('');
                } catch (e) {
                  useEditor.getState().notify((e as Error).message, 'error');
                }
              }}
            >
              <ClipboardPaste size={13} /> Use pasted data
            </button>
          </>
        ) : (
          <>
            <div className="row" style={{ marginBottom: 8 }}>
              <div className="hint" style={{ flex: 1 }}>
                <b>{data.fileName}</b>: {data.rows.length} rows, {selected.length} selected
              </div>
              <button className="btn sm ghost danger" onClick={() => update((d) => ({ ...d, data: null }))}>
                Remove
              </button>
            </div>
            <div className="field-label" style={{ marginBottom: 4 }}>Click a column to insert it:</div>
            <div className="chips" style={{ marginBottom: 10 }}>
              {data.columns.map((c) => (
                <button key={c} className="chip" onClick={() => insertPlaceholder(`{{${c}}}`)}>
                  {c}
                </button>
              ))}
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={selected.length === data.rows.length}
                        onChange={(e) => update((d) => ({ ...d, data: { ...d.data!, selected: e.target.checked ? null : [] } }))}
                      />
                    </th>
                    {data.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => {
                    const on = selected.includes(i);
                    return (
                      <tr key={i} className={on && labelOf(i) === previewIndex ? 'cur' : ''} onClick={() => on && useEditor.getState().set({ previewIndex: labelOf(i) })}>
                        <td>
                          <input
                            type="checkbox"
                            checked={on}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => {
                              const next = on ? selected.filter((x) => x !== i) : [...selected, i].sort((a, b) => a - b);
                              update((d) => ({ ...d, data: { ...d.data!, selected: next.length === d.data!.rows.length ? null : next } }));
                            }}
                          />
                        </td>
                        {data.columns.map((c) => (
                          <td key={c} title={r[c]}>{r[c]}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="hint" style={{ marginTop: 6 }}>Each selected row prints one label. Click a row to preview it.</div>
          </>
        )}
      </div>
      <div className="section">
        <div className="section-title">Serialise (numbering)</div>
        <Check checked={serial.enabled} onChange={(enabled) => setSerial({ enabled })} label="Number labels with {{n}}" />
        {serial.enabled && (
          <>
            <div className="grid2" style={{ marginTop: 8 }}>
              <Field label="Start">
                <NumberInput value={serial.start} onChange={(start) => setSerial({ start: Math.round(start) })} step={1} />
              </Field>
              <Field label="Step">
                <NumberInput value={serial.step} onChange={(step) => setSerial({ step: Math.round(step) || 1 })} step={1} />
              </Field>
              <Field label={data ? 'Count (uses data rows)' : 'How many labels'}>
                <NumberInput value={serial.count} onChange={(count) => setSerial({ count: Math.max(1, Math.round(count)) })} min={1} max={9999} step={1} />
              </Field>
              <Field label="Zero padding">
                <NumberInput value={serial.pad} onChange={(pad) => setSerial({ pad: Math.max(0, Math.round(pad)) })} min={0} max={10} step={1} unit="digits" />
              </Field>
            </div>
            <Field label="Format">
              <Select value={serial.format} onChange={(format) => setSerial({ format })} options={[{ value: 'number', label: '1, 2, 3' }, { value: 'LETTER', label: 'A, B, C … AA' }, { value: 'letter', label: 'a, b, c … aa' }]} />
            </Field>
            <div className="hint">
              Preview: {Array.from({ length: Math.min(4, serial.count) }, (_, i) => formatSerial(serial, serial.start + i * serial.step)).join(', ')}
              {serial.count > 4 ? ` … ${formatSerial(serial, serial.start + (serial.count - 1) * serial.step)}` : ''}. Use <code>{'{{n}}'}</code> or <code>{'{{n+1}}'}</code> in text or barcodes.
            </div>
          </>
        )}
      </div>
    </>
  );
}

function LayersTab() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const st = useEditor.getState;
  const describe = (e: LabelElement) =>
    e.name && !e.name.startsWith('__')
      ? e.name
      : e.type === 'text'
        ? e.text.split('\n')[0] || 'Text'
        : e.type === 'symbol'
          ? symbolName(e.symbol)
          : e.type === 'barcode'
            ? `${e.symbology}: ${e.data}`
            : e.type === 'shape'
              ? e.shape
              : e.type === 'grid'
                ? `Blocks (${e.cells.length})`
                : e.type === 'table'
                  ? `Table ${e.rows.length} × ${e.cols.length}`
                  : 'Image';
  return (
    <div className="section">
      {doc.elements.length === 0 && <div className="hint">No elements yet.</div>}
      {[...doc.elements].reverse().map((e) => (
        <div key={e.id} className={`list-item ${selection.includes(e.id) ? 'on' : ''}`} onClick={(ev) => st().select(ev.shiftKey ? [...selection, e.id] : [e.id])}>
          <span className="grow">{describe(e)}</span>
          {e.generated && <span className="hint">auto</span>}
          <button className="btn ghost icon sm" onClick={(ev) => { ev.stopPropagation(); st().updateElement(e.id, { hidden: !e.hidden }); }}>
            {e.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <button className="btn ghost icon sm" onClick={(ev) => { ev.stopPropagation(); st().updateElement(e.id, { locked: !e.locked }); }}>
            {e.locked ? <Lock size={13} /> : <Unlock size={13} />}
          </button>
          <button className="btn ghost icon sm" onClick={(ev) => { ev.stopPropagation(); st().update((d) => ({ ...d, elements: d.elements.filter((x) => x.id !== e.id) })); }}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function LibraryTab() {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const refresh = () => libraryList().then(setItems).catch(() => setItems([]));
  const dirty = useEditor((s) => s.dirty);
  useEffect(() => {
    refresh();
  }, [dirty]);
  return (
    <div className="section">
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn sm" onClick={() => import('./actions').then((a) => a.saveToLibrary()).then(refresh)}>
          Save current label here
        </button>
        <button className="btn sm" onClick={() => import('./actions').then((a) => a.openFile())}>
          <FolderOpen size={13} /> Open file…
        </button>
      </div>
      {items?.length === 0 && <div className="hint">Labels you save with “Save to My labels” appear here. They are stored in this browser.</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {items?.map((it) => (
          <div key={it.id} className="template-card" onClick={() => loadDoc(it.doc, null, null)}>
            <img src={it.thumb} alt="" />
            <div className="row">
              <div className="name" style={{ flex: 1 }}>{it.name}</div>
              <span className="hint">{new Date(it.updated).toLocaleDateString()}</span>
              <button
                className="btn ghost icon sm"
                style={{ flex: '0 0 auto' }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete “${it.name}”?`)) libraryDelete(it.id).then(refresh);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
