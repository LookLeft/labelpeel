import type { LabelDoc, SerialSpec } from './types';
import { toLetters, type PlaceholderContext } from './placeholders';

export const DEFAULT_DATE_FORMAT = 'DD/MM/YYYY';

export function formatSerial(spec: SerialSpec, n: number): string {
  if (spec.format === 'letter') return toLetters(n, false);
  if (spec.format === 'LETTER') return toLetters(n, true);
  const s = String(Math.abs(n)).padStart(spec.pad, '0');
  return n < 0 ? `-${s}` : s;
}

/** Records to print, in order. Each becomes one label (before copies). */
export function enumeratePages(doc: LabelDoc, now = new Date(), dateFormat = DEFAULT_DATE_FORMAT): PlaceholderContext[] {
  const rows = doc.data
    ? (doc.data.selected ?? doc.data.rows.map((_, i) => i)).filter((i) => i < doc.data!.rows.length).map((i) => doc.data!.rows[i])
    : [];
  const count = rows.length || (doc.serial.enabled ? Math.max(1, doc.serial.count) : 1);
  const fmt = (n: number) => formatSerial(doc.serial, n);
  const out: PlaceholderContext[] = [];
  for (let i = 0; i < count; i++) {
    const value = doc.serial.start + i * doc.serial.step;
    out.push({
      now,
      serial: fmt(value),
      serialValue: value,
      formatSerial: fmt,
      index: i,
      count,
      record: rows[i] ?? null,
      dateFormat,
    });
  }
  return doc.print.reverse ? out.reverse() : out;
}

export function previewContext(doc: LabelDoc, index = 0, dateFormat = DEFAULT_DATE_FORMAT): PlaceholderContext {
  const pages = enumeratePages(doc, new Date(), dateFormat);
  return pages[Math.min(index, pages.length - 1)] ?? pages[0];
}
