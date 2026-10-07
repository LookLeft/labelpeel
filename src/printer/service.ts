import { create } from 'zustand';
import { findTape, MM_PER_INCH } from '../model/media';
import { enumeratePages } from '../model/pages';
import type { LabelDoc } from '../model/types';
import { preloadDoc } from '../render/assets';
import { renderPrintBitmap, type PrintBitmap } from '../render/render';
import { buildFeedCutJob, buildJob, cmdInit, cmdInvalidate, cmdStatusRequest, concat, hex, type JobOptions } from './protocol';
import { profileById, profileByPid, type PrinterProfile } from './profiles';
import { bitmapToRaster } from './raster';
import { findStatus, type PrinterStatus } from './status';
import { connectSerial, connectUsb, type Transport } from './transport';

export interface LogLine {
  t: number;
  level: 'info' | 'tx' | 'rx' | 'error';
  text: string;
}

interface PrinterState {
  transport: Transport | null;
  connecting: boolean;
  status: PrinterStatus | null;
  detectedProfile: PrinterProfile | null;
  busy: boolean;
  progress: number;
  log: LogLine[];
  addLog: (level: LogLine['level'], text: string) => void;
}

export const usePrinter = create<PrinterState>((set, get) => ({
  transport: null,
  connecting: false,
  status: null,
  detectedProfile: null,
  busy: false,
  progress: 0,
  log: [],
  addLog: (level, text) => set({ log: [...get().log.slice(-300), { t: Date.now(), level, text }] }),
}));

const log = (level: LogLine['level'], text: string) => usePrinter.getState().addLog(level, text);

export async function connect(kind: 'usb' | 'bluetooth' | 'serial'): Promise<Transport> {
  const st = usePrinter.getState();
  if (st.transport) await disconnect();
  usePrinter.setState({ connecting: true });
  try {
    const t = kind === 'usb' ? await connectUsb() : await connectSerial({ bluetoothOnly: kind === 'bluetooth' });
    t.onDisconnect = () => {
      log('error', 'Printer disconnected.');
      usePrinter.setState({ transport: null, status: null });
    };
    const detected = t.usbProductId != null ? profileByPid(t.usbProductId) ?? null : null;
    usePrinter.setState({ transport: t, detectedProfile: detected });
    log('info', `Connected: ${t.label}${detected ? ` — ${detected.name}` : ''}`);
    // Status is best-effort; some Bluetooth stacks only answer after the first job.
    refreshStatus().catch((e) => log('error', `Status: ${(e as Error).message}`));
    return t;
  } finally {
    usePrinter.setState({ connecting: false });
  }
}

export async function disconnect() {
  const t = usePrinter.getState().transport;
  usePrinter.setState({ transport: null, status: null, detectedProfile: null });
  if (t) await t.close().catch(() => undefined);
  log('info', 'Disconnected.');
}

async function send(t: Transport, data: Uint8Array) {
  log('tx', hex(data, 48));
  await t.write(data);
}

export async function refreshStatus(): Promise<PrinterStatus | null> {
  const t = usePrinter.getState().transport;
  if (!t) return null;
  await t.read(30); // drain
  await send(t, concat([cmdInvalidate(), cmdInit(), cmdStatusRequest()]));
  const bytes = await t.read(2500);
  if (bytes.length) log('rx', hex(bytes, 32));
  const found = findStatus(bytes);
  if (!found) {
    log('info', 'No status reply (normal for some Bluetooth connections).');
    return null;
  }
  const s = found.status;
  usePrinter.setState({ status: s });
  log('info', `Status: ${s.mediaWidth} mm ${s.mediaTypeName}, ${s.tapeColorName} tape / ${s.textColorName} text${s.errors.length ? `, errors: ${s.errors.join(', ')}` : ''}`);
  return s;
}

/** Split a long bitmap into sections (e.g. one label per DB rail row). */
function splitBitmap(bmp: PrintBitmap, doc: LabelDoc, dpm: number): PrintBitmap[] {
  const every = doc.print.splitEvery;
  if (!every || every <= 0) return [bmp];
  const cuts: number[] = [];
  for (let mm = doc.print.splitOrigin + every; mm < bmp.lengthMm - doc.marginEnd - 0.5; mm += every) cuts.push(Math.round(mm * dpm));
  if (!cuts.length) return [bmp];
  const pad = Math.round(Math.max(1, doc.marginStart) * dpm);
  const bounds = [0, ...cuts, bmp.width];
  const out: PrintBitmap[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const a = bounds[k];
    const b = bounds[k + 1];
    const lead = k === 0 ? 0 : pad;
    const tail = k === bounds.length - 2 ? 0 : pad;
    const w = b - a + lead + tail;
    const bits = new Uint8Array(w * bmp.height);
    for (let r = 0; r < bmp.height; r++) bits.set(bmp.bits.subarray(r * bmp.width + a, r * bmp.width + b), r * w + lead);
    out.push({ width: w, height: bmp.height, bits, lengthMm: w / dpm });
  }
  return out;
}

export interface PreparedJob {
  bitmaps: PrintBitmap[];
  profile: PrinterProfile;
  options: JobOptions;
  chunks: Uint8Array[];
  bytes: number;
}

export async function prepareJob(
  doc: LabelDoc,
  profile: PrinterProfile,
  minimal: boolean,
  dateFormat: string,
  range?: { from: number; to: number },
): Promise<PreparedJob> {
  await preloadDoc(doc);
  const all = enumeratePages(doc, new Date(), dateFormat);
  const pages = range ? all.slice(Math.max(0, range.from), Math.min(all.length, range.to + 1)) : all;
  const dpm = profile.dpi / MM_PER_INCH;
  const bitmaps: PrintBitmap[] = [];
  const cutMark = doc.print.cut === 'none' && doc.print.cutMarks;
  for (const pctx of pages) {
    const bmp = renderPrintBitmap(doc, pctx, profile.dpi, profile.headPins, { cutMark, mirror: doc.print.mirror });
    for (const section of splitBitmap(bmp, doc, dpm)) for (let c = 0; c < Math.max(1, doc.print.copies); c++) bitmaps.push(section);
  }
  const tape = findTape(doc.media.kind, doc.media.width);
  const options: JobOptions = {
    mediaWidth: tape.code,
    autoCut: doc.print.cut === 'each',
    cutEvery: doc.print.cutEvery,
    halfCut: doc.print.halfCut,
    chain: doc.print.chain,
    mirror: false, // mirroring is done in the bitmap so it works in every mode
    noCut: doc.print.cut === 'none' && !doc.print.chain,
    minimal,
  };
  const chunks = buildJob(bitmaps.map((b) => bitmapToRaster(b, profile)), profile, options);
  return { bitmaps, profile, options, chunks, bytes: chunks.reduce((s, c) => s + c.length, 0) };
}

export async function runJob(job: PreparedJob): Promise<void> {
  const st = usePrinter.getState();
  const t = st.transport;
  if (!t) throw new Error('Connect a printer first.');
  if (job.profile.unsupported) log('error', job.profile.unsupported);
  usePrinter.setState({ busy: true, progress: 0 });
  try {
    const total = job.bytes;
    let sent = 0;
    log('info', `Sending ${job.bitmaps.length} label(s), ${(total / 1024).toFixed(1)} KB to ${job.profile.name}${job.options.minimal ? ' (minimal protocol)' : ''}`);
    for (const chunk of job.chunks) {
      await t.write(chunk);
      sent += chunk.length;
      usePrinter.setState({ progress: sent / total });
    }
    log('info', 'Job sent.');
    // Read any completion / error status the printer pushes.
    const bytes = await t.read(1500);
    const found = bytes.length ? findStatus(bytes) : null;
    if (found) {
      usePrinter.setState({ status: found.status });
      if (found.status.errors.length) throw new Error(`Printer reports: ${found.status.errors.join(', ')}`);
    }
  } finally {
    usePrinter.setState({ busy: false });
  }
}

export async function feedAndCut(profile: PrinterProfile, mediaWidth: number) {
  const t = usePrinter.getState().transport;
  if (!t) throw new Error('Connect a printer first.');
  for (const c of buildFeedCutJob(profile, mediaWidth)) await send(t, c);
}

export function effectiveProfile(settingsId: string): PrinterProfile {
  return usePrinter.getState().detectedProfile ?? profileById(settingsId);
}
