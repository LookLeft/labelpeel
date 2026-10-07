import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Maximize, ChevronLeft, ChevronRight, Grid3x3, AlertTriangle } from 'lucide-react';
import { useEditor } from '../state/store';
import { clearRect, designSize, gridWidth, printableRect } from '../model/defaults';
import { enumeratePages } from '../model/pages';
import { CLEAR_LAMINATE, computeLayout, renderLabel, renderPrintBitmap, type Box } from '../render/render';
import { onAssetsChanged } from '../render/assets';
import { onFontsChanged } from '../render/fonts';
import { effectiveProfile } from '../printer/service';
import type { GridElement, LabelElement, TableElement } from '../model/types';
import { areaAt, cellAtPoint, tableEdges } from '../model/table';

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'rot';

interface Drag {
  mode: 'move' | 'resize' | 'rotate' | 'marquee' | 'pan';
  sx: number; // screen px
  sy: number;
  mx: number; // mm
  my: number;
  handle?: Handle;
  orig: Map<string, LabelElement>;
  boxes: Map<string, Box>;
  panX: number;
  panY: number;
  moved: boolean;
  additive: boolean;
}

interface SnapLine {
  axis: 'x' | 'y';
  pos: number;
}

const HANDLE_CURSOR: Record<Handle, string> = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', rot: 'grab',
};

function toLocal(px: number, py: number, b: Box, rot: number) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const r = (-rot * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  return { x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r) };
}

function hit(px: number, py: number, b: Box, rot: number, slop: number) {
  const l = toLocal(px, py, b, rot);
  return Math.abs(l.x) <= b.w / 2 + slop && Math.abs(l.y) <= Math.max(b.h, 0) / 2 + slop;
}

function aabb(b: Box, rot: number): Box {
  const r = ((rot % 360) + 360) % 360;
  if (!r) return b;
  const rad = (r * Math.PI) / 180;
  const w = Math.abs(b.w * Math.cos(rad)) + Math.abs(b.h * Math.sin(rad));
  const h = Math.abs(b.w * Math.sin(rad)) + Math.abs(b.h * Math.cos(rad));
  return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
}

export function EditorCanvas() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const dotPreview = useEditor((s) => s.dotPreview);
  const previewIndex = useEditor((s) => s.previewIndex);
  const fitRequest = useEditor((s) => s.fitRequest);
  const settings = useEditor((s) => s.settings);
  const editingTextId = useEditor((s) => s.editingTextId);
  const set = useEditor((s) => s.set);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [view, setView] = useState({ zoom: 6, panX: 60, panY: 120 });
  const [tick, setTick] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [snaps, setSnaps] = useState<SnapLine[]>([]);
  const [space, setSpace] = useState(false);
  const [editCell, setEditCell] = useState<{ id: string; cell: number } | null>(null);
  const [editTableCell, setEditTableCell] = useState<{ id: string; r: number; c: number } | null>(null);
  const drag = useRef<Drag | null>(null);

  const pages = useMemo(() => enumeratePages(doc, new Date(), settings.dateFormat), [doc, settings.dateFormat]);
  const pctx = pages[Math.min(previewIndex, pages.length - 1)] ?? pages[0];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => computeLayout(doc, pctx), [doc, pctx, tick]);
  const [W, H] = designSize(doc, layout.length);

  useEffect(() => {
    const offA = onAssetsChanged(() => setTick((t) => t + 1));
    const offF = onFontsChanged(() => setTick((t) => t + 1));
    document.fonts?.addEventListener?.('loadingdone', () => setTick((t) => t + 1));
    return () => {
      offA();
      offF();
    };
  }, []);

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const zoom = Math.max(1, Math.min(40, Math.min((size.w - 120) / W, (size.h - 160) / H)));
    setView({ zoom, panX: (size.w - W * zoom) / 2, panY: (size.h - H * zoom) / 2 - 10 });
  }, [size.w, size.h, W, H]);

  // Fit on load / new document / container resize.
  const fitKey = `${fitRequest}|${size.w}|${size.h}|${doc.orientation}|${doc.media.width}`;
  const lastFit = useRef('');
  useEffect(() => {
    if (lastFit.current !== fitKey && size.w > 50) {
      lastFit.current = fitKey;
      fit();
    }
  }, [fitKey, fit, size.w]);

  useEffect(() => {
    useEditor.setState({ zoom: view.zoom });
  }, [view.zoom]);

  // Keep the label in view as auto length grows past the right edge.
  useEffect(() => {
    if (drag.current) return;
    const right = view.panX + W * view.zoom;
    if (right > size.w - 20 && W * view.zoom < size.w - 80) setView((v) => ({ ...v, panX: size.w - 40 - W * v.zoom }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W]);

  const profile = effectiveProfile(settings.profileId);
  // Always rendered: it drives the dot preview and the "won't print" overlay.
  const printBmp = useMemo(
    () => renderPrintBitmap(doc, pctx, profile.dpi, profile.headPins, { mirror: false }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, pctx, profile, tick],
  );
  const bitmap = dotPreview ? printBmp : null;

  // ---------------------------------------------------------------- draw
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    c.style.width = `${size.w}px`;
    c.style.height = `${size.h}px`;
    const ctx = c.getContext('2d')!;
    const css = getComputedStyle(document.documentElement);
    const text3 = css.getPropertyValue('--text-3').trim() || '#888';
    const accent = css.getPropertyValue('--accent').trim() || '#4f8cff';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.scale(dpr, dpr);
    const { zoom, panX, panY } = view;
    const lw = W * zoom;
    const lh = H * zoom;

    // Ruler along the label length.
    const portrait = doc.orientation === 'portrait';
    ctx.fillStyle = text3;
    ctx.strokeStyle = text3;
    ctx.lineWidth = 1;
    ctx.font = '10px Inter, sans-serif';
    const len = portrait ? H : W;
    const step = zoom >= 5 ? 1 : zoom >= 2 ? 2 : 5;
    const labelEvery = zoom >= 8 ? 5 : zoom >= 3 ? 10 : 20;
    for (let mm = 0; mm <= len + 0.001; mm += step) {
      const major = Math.abs(mm % labelEvery) < 0.001;
      const t = major ? 8 : mm % 5 === 0 ? 5 : 3;
      ctx.beginPath();
      if (!portrait) {
        const x = Math.round(panX + mm * zoom) + 0.5;
        ctx.moveTo(x, panY - 6);
        ctx.lineTo(x, panY - 6 - t);
      } else {
        const y = Math.round(panY + mm * zoom) + 0.5;
        ctx.moveTo(panX - 6, y);
        ctx.lineTo(panX - 6 - t, y);
      }
      ctx.stroke();
      if (major) {
        if (!portrait) {
          ctx.textAlign = 'center';
          ctx.fillText(String(mm), panX + mm * zoom, panY - 18);
        } else {
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(mm), panX - 18, panY + mm * zoom);
          ctx.textBaseline = 'alphabetic';
        }
      }
    }

    // Tape.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = doc.media.tapeColor;
    ctx.fillRect(panX, panY, lw, lh);
    ctx.restore();
    const cr = clearRect(doc, layout.length);
    if (cr) {
      ctx.fillStyle = CLEAR_LAMINATE;
      ctx.fillRect(panX + cr.x * zoom, panY + cr.y * zoom, cr.w * zoom, cr.h * zoom);
    }
    // Tape continues beyond the label (faded).
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = doc.media.tapeColor;
    if (!portrait) {
      ctx.fillRect(panX - 40, panY, 40, lh);
      ctx.fillRect(panX + lw, panY, 40, lh);
    } else {
      ctx.fillRect(panX, panY - 40, lw, 40);
      ctx.fillRect(panX, panY + lh, lw, 40);
    }
    ctx.restore();

    // Draws dot rows (tape orientation) whose first row sits `fromMm` across the tape.
    const pr = printableRect(doc, layout.length, profile.dpi, profile.headPins);
    const dotPx = zoom / (profile.dpi / 25.4);
    const drawDots = (width: number, height: number, bits: Uint8Array, rgb: [number, number, number], fromMm: number) => {
      const img = ctx.createImageData(width, height);
      for (let i = 0; i < bits.length; i++) if (bits[i]) img.data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
      const tmp = document.createElement('canvas');
      tmp.width = width;
      tmp.height = height;
      tmp.getContext('2d')!.putImageData(img, 0, 0);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      if (!portrait) {
        ctx.drawImage(tmp, panX, panY + fromMm * zoom, lw, height * dotPx);
      } else {
        // Undo the 90° rotation used for printing.
        ctx.translate(panX + fromMm * zoom + height * dotPx, panY);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(tmp, 0, 0, lh, height * dotPx);
      }
      ctx.restore();
    };
    const bandStart = portrait ? pr.x : pr.y;

    // Content.
    if (bitmap) {
      drawDots(bitmap.width, bitmap.height, bitmap.bits, hexRgb(doc.media.inkColor), bandStart);
    } else {
      ctx.save();
      ctx.translate(panX, panY);
      ctx.beginPath();
      ctx.rect(0, 0, lw, lh);
      ctx.clip();
      // Render at device resolution for sharp text.
      ctx.scale(1 / dpr, 1 / dpr);
      renderLabel(ctx, doc, layout, {
        scale: zoom * dpr,
        ink: doc.media.inkColor,
        paper: doc.media.tapeColor,
        pctx,
        editor: true,
        dpm: profile.dpi / 25.4,
      });
      ctx.restore();
    }

    // Non-printable areas.
    ctx.save();
    ctx.fillStyle = 'rgba(120,130,150,0.18)';
    if (!portrait) {
      ctx.fillRect(panX, panY, lw, pr.y * zoom);
      ctx.fillRect(panX, panY + (pr.y + pr.h) * zoom, lw, lh - (pr.y + pr.h) * zoom);
    } else {
      ctx.fillRect(panX, panY, pr.x * zoom, lh);
      ctx.fillRect(panX + (pr.x + pr.w) * zoom, panY, lw - (pr.x + pr.w) * zoom, lh);
    }
    ctx.restore();
    // Ink the print head can't reach, in red.
    if (printBmp.spill) {
      const m = printBmp.margin;
      const rows = m * 2 + printBmp.height;
      const all = new Uint8Array(printBmp.width * rows);
      all.set(printBmp.spill.subarray(0, printBmp.width * m));
      all.set(printBmp.spill.subarray(printBmp.width * m), printBmp.width * (m + printBmp.height));
      drawDots(printBmp.width, rows, all, [240, 82, 82], bandStart - m * (25.4 / profile.dpi));
    }

    // Guides.
    if (settings.showGuides) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = accent;
      ctx.fillStyle = accent;
      ctx.font = '10px Inter, sans-serif';
      ctx.lineWidth = 1;
      for (const g of doc.guides) {
        ctx.beginPath();
        if (g.axis === 'x') {
          const x = Math.round(panX + g.pos * zoom) + 0.5;
          ctx.moveTo(x, panY - 4);
          ctx.lineTo(x, panY + lh + 4);
          if (g.label) {
            ctx.textAlign = 'center';
            ctx.fillText(g.label, x, panY + lh + 16);
          }
        } else {
          const y = Math.round(panY + g.pos * zoom) + 0.5;
          ctx.moveTo(panX - 4, y);
          ctx.lineTo(panX + lw + 4, y);
          if (g.label) {
            ctx.textAlign = 'left';
            ctx.fillText(g.label, panX + lw + 8, y + 3);
          }
        }
        ctx.stroke();
      }
      // Split points.
      if (doc.print.splitEvery > 0) {
        ctx.strokeStyle = '#f05252';
        ctx.fillStyle = '#f05252';
        let n = 2;
        for (let mm = doc.print.splitOrigin + doc.print.splitEvery; mm < layout.length - doc.marginEnd - 0.5; mm += doc.print.splitEvery) {
          const x = Math.round(panX + mm * zoom) + 0.5;
          ctx.beginPath();
          ctx.moveTo(x, panY - 10);
          ctx.lineTo(x, panY + lh + 10);
          ctx.stroke();
          ctx.textAlign = 'left';
          ctx.fillText(`✂ label ${n++}`, x + 4, panY - 10);
        }
      }
      ctx.restore();
    }

    // Length dimension.
    ctx.fillStyle = text3;
    ctx.strokeStyle = text3;
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'center';
    if (!portrait) {
      const y = panY + lh + 30;
      ctx.beginPath();
      ctx.moveTo(panX, y);
      ctx.lineTo(panX + lw, y);
      ctx.stroke();
      ctx.fillText(`${layout.length.toFixed(1)} mm${doc.lengthMode === 'auto' ? ' (auto)' : ''} × ${doc.media.width} mm`, panX + lw / 2, y + 14);
    } else {
      ctx.fillText(`${doc.media.width} mm × ${layout.length.toFixed(1)} mm${doc.lengthMode === 'auto' ? ' (auto)' : ''}`, panX + lw / 2, panY + lh + 30);
    }
  }, [size, view, doc, layout, pctx, bitmap, printBmp, settings.showGuides, editingTextId, W, H, profile]);

  // ---------------------------------------------------------------- interaction
  const toMm = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    return { sx, sy, x: (sx - view.panX) / view.zoom, y: (sy - view.panY) / view.zoom };
  };

  const boxOf = (el: LabelElement) => layout.boxes.get(el.id) ?? el;

  const hitTest = (x: number, y: number): LabelElement | null => {
    const slop = 3 / view.zoom;
    for (let i = doc.elements.length - 1; i >= 0; i--) {
      const el = doc.elements[i];
      if (el.hidden) continue;
      if (hit(x, y, boxOf(el), el.rotation, el.type === 'shape' && el.shape === 'line' ? 4 / view.zoom : slop)) return el;
    }
    return null;
  };

  const snapTargets = (exclude: Set<string>) => {
    const pr = printableRect(doc, layout.length);
    const xs = [0, W / 2, W, pr.x, pr.x + pr.w / 2, pr.x + pr.w, doc.marginStart];
    const ys = [0, H / 2, H, pr.y, pr.y + pr.h / 2, pr.y + pr.h];
    if (doc.lengthMode === 'fixed') xs.push(W - doc.marginEnd);
    for (const g of doc.guides) (g.axis === 'x' ? xs : ys).push(g.pos);
    for (const el of doc.elements) {
      if (exclude.has(el.id) || el.hidden) continue;
      const b = aabb(boxOf(el), el.rotation);
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
    return { xs, ys };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (editingTextId || editCell || editTableCell) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toMm(e);
    const base = { sx: p.sx, sy: p.sy, mx: p.x, my: p.y, orig: new Map(), boxes: new Map(), panX: view.panX, panY: view.panY, moved: false, additive: e.shiftKey || e.metaKey || e.ctrlKey };
    if (e.button === 1 || space) {
      drag.current = { ...base, mode: 'pan' };
      return;
    }
    const handle = (e.target as Element).getAttribute?.('data-handle') as Handle | null;
    const st = useEditor.getState();
    const snapshot = () => {
      const orig = new Map<string, LabelElement>();
      const boxes = new Map<string, Box>();
      for (const el of st.doc.elements) {
        if (useEditor.getState().selection.includes(el.id)) {
          orig.set(el.id, el);
          boxes.set(el.id, boxOf(el));
        }
      }
      return { orig, boxes };
    };
    if (handle) {
      st.begin();
      drag.current = { ...base, ...snapshot(), mode: handle === 'rot' ? 'rotate' : 'resize', handle };
      return;
    }
    const target = hitTest(p.x, p.y);
    if (target) {
      if (base.additive) {
        st.select(st.selection.includes(target.id) ? st.selection.filter((id) => id !== target.id) : [...st.selection, target.id]);
      } else if (!st.selection.includes(target.id)) {
        st.select([target.id]);
      }
      st.begin();
      drag.current = { ...base, ...snapshot(), mode: 'move' };
    } else {
      if (!base.additive) st.select([]);
      drag.current = { ...base, mode: 'marquee' };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const p = toMm(e);
    if (!d) {
      const t = hitTest(p.x, p.y);
      setHover(t?.id ?? null);
      return;
    }
    const dxs = p.sx - d.sx;
    const dys = p.sy - d.sy;
    if (!d.moved && Math.hypot(dxs, dys) < 3) return;
    d.moved = true;
    const st = useEditor.getState();
    if (d.mode === 'pan') {
      setView((v) => ({ ...v, panX: d.panX + dxs, panY: d.panY + dys }));
      return;
    }
    if (d.mode === 'marquee') {
      setMarquee({ x: Math.min(d.mx, p.x), y: Math.min(d.my, p.y), w: Math.abs(p.x - d.mx), h: Math.abs(p.y - d.my) });
      return;
    }
    let dx = p.x - d.mx;
    let dy = p.y - d.my;
    if (d.mode === 'move') {
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const lines: SnapLine[] = [];
      if (settings.snap && !e.altKey) {
        let gb: Box | null = null;
        for (const [id, b] of d.boxes) {
          const r = aabb(b, d.orig.get(id)!.rotation);
          gb = gb ? union(gb, r) : r;
        }
        if (gb) {
          const { xs, ys } = snapTargets(new Set(d.orig.keys()));
          const thr = 6 / view.zoom;
          const cand = (vals: number[], targets: number[]) => {
            let best: { d: number; t: number } | null = null;
            for (const v of vals) for (const t of targets) if (Math.abs(t - v) < thr && (!best || Math.abs(t - v) < Math.abs(best.d))) best = { d: t - v, t };
            return best;
          };
          const sx = cand([gb.x + dx, gb.x + gb.w / 2 + dx, gb.x + gb.w + dx], xs);
          const sy = cand([gb.y + dy, gb.y + gb.h / 2 + dy, gb.y + gb.h + dy], ys);
          if (sx) {
            dx += sx.d;
            lines.push({ axis: 'x', pos: sx.t });
          }
          if (sy) {
            dy += sy.d;
            lines.push({ axis: 'y', pos: sy.t });
          }
        }
      }
      setSnaps(lines);
      st.transient((doc) => ({
        ...doc,
        elements: doc.elements.map((el) => {
          const o = d.orig.get(el.id);
          if (!o || o.locked) return el;
          return { ...el, x: round2(o.x + dx), y: round2(o.y + dy) } as LabelElement;
        }),
      }));
      return;
    }
    const [id] = d.orig.keys();
    const o = d.orig.get(id);
    const b = d.boxes.get(id);
    if (!o || !b || o.locked) return;
    if (d.mode === 'rotate') {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      let ang = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
      ang = ((ang % 360) + 360) % 360;
      if (e.shiftKey) ang = Math.round(ang / 15) * 15;
      else for (const s of [0, 90, 180, 270, 360]) if (Math.abs(ang - s) < 5) ang = s % 360;
      st.transient((doc) => ({ ...doc, elements: doc.elements.map((el) => (el.id === id ? ({ ...el, rotation: Math.round(ang) % 360 } as LabelElement) : el)) }));
      return;
    }
    // Resize in the element's rotated frame.
    const h = d.handle!;
    const rad = (o.rotation * Math.PI) / 180;
    const lx = dx * Math.cos(-rad) - dy * Math.sin(-rad);
    const ly = dx * Math.sin(-rad) + dy * Math.cos(-rad);
    let left = -b.w / 2;
    let right = b.w / 2;
    let top = -b.h / 2;
    let bottom = b.h / 2;
    if (h.includes('e')) right += lx;
    if (h.includes('w')) left += lx;
    if (h.includes('s')) bottom += ly;
    if (h.includes('n')) top += ly;
    const keep =
      (o.type === 'symbol' && o.keepAspect) || (o.type === 'image' && o.keepAspect) || (h.length === 2 && e.shiftKey) || (o.type === 'barcode' && ['qrcode', 'datamatrix', 'azteccode', 'microqrcode'].includes(o.symbology));
    let nw = Math.max(0.5, right - left);
    let nh = Math.max(o.type === 'shape' && o.shape === 'line' ? 0 : 0.5, bottom - top);
    if (keep && b.w > 0 && b.h > 0) {
      const ratio = b.w / b.h;
      if (h === 'n' || h === 's') nw = nh * ratio;
      else if (h === 'e' || h === 'w') nh = nw / ratio;
      else if (nw / nh > ratio) nh = nw / ratio;
      else nw = nh * ratio;
      if (h.includes('w')) left = right - nw;
      else right = left + nw;
      if (h.includes('n')) top = bottom - nh;
      else bottom = top + nh;
    }
    const lcx = (left + right) / 2;
    const lcy = (top + bottom) / 2;
    const gcx = b.x + b.w / 2 + lcx * Math.cos(rad) - lcy * Math.sin(rad);
    const gcy = b.y + b.h / 2 + lcx * Math.sin(rad) + lcy * Math.cos(rad);
    const patch: Partial<LabelElement> & Record<string, unknown> = { x: round2(gcx - nw / 2), y: round2(gcy - nh / 2), w: round2(nw), h: round2(nh) };
    if (o.type === 'text' && (h.includes('e') || h.includes('w'))) patch.autoWidth = false;
    if (o.type === 'grid') {
      const mods = (o as GridElement).cells.reduce((s, c) => s + Math.max(1, c.span), 0);
      patch.pitch = round2(nw / mods);
    }
    st.transient((doc) => ({ ...doc, elements: doc.elements.map((el) => (el.id === id ? ({ ...el, ...patch } as LabelElement) : el)) }));
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setSnaps([]);
    if (!d) return;
    const st = useEditor.getState();
    if (d.mode === 'marquee') {
      if (marquee) {
        const ids = doc.elements
          .filter((el) => !el.hidden)
          .filter((el) => {
            const b = aabb(boxOf(el), el.rotation);
            return b.x < marquee.x + marquee.w && b.x + b.w > marquee.x && b.y < marquee.y + marquee.h && b.y + b.h > marquee.y;
          })
          .map((el) => el.id);
        st.select(d.additive ? Array.from(new Set([...st.selection, ...ids])) : ids);
      }
      setMarquee(null);
      return;
    }
    if (d.mode !== 'pan') st.commit();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = toMm(e);
    const t = hitTest(p.x, p.y);
    if (!t || t.locked) return;
    if (t.type === 'text') set({ editingTextId: t.id, selection: [t.id] });
    if (t.type === 'grid') {
      const b = boxOf(t);
      const l = toLocal(p.x, p.y, b, t.rotation);
      let acc = -b.w / 2;
      const idx = t.cells.findIndex((c) => {
        acc += Math.max(1, c.span) * t.pitch;
        return l.x <= acc;
      });
      setEditCell({ id: t.id, cell: idx < 0 ? t.cells.length - 1 : idx });
    }
    if (t.type === 'table') {
      const b = boxOf(t);
      const l = toLocal(p.x, p.y, b, t.rotation);
      const a = cellAtPoint(t, b.w, b.h, l.x + b.w / 2, l.y + b.h / 2);
      if (a) setEditTableCell({ id: t.id, r: a.r, c: a.c });
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinches arrive as ctrl+wheel with small deltas; mouse wheel
      // notches are ~100px. Pinches get a higher rate so they don't feel sluggish.
      const pinch = e.deltaMode === 0 && Math.abs(e.deltaY) < 40;
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : pinch ? 0.007 : 0.0025));
      setView((v) => {
        const zoom = Math.max(0.5, Math.min(80, v.zoom * factor));
        const mx = (sx - v.panX) / v.zoom;
        const my = (sy - v.panY) / v.zoom;
        return { zoom, panX: sx - mx * zoom, panY: sy - my * zoom };
      });
    } else {
      const k = e.deltaMode === 1 ? 16 : 1;
      setView((v) => ({ ...v, panX: v.panX - (e.shiftKey ? e.deltaY : e.deltaX) * k, panY: v.panY - (e.shiftKey ? 0 : e.deltaY) * k }));
    }
  };

  // Prevent browser page zoom on ctrl+wheel over the stage.
  useEffect(() => {
    const el = wrapRef.current!;
    const h = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener('wheel', h, { passive: false });
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).closest('input,textarea,select')) {
        setSpace(true);
        e.preventDefault();
      }
    };
    const ku = (e: KeyboardEvent) => e.code === 'Space' && setSpace(false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      el.removeEventListener('wheel', h);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, []);

  // Zoom commands from the toolbar.
  useEffect(() => {
    const onZoom = (ev: Event) => {
      const kind = (ev as CustomEvent).detail as 'in' | 'out' | 'fit' | '100';
      if (kind === 'fit') return fit();
      setView((v) => {
        const zoom = kind === '100' ? 96 / 25.4 : Math.max(0.5, Math.min(80, v.zoom * (kind === 'in' ? 1.25 : 0.8)));
        const cx = size.w / 2;
        const cy = size.h / 2;
        const mx = (cx - v.panX) / v.zoom;
        const my = (cy - v.panY) / v.zoom;
        return { zoom, panX: cx - mx * zoom, panY: cy - my * zoom };
      });
    };
    window.addEventListener('labelsmith-zoom', onZoom);
    return () => window.removeEventListener('labelsmith-zoom', onZoom);
  }, [fit, size]);

  // ---------------------------------------------------------------- overlay
  const z = view.zoom;
  const sel = doc.elements.filter((e) => selection.includes(e.id));
  const toScreen = (b: Box) => ({ x: view.panX + b.x * z, y: view.panY + b.y * z, w: b.w * z, h: b.h * z });

  const editingEl = editingTextId ? doc.elements.find((e) => e.id === editingTextId) : null;
  const cellEl = editCell ? (doc.elements.find((e) => e.id === editCell.id) as GridElement | undefined) : undefined;
  const tableEl = editTableCell ? (doc.elements.find((e) => e.id === editTableCell.id) as TableElement | undefined) : undefined;

  return (
    <div
      ref={wrapRef}
      className="stage"
      style={{ cursor: space || drag.current?.mode === 'pan' ? 'grab' : hover ? 'move' : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onWheel={onWheel}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (!f) return;
        import('./actions').then((a) => {
          if (/\.(csv|tsv|txt)$/i.test(f.name)) a.loadDataFile(f);
          else if (f.type.startsWith('image/')) a.insertImage(f);
        });
      }}
    >
      <canvas ref={canvasRef} />
      <svg className="overlay">
        {hover && !selection.includes(hover) && (() => {
          const el = doc.elements.find((e) => e.id === hover);
          if (!el) return null;
          const s = toScreen(boxOf(el));
          return <rect x={s.x} y={s.y} width={s.w} height={Math.max(1, s.h)} fill="none" stroke="var(--accent)" strokeOpacity={0.6} transform={`rotate(${el.rotation} ${s.x + s.w / 2} ${s.y + s.h / 2})`} pointerEvents="none" />;
        })()}
        {sel.map((el) => {
          const s = toScreen(boxOf(el));
          const cx = s.x + s.w / 2;
          const cy = s.y + s.h / 2;
          const single = sel.length === 1 && !el.locked;
          const hs = 8;
          const handles: [Handle, number, number][] = [
            ['nw', s.x, s.y], ['n', cx, s.y], ['ne', s.x + s.w, s.y], ['e', s.x + s.w, cy],
            ['se', s.x + s.w, s.y + s.h], ['s', cx, s.y + s.h], ['sw', s.x, s.y + s.h], ['w', s.x, cy],
          ];
          return (
            <g key={el.id} transform={`rotate(${el.rotation} ${cx} ${cy})`}>
              <rect x={s.x} y={s.y} width={s.w} height={Math.max(1, s.h)} fill="none" stroke={el.locked ? '#f5b942' : 'var(--accent)'} strokeWidth={1.5} pointerEvents="none" />
              {single && (
                <>
                  <line x1={cx} y1={s.y} x2={cx} y2={s.y - 22} stroke="var(--accent)" pointerEvents="none" />
                  <circle data-handle="rot" cx={cx} cy={s.y - 24} r={5.5} fill="var(--panel)" stroke="var(--accent)" strokeWidth={1.5} style={{ cursor: HANDLE_CURSOR.rot }} />
                  {handles.map(([h, x, y]) => (
                    <rect key={h} data-handle={h} x={x - hs / 2} y={y - hs / 2} width={hs} height={hs} rx={2} fill="var(--panel)" stroke="var(--accent)" strokeWidth={1.5} style={{ cursor: HANDLE_CURSOR[h] }} />
                  ))}
                </>
              )}
            </g>
          );
        })}
        {marquee && (() => {
          const s = toScreen(marquee);
          return <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="var(--accent-soft)" stroke="var(--accent)" strokeDasharray="4 3" pointerEvents="none" />;
        })()}
        {snaps.map((l, i) =>
          l.axis === 'x' ? (
            <line key={i} x1={view.panX + l.pos * z} x2={view.panX + l.pos * z} y1={view.panY - 30} y2={view.panY + H * z + 30} stroke="#ff4d8d" strokeWidth={1} pointerEvents="none" />
          ) : (
            <line key={i} y1={view.panY + l.pos * z} y2={view.panY + l.pos * z} x1={view.panX - 30} x2={view.panX + W * z + 30} stroke="#ff4d8d" strokeWidth={1} pointerEvents="none" />
          ),
        )}
      </svg>

      {editingEl && editingEl.type === 'text' && (
        <InlineEditor
          box={toScreen(boxOf(editingEl))}
          value={editingEl.text}
          onLive={(v) => useEditor.getState().updateElement(editingEl.id, { text: v }, `inline:${editingEl.id}`)}
          onDone={(v) => {
            if (v !== editingEl.text) useEditor.getState().updateElement(editingEl.id, { text: v }, `inline:${editingEl.id}`);
            set({ editingTextId: null });
          }}
        />
      )}
      {cellEl && editCell && (
        <InlineEditor
          box={(() => {
            const b = boxOf(cellEl);
            const before = cellEl.cells.slice(0, editCell.cell).reduce((s, c) => s + Math.max(1, c.span), 0);
            return toScreen({ x: b.x + before * cellEl.pitch, y: b.y, w: Math.max(1, cellEl.cells[editCell.cell].span) * cellEl.pitch, h: b.h });
          })()}
          value={cellEl.cells[editCell.cell]?.text ?? ''}
          onDone={(v) => {
            const cells = cellEl.cells.map((c, i) => (i === editCell.cell ? { ...c, text: v } : c));
            useEditor.getState().updateElement(cellEl.id, { cells, w: gridWidth({ cells, pitch: cellEl.pitch }) } as Partial<LabelElement>);
            setEditCell(null);
          }}
        />
      )}

      {tableEl && editTableCell && (
        <InlineEditor
          box={(() => {
            // Unrotated cell box; rotated tables are edited in place of their bounding cell.
            const b = boxOf(tableEl);
            const a = areaAt(tableEl, editTableCell.r, editTableCell.c) ?? { r: editTableCell.r, c: editTableCell.c, rs: 1, cs: 1 };
            const { xs, ys } = tableEdges(tableEl, b.w, b.h);
            return toScreen({ x: b.x + xs[a.c], y: b.y + ys[a.r], w: xs[a.c + a.cs] - xs[a.c], h: ys[a.r + a.rs] - ys[a.r] });
          })()}
          value={tableEl.cells[editTableCell.r]?.[editTableCell.c]?.text ?? ''}
          onDone={(v) => {
            const { r, c } = editTableCell;
            const cells = tableEl.cells.map((row, i) => row.map((cell, j) => (i === r && j === c ? { ...cell, text: v } : cell)));
            useEditor.getState().updateElement(tableEl.id, { cells } as Partial<LabelElement>);
            setEditTableCell(null);
          }}
        />
      )}

      {printBmp.spillDots > 0 && (
        <div className="floating clip-warning" role="status">
          <AlertTriangle size={14} />
          Parts shown in red are outside the printable area and will be cut off.
        </div>
      )}

      <div className="floating zoom" onPointerDown={(e) => e.stopPropagation()}>
        <button className={`btn ghost icon sm ${dotPreview ? 'active' : ''}`} title="Dot preview: show exactly what the printer prints (180 dpi)" onClick={() => set({ dotPreview: !dotPreview })}>
          <Grid3x3 size={15} />
        </button>
        <div className="sep" />
        <button className="btn ghost icon sm" title="Zoom out (Ctrl -)" onClick={() => window.dispatchEvent(new CustomEvent('labelsmith-zoom', { detail: 'out' }))}>
          <Minus size={15} />
        </button>
        <span className="pct">{Math.round((view.zoom / (96 / 25.4)) * 100)}%</span>
        <button className="btn ghost icon sm" title="Zoom in (Ctrl +)" onClick={() => window.dispatchEvent(new CustomEvent('labelsmith-zoom', { detail: 'in' }))}>
          <Plus size={15} />
        </button>
        <button className="btn ghost icon sm" title="Fit (Ctrl 0)" onClick={fit}>
          <Maximize size={14} />
        </button>
      </div>

      {pages.length > 1 && (
        <div className="floating records" onPointerDown={(e) => e.stopPropagation()}>
          <button className="btn ghost icon sm" disabled={previewIndex <= 0} onClick={() => set({ previewIndex: Math.max(0, previewIndex - 1) })}>
            <ChevronLeft size={15} />
          </button>
          <span className="pct" style={{ minWidth: 90 }}>
            Label {Math.min(previewIndex, pages.length - 1) + 1} of {pages.length}
          </span>
          <button className="btn ghost icon sm" disabled={previewIndex >= pages.length - 1} onClick={() => set({ previewIndex: Math.min(pages.length - 1, previewIndex + 1) })}>
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function InlineEditor({ box, value, onDone, onLive }: { box: Box; value: string; onDone: (v: string) => void; onLive?: (v: string) => void }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const lines = Math.max(1, v.split('\n').length);
  return (
    <textarea
      ref={ref}
      className="inline-editor"
      value={v}
      style={{ left: box.x, top: box.y + box.h + 6, width: Math.max(160, box.w), height: 14 + lines * 19 }}
      onChange={(e) => {
        setV(e.target.value);
        onLive?.(e.target.value);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => onDone(v)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          onLive?.(value);
          onDone(value);
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onDone(v);
      }}
    />
  );
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}
