// Table structure helpers: merged cells, and adding or removing rows and
// columns without leaving merges that point outside the table.
import type { TableCell, TableElement } from './types';

export interface CellArea {
  r: number;
  c: number;
  rs: number;
  cs: number;
}

const blank = (): TableCell => ({ text: '' });
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

/**
 * The visible cells: each merge's top-left cell with its clamped span. Cells
 * covered by an earlier merge are skipped.
 */
export function tableAreas(el: Pick<TableElement, 'rows' | 'cols' | 'cells'>): CellArea[] {
  const R = el.rows.length;
  const C = el.cols.length;
  const covered = new Set<number>();
  const out: CellArea[] = [];
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (covered.has(r * C + c)) continue;
      const cell = el.cells[r]?.[c] ?? blank();
      let rs = Math.max(1, Math.min(cell.rowSpan ?? 1, R - r));
      let cs = Math.max(1, Math.min(cell.colSpan ?? 1, C - c));
      // Don't overlap a merge that was placed first.
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) if (covered.has((r + i) * C + c + j)) { rs = Math.min(rs, i || 1); cs = Math.min(cs, j || 1); }
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) covered.add((r + i) * C + c + j);
      out.push({ r, c, rs, cs });
    }
  }
  return out;
}

/** The visible cell that contains grid position (r, c). */
export function areaAt(el: Pick<TableElement, 'rows' | 'cols' | 'cells'>, r: number, c: number): CellArea | undefined {
  return tableAreas(el).find((a) => r >= a.r && r < a.r + a.rs && c >= a.c && c < a.c + a.cs);
}

/** Cell edges in mm from the table's top-left, for a box of w × h. */
export function tableEdges(el: Pick<TableElement, 'rows' | 'cols'>, w: number, h: number) {
  const edges = (weights: number[], size: number) => {
    const total = sum(weights) || 1;
    const out = [0];
    for (const v of weights) out.push(out[out.length - 1] + (v / total) * size);
    return out;
  };
  return { xs: edges(el.cols, w), ys: edges(el.rows, h) };
}

/** Grid position under a point (mm from the table's top-left). */
export function cellAtPoint(el: Pick<TableElement, 'rows' | 'cols' | 'cells'>, w: number, h: number, x: number, y: number): CellArea | undefined {
  const { xs, ys } = tableEdges(el, w, h);
  const find = (edges: number[], v: number) => Math.max(0, Math.min(edges.length - 2, edges.findIndex((e, i) => i > 0 && v <= e) - 1));
  return areaAt(el, find(ys, y), find(xs, x));
}

/** Merge a rectangular selection into one cell, keeping the first cell's content. */
export function mergeCells(el: TableElement, sel: CellArea): Partial<TableElement> {
  // Grow the selection to include any merge it cuts through.
  let { r, c, rs, cs } = sel;
  for (let changed = true; changed; ) {
    changed = false;
    for (const a of tableAreas(el)) {
      const overlaps = a.r < r + rs && a.r + a.rs > r && a.c < c + cs && a.c + a.cs > c;
      if (!overlaps) continue;
      const r2 = Math.min(r, a.r), c2 = Math.min(c, a.c);
      const re = Math.max(r + rs, a.r + a.rs), ce = Math.max(c + cs, a.c + a.cs);
      if (r2 !== r || c2 !== c || re - r2 !== rs || ce - c2 !== cs) {
        [r, c, rs, cs] = [r2, c2, re - r2, ce - c2];
        changed = true;
      }
    }
  }
  const cells = el.cells.map((row, i) =>
    row.map((cell, j) => {
      if (i < r || i >= r + rs || j < c || j >= c + cs) return cell;
      if (i === r && j === c) return { ...cell, rowSpan: rs, colSpan: cs };
      const { rowSpan: _r, colSpan: _c, ...rest } = cell;
      void _r;
      void _c;
      return rest;
    }),
  );
  return { cells };
}

/** Undo the merge at (r, c). */
export function splitCell(el: TableElement, r: number, c: number): Partial<TableElement> {
  const a = areaAt(el, r, c);
  if (!a) return {};
  return {
    cells: el.cells.map((row, i) => row.map((cell, j) => (i === a.r && j === a.c ? { ...cell, rowSpan: 1, colSpan: 1 } : cell))),
  };
}

/** Insert a row before index `at` (rows.length appends). Merges spanning it grow. */
export function insertRow(el: TableElement, at: number): Partial<TableElement> {
  const cells = el.cells.map((row, i) =>
    row.map((cell): TableCell => (i < at && i + (cell.rowSpan ?? 1) > at ? { ...cell, rowSpan: (cell.rowSpan ?? 1) + 1 } : cell)),
  );
  cells.splice(at, 0, el.cols.map(blank));
  const rows = [...el.rows];
  rows.splice(at, 0, el.rows[Math.min(at, el.rows.length - 1)] ?? 1);
  return { rows, cells };
}

export function insertCol(el: TableElement, at: number): Partial<TableElement> {
  const cells = el.cells.map((row) => {
    const next = row.map((cell, j): TableCell => (j < at && j + (cell.colSpan ?? 1) > at ? { ...cell, colSpan: (cell.colSpan ?? 1) + 1 } : cell));
    next.splice(at, 0, blank());
    return next;
  });
  const cols = [...el.cols];
  cols.splice(at, 0, el.cols[Math.min(at, el.cols.length - 1)] ?? 1);
  return { cols, cells };
}

/** Remove row `at`. Merges that span it shrink; a merge starting on it moves to the row below. */
export function deleteRow(el: TableElement, at: number): Partial<TableElement> {
  if (el.rows.length <= 1) return {};
  const cells = el.cells.map((row) => row.map((cell) => ({ ...cell })));
  cells.forEach((row, i) =>
    row.forEach((cell, j) => {
      const rs = cell.rowSpan ?? 1;
      if (i < at && i + rs > at) cell.rowSpan = rs - 1;
      else if (i === at && rs > 1 && cells[at + 1]) Object.assign(cells[at + 1][j], { rowSpan: rs - 1, colSpan: cell.colSpan });
    }),
  );
  cells.splice(at, 1);
  return { rows: el.rows.filter((_, i) => i !== at), cells };
}

/** Remove column `at`. Merges that span it shrink; a merge starting on it moves right. */
export function deleteCol(el: TableElement, at: number): Partial<TableElement> {
  if (el.cols.length <= 1) return {};
  const cells = el.cells.map((row) => row.map((cell) => ({ ...cell })));
  for (const row of cells) {
    row.forEach((cell, j) => {
      const cs = cell.colSpan ?? 1;
      if (j < at && j + cs > at) cell.colSpan = cs - 1;
      else if (j === at && cs > 1 && row[at + 1]) Object.assign(row[at + 1], { colSpan: cs - 1, rowSpan: cell.rowSpan });
    });
    row.splice(at, 1);
  }
  return { cols: el.cols.filter((_, j) => j !== at), cells };
}
