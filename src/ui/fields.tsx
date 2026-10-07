import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { allFonts, onFontsChanged } from '../render/fonts';

export function Field({ label, children, hint }: { label?: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

const round = (v: number, step = 0.1) => {
  const d = Math.max(0, -Math.floor(Math.log10(step)));
  return Number(v.toFixed(Math.min(4, d + 1)));
};

export function NumberInput({
  value,
  onChange,
  unit,
  prefix,
  min,
  max,
  step = 0.5,
  title,
}: {
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  prefix?: string;
  min?: number;
  max?: number;
  step?: number;
  title?: string;
}) {
  const [text, setText] = useState(String(round(value, step)));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(round(value, step)));
  }, [value, focused, step]);
  const commit = (s: string) => {
    const v = Number(s.replace(',', '.'));
    if (!isFinite(v) || s.trim() === '') return;
    let c = v;
    if (min != null) c = Math.max(min, c);
    if (max != null) c = Math.min(max, c);
    onChange(c);
  };
  return (
    <div className={`num ${prefix ? 'has-prefix' : ''}`} title={title}>
      {prefix && <span className="prefix">{prefix}</span>}
      <input
        className="input"
        inputMode="decimal"
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit(text);
        }}
        onChange={(e) => {
          setText(e.target.value);
          if (/^-?\d+([.,]\d+)?$/.test(e.target.value.trim())) commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const k = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const v = round((Number(text) || 0) + k, step);
            setText(String(v));
            commit(String(v));
          } else if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </div>
  );
}

export function TextInput({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <input
      className="input"
      value={value}
      placeholder={placeholder}
      style={mono ? { fontFamily: 'Roboto Mono, monospace', fontSize: 12 } : undefined}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
}

export function TextArea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      className="textarea"
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
}

export function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Seg<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.value)} title={o.title} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function FontSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [, force] = useState(0);
  useEffect(() => {
    const off = onFontsChanged(() => force((n) => n + 1));
    return () => {
      off();
    };
  }, []);
  const fonts = allFonts();
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const f of fonts) m.set(f.category, [...(m.get(f.category) ?? []), f.family]);
    return m;
  }, [fonts]);
  const known = fonts.some((f) => f.family === value);
  return (
    <select className="select" value={value} style={{ fontFamily: `"${value}"` }} onChange={(e) => onChange(e.target.value)}>
      {!known && <option value={value}>{value}</option>}
      {Array.from(groups).map(([cat, list]) => (
        <optgroup key={cat} label={cat}>
          {list.map((f) => (
            <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>
              {f}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: 34, height: 28, border: '1px solid var(--line)', borderRadius: 6, padding: 2, background: 'var(--bg-2)' }}
    />
  );
}
