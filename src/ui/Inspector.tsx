import { useMemo, useState } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal,
  AlignCenterHorizontal, AlignEndHorizontal, Bold, Copy, Eye, EyeOff, Italic, Lock, Unlock, Trash2, Underline,
  Strikethrough, RotateCw, RotateCcw, ArrowUpToLine, ArrowDownToLine, Plus, X, Unlink, Settings2,
  ArrowUpFromLine, ArrowDownFromLine,
} from 'lucide-react';
import { useEditor } from '../state/store';
import type {
  BarcodeElement, GridElement, ImageElement, LabelDoc, LabelElement, ShapeElement, SymbolElement, TextElement, MediaKind,
  TableElement, CellFill, LineStyle,
} from '../model/types';
import { tableAreas, mergeCells, splitCell, insertRow, insertCol, deleteRow, deleteCol, type CellArea } from '../model/table';
import { Check, ColorInput, Field, FontSelect, NumberInput, Select, Seg, TextArea, TextInput } from './fields';
import { labelType, applyLabelType, DB_PRESETS, type ParamDef } from '../model/labelTypes';
import { sizesFor, TAPE_COLORS } from '../model/media';
import { SYMBOLOGIES, isTwoD } from '../render/barcode';
import { CUSTOM_SYMBOLS } from '../clipart/custom';
import { symbolName, symbolSvg } from '../clipart';
import { PLACEHOLDER_HELP } from '../model/placeholders';
import { gridWidth, designSize, printableRect, FRAME_STYLES } from '../model/defaults';
import { effectiveProfile } from '../printer/service';
import { computeLayout } from '../render/render';
import { previewContext } from '../model/pages';
import { TypeIcon } from './TypeIcon';

export function Inspector() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const sel = doc.elements.filter((e) => selection.includes(e.id));
  return (
    <aside className="right">
      <div className="scroll">
        {sel.length === 0 && <LabelPanel doc={doc} />}
        {sel.length === 1 && <ElementPanel el={sel[0]} key={sel[0].id} />}
        {sel.length > 1 && <MultiPanel els={sel} />}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ label

function LabelPanel({ doc }: { doc: LabelDoc }) {
  const update = useEditor((s) => s.update);
  const settings = useEditor((s) => s.settings);
  const profile = effectiveProfile(settings.profileId);
  const def = labelType(doc.labelType);
  const set = (patch: Partial<LabelDoc>, key?: string) => update((d) => ({ ...d, ...patch }), key);
  const reapply = (patch: Partial<LabelDoc>) => {
    // Media / orientation changes re-run the type generator so layouts fit the tape.
    update((d) => {
      const next = { ...d, ...patch };
      return def.generate ? useEditorApply(next) : next;
    });
  };
  const sizes = sizesFor(doc.media.kind).filter((t) => t.width <= profile.maxTape + 0.5);

  return (
    <>
      <div className="section">
        <div className="section-title">
          <TypeIcon name={def.icon} size={13} /> {def.name}
          <span className="spacer" />
          <button className="btn ghost sm" onClick={() => useEditor.getState().set({ wizardOpen: true })} title="Start a new label of another type">
            <Settings2 size={13} /> Change
          </button>
        </div>
        {def.params.length > 0 ? (
          <>
            <TypeParamsForm />
            <button
              className="btn sm ghost"
              title="Turn the generated layout into free elements you can edit individually"
              onClick={() => update((d) => ({ ...d, labelType: 'general', elements: d.elements.map((e) => ({ ...e, generated: false })) }))}
            >
              <Unlink size={13} /> Detach to free design
            </button>
          </>
        ) : (
          <div className="hint">Add text, symbols, barcodes and shapes from the left panel. Double-click text on the label to edit it.</div>
        )}
      </div>

      <div className="section">
        <div className="section-title">Tape</div>
        {profile.media.length > 1 && (
          <Field>
            <Seg<MediaKind>
              value={doc.media.kind}
              onChange={(kind) => reapply({ media: { ...doc.media, kind, width: sizesFor(kind)[Math.min(3, sizesFor(kind).length - 1)].width } })}
              options={profile.media.map((m) => ({ value: m, label: m === 'tze' ? 'TZe tape' : m === 'hse' ? 'Heat-shrink' : m === 'fle' ? 'FLe flag' : 'Fabric' }))}
            />
          </Field>
        )}
        <Field label="Width">
          <div className="chips">
            {sizes.map((t) => (
              <button key={t.width} className={`chip ${doc.media.width === t.width ? 'on' : ''}`} onClick={() => reapply({ media: { ...doc.media, width: t.width } })} title={t.label}>
                {t.width} mm
              </button>
            ))}
          </div>
        </Field>
        <Field label="Colour">
          <div className="swatches">
            {TAPE_COLORS.map((c) => (
              <button
                key={c.name}
                title={c.name}
                className={`swatch ${doc.media.tapeColor === c.tape && doc.media.inkColor === c.ink ? 'on' : ''}`}
                style={{ background: c.tape, color: c.ink }}
                onClick={() => set({ media: { ...doc.media, tapeColor: c.tape, inkColor: c.ink } })}
              >
                A
              </button>
            ))}
          </div>
        </Field>
        <div className="row">
          <Field label="Tape">
            <ColorInput value={doc.media.tapeColor} onChange={(v) => set({ media: { ...doc.media, tapeColor: v } }, 'tapeColor')} />
          </Field>
          <Field label="Ink">
            <ColorInput value={doc.media.inkColor} onChange={(v) => set({ media: { ...doc.media, inkColor: v } }, 'inkColor')} />
          </Field>
        </div>
      </div>

      <div className="section">
        <div className="section-title">Size &amp; layout</div>
        <Field label="Orientation">
          <Seg value={doc.orientation} onChange={(v) => reapply({ orientation: v })} options={[{ value: 'landscape', label: 'Horizontal' }, { value: 'portrait', label: 'Vertical' }]} />
        </Field>
        <Field label="Length">
          <div className="row">
            <Seg value={doc.lengthMode} onChange={(v) => set({ lengthMode: v, length: v === 'fixed' ? Math.round(computeLayout(doc, previewContext(doc, useEditor.getState().previewIndex, useEditor.getState().settings.dateFormat)).length) : doc.length })} options={[{ value: 'auto', label: 'Auto' }, { value: 'fixed', label: 'Fixed' }]} />
            {doc.lengthMode === 'fixed' && <NumberInput value={doc.length} onChange={(v) => set({ length: v }, 'length')} unit="mm" min={4} max={1000} step={1} />}
          </div>
        </Field>
        <div className="grid2">
          <Field label="Start margin">
            <NumberInput value={doc.marginStart} onChange={(v) => set({ marginStart: v }, 'mstart')} unit="mm" min={0} max={50} step={0.5} />
          </Field>
          <Field label="End margin">
            <NumberInput value={doc.marginEnd} onChange={(v) => set({ marginEnd: v }, 'mend')} unit="mm" min={0} max={50} step={0.5} />
          </Field>
        </div>
        <Field label="Frame">
          <Select
            value={doc.frame.style}
            onChange={(style) => set({ frame: { ...doc.frame, style } })}
            options={[{ value: 'none', label: 'None' }, ...FRAME_STYLES]}
          />
        </Field>
        {doc.frame.style !== 'none' && (
          <div className="grid2">
            <Field label="Inset">
              <NumberInput value={doc.frame.inset} onChange={(v) => set({ frame: { ...doc.frame, inset: v } }, 'finset')} unit="mm" min={0} max={10} step={0.1} />
            </Field>
            <Field label="Line">
              <NumberInput value={doc.frame.thickness} onChange={(v) => set({ frame: { ...doc.frame, thickness: v } }, 'fthick')} unit="mm" min={0.1} max={3} step={0.1} />
            </Field>
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-title">Cutting &amp; printing</div>
        <Field label="Cut">
          <Seg
            value={doc.print.cut}
            onChange={(cut) => set({ print: { ...doc.print, cut } })}
            options={[{ value: 'each', label: 'Each label' }, { value: 'end', label: 'At end' }, { value: 'none', label: 'Never' }]}
          />
        </Field>
        {doc.print.cut === 'each' && (
          <Field label="Cut after every">
            <NumberInput value={doc.print.cutEvery} onChange={(v) => set({ print: { ...doc.print, cutEvery: Math.round(v) } })} unit="labels" min={1} max={99} step={1} />
          </Field>
        )}
        {profile.halfCut && <Check checked={doc.print.halfCut} onChange={(v) => set({ print: { ...doc.print, halfCut: v } })} label="Half cut between labels (backing stays joined)" />}
        <Check checked={doc.print.chain} onChange={(v) => set({ print: { ...doc.print, chain: v } })} label="Chain print (save tape: last label is cut with the next job)" />
        {doc.print.cut === 'none' && <Check checked={doc.print.cutMarks} onChange={(v) => set({ print: { ...doc.print, cutMarks: v } })} label="Print cut marks" />}
        <Check checked={doc.print.mirror} onChange={(v) => set({ print: { ...doc.print, mirror: v } })} label="Mirror (for back-printing clear tape)" />
        <Check checked={doc.print.reverse} onChange={(v) => set({ print: { ...doc.print, reverse: v } })} label="Print records in reverse order" />
        <div className="grid2" style={{ marginTop: 8 }}>
          <Field label="Copies">
            <NumberInput value={doc.print.copies} onChange={(v) => set({ print: { ...doc.print, copies: Math.max(1, Math.round(v)) } })} min={1} max={999} step={1} />
          </Field>
          <Field label="Split every" hint={undefined}>
            <NumberInput value={doc.print.splitEvery} onChange={(v) => set({ print: { ...doc.print, splitEvery: v } }, 'split')} unit="mm" min={0} max={1000} step={1} title="Print one long design as several labels (0 = off)" />
          </Field>
        </div>
      </div>
    </>
  );
}

// Re-run the generator with current params (used after media changes).
function useEditorApply(d: LabelDoc): LabelDoc {
  return applyLabelType(d, d.labelType, d.typeParams);
}

export function TypeParamsForm() {
  const doc = useEditor((s) => s.doc);
  const setTypeParams = useEditor((s) => s.setTypeParams);
  const def = labelType(doc.labelType);
  const p = { ...def.defaults, ...doc.typeParams };
  return (
    <ParamsForm
      params={def.params}
      values={p}
      onChange={(key, v) => {
        const next = { ...p, [key]: v };
        if (key === 'preset' && typeof v === 'string' && DB_PRESETS[v]) {
          next.circuits = DB_PRESETS[v].circuits;
          next.pitch = DB_PRESETS[v].pitch;
        }
        if (key === 'circuits') next.preset = '';
        setTypeParams(next);
      }}
    />
  );
}

export function ParamsForm({ params, values, onChange }: { params: ParamDef[]; values: Record<string, unknown>; onChange: (key: string, v: unknown) => void }) {
  return (
    <>
      {params
        .filter((d) => !d.when || d.when(values))
        .map((d) => {
          const v = values[d.key];
          if (d.type === 'checkbox') return <Check key={d.key} checked={!!v} onChange={(x) => onChange(d.key, x)} label={d.label} />;
          return (
            <Field key={d.key} label={d.label} hint={d.help}>
              {d.type === 'text' && <TextInput value={String(v ?? '')} placeholder={d.placeholder} onChange={(x) => onChange(d.key, x)} />}
              {d.type === 'textarea' && <TextArea value={String(v ?? '')} placeholder={d.placeholder} rows={d.key === 'circuits' ? 8 : 3} onChange={(x) => onChange(d.key, x)} />}
              {d.type === 'number' && <NumberInput value={Number(v ?? 0)} unit={d.unit} min={d.min} max={d.max} step={d.step ?? 1} onChange={(x) => onChange(d.key, x)} />}
              {d.type === 'select' && <Select value={String(v ?? '')} options={d.options ?? []} onChange={(x) => onChange(d.key, x)} />}
              {d.type === 'font' && <FontSelect value={String(v ?? 'Inter')} onChange={(x) => onChange(d.key, x)} />}
              {d.type === 'symbol' && <SymbolChooser value={String(v ?? '')} onChange={(x) => onChange(d.key, x)} />}
            </Field>
          );
        })}
    </>
  );
}

export function svgUrl(key: string, color = '#000') {
  const svg = symbolSvg(key);
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/currentColor/g, color))}` : '';
}

function SymbolChooser({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="btn block" style={{ justifyContent: 'flex-start' }} onClick={() => setOpen(!open)}>
        {value && <img src={svgUrl(value, 'currentColor')} style={{ width: 18, height: 18, filter: 'var(--icon-filter)' }} alt="" />}
        {symbolName(value)}
      </button>
      {open && (
        <div className="icon-grid" style={{ marginTop: 6 }}>
          {CUSTOM_SYMBOLS.map((s) => (
            <button key={s.id} className={`icon-cell ${value === `custom:${s.id}` ? 'on' : ''}`} title={s.name} onClick={() => { onChange(`custom:${s.id}`); setOpen(false); }}>
              <img src={svgUrl(`custom:${s.id}`)} alt={s.name} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ elements

const TYPE_NAMES: Record<LabelElement['type'], string> = { text: 'Text', shape: 'Shape', symbol: 'Symbol', image: 'Image', barcode: 'Barcode', grid: 'Grid / blocks', table: 'Table' };

function ElementPanel({ el }: { el: LabelElement }) {
  const updateElement = useEditor((s) => s.updateElement);
  const st = useEditor.getState;
  const up = (patch: Partial<LabelElement>, key?: string) => updateElement(el.id, patch, key);
  return (
    <>
      <div className="section">
        <div className="section-title">
          {TYPE_NAMES[el.type]}
          {el.generated && <span className="chip" style={{ padding: '0 6px', fontSize: 10 }} title="Part of the label type layout; regenerated when the label settings change">auto</span>}
          <span className="spacer" />
          <button className="btn ghost icon sm" title={el.hidden ? 'Show' : 'Hide'} onClick={() => up({ hidden: !el.hidden })}>
            {el.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button className="btn ghost icon sm" title={el.locked ? 'Unlock' : 'Lock'} onClick={() => up({ locked: !el.locked })}>
            {el.locked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
          <button className="btn ghost icon sm" title="Duplicate (Ctrl D)" onClick={() => st().duplicateSelection()}>
            <Copy size={14} />
          </button>
          <button className="btn ghost icon sm danger" title="Delete (Del)" onClick={() => st().deleteSelection()}>
            <Trash2 size={14} />
          </button>
        </div>
        {el.type === 'text' && <TextProps el={el} up={up} />}
        {el.type === 'shape' && <ShapeProps el={el} up={up} />}
        {el.type === 'symbol' && <SymbolProps el={el} up={up} />}
        {el.type === 'image' && <ImageProps el={el} up={up} />}
        {el.type === 'barcode' && <BarcodeProps el={el} up={up} />}
        {el.type === 'grid' && <GridProps el={el} up={up} />}
        {el.type === 'table' && <TableProps el={el} up={up} />}
      </div>
      <GeometrySection el={el} up={up} />
      <ArrangeSection />
    </>
  );
}

type Up<T> = (patch: Partial<T>, key?: string) => void;

function PlaceholderChips({ onInsert }: { onInsert: (t: string) => void }) {
  const data = useEditor((s) => s.doc.data);
  return (
    <div className="chips" style={{ marginTop: 6 }}>
      {PLACEHOLDER_HELP.map((p) => (
        <button key={p.token} className="chip" title={p.token} onClick={() => onInsert(p.token)}>
          {p.desc}
        </button>
      ))}
      {data?.columns.map((c) => (
        <button key={c} className="chip" title={`{{${c}}}`} onClick={() => onInsert(`{{${c}}}`)}>
          {c}
        </button>
      ))}
    </div>
  );
}

function TextStyleControls({ el, up }: { el: TextElement | GridElement | TableElement; up: (patch: Partial<TextElement> & Partial<GridElement>, key?: string) => void }) {
  return (
    <>
      <Field label="Font">
        <FontSelect value={el.font} onChange={(font) => up({ font })} />
      </Field>
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="seg" style={{ flex: '0 0 auto' }}>
          <button className={el.bold ? 'on' : ''} title="Bold (Ctrl B)" onClick={() => up({ bold: !el.bold })}><Bold size={14} /></button>
          <button className={el.italic ? 'on' : ''} title="Italic (Ctrl I)" onClick={() => up({ italic: !el.italic })}><Italic size={14} /></button>
          <button className={el.underline ? 'on' : ''} title="Underline (Ctrl U)" onClick={() => up({ underline: !el.underline })}><Underline size={14} /></button>
          <button className={el.strike ? 'on' : ''} title="Strikethrough" onClick={() => up({ strike: !el.strike })}><Strikethrough size={14} /></button>
        </div>
        <Seg value={el.align} onChange={(align) => up({ align })} options={[
          { value: 'left', label: <AlignLeft size={14} />, title: 'Align left' },
          { value: 'center', label: <AlignCenter size={14} />, title: 'Centre' },
          { value: 'right', label: <AlignRight size={14} />, title: 'Align right' },
        ]} />
      </div>
      <div className="grid2">
        <Field label={<>Size <Check checked={el.autoSize} onChange={(autoSize) => up({ autoSize })} label="Auto" /></>}>
          {!el.autoSize ? <NumberInput value={el.size} onChange={(size) => up({ size }, 'size')} unit="pt" min={2} max={300} step={0.5} /> : <div className="hint" style={{ paddingTop: 6 }}>Fits the box</div>}
          {!el.autoSize && el.type !== 'grid' && (
            <Check checked={!!el.shrink} onChange={(shrink) => up({ shrink } as never)} label="Shrink to fit" />
          )}
        </Field>
        <Field label="Line height">
          <NumberInput value={el.lineHeight} onChange={(lineHeight) => up({ lineHeight }, 'lh')} min={0.6} max={3} step={0.05} />
        </Field>
      </div>
      <Field label="Letter spacing">
        <NumberInput value={el.letterSpacing} onChange={(letterSpacing) => up({ letterSpacing }, 'ls')} unit="mm" min={-2} max={10} step={0.1} />
      </Field>
    </>
  );
}

function TextProps({ el, up }: { el: TextElement; up: Up<TextElement> }) {
  return (
    <>
      <Field label="Text">
        <TextArea value={el.text} onChange={(text) => up({ text }, 'text')} rows={Math.min(6, Math.max(2, el.text.split('\n').length + 1))} />
        <PlaceholderChips onInsert={(t) => up({ text: el.text ? `${el.text} ${t}` : t })} />
      </Field>
      <TextStyleControls el={el} up={up as never} />
      <Field label="Vertical alignment">
        <Seg value={el.vAlign} onChange={(vAlign) => up({ vAlign })} options={[
          { value: 'top', label: <AlignStartHorizontal size={14} /> },
          { value: 'middle', label: <AlignCenterHorizontal size={14} /> },
          { value: 'bottom', label: <AlignEndHorizontal size={14} /> },
        ]} />
      </Field>
      <Check checked={el.autoWidth} onChange={(autoWidth) => up({ autoWidth })} label="Width follows text" />
      <Check checked={el.invert} onChange={(invert) => up({ invert })} label="Inverted (white on black)" />
      <Check checked={!!el.outline} onChange={(outline) => up({ outline })} label="Outline letters (hollow, for text on a black area)" />
      <Check checked={!!el.stacked} onChange={(stacked) => up({ stacked })} label="Stacked vertical letters" />
      <div className="grid2" style={{ marginTop: 8 }}>
        <Field label="Frame">
          <Select value={el.frame ?? 'none'} onChange={(frame) => up({ frame })} options={[{ value: 'none', label: 'None' }, { value: 'rect', label: 'Box' }, { value: 'round', label: 'Rounded' }]} />
        </Field>
        {(el.invert || (el.frame && el.frame !== 'none')) && (
          <Field label="Padding">
            <NumberInput value={el.framePadding ?? 0.6} onChange={(framePadding) => up({ framePadding }, 'pad')} unit="mm" min={0} max={10} step={0.1} />
          </Field>
        )}
      </div>
    </>
  );
}

function ShapeProps({ el, up }: { el: ShapeElement; up: Up<ShapeElement> }) {
  return (
    <>
      <Field label="Shape">
        <Select value={el.shape} onChange={(shape) => up({ shape })} options={[
          { value: 'rect', label: 'Rectangle' }, { value: 'roundrect', label: 'Rounded rectangle' }, { value: 'ellipse', label: 'Ellipse' },
          { value: 'line', label: 'Line' }, { value: 'triangle', label: 'Triangle' }, { value: 'diamond', label: 'Diamond' }, { value: 'arrow', label: 'Arrow' },
          { value: 'frame', label: 'Frame' },
        ]} />
      </Field>
      {el.shape === 'frame' && (
        <Field label="Frame style">
          <Select value={el.frameStyle ?? 'rect'} onChange={(frameStyle) => up({ frameStyle })} options={FRAME_STYLES} />
        </Field>
      )}
      <div className="grid2">
        <Field label="Line width">
          <NumberInput value={el.strokeWidth} onChange={(strokeWidth) => up({ strokeWidth }, 'sw')} unit="mm" min={0.1} max={10} step={0.1} />
        </Field>
        {el.shape === 'roundrect' && (
          <Field label="Radius">
            <NumberInput value={el.radius} onChange={(radius) => up({ radius }, 'radius')} unit="mm" min={0} max={50} step={0.25} />
          </Field>
        )}
      </div>
      {el.shape !== 'frame' && (
        <Field label="Line style">
          <Seg value={el.dash} onChange={(dash) => up({ dash })} options={[{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }]} />
        </Field>
      )}
      {el.shape !== 'line' && el.shape !== 'frame' && (
        <>
          <Check checked={el.fill} onChange={(fill) => up({ fill })} label="Filled" />
          <Check checked={el.stroke} onChange={(stroke) => up({ stroke })} label="Outline" />
        </>
      )}
    </>
  );
}

function SymbolProps({ el, up }: { el: SymbolElement; up: Up<SymbolElement> }) {
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <img src={svgUrl(el.symbol)} alt="" style={{ width: 40, height: 40, flex: '0 0 40px', background: '#fff', borderRadius: 6, padding: 4 }} />
        <div>
          <div style={{ fontWeight: 600 }}>{symbolName(el.symbol)}</div>
          <button className="btn sm ghost" style={{ paddingLeft: 0 }} onClick={() => useEditor.getState().set({ leftTab: 'clipart' })}>
            Replace from clip art…
          </button>
        </div>
      </div>
      {el.symbol.startsWith('lucide:') && (
        <Field label="Line weight">
          <NumberInput value={el.strokeWidth ?? 2} onChange={(strokeWidth) => up({ strokeWidth }, 'sw')} min={0.5} max={4} step={0.25} />
        </Field>
      )}
      <Check checked={el.invert} onChange={(invert) => up({ invert })} label="Inverted (white on black)" />
      <Check checked={el.keepAspect} onChange={(keepAspect) => up({ keepAspect })} label="Keep proportions" />
    </>
  );
}

function ImageProps({ el, up }: { el: ImageElement; up: Up<ImageElement> }) {
  return (
    <>
      <Field label="Black & white conversion">
        <Select value={el.dither} onChange={(dither) => up({ dither })} options={[
          { value: 'threshold', label: 'Threshold (logos, line art)' }, { value: 'floyd', label: 'Dither: Floyd–Steinberg (photos)' },
          { value: 'atkinson', label: 'Dither: Atkinson (crisp photos)' }, { value: 'ordered', label: 'Dither: ordered pattern' },
        ]} />
      </Field>
      <Field label={`Threshold / brightness: ${el.threshold}`}>
        <input type="range" min={10} max={245} value={el.threshold} onChange={(e) => up({ threshold: Number(e.target.value) }, 'thr')} />
      </Field>
      <Check checked={el.invert} onChange={(invert) => up({ invert })} label="Invert" />
      <Check checked={el.keepAspect} onChange={(keepAspect) => up({ keepAspect })} label="Keep proportions" />
    </>
  );
}

function BarcodeProps({ el, up }: { el: BarcodeElement; up: Up<BarcodeElement> }) {
  return (
    <>
      <Field label="Type">
        <Select value={el.symbology} onChange={(symbology) => up({ symbology, showText: isTwoD(symbology) ? false : el.showText })} options={SYMBOLOGIES.map((s) => ({ value: s.id, label: s.name }))} />
      </Field>
      <Field label="Data">
        <TextInput value={el.data} mono onChange={(data) => up({ data }, 'data')} />
        <PlaceholderChips onInsert={(t) => up({ data: el.data + t })} />
      </Field>
      {el.symbology === 'qrcode' && (
        <Field label="Error correction">
          <Seg value={el.eclevel ?? 'M'} onChange={(eclevel) => up({ eclevel })} options={[{ value: 'L', label: 'L 7%' }, { value: 'M', label: 'M 15%' }, { value: 'Q', label: 'Q 25%' }, { value: 'H', label: 'H 30%' }]} />
        </Field>
      )}
      {!isTwoD(el.symbology) && (
        <>
          <Check checked={el.showText} onChange={(showText) => up({ showText })} label="Show human-readable text" />
          {el.showText && (
            <div className="grid2">
              <Field label="Text size">
                <NumberInput value={el.textSize} onChange={(textSize) => up({ textSize }, 'ts')} unit="pt" min={3} max={30} step={0.5} />
              </Field>
              <Field label="Font">
                <FontSelect value={el.font} onChange={(font) => up({ font })} />
              </Field>
            </div>
          )}
        </>
      )}
      <div className="hint">Modules snap to whole printer dots so codes scan reliably. Keep QR codes at least 8–10 mm square.</div>
    </>
  );
}

function GridProps({ el, up }: { el: GridElement; up: Up<GridElement> }) {
  const setCells = (cells: GridElement['cells']) => up({ cells, w: gridWidth({ cells, pitch: el.pitch }) }, 'cells');
  return (
    <>
      <Field label={`Blocks (${el.cells.reduce((s, c) => s + Math.max(1, c.span), 0)} modules)`}>
        <div className="cells-editor">
          {el.cells.map((c, i) => (
            <div className="cell-row" key={i}>
              <span className="idx">{i + 1}</span>
              <TextInput value={c.text.replace(/\n/g, '\\n')} onChange={(t) => setCells(el.cells.map((x, j) => (j === i ? { ...x, text: t.replace(/\\n/g, '\n') } : x)))} />
              <NumberInput value={c.span} onChange={(span) => setCells(el.cells.map((x, j) => (j === i ? { ...x, span: Math.max(1, Math.round(span)) } : x)))} min={1} max={24} step={1} unit="×" title="Width in modules" />
              <button className="btn ghost icon sm" title="Remove" onClick={() => setCells(el.cells.filter((_, j) => j !== i))}>
                <X size={13} />
              </button>
            </div>
          ))}
          <button className="btn sm" onClick={() => setCells([...el.cells, { span: 1, text: '' }])}>
            <Plus size={13} /> Add block
          </button>
        </div>
      </Field>
      <div className="grid2">
        <Field label="Module width">
          <NumberInput value={el.pitch} onChange={(pitch) => up({ pitch, w: gridWidth({ cells: el.cells, pitch }) }, 'pitch')} unit="mm" min={2} max={200} step={0.1} />
        </Field>
        <Field label="Heavy divider every">
          <NumberInput value={el.groupEvery} onChange={(groupEvery) => up({ groupEvery: Math.round(groupEvery) })} min={0} max={48} step={1} />
        </Field>
      </div>
      <Field label="Text direction">
        <Select value={el.textDir} onChange={(textDir) => up({ textDir })} options={[{ value: 'horizontal', label: 'Horizontal' }, { value: 'up', label: 'Vertical (bottom to top)' }, { value: 'down', label: 'Vertical (top to bottom)' }]} />
      </Field>
      <Field label="Text position">
        <Seg value={el.textPos} onChange={(textPos) => up({ textPos })} options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} />
      </Field>
      <TextStyleControls el={el} up={up as never} />
      <Field label="Numbering">
        <Seg value={el.numbers} onChange={(numbers) => up({ numbers })} options={[{ value: 'none', label: 'None' }, { value: 'top', label: 'Above' }, { value: 'bottom', label: 'Below' }]} />
      </Field>
      {el.numbers !== 'none' && (
        <div className="grid3">
          <Field label="Start">
            <NumberInput value={el.numberStart} onChange={(numberStart) => up({ numberStart })} step={1} />
          </Field>
          <Field label="Step">
            <NumberInput value={el.numberStep} onChange={(numberStep) => up({ numberStep })} step={1} />
          </Field>
          <Field label="Size">
            <NumberInput value={el.numberSize} onChange={(numberSize) => up({ numberSize }, 'ns')} unit="pt" min={3} max={30} step={0.5} />
          </Field>
        </div>
      )}
      {el.numbers !== 'none' && <Check checked={el.numberInvert} onChange={(numberInvert) => up({ numberInvert })} label="White-on-black numbers" />}
      <Field label="Dividers">
        <Seg value={el.separator} onChange={(separator) => up({ separator })} options={[{ value: 'line', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }, { value: 'none', label: 'None' }]} />
      </Field>
      <Check checked={el.border} onChange={(border) => up({ border })} label="Outer border" />
      <div className="hint">Tip: double-click a block on the label to edit its text.</div>
    </>
  );
}

function GeometrySection({ el, up }: { el: LabelElement; up: Up<LabelElement> }) {
  return (
    <div className="section">
      <div className="section-title">Position &amp; size</div>
      <div className="grid2">
        <NumberInput prefix="X" value={el.x} onChange={(x) => up({ x }, 'x')} unit="mm" step={0.1} />
        <NumberInput prefix="Y" value={el.y} onChange={(y) => up({ y }, 'y')} unit="mm" step={0.1} />
        <NumberInput prefix="W" value={el.w} onChange={(w) => up(el.type === 'text' ? ({ w, autoWidth: false } as Partial<TextElement>) : { w }, 'w')} unit="mm" min={0.5} step={0.1} />
        <NumberInput prefix="H" value={el.h} onChange={(h) => up({ h }, 'h')} unit="mm" min={0} step={0.1} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <NumberInput prefix="↻" value={el.rotation} onChange={(rotation) => up({ rotation: ((rotation % 360) + 360) % 360 }, 'rot')} unit="°" step={1} />
        <div className="row tight" style={{ flex: '0 0 auto' }}>
          <button className="btn icon sm" title="Rotate left 90°" onClick={() => up({ rotation: (el.rotation + 270) % 360 })}>
            <RotateCcw size={14} />
          </button>
          <button className="btn icon sm" title="Rotate right 90°" onClick={() => up({ rotation: (el.rotation + 90) % 360 })}>
            <RotateCw size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function alignTo(kind: 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom', ids: string[]) {
  const s = useEditor.getState();
  const doc = s.doc;
  const pctx = previewContext(doc, s.previewIndex, s.settings.dateFormat);
  const layout = computeLayout(doc, pctx);
  const profile = effectiveProfile(s.settings.profileId);
  const pr = printableRect(doc, layout.length, profile.dpi, profile.headPins);
  const [W] = designSize(doc, layout.length);
  const els = doc.elements.filter((e) => ids.includes(e.id));
  // Several elements align to their common bounds; one aligns to the label.
  const boxes = els.map((e) => layout.boxes.get(e.id) ?? e);
  const multi = els.length > 1;
  const minX = multi ? Math.min(...boxes.map((b) => b.x)) : doc.orientation === 'portrait' ? pr.x : doc.marginStart;
  const maxX = multi ? Math.max(...boxes.map((b) => b.x + b.w)) : doc.orientation === 'portrait' ? pr.x + pr.w : W - doc.marginEnd;
  const minY = multi ? Math.min(...boxes.map((b) => b.y)) : pr.y;
  const maxY = multi ? Math.max(...boxes.map((b) => b.y + b.h)) : pr.y + pr.h;
  s.update((d) => ({
    ...d,
    elements: d.elements.map((e) => {
      const i = els.findIndex((x) => x.id === e.id);
      if (i < 0 || e.locked) return e;
      const b = boxes[i];
      switch (kind) {
        case 'left': return { ...e, x: minX };
        case 'hcenter': return { ...e, x: (minX + maxX) / 2 - b.w / 2 };
        case 'right': return { ...e, x: maxX - b.w };
        case 'top': return { ...e, y: minY };
        case 'vmiddle': return { ...e, y: (minY + maxY) / 2 - b.h / 2 };
        case 'bottom': return { ...e, y: maxY - b.h };
      }
      return e;
    }),
  }));
}

function distribute(ids: string[]) {
  const s = useEditor.getState();
  const layout = computeLayout(s.doc, previewContext(s.doc, s.previewIndex, s.settings.dateFormat));
  const els = s.doc.elements.filter((e) => ids.includes(e.id)).map((e) => ({ e, b: layout.boxes.get(e.id) ?? e })).sort((a, b) => a.b.x - b.b.x);
  if (els.length < 3) return;
  const total = els.reduce((sum, x) => sum + x.b.w, 0);
  const span = els[els.length - 1].b.x + els[els.length - 1].b.w - els[0].b.x;
  const gap = (span - total) / (els.length - 1);
  let x = els[0].b.x;
  const pos = new Map<string, number>();
  for (const it of els) {
    pos.set(it.e.id, x);
    x += it.b.w + gap;
  }
  s.update((d) => ({ ...d, elements: d.elements.map((e) => (pos.has(e.id) ? { ...e, x: pos.get(e.id)! } : e)) }));
}

function ArrangeSection() {
  const selection = useEditor((s) => s.selection);
  const reorder = useEditor((s) => s.reorder);
  const many = selection.length > 1;
  return (
    <div className="section">
      <div className="section-title">{many ? 'Align selection' : 'Align on label'}</div>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="seg">
          <button title="Left" onClick={() => alignTo('left', selection)}><AlignStartVertical size={14} /></button>
          <button title="Centre" onClick={() => alignTo('hcenter', selection)}><AlignCenterVertical size={14} /></button>
          <button title="Right" onClick={() => alignTo('right', selection)}><AlignEndVertical size={14} /></button>
        </div>
        <div className="seg">
          <button title="Top" onClick={() => alignTo('top', selection)}><AlignStartHorizontal size={14} /></button>
          <button title="Middle" onClick={() => alignTo('vmiddle', selection)}><AlignCenterHorizontal size={14} /></button>
          <button title="Bottom" onClick={() => alignTo('bottom', selection)}><AlignEndHorizontal size={14} /></button>
        </div>
      </div>
      {selection.length > 2 && (
        <button className="btn sm block" style={{ marginBottom: 8 }} onClick={() => distribute(selection)}>
          Distribute horizontally
        </button>
      )}
      <div className="section-title" style={{ marginTop: 6 }}>Order</div>
      <div className="seg">
        <button title="Bring to front" onClick={() => reorder('front')}><ArrowUpToLine size={14} /></button>
        <button title="Bring forward" onClick={() => reorder('forward')}><ArrowUpFromLine size={14} /></button>
        <button title="Send backward" onClick={() => reorder('backward')}><ArrowDownFromLine size={14} /></button>
        <button title="Send to back" onClick={() => reorder('back')}><ArrowDownToLine size={14} /></button>
      </div>
    </div>
  );
}

function MultiPanel({ els }: { els: LabelElement[] }) {
  const st = useEditor.getState;
  const texts = els.filter((e) => e.type === 'text') as TextElement[];
  const font = useMemo(() => (texts.length ? texts[0].font : 'Inter'), [texts]);
  return (
    <>
      <div className="section">
        <div className="section-title">
          {els.length} elements
          <span className="spacer" />
          <button className="btn ghost icon sm" title="Duplicate" onClick={() => st().duplicateSelection()}>
            <Copy size={14} />
          </button>
          <button className="btn ghost icon sm danger" title="Delete" onClick={() => st().deleteSelection()}>
            <Trash2 size={14} />
          </button>
        </div>
        {texts.length > 0 && (
          <>
            <Field label="Font (all text)">
              <FontSelect value={font} onChange={(f) => st().updateElements(texts.map((t) => t.id), (e) => ({ ...e, font: f }) as LabelElement)} />
            </Field>
            <div className="row">
              <button className="btn sm" onClick={() => st().updateElements(texts.map((t) => t.id), (e) => ({ ...e, bold: !(e as TextElement).bold }) as LabelElement)}>
                <Bold size={13} /> Toggle bold
              </button>
              <button className="btn sm" onClick={() => st().updateElements(texts.map((t) => t.id), (e) => ({ ...e, invert: !(e as TextElement).invert }) as LabelElement)}>
                Toggle invert
              </button>
            </div>
          </>
        )}
      </div>
      <ArrangeSection />
    </>
  );
}

// ------------------------------------------------------------------ table

const LINE_OPTIONS: { value: LineStyle; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'none', label: 'None' },
];

function TableProps({ el, up }: { el: TableElement; up: Up<TableElement> }) {
  const R = el.rows.length;
  const C = el.cols.length;
  // Selected block of grid positions; shift-click extends it from the anchor.
  const [anchor, setAnchor] = useState({ r: 0, c: 0 });
  const [sel, setSel] = useState<CellArea>({ r: 0, c: 0, rs: 1, cs: 1 });
  const clamp = (a: CellArea): CellArea => {
    const r = Math.min(a.r, R - 1);
    const c = Math.min(a.c, C - 1);
    return { r, c, rs: Math.max(1, Math.min(a.rs, R - r)), cs: Math.max(1, Math.min(a.cs, C - c)) };
  };
  const cur = clamp(sel);
  const areas = tableAreas(el);
  const inSel = (a: CellArea) => a.r < cur.r + cur.rs && a.r + a.rs > cur.r && a.c < cur.c + cur.cs && a.c + a.cs > cur.c;
  const picked = areas.filter(inSel);
  const single = picked.length === 1 ? picked[0] : null;
  const first = el.cells[cur.r]?.[cur.c];

  const pick = (a: CellArea, extend: boolean) => {
    if (!extend) {
      setAnchor({ r: a.r, c: a.c });
      setSel(a);
      return;
    }
    const r0 = Math.min(anchor.r, a.r);
    const c0 = Math.min(anchor.c, a.c);
    setSel({ r: r0, c: c0, rs: Math.max(anchor.r, a.r + a.rs - 1) - r0 + 1, cs: Math.max(anchor.c, a.c + a.cs - 1) - c0 + 1 });
  };
  /** Apply a change to every selected cell. */
  const setCells = (patch: Partial<TableElement['cells'][number][number]>, key?: string) =>
    up({ cells: el.cells.map((row, i) => row.map((cell, j) => (picked.some((a) => a.r === i && a.c === j) ? { ...cell, ...patch } : cell))) }, key);
  const structure = (patch: Partial<TableElement>, next?: CellArea) => {
    up(patch);
    if (next) setSel(next);
  };

  return (
    <>
      <Field label={`Cells (${R} × ${C}) · shift-click to select several`}>
        <div className="table-picker" style={{ gridTemplateColumns: el.cols.map((w) => `${w}fr`).join(' '), gridTemplateRows: `repeat(${R}, minmax(26px, auto))` }}>
          {areas.map((a) => {
            const cell = el.cells[a.r]?.[a.c];
            return (
              <button
                key={`${a.r}-${a.c}`}
                className={`table-pick ${inSel(a) ? 'on' : ''} fill-${cell?.fill ?? 'none'}`}
                style={{ gridRow: `${a.r + 1} / span ${a.rs}`, gridColumn: `${a.c + 1} / span ${a.cs}`, fontWeight: cell?.bold ?? el.bold ? 700 : 400 }}
                onClick={(e) => pick(a, e.shiftKey)}
                title={cell?.text || 'Empty cell'}
              >
                {cell?.text.split('\n')[0] || '\u00a0'}
              </button>
            );
          })}
        </div>
      </Field>

      {single && first && (
        <Field label="Cell text">
          <TextArea value={first.text} onChange={(text) => setCells({ text }, `cell:${cur.r}:${cur.c}`)} rows={2} />
          <PlaceholderChips onInsert={(t) => setCells({ text: first.text ? `${first.text} ${t}` : t })} />
        </Field>
      )}
      <Field label={single ? 'Cell fill' : `Fill (${picked.length} cells)`}>
        <Seg<CellFill> value={first?.fill ?? 'none'} onChange={(fill) => setCells({ fill })} options={[
          { value: 'none', label: 'None' }, { value: 'black', label: 'Black' }, { value: 'hatch', label: 'Hatch' }, { value: 'dots', label: 'Dots' },
        ]} />
      </Field>
      <div className="row" style={{ marginBottom: 10 }}>
        <Seg value={first?.align ?? el.align} onChange={(align) => setCells({ align })} options={[
          { value: 'left', label: <AlignLeft size={14} />, title: 'Align left' },
          { value: 'center', label: <AlignCenter size={14} />, title: 'Centre' },
          { value: 'right', label: <AlignRight size={14} />, title: 'Align right' },
        ]} />
        <div className="seg" style={{ flex: '0 0 auto' }}>
          <button className={first?.bold ?? el.bold ? 'on' : ''} title="Bold" onClick={() => setCells({ bold: !(first?.bold ?? el.bold) })}><Bold size={14} /></button>
        </div>
      </div>
      <div className="row tight" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <button className="btn sm" disabled={picked.length < 2} onClick={() => structure(mergeCells(el, cur))}>Merge cells</button>
        <button className="btn sm" disabled={!single || (single.rs === 1 && single.cs === 1)} onClick={() => single && structure(splitCell(el, single.r, single.c), { ...single, rs: 1, cs: 1 })}>Split</button>
      </div>
      <div className="grid2" style={{ marginBottom: 10 }}>
        <button className="btn sm" onClick={() => structure(insertRow(el, cur.r))}><Plus size={13} /> Row above</button>
        <button className="btn sm" onClick={() => structure(insertRow(el, cur.r + cur.rs), { ...cur, r: cur.r + cur.rs, rs: 1 })}><Plus size={13} /> Row below</button>
        <button className="btn sm" onClick={() => structure(insertCol(el, cur.c))}><Plus size={13} /> Column left</button>
        <button className="btn sm" onClick={() => structure(insertCol(el, cur.c + cur.cs), { ...cur, c: cur.c + cur.cs, cs: 1 })}><Plus size={13} /> Column right</button>
        <button className="btn sm danger" disabled={R <= 1} onClick={() => structure(deleteRow(el, cur.r), { ...cur, rs: 1 })}><X size={13} /> Delete row</button>
        <button className="btn sm danger" disabled={C <= 1} onClick={() => structure(deleteCol(el, cur.c), { ...cur, cs: 1 })}><X size={13} /> Delete column</button>
      </div>

      <Field label="Column widths (relative)">
        <div className="grid3">
          {el.cols.map((w, i) => (
            <NumberInput key={i} value={w} onChange={(v) => up({ cols: el.cols.map((x, j) => (j === i ? Math.max(0.1, v) : x)) }, `col${i}`)} min={0.1} max={20} step={0.1} />
          ))}
        </div>
      </Field>
      <Field label="Row heights (relative)">
        <div className="grid3">
          {el.rows.map((h, i) => (
            <NumberInput key={i} value={h} onChange={(v) => up({ rows: el.rows.map((x, j) => (j === i ? Math.max(0.1, v) : x)) }, `row${i}`)} min={0.1} max={20} step={0.1} />
          ))}
        </div>
      </Field>

      <Field label="Outer border">
        <Seg value={el.border} onChange={(border) => up({ border })} options={LINE_OPTIONS} />
      </Field>
      <Field label="Lines between cells">
        <Seg value={el.inner} onChange={(inner) => up({ inner })} options={LINE_OPTIONS} />
      </Field>
      <div className="grid2">
        <Field label="Border width">
          <NumberInput value={el.borderWidth} onChange={(borderWidth) => up({ borderWidth }, 'bw')} unit="mm" min={0.1} max={3} step={0.05} />
        </Field>
        <Field label="Line width">
          <NumberInput value={el.innerWidth} onChange={(innerWidth) => up({ innerWidth }, 'iw')} unit="mm" min={0.1} max={3} step={0.05} />
        </Field>
      </div>

      <TextStyleControls el={el} up={up as never} />
      <div className="grid2">
        <Field label="Cell padding">
          <NumberInput value={el.padding} onChange={(padding) => up({ padding }, 'pad')} unit="mm" min={0} max={5} step={0.1} />
        </Field>
        <Field label="Vertical">
          <Seg value={el.vAlign} onChange={(vAlign) => up({ vAlign })} options={[
            { value: 'top', label: <AlignStartHorizontal size={14} /> },
            { value: 'middle', label: <AlignCenterHorizontal size={14} /> },
            { value: 'bottom', label: <AlignEndHorizontal size={14} /> },
          ]} />
        </Field>
      </div>
      <div className="hint">Tip: double-click a cell on the label to edit its text.</div>
    </>
  );
}
