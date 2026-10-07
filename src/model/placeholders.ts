// {{placeholder}} engine used by text, barcodes and grid cells.
//
//   {{date}}                today in the default format
//   {{date+12m}}            today plus 12 months (d, w, m, y units; also -)
//   {{date+1y:MMM YYYY}}    with a custom format
//   {{time}} {{datetime}}
//   {{n}} / {{serial}}      current serial number (see Serialise settings)
//   {{n+5}}                 serial value with an offset
//   {{index}} {{count}}     record number and record total
//   {{Column name}}         a column of the loaded CSV / spreadsheet data

export interface PlaceholderContext {
  now: Date;
  serial: string;
  serialValue: number;
  formatSerial: (n: number) => string;
  index: number;
  count: number;
  record: Record<string, string> | null;
  dateFormat: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function formatDate(d: Date, fmt: string): string {
  return fmt.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|mm|ss|\[[^\]]*\]/g, (tok) => {
    switch (tok) {
      case 'YYYY': return String(d.getFullYear());
      case 'YY': return pad(d.getFullYear() % 100);
      case 'MMMM': return MONTHS[d.getMonth()];
      case 'MMM': return MONTHS[d.getMonth()].slice(0, 3);
      case 'MM': return pad(d.getMonth() + 1);
      case 'M': return String(d.getMonth() + 1);
      case 'DD': return pad(d.getDate());
      case 'D': return String(d.getDate());
      case 'dddd': return DAYS[d.getDay()];
      case 'ddd': return DAYS[d.getDay()].slice(0, 3);
      case 'HH': return pad(d.getHours());
      case 'H': return String(d.getHours());
      case 'mm': return pad(d.getMinutes());
      case 'ss': return pad(d.getSeconds());
      default: return tok.slice(1, -1); // [literal]
    }
  });
}

export function addToDate(d: Date, amount: number, unit: string): Date {
  const r = new Date(d.getTime());
  switch (unit) {
    case 'd': r.setDate(r.getDate() + amount); break;
    case 'w': r.setDate(r.getDate() + amount * 7); break;
    case 'm': {
      const day = r.getDate();
      r.setDate(1);
      r.setMonth(r.getMonth() + amount);
      // Clamp to the end of the target month (31 Jan + 1m = 28/29 Feb).
      const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
      r.setDate(Math.min(day, last));
      break;
    }
    case 'y': {
      const m = r.getMonth();
      r.setFullYear(r.getFullYear() + amount);
      if (r.getMonth() !== m) r.setDate(0);
      break;
    }
  }
  return r;
}

export function toLetters(n: number, upper = true): string {
  // 1 -> A, 26 -> Z, 27 -> AA
  let s = '';
  let v = Math.max(1, Math.floor(n));
  while (v > 0) {
    const r = (v - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    v = Math.floor((v - 1) / 26);
  }
  return upper ? s : s.toLowerCase();
}

const RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function hasPlaceholders(s: string): boolean {
  RE.lastIndex = 0;
  return RE.test(s);
}

export function resolve(text: string, ctx: PlaceholderContext): string {
  return text.replace(RE, (whole, body: string) => {
    const colon = body.indexOf(':');
    const head = (colon >= 0 ? body.slice(0, colon) : body).trim();
    const fmt = colon >= 0 ? body.slice(colon + 1) : '';
    const m = /^(date|today|time|datetime|now)\s*(?:([+-])\s*(\d+)\s*([dwmy]))?$/i.exec(head);
    if (m) {
      let d = ctx.now;
      if (m[2]) d = addToDate(d, (m[2] === '-' ? -1 : 1) * Number(m[3]), m[4].toLowerCase());
      const kind = m[1].toLowerCase();
      const def = kind === 'time' ? 'HH:mm' : kind === 'datetime' || kind === 'now' ? `${ctx.dateFormat} HH:mm` : ctx.dateFormat;
      return formatDate(d, fmt || def);
    }
    const s = /^(n|serial|counter)\s*(?:([+-])\s*(\d+))?$/i.exec(head);
    if (s) {
      if (!s[2]) return ctx.serial;
      const off = (s[2] === '-' ? -1 : 1) * Number(s[3]);
      return ctx.formatSerial(ctx.serialValue + off);
    }
    const lower = head.toLowerCase();
    if (lower === 'index') return String(ctx.index + 1);
    if (lower === 'count') return String(ctx.count);
    if (ctx.record) {
      const key = Object.keys(ctx.record).find((k) => k.toLowerCase() === lower);
      if (key !== undefined) return ctx.record[key] ?? '';
    }
    return whole;
  });
}

export const PLACEHOLDER_HELP: { token: string; desc: string }[] = [
  { token: '{{date}}', desc: 'Today' },
  { token: '{{date+12m}}', desc: 'Today + 12 months' },
  { token: '{{date+1y}}', desc: 'Today + 1 year' },
  { token: '{{date+5y:MMM YYYY}}', desc: '+5 years, custom format' },
  { token: '{{date+30d}}', desc: 'Today + 30 days' },
  { token: '{{time}}', desc: 'Current time' },
  { token: '{{n}}', desc: 'Serial number' },
  { token: '{{index}}', desc: 'Record number' },
];
