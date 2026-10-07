import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Printer, Download, Bluetooth } from 'lucide-react';
import { useEditor } from '../state/store';
import { prepareJob, runJob, usePrinter, effectiveProfile, type PreparedJob } from '../printer/service';
import { enumeratePages } from '../model/pages';
import { concat } from '../printer/protocol';
import { download } from '../io/files';
import { Check, Field, NumberInput, Seg } from './fields';
import { findTape } from '../model/media';

export function PrintDialog() {
  const open = useEditor((s) => s.printOpen);
  const doc = useEditor((s) => s.doc);
  const settings = useEditor((s) => s.settings);
  const st = useEditor.getState;
  const { transport, busy, progress, status } = usePrinter();
  const [job, setJob] = useState<PreparedJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const profile = effectiveProfile(settings.profileId);
  const pageCount = useMemo(() => enumeratePages(doc).length, [doc]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(null);
    prepareJob(doc, profile, settings.minimalProtocol, settings.dateFormat, range ?? undefined)
      .then((j) => alive && setJob(j))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [open, doc, profile, settings.minimalProtocol, settings.dateFormat, range]);

  // Draw the exact bitmaps that will be sent, on the full width of the tape.
  useEffect(() => {
    const host = stripRef.current;
    if (!host || !job) return;
    const hex = (h: string) => {
      const m = /^#?(..)(..)(..)/.exec(h)!;
      return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
    };
    const ink = hex(doc.media.inkColor);
    const tape = hex(doc.media.tapeColor);
    // Edges the head can't reach: the tape colour, shaded like the editor.
    const edge = tape.map((v) => Math.round(v * 0.82 + 140 * 0.18));
    const lost = [240, 82, 82];
    const nodes = job.bitmaps.slice(0, 30).map((b) => {
      const m = b.margin;
      const rows = m * 2 + b.height;
      const c = document.createElement('canvas');
      c.width = b.width;
      c.height = rows;
      const cx = c.getContext('2d')!;
      const img = cx.createImageData(b.width, rows);
      for (let r = 0; r < rows; r++) {
        const inBand = r >= m && r < m + b.height;
        for (let col = 0; col < b.width; col++) {
          const on = inBand ? b.bits[(r - m) * b.width + col] : b.spill?.[(r < m ? r : r - b.height) * b.width + col];
          img.data.set([...(on ? (inBand ? ink : lost) : inBand ? tape : edge), 255], (r * b.width + col) * 4);
        }
      }
      cx.putImageData(img, 0, 0);
      c.style.width = `${b.width * 1.4}px`;
      c.style.maxWidth = '100%';
      c.style.height = 'auto';
      c.title = `${(b.width / (profile.dpi / 25.4)).toFixed(1)} mm`;
      return c;
    });
    host.replaceChildren(...nodes);
  }, [job, doc.media, profile.dpi]);

  if (!open) return null;
  const close = () => !busy && st().set({ printOpen: false });
  const p = doc.print;
  const setPrint = (patch: Partial<typeof p>) => st().update((d) => ({ ...d, print: { ...d.print, ...patch } }));
  const totalMm = job ? job.bitmaps.reduce((s, b) => s + b.width, 0) / (profile.dpi / 25.4) : 0;
  const clipped = job ? new Set(job.bitmaps.filter((b) => b.spillDots > 0)).size : 0;
  const mismatch = status && status.mediaWidth && Math.abs(findTape(doc.media.kind, doc.media.width).code - status.mediaWidth) > 0.5;

  const doPrint = async () => {
    if (!job) return;
    try {
      await runJob(job);
      st().notify(`Sent ${job.bitmaps.length} label${job.bitmaps.length > 1 ? 's' : ''} to the printer`, 'success');
      st().set({ printOpen: false });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal">
        <div className="modal-head">
          <h2>Print</h2>
          <span className="hint">
            {profile.name} · {doc.media.width} mm {doc.media.kind === 'hse' ? 'heat-shrink' : 'tape'}
          </span>
          <div className="spacer" />
          <button className="btn ghost icon" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="wizard-split">
            <div>
              <div className="section-title">What to print</div>
              {pageCount > 1 && (
                <Field label={`Records / serial numbers (${pageCount})`}>
                  <Seg value={range ? 'range' : 'all'} onChange={(v) => setRange(v === 'all' ? null : { from: 0, to: Math.min(pageCount - 1, 0) })} options={[{ value: 'all', label: 'All' }, { value: 'range', label: 'Range' }]} />
                  {range && (
                    <div className="grid2" style={{ marginTop: 6 }}>
                      <NumberInput prefix="#" value={range.from + 1} onChange={(v) => setRange({ ...range, from: Math.max(0, Math.round(v) - 1) })} min={1} max={pageCount} step={1} />
                      <NumberInput prefix="→" value={range.to + 1} onChange={(v) => setRange({ ...range, to: Math.max(range.from, Math.round(v) - 1) })} min={1} max={pageCount} step={1} />
                    </div>
                  )}
                </Field>
              )}
              <Field label="Copies of each">
                <NumberInput value={p.copies} onChange={(v) => setPrint({ copies: Math.max(1, Math.round(v)) })} min={1} max={999} step={1} />
              </Field>
              <Field label="Cut">
                <Seg value={p.cut} onChange={(cut) => setPrint({ cut })} options={[{ value: 'each', label: 'Each label' }, { value: 'end', label: 'At end' }, { value: 'none', label: 'Never' }]} />
              </Field>
              {profile.halfCut && <Check checked={p.halfCut} onChange={(halfCut) => setPrint({ halfCut })} label="Half cut" />}
              <Check checked={p.chain} onChange={(chain) => setPrint({ chain })} label="Chain print (don't feed the last label)" />
              <Check checked={p.mirror} onChange={(mirror) => setPrint({ mirror })} label="Mirror" />
              {settings.minimalProtocol && <div className="callout warn" style={{ marginTop: 10 }}>Minimal command set is on: cut options are left to the printer.</div>}
              {mismatch && (
                <div className="callout warn" style={{ marginTop: 10 }}>
                  Printer reports {status!.mediaWidth} mm tape, label is {doc.media.width} mm.
                </div>
              )}
              {clipped > 0 && (
                <div className="callout err" style={{ marginTop: 10 }}>
                  {clipped === 1 && job!.bitmaps.length === 1 ? 'Part of the design' : `Part of ${clipped} label${clipped > 1 ? 's' : ''}`} falls outside the printable area and will be cut off. It's shown in red in the preview.
                </div>
              )}
              {error && <div className="callout err" style={{ marginTop: 10 }}>{error}</div>}
            </div>
            <div>
              <div className="section-title">
                Preview: exact dots ({job ? `${job.bitmaps.length} label${job.bitmaps.length > 1 ? 's' : ''}, ${(totalMm / 10).toFixed(1)} cm of tape` : 'preparing…'})
              </div>
              <div className="pages-strip" ref={stripRef} />
              <div className="hint" style={{ marginTop: 6 }}>Shaded edges are tape the print head can't reach. Anything in red won't print.</div>
              {job && job.bitmaps.length > 30 && <div className="hint">Showing the first 30.</div>}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          {busy && (
            <div style={{ flex: 1 }} className="progress">
              <div style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          {!busy && <div className="spacer" />}
          <button className="btn" disabled={!job} onClick={() => job && download(`${doc.name || 'label'}.bin`, concat(job.chunks))} title="Raw printer data for lp -o raw / copy /b">
            <Download size={14} /> .bin
          </button>
          {!transport ? (
            <button className="btn primary" onClick={() => st().set({ printerOpen: true })}>
              <Bluetooth size={14} /> Connect printer…
            </button>
          ) : (
            <button className="btn primary" disabled={!job || busy} onClick={doPrint}>
              <Printer size={14} /> {busy ? 'Printing…' : `Print ${job?.bitmaps.length ?? ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
