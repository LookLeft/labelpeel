import { X, Usb, Bluetooth, Cable, RefreshCw, Scissors, Unplug } from 'lucide-react';
import { useEditor } from '../state/store';
import { connect, disconnect, feedAndCut, refreshStatus, usePrinter, effectiveProfile } from '../printer/service';
import { PROFILES } from '../printer/profiles';
import { isMac, supportsSerial, supportsUsb } from '../printer/transport';
import { isAndroidApp, supportsNative } from '../printer/native';
import { Check, Field, Select } from './fields';
import { findTape } from '../model/media';
import { matchLoadedTape } from './actions';

export function PrinterPanel() {
  const open = useEditor((s) => s.printerOpen);
  const settings = useEditor((s) => s.settings);
  const doc = useEditor((s) => s.doc);
  const st = useEditor.getState;
  const { transport, connecting, status, responded, detectedProfile, log } = usePrinter();
  if (!open) return null;
  const close = () => st().set({ printerOpen: false });
  const profile = effectiveProfile(settings.profileId);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      const msg = (e as Error).message;
      if (!/No (port|device) selected|cancel/i.test(msg)) st().notify(msg, 'error');
      usePrinter.getState().addLog('error', msg);
    }
  };

  const useTape = () => status && matchLoadedTape(status);
  const mismatch = status && status.mediaWidth && Math.abs(findTape(doc.media.kind, doc.media.width).code - status.mediaWidth) > 0.5;

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal narrow">
        <div className="modal-head">
          <h2>Printer</h2>
          <div className="spacer" />
          <button className="btn ghost icon" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <Field label="Model" hint={detectedProfile ? `Detected over USB: ${detectedProfile.name}` : 'Select your model. USB connections detect it automatically.'}>
            <Select
              value={detectedProfile?.id ?? settings.profileId}
              onChange={(profileId) => {
                st().setSettings({ profileId });
                usePrinter.setState({ detectedProfile: null });
              }}
              options={PROFILES.map((p) => ({ value: p.id, label: `${p.name}${p.bluetooth ? ' (Bluetooth)' : ''}` }))}
            />
          </Field>
          {profile.unsupported && <div className="callout warn" style={{ marginBottom: 12 }}>{profile.unsupported}</div>}

          {!transport ? (
            <>
              <div className="section-title">Connect</div>
              {supportsNative() ? (
                <>
                  <button className="btn block" disabled={connecting} onClick={() => run(() => connect('native'))}>
                    <Bluetooth size={15} /> Bluetooth printer
                  </button>
                  <div className="hint" style={{ marginTop: 12 }}>
                    {isAndroidApp()
                      ? 'Pair the printer in Android Settings → Bluetooth first, then tap Bluetooth printer. If it\'s connected to another phone or app, disconnect it there first.'
                      : 'Turn the printer on. If it isn\'t paired yet, iOS shows a list of nearby printers to pair with. If it\'s connected to another phone or app, disconnect it there first.'}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {/* On a Mac only the cu.* serial port works, so list every port. */}
                    <button className="btn block" disabled={!supportsSerial() || connecting} onClick={() => run(() => connect(isMac() ? 'serial' : 'bluetooth'))}>
                      <Bluetooth size={15} /> Bluetooth (pair in your OS first)
                    </button>
                    <button className="btn block" disabled={!supportsUsb() || connecting} onClick={() => run(() => connect('usb'))}>
                      <Usb size={15} /> USB cable
                    </button>
                    <button className="btn block" disabled={!supportsSerial() || connecting} onClick={() => run(() => connect('serial'))}>
                      <Cable size={15} /> Serial / Bluetooth COM port
                    </button>
                  </div>
                  {!supportsSerial() && !supportsUsb() && (
                    <div className="callout err" style={{ marginTop: 12 }}>
                      This browser cannot talk to printers. Use Chrome or Edge on Windows, macOS, Linux or ChromeOS (or Chrome on Android for USB). You can still design labels and download print files.
                    </div>
                  )}
                  <div className="hint" style={{ marginTop: 12 }}>
                    {isMac() ? (
                      <>
                        <b>Bluetooth on a Mac:</b> pair the printer in System Settings → Bluetooth (it's normal for it to show “Not Connected” afterwards). Then click Bluetooth and pick the entry starting with <b>cu.</b>, for example <code>cu.PT-E560BT…</code>, not the plain PT-E560BT one.<br />
                      </>
                    ) : (
                      <>
                        <b>Bluetooth:</b> the PT-E560BT uses Bluetooth Classic. Pair it in your system settings, then choose it here (Chrome 117+ lists paired printers directly; on Windows you can also pick its outgoing COM port).<br />
                      </>
                    )}
                    <b>USB:</b> works on macOS, Linux, ChromeOS and Android. On Windows the Brother driver holds the USB device, so use Bluetooth there.
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="callout" style={{ marginBottom: 12 }}>
                <span className={`dot ${status?.errors.length ? 'err' : responded || transport.kind !== 'serial' ? 'on' : 'warn'}`} style={{ marginTop: 5 }} />
                <div style={{ flex: 1 }}>
                  <b>{transport.label}</b>
                  {!responded && transport.kind === 'serial' ? (
                    <div className="hint">Port open, but the printer hasn't responded. Check it's on and not connected to another device, then press Status.</div>
                  ) : status ? (
                    <div>
                      {status.mediaWidth} mm {status.mediaTypeName} · {status.tapeColorName} / {status.textColorName}
                      {status.errors.length > 0 && <div style={{ color: 'var(--danger)' }}>{status.errors.join(', ')}</div>}
                    </div>
                  ) : (
                    <div className="hint">No status yet (some Bluetooth links only reply during printing).</div>
                  )}
                </div>
              </div>
              {mismatch && (
                <div className="callout warn" style={{ marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    The printer has {status!.mediaWidth} mm tape but the label is designed for {doc.media.width} mm.
                    <button className="btn sm" style={{ marginLeft: 8 }} onClick={useTape}>
                      Use {status!.mediaWidth} mm
                    </button>
                  </div>
                </div>
              )}
              <div className="row" style={{ marginBottom: 12 }}>
                <button className="btn" onClick={() => run(refreshStatus)}>
                  <RefreshCw size={14} /> Status
                </button>
                <button className="btn" onClick={() => run(() => feedAndCut(profile, findTape(doc.media.kind, doc.media.width).code))}>
                  <Scissors size={14} /> Feed &amp; cut
                </button>
                {status && (
                  <button className="btn" onClick={useTape}>
                    Match tape
                  </button>
                )}
                <button className="btn danger" onClick={() => run(disconnect)}>
                  <Unplug size={14} /> Disconnect
                </button>
              </div>
            </>
          )}

          <div className="section-title" style={{ marginTop: 16 }}>Advanced</div>
          <Check
            checked={settings.minimalProtocol}
            onChange={(minimalProtocol) => st().setSettings({ minimalProtocol })}
            label="Minimal command set"
          />
          <div className="hint" style={{ marginBottom: 10 }}>
            Sends only a basic command sequence known to work on these printers. Try this if labels don't print; cut and half-cut options are then left to the printer's defaults.
          </div>
          <Field label="Date format for {{date}}">
            <Select
              value={settings.dateFormat}
              onChange={(dateFormat) => st().setSettings({ dateFormat })}
              options={['DD/MM/YYYY', 'DD.MM.YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'D MMM YYYY', 'MMM YYYY'].map((f) => ({ value: f, label: f }))}
            />
          </Field>
          <div className="section-title">Log</div>
          <div className="log">
            {log.length === 0 && <span className="tx">Nothing yet.</span>}
            {log.slice(-80).map((l, i) => (
              <div key={i} className={l.level}>
                {new Date(l.t).toLocaleTimeString()} {l.level === 'tx' ? '→' : l.level === 'rx' ? '←' : ''} {l.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
