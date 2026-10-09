// Core document model. All geometry is in millimetres in "design space":
// X runs along the label length, Y runs across the tape (0 = top edge of the
// physical tape, tapeWidth = bottom edge). In portrait orientation the design
// space is rotated 90° before printing, so X runs across the tape instead.

export type Id = string;

export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';

export interface BaseElement {
  id: Id;
  type: ElementType;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation in degrees, clockwise, around the element centre. */
  rotation: number;
  locked?: boolean;
  hidden?: boolean;
  /** Created by a label-type generator; regenerated when its settings change. */
  generated?: boolean;
}

export type ElementType = 'text' | 'shape' | 'symbol' | 'image' | 'barcode' | 'grid' | 'table';

export interface TextStyle {
  font: string;
  /** Font size in points. Ignored when autoSize is on. */
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  align: HAlign;
  vAlign: VAlign;
  /** Line height multiplier. */
  lineHeight: number;
  /** Extra letter spacing in mm. */
  letterSpacing: number;
}

export interface TextElement extends BaseElement, TextStyle {
  type: 'text';
  /** May contain {{placeholders}}. */
  text: string;
  /** Shrink/grow the font so the text fills the box height (and width unless autoWidth). */
  autoSize: boolean;
  /** Box width follows the text width. */
  autoWidth: boolean;
  /** White text on a filled box. */
  invert: boolean;
  /** Characters stacked vertically, one per line. */
  stacked?: boolean;
  /** Draw a frame around the text box. */
  frame?: 'none' | 'rect' | 'round';
  framePadding?: number;
  /** Paper-coloured letters with an ink outline (P-touch Editor's "Outline" effect). */
  outline?: boolean;
  /** Font name from an imported P-touch Editor file, written back on .lbx export. */
  sourceFont?: string;
  /** With a fixed size, make the text smaller if it doesn't fit the box. */
  shrink?: boolean;
}

export type ShapeKind = 'rect' | 'roundrect' | 'ellipse' | 'line' | 'triangle' | 'arrow' | 'diamond' | 'frame';

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shape: ShapeKind;
  strokeWidth: number;
  stroke: boolean;
  fill: boolean;
  dash: 'solid' | 'dashed' | 'dotted';
  radius: number;
  /** Style of a 'frame' shape. */
  frameStyle?: FrameStyle;
}

export interface SymbolElement extends BaseElement {
  type: 'symbol';
  /** Clip-art key, e.g. "custom:w012-electricity" or "lucide:zap". */
  symbol: string;
  /** Stroke width override for line icons (24-unit grid). */
  strokeWidth?: number;
  invert: boolean;
  keepAspect: boolean;
}

export type DitherMode = 'threshold' | 'floyd' | 'atkinson' | 'ordered';

export interface ImageElement extends BaseElement {
  type: 'image';
  src: string; // data URL
  dither: DitherMode;
  threshold: number; // 0..255
  invert: boolean;
  keepAspect: boolean;
}

export interface BarcodeElement extends BaseElement {
  type: 'barcode';
  /** bwip-js symbology id, e.g. code128, qrcode, datamatrix, ean13. */
  symbology: string;
  data: string;
  showText: boolean;
  textSize: number; // pt
  font: string;
  /** QR error-correction level. */
  eclevel?: 'L' | 'M' | 'Q' | 'H';
}

export interface GridCell {
  span: number;
  text: string;
}

export interface GridElement extends BaseElement, Omit<TextStyle, 'align' | 'vAlign'> {
  type: 'grid';
  /** Width of one module (one way / one port) in mm. */
  pitch: number;
  cells: GridCell[];
  separator: 'line' | 'dashed' | 'dotted' | 'none';
  separatorWidth: number;
  border: boolean;
  textDir: 'horizontal' | 'up' | 'down';
  textPos: VAlign;
  align: HAlign;
  autoSize: boolean;
  numbers: 'none' | 'top' | 'bottom';
  numberStart: number;
  numberStep: number;
  numberSize: number;
  numberInvert: boolean;
  /** Heavier separator every N modules (0 = off), e.g. port groups of 6. */
  groupEvery: number;
}

export type CellFill = 'none' | 'black' | 'hatch' | 'dots';
export type LineStyle = 'solid' | 'dashed' | 'dotted' | 'none';

export interface TableCell {
  /** May contain {{placeholders}}. */
  text: string;
  /** Merged size when this cell is the top-left of a merge (default 1). */
  rowSpan?: number;
  colSpan?: number;
  /** Black fill prints the text white. */
  fill?: CellFill;
  align?: HAlign;
  bold?: boolean;
}

export interface TableElement extends BaseElement, Omit<TextStyle, 'align' | 'vAlign'> {
  type: 'table';
  /** Relative column widths and row heights; the table fills its box. */
  cols: number[];
  rows: number[];
  /** cells[row][col]. Cells covered by a merge keep their data but aren't drawn. */
  cells: TableCell[][];
  align: HAlign;
  vAlign: VAlign;
  autoSize: boolean;
  /** Space between the cell edge and its text, in mm. */
  padding: number;
  /** With a fixed size, make text smaller where it doesn't fit its cell. */
  shrink?: boolean;
  border: LineStyle;
  borderWidth: number;
  /** Lines between cells. */
  inner: LineStyle;
  innerWidth: number;
}

export type LabelElement =
  | TextElement
  | ShapeElement
  | SymbolElement
  | ImageElement
  | BarcodeElement
  | GridElement
  | TableElement;

/** P-touch tape and media, or DK rolls for QL printers: continuous ('dk') or die-cut labels ('dkdie'). */
export type MediaKind = 'tze' | 'hse' | 'fle' | 'fabric' | 'dk' | 'dkdie';

export interface Media {
  kind: MediaKind;
  /** Nominal width in mm, e.g. 24, 12, 3.5, or 23.6 for HSe. */
  width: number;
  /** Die-cut DK labels: the label's length along the roll, in mm. */
  length?: number;
  tapeColor: string;
  inkColor: string;
  /**
   * Self-laminating tape: where the clear laminate starts, in mm across the
   * tape from its top edge. The white print band is above it.
   */
  clearFrom?: number;
}

export type FrameStyle =
  | 'none' | 'rect' | 'round' | 'double' | 'thick' | 'dashed' | 'dotted'
  | 'brackets' | 'corners' | 'chamfer' | 'ticket' | 'tag' | 'hazard';

export interface FrameSpec {
  style: FrameStyle;
  inset: number;
  thickness: number;
}

export interface Guide {
  axis: 'x' | 'y';
  pos: number;
  label?: string;
}

export type CutMode = 'each' | 'end' | 'none';

export interface PrintOptions {
  copies: number;
  /** Cut between labels (each), only after the last (end) or never (none). */
  cut: CutMode;
  /** Cut after every N labels when cut === 'each'. */
  cutEvery: number;
  halfCut: boolean;
  /** Leave the last label in the printer (no feed/cut) to save tape on the next job. */
  chain: boolean;
  mirror: boolean;
  /** Print order of data records. */
  reverse: boolean;
  /** Print dashed cut marks between labels when cutting is off. */
  cutMarks: boolean;
  /** Split one long design into separate labels every N mm (0 = off). */
  splitEvery: number;
  /** Where the first split section starts, in mm along the label. */
  splitOrigin: number;
}

export interface SerialSpec {
  enabled: boolean;
  start: number;
  step: number;
  count: number;
  pad: number;
  /** Number or letter (A, B, ... Z, AA) sequence. */
  format: 'number' | 'letter' | 'LETTER';
}

export interface DataSource {
  fileName?: string;
  columns: string[];
  rows: Record<string, string>[];
  /** Selected row indexes to print; null means all rows. */
  selected: number[] | null;
}

export interface LabelDoc {
  version: 1;
  name: string;
  labelType: string;
  /** Settings for the label type generator, edited in the Label tab. */
  typeParams: Record<string, unknown>;
  media: Media;
  orientation: 'landscape' | 'portrait';
  /** Label length along the tape, in mm. Auto fits the content. */
  lengthMode: 'auto' | 'fixed';
  length: number;
  /** Blank space before/after content when length is auto, in mm. */
  marginStart: number;
  marginEnd: number;
  frame: FrameSpec;
  elements: LabelElement[];
  guides: Guide[];
  print: PrintOptions;
  serial: SerialSpec;
  data: DataSource | null;
}
