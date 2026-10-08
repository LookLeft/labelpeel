import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { useEditor } from '../state/store';
import { actualPxPerMm, measuredPxPerMm, NOMINAL_PX_PER_MM } from './screen';

// ISO/IEC 7810 ID-1: bank cards, driving licences and most ID cards.
const CARD = { w: 85.6, h: 53.98, r: 3.18 };

/** Match a card or ruler on screen to a real one, so 100% zoom is real size. */
export function CalibrateDialog() {
  const open = useEditor((s) => s.calibrateOpen);
  const settings = useEditor((s) => s.settings);
  const [pxPerMm, setPxPerMm] = useState(() => actualPxPerMm(settings));
  const bodyRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(600);
  useEffect(() => {
    if (!open) return;
    setPxPerMm(actualPxPerMm(useEditor.getState().settings));
    const el = bodyRef.current;
    if (el) setRoom(el.clientWidth - 40);
  }, [open]);
  if (!open) return null;

  const st = useEditor.getState;
  const close = () => st().set({ calibrateOpen: false });
  const measured = measuredPxPerMm();
  // Phones are often narrower than a card; use a shorter ruler there.
  const showCard = CARD.w * pxPerMm <= room;
  // Up to 10 cm, in whole centimetres that fit the dialog.
  const rulerMm = Math.max(20, Math.min(100, Math.floor(room / pxPerMm / 10) * 10));
  const nudge = (k: number) => setPxPerMm((v) => Math.max(NOMINAL_PX_PER_MM * 0.4, Math.min(NOMINAL_PX_PER_MM * 3, v * k)));
  const zoom100 = () => window.dispatchEvent(new CustomEvent('labelsmith-zoom', { detail: '100' }));

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal narrow">
        <div className="modal-head">
          <h2>Calibrate actual size</h2>
          <div className="spacer" />
          <button className="btn ghost icon" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body" ref={bodyRef}>
          <p style={{ marginTop: 0 }}>
            {showCard
              ? 'Hold a bank card against the screen and adjust until the outline matches its edges. Or measure the ruler with a real one.'
              : 'Hold a ruler against the screen and adjust until the marks match.'}{' '}
            100% zoom then shows labels at their real size.
          </p>
          {measured && (
            <div className="callout" style={{ marginBottom: 12 }}>
              The Mac app measures your display, so this should already match. Adjust it only if it doesn't.
            </div>
          )}
          <div className="calibrate-stage">
            {showCard && (
              <div
                className="calibrate-card"
                style={{ width: CARD.w * pxPerMm, height: CARD.h * pxPerMm, borderRadius: CARD.r * pxPerMm }}
              >
                85.6 × 54 mm
              </div>
            )}
            <div className="calibrate-ruler" style={{ width: rulerMm * pxPerMm }}>
              {Array.from({ length: rulerMm + 1 }, (_, mm) => (
                <span key={mm} className={mm % 10 === 0 ? 'cm' : mm % 5 === 0 ? 'half' : ''} style={{ left: mm * pxPerMm }}>
                  {mm % 10 === 0 && <b>{mm / 10}</b>}
                </span>
              ))}
            </div>
          </div>
          <div className="row tight" style={{ marginTop: 14 }}>
            <button className="btn icon" title="Smaller" onClick={() => nudge(1 / 1.002)}>
              <Minus size={15} />
            </button>
            <input
              type="range"
              min={NOMINAL_PX_PER_MM * 0.4}
              max={NOMINAL_PX_PER_MM * 3}
              step={0.001}
              value={pxPerMm}
              onChange={(e) => setPxPerMm(Number(e.target.value))}
              aria-label="Screen scale"
              style={{ flex: 1 }}
            />
            <button className="btn icon" title="Larger" onClick={() => nudge(1.002)}>
              <Plus size={15} />
            </button>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {Math.round(pxPerMm * 25.4 * (window.devicePixelRatio || 1))} pixels per inch on this screen
          </div>
        </div>
        <div className="modal-foot">
          <button
            className="btn"
            onClick={() => {
              st().setSettings({ screenDevicePxPerMm: null });
              setPxPerMm(actualPxPerMm({ screenDevicePxPerMm: null }));
            }}
          >
            Reset
          </button>
          <div className="spacer" />
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              st().setSettings({ screenDevicePxPerMm: pxPerMm * (window.devicePixelRatio || 1) });
              close();
              zoom100();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
