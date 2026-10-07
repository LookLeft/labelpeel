import { describe, expect, it } from 'vitest';
import { cellAtPoint, deleteCol, deleteRow, insertCol, insertRow, mergeCells, splitCell, tableAreas } from '../src/model/table';
import type { TableElement } from '../src/model/types';

const table = (rows: number, cols: number, over: Partial<TableElement> = {}): TableElement => ({
  id: 't', type: 'table', x: 0, y: 0, w: 30, h: 10, rotation: 0,
  font: 'Inter', size: 10, bold: false, italic: false, underline: false, strike: false, lineHeight: 1.1, letterSpacing: 0,
  align: 'center', vAlign: 'middle', autoSize: true, padding: 0.5,
  border: 'solid', borderWidth: 0.3, inner: 'solid', innerWidth: 0.2,
  rows: Array(rows).fill(1),
  cols: Array(cols).fill(1),
  cells: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ({ text: `${r}${c}` }))),
  ...over,
});
const apply = (t: TableElement, p: Partial<TableElement>) => ({ ...t, ...p });

describe('table structure', () => {
  it('lists every cell when nothing is merged', () => {
    expect(tableAreas(table(2, 3))).toHaveLength(6);
  });

  it('merges a block and hides the covered cells', () => {
    const t = apply(table(2, 3), mergeCells(table(2, 3), { r: 0, c: 0, rs: 2, cs: 2 }));
    expect(tableAreas(t)).toEqual([
      { r: 0, c: 0, rs: 2, cs: 2 },
      { r: 0, c: 2, rs: 1, cs: 1 },
      { r: 1, c: 2, rs: 1, cs: 1 },
    ]);
    expect(t.cells[0][0].text).toBe('00');
  });

  it('grows a merge to swallow any merge it overlaps', () => {
    let t = apply(table(2, 3), mergeCells(table(2, 3), { r: 0, c: 1, rs: 2, cs: 1 }));
    t = apply(t, mergeCells(t, { r: 0, c: 0, rs: 1, cs: 2 }));
    expect(tableAreas(t)[0]).toEqual({ r: 0, c: 0, rs: 2, cs: 2 });
  });

  it('splits a merge back into cells', () => {
    let t = apply(table(2, 2), mergeCells(table(2, 2), { r: 0, c: 0, rs: 2, cs: 2 }));
    t = apply(t, splitCell(t, 1, 1));
    expect(tableAreas(t)).toHaveLength(4);
  });

  it('grows merges when a row or column is inserted inside them', () => {
    let t = apply(table(2, 2), mergeCells(table(2, 2), { r: 0, c: 0, rs: 2, cs: 2 }));
    t = apply(t, insertRow(t, 1));
    t = apply(t, insertCol(t, 1));
    expect(t.rows).toHaveLength(3);
    expect(t.cols).toHaveLength(3);
    expect(tableAreas(t)[0]).toEqual({ r: 0, c: 0, rs: 3, cs: 3 });
  });

  it('shrinks or hands on merges when rows and columns are deleted, without changing the original', () => {
    const merged = apply(table(3, 3), mergeCells(table(3, 3), { r: 0, c: 0, rs: 2, cs: 2 }));
    const t = apply(merged, deleteRow(merged, 0));
    expect(tableAreas(t)[0]).toEqual({ r: 0, c: 0, rs: 1, cs: 2 });
    expect(merged.cells[1][0].rowSpan).toBeUndefined();
    const u = apply(merged, deleteCol(merged, 1));
    expect(tableAreas(u)[0]).toEqual({ r: 0, c: 0, rs: 2, cs: 1 });
  });

  it('finds the cell under a point, including merged cells', () => {
    const t = apply(table(2, 3), mergeCells(table(2, 3), { r: 0, c: 1, rs: 2, cs: 2 }));
    expect(cellAtPoint(t, 30, 10, 25, 8)).toEqual({ r: 0, c: 1, rs: 2, cs: 2 });
    expect(cellAtPoint(t, 30, 10, 2, 8)).toEqual({ r: 1, c: 0, rs: 1, cs: 1 });
  });
});
