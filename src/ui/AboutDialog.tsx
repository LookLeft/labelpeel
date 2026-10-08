import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useEditor } from '../state/store';

export const TRADEMARK_NOTICE =
  'Labelpeel is an independent project and is not affiliated with, endorsed by or sponsored by Brother Industries, Ltd. ' +
  'Brother, P-touch, TZe, HSe and FLe are trademarks of Brother Industries, Ltd. Printer model names are used only to describe compatibility.';

export function AboutDialog() {
  const open = useEditor((s) => s.aboutOpen);
  const [licenses, setLicenses] = useState<string | null>(null);
  const [showLicenses, setShowLicenses] = useState(false);
  useEffect(() => {
    if (!showLicenses || licenses !== null) return;
    fetch('./licenses.txt')
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.statusText))))
      .then(setLicenses)
      .catch(() => setLicenses('Licence information could not be loaded.'));
  }, [showLicenses, licenses]);
  if (!open) return null;
  const close = () => useEditor.getState().set({ aboutOpen: false });

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal narrow">
        <div className="modal-head">
          <img className="brand-mark" src="./icon-192.png" alt="" />
          <h2>Labelpeel</h2>
          <span className="hint">v{__APP_VERSION__}</span>
          <div className="spacer" />
          <button className="btn ghost icon" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <p style={{ marginTop: 0 }}>Design and print labels on Brother P-touch compatible label printers over Bluetooth or USB.</p>
          <div className="callout">{TRADEMARK_NOTICE}</div>
          <p className="hint">
            Printer protocol details are based on Brother's published raster command reference. Brother's .lbx format is imported on a
            best-effort basis for interoperability.
          </p>
          <button className="btn" onClick={() => setShowLicenses(!showLicenses)}>
            {showLicenses ? 'Hide' : 'Show'} open-source licences
          </button>
          {showLicenses && <pre className="log" style={{ marginTop: 10, maxHeight: 320 }}>{licenses ?? 'Loading…'}</pre>}
        </div>
      </div>
    </div>
  );
}
