import { isDk, MEDIA_KIND_LABELS, mediaOfKind, sizesFor, TAPE_COLORS } from '../model/media';
import type { Media, MediaKind } from '../model/types';
import type { PrinterProfile } from '../printer/profiles';
import { ColorInput, Field, Seg } from './fields';

/**
 * Tape or DK media for a label: kind, size and colours. `onMedia` is for
 * changes that affect the layout (kind, size); `onColor` for colours only.
 */
export function MediaPicker({
  media,
  profile,
  onMedia,
  onColor,
  customColors,
}: {
  media: Media;
  profile: PrinterProfile;
  onMedia: (m: Media) => void;
  onColor: (m: Media, key?: string) => void;
  /** Show the tape and ink colour inputs as well as the presets. */
  customColors?: boolean;
}) {
  const dk = isDk(media.kind);
  const sizes = sizesFor(media.kind).filter((t) => t.width <= profile.maxTape + 0.5);
  // The design's media may not be one this printer takes (e.g. after switching model).
  const kinds = profile.media.includes(media.kind) ? profile.media : [media.kind, ...profile.media];

  return (
    <>
      {kinds.length > 1 && (
        <Field>
          <Seg<MediaKind> value={media.kind} onChange={(kind) => onMedia(mediaOfKind(media, kind))} options={kinds.map((m) => ({ value: m, label: MEDIA_KIND_LABELS[m] }))} />
        </Field>
      )}
      <Field label={media.kind === 'dkdie' ? 'Label size' : 'Width'}>
        <div className="chips">
          {sizes.map((t) => {
            const on = media.width === t.width && (t.length == null || media.length === t.length);
            return (
              <button key={t.label} className={`chip ${on ? 'on' : ''}`} onClick={() => onMedia({ ...media, width: t.width, length: t.length })} title={t.label}>
                {t.length == null ? `${t.width} mm` : t.label.includes('round') ? `${t.width} mm round` : `${t.width} × ${t.length}`}
              </button>
            );
          })}
        </div>
      </Field>
      {dk ? (
        <div className="hint">Black on white paper. DK labels print black only for now.</div>
      ) : (
        <>
          <Field label="Colour">
            <div className="swatches">
              {TAPE_COLORS.map((c) => (
                <button
                  key={c.name}
                  title={c.name}
                  className={`swatch ${media.tapeColor === c.tape && media.inkColor === c.ink ? 'on' : ''}`}
                  style={{ background: c.tape, color: c.ink }}
                  onClick={() => onColor({ ...media, tapeColor: c.tape, inkColor: c.ink })}
                >
                  A
                </button>
              ))}
            </div>
          </Field>
          {customColors && (
            <div className="row">
              <Field label="Tape">
                <ColorInput value={media.tapeColor} onChange={(v) => onColor({ ...media, tapeColor: v }, 'tapeColor')} />
              </Field>
              <Field label="Ink">
                <ColorInput value={media.inkColor} onChange={(v) => onColor({ ...media, inkColor: v }, 'inkColor')} />
              </Field>
            </div>
          )}
        </>
      )}
    </>
  );
}
