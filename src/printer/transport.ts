// Browser transports. WebUSB talks to the printer's USB printer-class
// interface directly. Web Serial covers Bluetooth Classic (SPP/RFCOMM): Chrome
// can open the printer's RFCOMM channel directly, or the user can pick the
// virtual COM port their OS created when pairing.

import { BROTHER_VID } from './profiles';

export interface Transport {
  kind: 'usb' | 'serial' | 'native';
  label: string;
  usbProductId?: number;
  write(data: Uint8Array): Promise<void>;
  /** Read whatever arrives within the timeout. */
  read(timeoutMs: number): Promise<Uint8Array>;
  close(): Promise<void>;
  onDisconnect?: () => void;
}

export const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';

export const supportsUsb = () => typeof navigator !== 'undefined' && 'usb' in navigator;
export const supportsSerial = () => typeof navigator !== 'undefined' && 'serial' in navigator;
/**
 * On macOS, Chrome's direct RFCOMM link to the PT-E560BT fails to open, but the
 * serial port macOS creates when pairing (/dev/cu.PT-E560BT…) works.
 */
export const isMac = () => typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function connectUsb(device?: USBDevice): Promise<Transport> {
  if (!supportsUsb()) throw new Error('WebUSB is not available in this browser. Use Chrome or Edge on desktop or Android.');
  const dev = device ?? (await navigator.usb.requestDevice({ filters: [{ vendorId: BROTHER_VID }] }));
  await dev.open();
  if (dev.configuration === null) await dev.selectConfiguration(1);
  const config = dev.configuration!;
  // Prefer the printer-class interface (class 7); fall back to the first one
  // with a bulk OUT endpoint.
  const ifaces = config.interfaces;
  const pick =
    ifaces.find((i) => i.alternates.some((a) => a.interfaceClass === 7)) ??
    ifaces.find((i) => i.alternates.some((a) => a.endpoints.some((e) => e.type === 'bulk' && e.direction === 'out')));
  if (!pick) throw new Error('No printer interface found on this USB device.');
  try {
    await dev.claimInterface(pick.interfaceNumber);
  } catch (e) {
    throw new Error(
      `Could not claim the printer's USB interface (${(e as Error).message}). ` +
        'On Windows the Brother driver owns the device: use Bluetooth, or switch the device to WinUSB with Zadig. ' +
        'On Linux, unload the usblp module (sudo rmmod usblp) or add a udev rule.',
    );
  }
  const alt = pick.alternates.find((a) => a.interfaceClass === 7) ?? pick.alternates[0];
  const out = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'out');
  const inp = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'in');
  if (!out) throw new Error('No bulk OUT endpoint.');

  const t: Transport = {
    kind: 'usb',
    label: `${dev.productName ?? 'Brother printer'} (USB)`,
    usbProductId: dev.productId,
    async write(data) {
      const CHUNK = 16384;
      for (let o = 0; o < data.length; o += CHUNK) {
        const r = await dev.transferOut(out.endpointNumber, data.subarray(o, o + CHUNK) as BufferSource);
        if (r.status !== 'ok') throw new Error(`USB transfer ${r.status}`);
      }
    },
    async read(timeoutMs) {
      if (!inp) return new Uint8Array();
      const deadline = Date.now() + timeoutMs;
      const parts: number[] = [];
      while (Date.now() < deadline) {
        const r = await Promise.race([
          dev.transferIn(inp.endpointNumber, 64),
          sleep(Math.max(10, deadline - Date.now())).then(() => null),
        ]);
        if (r && r.data && r.data.byteLength) {
          parts.push(...new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength));
          if (parts.length >= 32) break;
        } else if (!r) break;
        else await sleep(50);
      }
      return Uint8Array.from(parts);
    },
    async close() {
      try {
        await dev.releaseInterface(pick.interfaceNumber);
      } catch {
        /* already released */
      }
      await dev.close().catch(() => undefined);
    },
  };
  const onDisc = (ev: USBConnectionEvent) => {
    if (ev.device === dev) {
      navigator.usb.removeEventListener('disconnect', onDisc);
      t.onDisconnect?.();
    }
  };
  navigator.usb.addEventListener('disconnect', onDisc);
  return t;
}

// Bluetooth SPP links often fail to open while the radio pages the printer
// (macOS drops the link after pairing and reconnects on demand, which can take
// a few seconds), so retry with growing pauses before explaining the usual causes.
async function openWithRetry(port: SerialPort, log: (msg: string) => void): Promise<void> {
  const delays = [0, 2000, 4000];
  let last: Error | null = null;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await sleep(delays[i]);
    try {
      await port.open({ baudRate: 115200, bufferSize: 65536 });
      return;
    } catch (e) {
      last = e as Error;
      if (last.name === 'InvalidStateError') return; // already open
      log(`Open attempt ${i + 1} of ${delays.length} failed: ${last.name}: ${last.message}`);
    }
  }
  try {
    await port.forget?.();
  } catch {
    /* ignore */
  }
  const info = port.getInfo() as SerialPortInfo & { bluetoothServiceClassId?: string };
  throw new Error(
    `Could not open the printer port (${last?.name}: ${last?.message}). ` +
      (info.bluetoothServiceClassId && isMac()
        ? 'On a Mac, choose Serial / Bluetooth COM port instead and pick the entry starting with "cu." (for example cu.PT-E560BT…). '
        : 'Check the printer is switched on and not connected to a phone or another app (the PT-E560BT accepts one Bluetooth connection at a time), then try again. ') +
      'If it still fails, connect with the USB cable instead.',
  );
}

export async function connectSerial(opts: { bluetoothOnly?: boolean; log?: (msg: string) => void } = {}): Promise<Transport> {
  const log = opts.log ?? (() => undefined);
  if (!supportsSerial()) throw new Error('Web Serial is not available in this browser. Use Chrome or Edge 117+ on desktop.');
  let port: SerialPort;
  try {
    port = await navigator.serial.requestPort(
      opts.bluetoothOnly
        ? ({ allowedBluetoothServiceClassIds: [SPP_UUID], filters: [{ bluetoothServiceClassId: SPP_UUID }] } as SerialPortRequestOptions)
        : ({ allowedBluetoothServiceClassIds: [SPP_UUID] } as SerialPortRequestOptions),
    );
  } catch (e) {
    if ((e as Error).name === 'NotFoundError') throw new Error('No port selected.');
    throw e;
  }
  const info = port.getInfo() as SerialPortInfo & { bluetoothServiceClassId?: string };
  log(
    info.bluetoothServiceClassId
      ? `Opening Bluetooth RFCOMM link (service ${info.bluetoothServiceClassId})…`
      : info.usbVendorId != null
        ? `Opening USB serial port ${info.usbVendorId.toString(16)}:${info.usbProductId?.toString(16)}…`
        : 'Opening serial port (OS Bluetooth/COM port)…',
  );
  await openWithRetry(port, log);
  const writer = port.writable!.getWriter();
  let pending: number[] = [];
  let reading = true;
  let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  // Background reader keeps the stream drained and buffers status packets.
  const readLoop = (async () => {
    while (reading && port.readable) {
      const reader = port.readable.getReader();
      currentReader = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) pending.push(...value);
        }
      } catch {
        /* port closed or read error */
      } finally {
        reader.releaseLock();
      }
      if (!reading) break;
      await sleep(50);
    }
  })();

  const label = info.bluetoothServiceClassId
    ? 'Bluetooth (RFCOMM)'
    : info.usbVendorId != null
      ? `Serial USB ${info.usbVendorId.toString(16)}:${info.usbProductId?.toString(16)}`
      : 'Serial / Bluetooth COM port';

  const t: Transport = {
    kind: 'serial',
    label,
    usbProductId: info.usbVendorId === BROTHER_VID ? info.usbProductId : undefined,
    async write(data) {
      // Bluetooth SPP links have small buffers; pace the writes.
      const CHUNK = 512;
      for (let o = 0; o < data.length; o += CHUNK) {
        await writer.write(data.subarray(o, o + CHUNK));
        if (o + CHUNK < data.length) await sleep(8);
      }
    },
    async read(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && pending.length < 32) await sleep(25);
      const out = Uint8Array.from(pending);
      pending = [];
      return out;
    },
    async close() {
      reading = false;
      await currentReader?.cancel().catch(() => undefined);
      try {
        writer.releaseLock();
      } catch {
        /* ignore */
      }
      await port.close().catch(() => undefined);
      await readLoop.catch(() => undefined);
    },
  };
  port.addEventListener('disconnect', () => t.onDisconnect?.());
  return t;
}
