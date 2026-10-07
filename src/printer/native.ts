// Transport for the native apps (ios/, macos/ and android/). Each app hosts this build
// in a web view and exposes a "labelsmith" bridge that talks to the printer
// over Bluetooth Classic: External Accessory on iOS, IOBluetooth on macOS, an
// RFCOMM socket on Android. Bytes cross the bridge as base64.

import type { Transport } from './transport';

interface NativeHandler {
  postMessage(msg: unknown): Promise<unknown>;
}

/** Android's JavaScript interface: replies arrive via window.__labelsmithReply. */
interface AndroidBridge {
  postMessage(json: string, id: string): void;
  saveFile?(name: string, mime: string, base64: string): void;
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: { labelsmith?: NativeHandler } };
    LabelsmithAndroid?: AndroidBridge;
    __labelsmithNativeDisconnect?: () => void;
    /** Set by the macOS app before the page loads (iPads also report a Mac platform). */
    __labelsmithPlatform?: 'macos';
    __labelsmithReply?: (id: string, result: unknown, error: string | null) => void;
  }
}

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let nextId = 0;

const handler = (): NativeHandler | undefined => {
  if (typeof window === 'undefined') return undefined;
  const ios = window.webkit?.messageHandlers?.labelsmith;
  if (ios) return ios;
  const android = window.LabelsmithAndroid;
  if (!android) return undefined;
  window.__labelsmithReply ??= (id, result, error) => {
    const p = pending.get(id);
    pending.delete(id);
    if (error) p?.reject(new Error(error));
    else p?.resolve(result);
  };
  return {
    postMessage: (msg) =>
      new Promise((resolve, reject) => {
        const id = String(++nextId);
        pending.set(id, { resolve, reject });
        android.postMessage(JSON.stringify(msg), id);
      }),
  };
};

export const supportsNative = () => !!handler();
/** Which native app is hosting the page, if any. */
export const nativePlatform = (): 'android' | 'macos' | 'ios' | null => {
  if (!supportsNative()) return null;
  if (window.LabelsmithAndroid) return 'android';
  return window.__labelsmithPlatform === 'macos' ? 'macos' : 'ios';
};

const call = async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
  const h = handler();
  if (!h) throw new Error('The printer bridge is not available.');
  return (await h.postMessage({ op, ...args })) as T;
};

export const toB64 = (data: Uint8Array) => {
  let s = '';
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
};

const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** The macOS and Android apps can also print over USB; iOS can't. */
export const nativeSupportsUsb = () => nativePlatform() === 'macos' || nativePlatform() === 'android';

export async function connectNative(kind: 'bluetooth' | 'usb' = 'bluetooth'): Promise<Transport> {
  const info = await call<{ name: string; productId?: number }>('connect', { kind });
  const t: Transport = {
    kind: 'native',
    label: `${info.name} (${kind === 'usb' ? 'USB' : 'Bluetooth'})`,
    // Over USB the product ID identifies the model, as with WebUSB.
    usbProductId: kind === 'usb' ? info.productId : undefined,
    async write(data) {
      await call('write', { data: toB64(data) });
    },
    async read(timeoutMs) {
      const b64 = await call<string>('read', { timeoutMs });
      return b64 ? fromB64(b64) : new Uint8Array();
    },
    async close() {
      window.__labelsmithNativeDisconnect = undefined;
      await call('close').catch(() => undefined);
    },
  };
  window.__labelsmithNativeDisconnect = () => t.onDisconnect?.();
  return t;
}
