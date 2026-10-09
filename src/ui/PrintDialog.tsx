import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Printer, Download, Bluetooth, Scissors } from 'lucide-react';
import { useEditor } from '../state/store';
import { prepareJob, runJob, usePrinter, effectiveProfile, type PreparedJob } from '../printer/service';
import { cutPlan, type CutPlan } from '../printer/cuts';
import type { PrintBitmap } from '../render/render';
import type { Media } from '../model/types';
import { enumeratePages } from '../model/pages';
import { concat } from '../printer/protocol';
import { download } from '../io/files';
import { Check, Field, NumberInput, Seg } from './fields';
import { findTape, isDk } from '../model/media';
import { dkMismatch, matchLoadedTape, mediaName, reportedMedia } from './actions';

export function PrintDialog() {
  const open = useEditor((s) => s.printOpen);
  const doc = useEditor((s) => s.doc);
  const settings = useEditor((s) => s.settings);
  const st = useEditor.getState;
  const { transport, busy, progress, status, responded } = usePrinter();
  const [job, setJob] = useState<PreparedJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const profile = effectiveProfile(settings.profileId);
  const pageCount = useMemo(() => enumeratePages(doc).length, [doc]);
  // Print just this label, or every open tab in one job.
  const tabs = useEditor((s) => s.tabs);
  const [scope, setScope] = useState<'one' | 'all'>('one');
  const all = scope === 'all' && tabs.length > 1;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(null);
    const labels = all ? st().allTabs().map((t) => t.doc) : undefined;
    prepareJob(doc, profile, settings.minimalProtocol, settings.dateFormat, range ?? undefined, labels)
      .then((j) => alive && setJob(j))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc, profile, settings.minimalProtocol, settings.dateFormat, range, all, tabs]);


  // Tape the printer reports vs the tape the design is for (width codes, mm).
  // QL printers check the media themselves, so any DK difference stops the print.
  const dk = isDk(doc.media.kind);
  const wrongDk = dkMismatch(status, doc.media);
  const loaded = dk ? 0 : status?.mediaWidth ?? 0;
  const designed = findTape(doc.media.kind, doc.media.width).code;
  const loadedMm = loaded === 4 ? 3.5 : loaded;
  // A design for wider tape loses its edges, and the head prints past the tape
  // edge, so printing it needs an explicit override.
  const tooWide = loaded > 0 && designed > loaded + 0.5;
  const narrower = loaded > 0 && designed < loaded - 0.5;
  const [override, setOverride] = useState(false);
  useEffect(() => setOverride(false), [loaded, designed]);

  if (!open) return null;
  const close = () => !busy && st().set({ printOpen: false });
  const p = doc.print;
  const setPrint = (patch: Partial<typeof p>) => st().update((d) => ({ ...d, print: { ...d.print, ...patch } }));
  // Die-cut labels use their whole length, though only the middle is printed.
  const totalMm = !job ? 0 : doc.media.kind === 'dkdie' && doc.media.length ? job.bitmaps.length * doc.media.length : job.bitmaps.reduce((s, b) => s + b.width, 0) / (profile.dpi / 25.4);
  const clipped = job ? new Set(job.bitmaps.filter((b) => b.spillDots > 0)).size : 0;
  const plan = job ? cutPlan(job.bitmaps.length, p, profile.halfCut, settings.minimalProtocol && !profile.ql) : null;

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
            {profile.name} · {mediaName(doc.media)}
          </span>
          <div className="spacer" />
          <button className="btn ghost icon" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="wizard-split print-split">
            <div>
              <div className="section-title">What to print</div>
              {tabs.length > 1 && (
                <Field label="Labels">
                  <Seg value={scope} onChange={setScope} options={[{ value: 'one', label: 'This label' }, { value: 'all', label: `All open (${tabs.length})` }]} />
                  {all && <div className="hint" style={{ marginTop: 4 }}>In tab order, as one strip. Each label uses its own copies and records; the cut settings below apply to the whole strip.</div>}
                </Field>
              )}
              {all && job && job.skipped.length > 0 && (
                <div className="callout warn" style={{ marginBottom: 10 }}>
                  Not included, as they're for different tape: {job.skipped.join(', ')}.
                </div>
              )}
              {!all && pageCount > 1 && (
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
              {p.cut === 'each' && !(p.halfCut && profile.halfCut) && (job?.bitmaps.length ?? 0) > 1 && (
                <Field label="Cut every">
                  <NumberInput value={p.cutEvery} onChange={(v) => setPrint({ cutEvery: Math.max(1, Math.round(v)) })} unit="labels" min={1} max={99} step={1} />
                </Field>
              )}
              {profile.halfCut && <Check checked={p.halfCut} onChange={(halfCut) => setPrint({ halfCut })} label="Half cut" />}
              <Check checked={p.chain} onChange={(chain) => setPrint({ chain })} label="Chain print (don't feed the last label)" />
              <Check checked={p.mirror} onChange={(mirror) => setPrint({ mirror })} label="Mirror" />
              {settings.minimalProtocol && <div className="callout warn" style={{ marginTop: 10 }}>Minimal command set is on: cut options are left to the printer.</div>}
              {transport?.kind === 'serial' && !responded && (
                <div className="callout warn" style={{ marginTop: 10 }}>
                  The printer hasn't responded since you connected. If it's off, out of range or connected to another device, nothing will print. Check it in the printer panel (Status).
                </div>
              )}
              {wrongDk && (
                <div className="callout err" style={{ marginTop: 10, flexDirection: 'column' }}>
                  <div>
                    The printer has {mediaName(reportedMedia(status!, doc.media))} loaded, but this label is designed for {mediaName(doc.media)}. The printer won't print
                    until they match.
                  </div>
                  <div className="row tight">
                    <button className="btn sm" onClick={() => matchLoadedTape(status!)}>
                      Switch design to {mediaName(reportedMedia(status!, doc.media))}
                    </button>
                  </div>
                </div>
              )}
              {tooWide && (
                <div className="callout err" style={{ marginTop: 10, flexDirection: 'column' }}>
                  <div>
                    The printer has {loadedMm} mm tape, but this label is designed for {doc.media.width} mm. The edges of the design would be lost, and the print head
                    would print past the edge of the tape.
                  </div>
                  <div className="row tight">
                    <button className="btn sm" onClick={() => matchLoadedTape(status!)}>
                      Switch design to {loadedMm} mm
                    </button>
                    {!override && (
                      <button className="btn ghost sm" onClick={() => setOverride(true)}>
                        Print anyway
                      </button>
                    )}
                  </div>
                </div>
              )}
              {narrower && (
                <div className="callout" style={{ marginTop: 10, flexDirection: 'column' }}>
                  <div>
                    The printer has {loadedMm} mm tape and this label is designed for {doc.media.width} mm. It will print centred, with blank tape above and below.
                  </div>
                  <div className="row tight">
                    <button className="btn sm" onClick={() => matchLoadedTape(status!)}>
                      Use the full {loadedMm} mm
                    </button>
                  </div>
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
              {plan && <p className="print-summary">{plan.summary}</p>}
              {job && plan && <TapeStrip bitmaps={job.bitmaps.slice(0, 30)} plan={plan} media={doc.media} dpi={profile.dpi} more={job.bitmaps.length > 30} />}
              {job && job.bitmaps.length > 30 && <div className="hint">Showing the first 30.</div>}
              <div className="hint" style={{ marginTop: 6 }}>
                <Scissors size={11} /> full cut · <span className="key-half" /> half cut · <span className="key-join" /> label edge, not cut. Shaded edges are tape the print head can't reach; anything in red won't print.
              </div>
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
            <button className="btn primary" disabled={!job || busy || wrongDk || (tooWide && !override)} onClick={doPrint}>
              <Printer size={14} /> {busy ? 'Printing…' : `Print ${job?.bitmaps.length ?? ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const hexRgb = (h: string) => {
  const m = /^#?(..)(..)(..)/.exec(h)!;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
};

/** One label's exact dots on the full width of the tape. */
function TapeLabel({ bmp, media, scale, dpi }: { bmp: PrintBitmap; media: Media; scale: number; dpi: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ink = hexRgb(media.inkColor);
    const tape = hexRgb(media.tapeColor);
    // Edges the head can't reach: the tape colour, shaded like the editor.
    const shade = (rgb: number[], k: number) => rgb.map((v) => Math.round(v * (1 - k) + 140 * k));
    const edge = shade(tape, 0.18);
    // Self-laminating tape: the clear laminate part, grey as in the editor.
    const clear = shade(tape, 0.32);
    const clearRow = media.clearFrom != null ? Math.round((media.clearFrom * dpi) / 25.4) : Infinity;
    const lost = [240, 82, 82];
    const m = bmp.margin;
    const rows = m * 2 + bmp.height;
    c.width = bmp.width;
    c.height = rows;
    const cx = c.getContext('2d')!;
    const img = cx.createImageData(bmp.width, rows);
    for (let r = 0; r < rows; r++) {
      const inBand = r >= m && r < m + bmp.height;
      for (let col = 0; col < bmp.width; col++) {
        const on = inBand ? bmp.bits[(r - m) * bmp.width + col] : bmp.spill?.[(r < m ? r : r - bmp.height) * bmp.width + col];
        const bg = r >= clearRow ? (inBand ? clear : shade(clear, 0.18)) : inBand ? tape : edge;
        img.data.set([...(on ? (inBand ? ink : lost) : bg), 255], (r * bmp.width + col) * 4);
      }
    }
    cx.putImageData(img, 0, 0);
  }, [bmp, media.inkColor, media.tapeColor, media.clearFrom, dpi]);
  return (
    <canvas
      ref={ref}
      style={{ width: bmp.width * scale, height: (bmp.margin * 2 + bmp.height) * scale, imageRendering: scale >= 1 ? 'pixelated' : 'auto' }}
    />
  );
}

/**
 * The job as it comes out of the printer: labels end to end on one strip,
 * split into separate pieces wherever the printer makes a full cut.
 */
function TapeStrip({ bitmaps, plan, media, dpi, more }: { bitmaps: PrintBitmap[]; plan: CutPlan; media: Media; dpi: number; more: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(400);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth - 24 - 60));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!bitmaps.length) return null;
  const pieces: number[][] = [[]];
  bitmaps.forEach((_, i) => {
    pieces[pieces.length - 1].push(i);
    if (i < bitmaps.length - 1 && plan.joints[i] === 'cut') pieces.push([]);
  });
  const rows = bitmaps[0].margin * 2 + bitmaps[0].height;
  // Fit the longest uncut piece to the width (pieces that are cut apart wrap
  // onto new rows), within a readable range; longer strips scroll.
  const widest = Math.max(...pieces.map((pc) => pc.reduce((w, i) => w + bitmaps[i].width, 0)));
  const scale = Math.max(48 / rows, Math.min(1.4, 150 / rows, avail / widest));
  const mm = (b: PrintBitmap) => `${(b.width / (dpi / 25.4)).toFixed(1)} mm`;
  return (
    <div className="tape-strip" ref={ref}>
      {pieces.map((piece, k) => (
        <div key={k} className="tape-run">
          <div className="tape-piece">
            {piece.map((i, j) => (
              <div key={i} className="tape-label" title={`Label ${i + 1} · ${mm(bitmaps[i])}`}>
                {j > 0 && <span className={`tape-joint ${plan.joints[i - 1]}`} title={plan.joints[i - 1] === 'half' ? 'Half cut' : 'Label edge, not cut'} />}
                <TapeLabel bmp={bitmaps[i]} media={media} scale={scale} dpi={dpi} />
              </div>
            ))}
            {k === pieces.length - 1 && !more && plan.end !== 'cut' && (
              <div className="tape-tail" style={{ height: rows * scale, background: media.tapeColor }} title={plan.end === 'chain' ? 'Stays in the printer until the next print' : 'Not cut'} />
            )}
          </div>
          {(k < pieces.length - 1 || (!more && plan.end === 'cut')) && (
            <span className="tape-cut" title="Full cut">
              <Scissors size={14} />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
