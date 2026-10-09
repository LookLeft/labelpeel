import { useEffect, useMemo, useRef, useState } from 'react';
import { X, ArrowLeft, FolderOpen, FileUp } from 'lucide-react';
import { useEditor } from '../state/store';
import { LABEL_TYPES, labelType, applyLabelType, DB_PRESETS } from '../model/labelTypes';
import { fitMedia, isDk, mediaOfKind } from '../model/media';
import type { Media } from '../model/types';
import { MediaPicker } from './MediaPicker';
import { newDoc, makeText } from '../model/defaults';
import { ParamsForm } from './Inspector';
import { TypeIcon } from './TypeIcon';
import { importLbxFile, loadDoc, openFile, thumbnail } from './actions';
import { effectiveProfile } from '../printer/service';

export function Wizard() {
  const open = useEditor((s) => s.wizardOpen);
  const set = useEditor((s) => s.set);
  const settings = useEditor((s) => s.settings);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [media, setMedia] = useState<Media>({ kind: 'tze', width: 12, tapeColor: '#ffffff', inkColor: '#111111' });
  const [params, setParams] = useState<Record<string, unknown>>({});
  const profile = effectiveProfile(settings.profileId);

  useEffect(() => {
    if (!open) return;
    setTypeId(null);
    // Start from media the selected printer takes: a 62 mm roll on a QL printer.
    setMedia((m) => (profile.media.includes(m.kind) ? m : profile.ql ? mediaOfKind(m, 'dk') : fitMedia(m, profile.media, profile.maxTape)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const types = LABEL_TYPES.filter((t) => !(profile.ql && t.ptouchOnly));

  const def = typeId ? labelType(typeId) : null;
  const choose = (id: string) => {
    const d = labelType(id);
    setTypeId(id);
    setParams({ ...d.defaults });
    // The type's suggested tape, or the nearest the printer takes (DK on a QL printer).
    setMedia((m) => fitMedia({ ...m, ...d.media, tapeColor: d.media?.tapeColor ?? '#ffffff', inkColor: d.media?.inkColor ?? '#111111' }, profile.media, profile.maxTape));
  };

  const preview = useMemo(() => {
    if (!typeId) return null;
    let doc = applyLabelType(newDoc({ media }), typeId, params);
    if (typeId === 'general') doc = { ...doc, elements: [makeText(doc, 'Hello', { bold: true })] };
    return doc;
  }, [typeId, media, params]);

  const canvasRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!preview || !canvasRef.current) return;
    let alive = true;
    thumbnail(preview, 420, 150).then((c) => {
      if (!alive || !canvasRef.current) return;
      canvasRef.current.replaceChildren(c);
    });
    return () => {
      alive = false;
    };
  }, [preview]);

  if (!open) return null;
  const close = () => set({ wizardOpen: false });
  const create = () => {
    if (!preview) return;
    loadDoc({ ...preview, name: def?.id === 'general' ? 'Untitled label' : def!.name });
    close();
  };

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal">
        <div className="modal-head">
          {def && (
            <button className="btn ghost icon" onClick={() => setTypeId(null)} title="Back">
              <ArrowLeft size={16} />
            </button>
          )}
          <h2>{def ? `New ${def.name.toLowerCase()} label` : 'What are you labelling?'}</h2>
          <div className="spacer" />
          <button className="btn ghost icon" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          {!def ? (
            <>
              <div className="type-grid">
                {types.map((t) => (
                  <button key={t.id} className="type-card" onClick={() => choose(t.id)}>
                    <div className="ic">
                      <TypeIcon name={t.icon} />
                    </div>
                    <div className="t">{t.name}</div>
                    <div className="d">{t.description}</div>
                  </button>
                ))}
              </div>
              <div className="row tight" style={{ marginTop: 16, gap: 8 }}>
                <button className="btn" onClick={() => { close(); openFile(); }}>
                  <FolderOpen size={14} /> Open a saved label
                </button>
                <button className="btn" onClick={() => { close(); importLbxFile(); }}>
                  <FileUp size={14} /> Import P-touch Editor .lbx
                </button>
                <button className="btn" onClick={() => { close(); useEditor.getState().set({ leftTab: 'templates' }); }}>
                  Browse templates
                </button>
              </div>
            </>
          ) : (
            <div className="wizard-split">
              <div>
                <div className="section-title">{isDk(media.kind) ? 'Labels' : 'Tape'}</div>
                <MediaPicker media={media} profile={profile} onMedia={setMedia} onColor={setMedia} />
                {def.params.length > 0 && (
                  <>
                    <div className="section-title" style={{ marginTop: 16 }}>Settings</div>
                    <ParamsForm
                      params={def.params}
                      values={params}
                      onChange={(k, v) => {
                        const next = { ...params, [k]: v };
                        if (k === 'preset' && typeof v === 'string' && DB_PRESETS[v]) {
                          next.circuits = DB_PRESETS[v].circuits;
                          next.pitch = DB_PRESETS[v].pitch;
                        }
                        setParams(next);
                      }}
                    />
                  </>
                )}
              </div>
              <div>
                <div className="section-title">Preview</div>
                <div className="preview-box" ref={canvasRef} />
                <div className="hint" style={{ marginTop: 8 }}>{def.description} You can change every setting later in the right-hand panel.</div>
              </div>
            </div>
          )}
        </div>
        {def && (
          <div className="modal-foot">
            <button className="btn" onClick={() => setTypeId(null)}>
              Back
            </button>
            <button className="btn primary" onClick={create}>
              Create label
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
