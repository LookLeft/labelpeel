import { create } from 'zustand';
import { findTape, MM_PER_INCH } from '../model/media';
import { enumeratePages } from '../model/pages';
import type { LabelDoc } from '../model/types';
import { preloadDoc } from '../render/assets';
import { renderPrintBitmap, type PrintBitmap } from '../render/render';
import { buildFeedCutJob, buildJob, cmdInit, cmdInvalidate, cmdStatusRequest, concat, hex, type JobOptions } from './protocol';
import { profileById, profileByPid, type PrinterProfile } from './profiles';
import { bitmapToRaster } from './raster';
import { findAllStatus, findStatus, type PrinterStatus } from './status';
import { connectNative } from './native';
import { connectSerial, connectUsb, isMac, type Transport } from './transport';

export interface LogLine {
  t: number;
  level: 'info' | 'tx' | 'rx' | 'error';
  text: string;
}

interface PrinterState {
  transport: Transport | null;
  connecting: boolean;
  status: PrinterStatus | null;
  /**
   * The printer has sent a status reply since connecting. A serial port can
   * open with nothing behind it (macOS keeps a paired printer's cu. port even
   * when the printer is off), so only a reply proves the link works.
   */
  responded: boolean;
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
  responded: false,
  detectedProfile: null,
  busy: false,
  progress: 0,
  log: [],
  addLog: (level, text) => set({ log: [...get().log.slice(-300), { t: Date.now(), level, text }] }),
}));

const log = (level: LogLine['level'], text: string) => usePrinter.getState().addLog(level, text);

export async function connect(kind: 'usb' | 'bluetooth' | 'serial' | 'native' | 'native-usb'): Promise<Transport> {
  const st = usePrinter.getState();
  if (st.transport) await disconnect();
  usePrinter.setState({ connecting: true });
  try {
    const t =
      kind === 'native' || kind === 'native-usb'
        ? await connectNative(kind === 'native-usb' ? 'usb' : 'bluetooth')
        : kind === 'usb'
          ? await connectUsb()
          : await connectSerial({ bluetoothOnly: kind === 'bluetooth', log: (msg) => log('info', msg) });
    t.onDisconnect = () => {
      log('error', 'Printer disconnected.');
      usePrinter.setState({ transport: null, status: null, responded: false });
    };
    const detected = t.usbProductId != null ? profileByPid(t.usbProductId) ?? null : null;
    usePrinter.setState({ transport: t, detectedProfile: detected, responded: false });
    // Opening a serial port doesn't prove the printer is there; its reply does.
    log('info', `${t.kind === 'serial' ? 'Port opened' : 'Connected'}: ${t.label}${detected ? ` — ${detected.name}` : ''}`);
    refreshStatus().catch((e) => log('error', `Status: ${(e as Error).message}`));
    return t;
  } finally {
    usePrinter.setState({ connecting: false });
  }
}

export async function disconnect() {
  const t = usePrinter.getState().transport;
  usePrinter.setState({ transport: null, status: null, responded: false, detectedProfile: null });
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
    if (t.kind === 'serial') log('error', notRespondingMessage());
    else log('info', 'No status reply (normal for some Bluetooth connections).');
    return null;
  }
  const s = found.status;
  usePrinter.setState({ status: s, responded: true });
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
    const slice = (src: Uint8Array, rows: number) => {
      const dst = new Uint8Array(w * rows);
      for (let r = 0; r < rows; r++) dst.set(src.subarray(r * bmp.width + a, r * bmp.width + b), r * w + lead);
      return dst;
    };
    const spill = bmp.spill && slice(bmp.spill, bmp.margin * 2);
    const spillDots = spill ? spill.reduce((n, v) => n + v, 0) : 0;
    out.push({ width: w, height: bmp.height, bits: slice(bmp.bits, bmp.height), lengthMm: w / dpm, margin: bmp.margin, spill: spillDots ? spill : null, spillDots });
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
    await watchJob(t);
  } finally {
    usePrinter.setState({ busy: false });
  }
}

/**
 * Follow the status packets the printer pushes while it prints: phase changes,
 * "printing completed" (possibly once per label) and errors such as tape end or
 * a jam, which can arrive well after the data has been sent.
 */
async function watchJob(t: Transport) {
  const start = Date.now();
  const hardStop = start + 20000;
  let deadline = start + 2500; // links that never report status end here
  let buf: Uint8Array = new Uint8Array();
  let seen = 0;
  const silentBefore = !usePrinter.getState().responded;
  while (Date.now() < deadline) {
    const bytes = await t.read(Math.max(50, deadline - Date.now()));
    if (!bytes.length) continue;
    buf = concat([buf, bytes]);
    const all = findAllStatus(buf);
    for (const s of all.slice(seen)) {
      log('rx', `${s.statusTypeName}${s.errors.length ? `: ${s.errors.join(', ')}` : ''}`);
      usePrinter.setState({ status: s, responded: true });
      if (s.statusType === 0x02 || s.errors.length) throw new Error(`Printer reports: ${s.errors.join(', ') || 'an error'}`);
      // Still printing: keep waiting. Completed: wait briefly for more labels.
      deadline = s.statusType === 0x01 ? Math.min(hardStop, Date.now() + 1500) : hardStop;
    }
    seen = all.length;
  }
  if (silentBefore && !seen && t.kind === 'serial') {
    log('error', 'The printer never replied. If nothing printed, it isn\'t really connected: ' + notRespondingMessage());
  }
}

/** Why a serial port can be open with no printer behind it, and what to do. */
export function notRespondingMessage() {
  return (
    "The port opened, but the printer didn't respond. It may be off, out of range, showing an error, or connected to another device, " +
    'and nothing will print until it answers. ' +
    (isMac() ? 'macOS lists the cu. port whenever the printer is paired, even when it is off. ' : '') +
    'Turn the printer on, disconnect it from other devices, then press Status to check again.'
  );
}

export async function feedAndCut(profile: PrinterProfile, mediaWidth: number) {
  const t = usePrinter.getState().transport;
  if (!t) throw new Error('Connect a printer first.');
  for (const c of buildFeedCutJob(profile, mediaWidth)) await send(t, c);
}

export function effectiveProfile(settingsId: string): PrinterProfile {
  return usePrinter.getState().detectedProfile ?? profileById(settingsId);
}
