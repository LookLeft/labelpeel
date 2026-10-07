// Transport for the iOS wrapper app (ios/). The app hosts this build in a
// WKWebView and exposes a "ptouch" message handler that talks to the printer
// through Apple's External Accessory framework, which is the only way iOS
// lets an app use a Bluetooth Classic printer. Bytes cross the bridge as
// base64.

import type { Transport } from './transport';

interface NativeHandler {
  postMessage(msg: unknown): Promise<unknown>;
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: { ptouch?: NativeHandler } };
    __ptouchNativeDisconnect?: () => void;
  }
}

const handler = () => (typeof window !== 'undefined' ? window.webkit?.messageHandlers?.ptouch : undefined);

export const supportsNative = () => !!handler();

const call = async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
  const h = handler();
  if (!h) throw new Error('The iOS printer bridge is not available.');
  return (await h.postMessage({ op, ...args })) as T;
};

const toB64 = (data: Uint8Array) => {
  let s = '';
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
};

const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export async function connectNative(): Promise<Transport> {
  const info = await call<{ name: string }>('connect');
  const t: Transport = {
    kind: 'native',
    label: `${info.name} (Bluetooth)`,
    async write(data) {
      await call('write', { data: toB64(data) });
    },
    async read(timeoutMs) {
      const b64 = await call<string>('read', { timeoutMs });
      return b64 ? fromB64(b64) : new Uint8Array();
    },
    async close() {
      window.__ptouchNativeDisconnect = undefined;
      await call('close').catch(() => undefined);
    },
  };
  window.__ptouchNativeDisconnect = () => t.onDisconnect?.();
  return t;
}
