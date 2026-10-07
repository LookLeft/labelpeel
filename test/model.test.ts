import { describe, expect, it } from 'vitest';
import { addToDate, formatDate, resolve, type PlaceholderContext } from '../src/model/placeholders';
import { parseCells } from '../src/model/labelTypes';

const ctx = (over: Partial<PlaceholderContext> = {}): PlaceholderContext => ({
  now: new Date(2025, 0, 31),
  serial: '007',
  serialValue: 7,
  formatSerial: (n) => String(n).padStart(3, '0'),
  index: 2,
  count: 10,
  record: { Room: 'Kitchen' },
  dateFormat: 'DD/MM/YYYY',
  ...over,
});

describe('placeholders', () => {
  it('adds months and clamps to month end', () => {
    expect(formatDate(addToDate(new Date(2025, 0, 31), 1, 'm'), 'YYYY-MM-DD')).toBe('2025-02-28');
    expect(resolve('{{date+12m}}', ctx())).toBe('31/01/2026');
    expect(resolve('{{date+1y:MMM YYYY}}', ctx())).toBe('Jan 2026');
    expect(resolve('{{date-1w}}', ctx())).toBe('24/01/2025');
  });
  it('resolves serials, records and columns', () => {
    expect(resolve('#{{n}} / {{n+1}}', ctx())).toBe('#007 / 008');
    expect(resolve('{{index}} of {{count}}', ctx())).toBe('3 of 10');
    expect(resolve('{{room}}', ctx())).toBe('Kitchen');
    expect(resolve('{{unknown}}', ctx())).toBe('{{unknown}}');
  });
});

describe('parseCells', () => {
  it('reads spans and line breaks', () => {
    expect(parseCells('Main Switch\\n100A|2\nCooker\n\nLights')).toEqual([
      { text: 'Main Switch\n100A', span: 2 },
      { text: 'Cooker', span: 1 },
      { text: '', span: 1 },
      { text: 'Lights', span: 1 },
    ]);
  });
});
