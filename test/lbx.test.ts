import { existsSync, readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { strToU8, zipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { importLbx } from '../src/io/lbx';
import type { ShapeElement, TableElement, TextElement } from '../src/model/types';

const PT = 25.4 / 72;
const close = (a: number, b: number, tol = 0.1) => expect(Math.abs(a - b)).toBeLessThan(tol);
const texts = (els: { type: string }[]) => els.filter((e): e is TextElement => e.type === 'text');

beforeAll(() => {
  (globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;
});

// ---------------------------------------------------------------- synthetic files
// Small .lbx files in the structure P-touch Editor writes (namespaces, element
// and attribute names as in its saved files), with our own content.

const NS =
  'xmlns:pt="http://schemas.brother.info/ptouch/2007/lbx/main" xmlns:style="http://schemas.brother.info/ptouch/2007/lbx/style" ' +
  'xmlns:text="http://schemas.brother.info/ptouch/2007/lbx/text" xmlns:draw="http://schemas.brother.info/ptouch/2007/lbx/draw" ' +
  'xmlns:image="http://schemas.brother.info/ptouch/2007/lbx/image" xmlns:barcode="http://schemas.brother.info/ptouch/2007/lbx/barcode" ' +
  'xmlns:table="http://schemas.brother.info/ptouch/2007/lbx/table"';

const style = (x: number, y: number, w: number, h: number, pen = 'NULL', brush = 'NULL', brushId = 0, penWidth = 0.5) =>
  `<pt:objectStyle x="${x}pt" y="${y}pt" width="${w}pt" height="${h}pt" backColor="#FFFFFF" backPrintColorNumber="0" ropMode="COPYPEN" angle="0" anchor="TOPLEFT" flip="NONE">` +
  `<pt:pen style="${pen}" widthX="${penWidth}pt" widthY="${penWidth}pt" color="#000000" printColorNumber="1"/>` +
  `<pt:brush style="${brush}" color="#000000" printColorNumber="1" id="${brushId}"/>` +
  `<pt:expanded objectName="" ID="0" lock="0" templateMergeTarget="LABELLIST" templateMergeType="NONE" templateMergeID="0" linkStatus="NONE" linkID="0"/></pt:objectStyle>`;

const font = (o: { name?: string; weight?: number; italic?: boolean; underline?: number; size?: number; effect?: string } = {}) =>
  `<text:ptFontInfo><text:logFont name="${o.name ?? 'Helsinki'}" width="0" italic="${o.italic ?? false}" weight="${o.weight ?? 400}" charSet="0" pitchAndFamily="2"/>` +
  `<text:fontExt effect="${o.effect ?? 'NOEFFECT'}" underline="${o.underline ?? 0}" strikeout="0" size="${o.size ?? 9}pt" orgSize="28.8pt" textColor="#000000" textPrintColorNumber="1"/></text:ptFontInfo>`;

interface TextOpts {
  font?: Parameters<typeof font>[0];
  runs?: [number, Parameters<typeof font>[0]][];
  align?: string;
  vertical?: boolean;
  lineSpace?: number;
  control?: string;
}
const text = (x: number, y: number, w: number, h: number, data: string, o: TextOpts = {}) =>
  `<text:text>${style(x, y, w, h)}${font(o.font)}` +
  `<text:textControl control="${o.control ?? 'FIXEDFRAME'}" clipFrame="false" aspectNormal="true" shrink="true" autoLF="false" avoidImage="false"/>` +
  `<text:textAlign horizontalAlignment="${o.align ?? 'LEFT'}" verticalAlignment="CENTER" inLineAlignment="BASELINE"/>` +
  `<text:textStyle vertical="${o.vertical ?? false}" nullBlock="false" charSpace="0" lineSpace="${o.lineSpace ?? 0}" orgPoint="9pt" combinedChars="false"/>` +
  `<pt:data>${data}</pt:data>` +
  (o.runs ?? [[data.length, o.font]]).map(([n, f]) => `<text:stringItem charLen="${n}">${font(f)}</text:stringItem>`).join('') +
  `</text:text>`;

const rect = (x: number, y: number, w: number, h: number, o: { fill?: boolean; round?: number; pen?: number } = {}) =>
  `<draw:rect>${style(x, y, w, h, 'INSIDEFRAME', o.fill ? 'PATTERN' : 'NULL', o.fill ? 1 : 0, o.pen ?? 0.5)}` +
  `<draw:rectStyle shape="${o.round ? 'ROUNDRECTANGLE' : 'RECTANGLE'}" roundnessX="${o.round ?? 0.1}pt" roundnessY="${o.round ?? 0.1}pt"/></draw:rect>`;

function lbx(objects: string, paper: { width?: number; height?: number; auto?: boolean; marginTop?: number } = {}) {
  const label =
    `<?xml version="1.0" encoding="UTF-8"?>\n<pt:document ${NS} version="1.9" generator="com.brother.PtouchEditor"><pt:body currentSheet="Sheet 1" direction="LTR"><style:sheet name="Sheet 1">` +
    `<style:paper media="0" width="${paper.width ?? 51.2}pt" height="${paper.height ?? 150}pt" marginLeft="3.2pt" marginTop="${paper.marginTop ?? 5.6}pt" marginRight="3.2pt" marginBottom="5.6pt" orientation="landscape" autoLength="${paper.auto ?? false}" paperColor="#FFFFFF" paperInk="#000000" format="260" printerID="32560" printerName="Brother PT-E560BT"/>` +
    `<pt:objects>${objects}</pt:objects></style:sheet></pt:body></pt:document>`;
  const zip = zipSync({ 'label.xml': strToU8(label), 'prop.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><meta:properties xmlns:meta="m"/>') });
  return importLbx(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, 'test.lbx');
}

describe('.lbx import', () => {
  it('reads the paper: tape width, length and margins along the tape', async () => {
    const { doc } = await lbx('', { width: 51.2, height: 200, marginTop: 11.2 });
    expect(doc.media.width).toBe(18);
    expect(doc.lengthMode).toBe('fixed');
    close(doc.length, 200 * PT);
    close(doc.marginStart, 11.2 * PT);
    expect((await lbx('', { width: 68, auto: true })).doc).toMatchObject({ lengthMode: 'auto', media: { width: 24 } });
  });

  it('reads text: font, size, weight, alignment, position and line breaks', async () => {
    const { doc } = await lbx(
      text(12.4, 11, 95.8, 14.2, 'ACME WIDGETS', { font: { name: 'PT Utah Condensed', weight: 700, size: 12 }, align: 'RIGHT' }) +
        text(124, 8, 64, 20, '1 High Street\nAnytown', { runs: [[13, {}], [1, {}], [7, {}]] }),
    );
    const [name, address] = texts(doc.elements);
    expect(name).toMatchObject({ text: 'ACME WIDGETS', bold: true, align: 'right', size: 12, sourceFont: 'PT Utah Condensed', font: 'Roboto Condensed', autoSize: false, shrink: true });
    close(name.x, 12.4 * PT);
    close(name.y, 11 * PT);
    expect(address.text).toBe('1 High Street\nAnytown');
    expect(address.font).toBe('Inter');
  });

  it('uses the most common style when a text box mixes styles', async () => {
    const { doc, warnings } = await lbx(
      text(0, 0, 50, 10, 'underline italics', { runs: [[9, { underline: 1 }], [8, { italic: true }], [0, {}]], font: { underline: 1 } }),
    );
    expect(texts(doc.elements)[0]).toMatchObject({ underline: true, italic: false });
    expect(warnings.join(' ')).toMatch(/mixed styles/);
  });

  it('maps the outline effect, vertical text, line spacing and auto-width frames', async () => {
    const { doc } = await lbx(
      text(0, 0, 50, 10, 'WHITE', { font: { effect: 'OUTLINE', italic: true } }) +
        text(0, 10, 10, 40, 'UP', { vertical: true, runs: [[1, {}], [1, {}]] }) +
        text(60, 0, 50, 30, 'A\nB', { lineSpace: -20, control: 'AUTOLEN' }),
    );
    const [outline, vertical, spaced] = texts(doc.elements);
    expect(outline).toMatchObject({ outline: true, italic: true });
    expect(vertical.stacked).toBe(true);
    expect(spaced).toMatchObject({ lineHeight: 0.88, autoWidth: true });
  });

  it('reads rectangles, fills and rounded corners, and flattens groups', async () => {
    const { doc } = await lbx(
      `<pt:group>${style(0, 0, 100, 40)}<pt:objects>${rect(5, 13, 140, 8.5, { fill: true })}${rect(5, 3, 140, 46, { round: 9, pen: 1.3 })}</pt:objects></pt:group>`,
    );
    const shapes = doc.elements.filter((e): e is ShapeElement => e.type === 'shape');
    expect(shapes).toHaveLength(2);
    expect(shapes[0]).toMatchObject({ shape: 'rect', fill: true });
    expect(shapes[1]).toMatchObject({ shape: 'roundrect', fill: false, stroke: true });
    close(shapes[1].strokeWidth, 1.3 * PT, 0.01);
    close(shapes[1].radius, 9 * PT, 0.01);
  });

  it('reads barcodes and leaves out unsupported ones with a note', async () => {
    const barcode = (proto: string, data: string) =>
      `<barcode:barcode>${style(10, 20, 120, 27, 'INSIDEFRAME', 'PATTERN', 1)}<barcode:barcodeStyle protocol="${proto}" lengths="9" barWidth="0.8pt" humanReadable="true" humanReadableAlignment="CENTER"/><pt:data>${data}</pt:data></barcode:barcode>`;
    const { doc, warnings } = await lbx(barcode('CODE128', 'ABC123') + barcode('RSS', 'x'));
    expect(doc.elements).toHaveLength(1);
    expect(doc.elements[0]).toMatchObject({ type: 'barcode', symbology: 'code128', data: 'ABC123', showText: true });
    expect(warnings.join(' ')).toMatch(/RSS barcodes/);
  });

  it('reads tables: grid, cell text, merges, bold and alignment', async () => {
    const cell = (x: number, y: number, data: string, extra = '', o: TextOpts = {}) =>
      `<table:cell addressX="${x}" addressY="${y}" spanX="1" spanY="1" backColor="#FFFFFF" ${extra}>${data ? text(0, 0, 10, 10, data, o) : ''}<pt:brush style="NULL" color="#000000" printColorNumber="1" id="0"/></table:cell>`;
    const { doc } = await lbx(
      `<table:table>${style(5, 3, 140, 45, 'INSIDEFRAME')}<table:tableStyle row="2" column="3" autoSize="false" keepSize="true"/>` +
        `<table:gridPosition x="0pt 40pt 100pt 140pt" y="0pt 20pt 45pt"/><table:cells>` +
        cell(1, 1, 'a') +
        cell(2, 1, 'merged', '').replace('spanX="1"', 'spanX="2"') +
        cell(1, 2, 'bold', '', { font: { weight: 700 } }) +
        cell(2, 2, 'centre', '', { align: 'CENTER' }) +
        cell(3, 2, '') +
        `</table:cells></table:table>`,
    );
    const table = doc.elements[0] as TableElement;
    expect(table.cols).toHaveLength(3);
    expect(table.rows).toHaveLength(2);
    close(table.cols[1], 60 * PT, 0.02);
    expect(table.cells[0][1]).toMatchObject({ text: 'merged', colSpan: 2 });
    expect(table.cells[1][0]).toMatchObject({ text: 'bold', bold: true });
    expect(table.cells[1][1]).toMatchObject({ text: 'centre', align: 'center' });
    expect(table.border).toBe('solid');
  });

  it("imports P-touch Editor's decorative frames as plain frames", async () => {
    const { doc, warnings } = await lbx(`<draw:frame>${style(5, 8, 235, 51, 'INSIDEFRAME')}<draw:frameStyle category="SIMPLE" style="8" stretchCenter="true"/></draw:frame>`);
    expect(doc.elements[0]).toMatchObject({ type: 'shape', shape: 'frame', frameStyle: 'rect' });
    expect(warnings.join(' ')).toMatch(/plain frames/);
  });

  it('rejects files without label.xml', async () => {
    const zip = zipSync({ 'other.txt': strToU8('x') });
    await expect(importLbx(zip.buffer as ArrayBuffer)).rejects.toThrow(/label\.xml/);
  });
});

// ---------------------------------------------------------------- real files
// Files saved by P-touch Editor, kept locally in examples/ (not committed).

const examples = new URL('../examples/', import.meta.url);
const loadExample = (name: string) => {
  const b = readFileSync(new URL(`${name}.lbx`, examples));
  return importLbx(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, `${name}.lbx`);
};

describe.skipIf(!existsSync(new URL('address.lbx', examples)))('.lbx import of P-touch Editor files in examples/', () => {
  it('reads every file', async () => {
    for (const name of ['address', 'icon and wash hands text', 'table', 'test', 'black border black top with white text barcode with number below it']) {
      if (!existsSync(new URL(`${name}.lbx`, examples))) continue;
      const { doc } = await loadExample(name);
      expect(doc.elements.length).toBeGreaterThan(0);
    }
  });

  it('reads the address label', async () => {
    const { doc } = await loadExample('address');
    expect(texts(doc.elements)).toHaveLength(5);
    expect(texts(doc.elements).find((e) => e.text === 'PETER A. ROBINS')).toMatchObject({ bold: true, align: 'right', size: 12 });
  });
});
