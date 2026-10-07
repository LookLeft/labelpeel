import { setMeasurePass } from '../model/labelTypes';
import { previewContext } from '../model/pages';
import { useEditor } from '../state/store';
import type { LabelDoc } from '../model/types';
import { elementBox } from './render';

const GAP = 1.5;

// Generated elements named "__after" are placed after the preceding generated
// elements ("__after:4" leaves a 4 mm gap), "__right" after everything; both
// need measured text widths.
setMeasurePass((doc: LabelDoc): LabelDoc => {
  const pctx = previewContext(doc, 0, useEditor.getState().settings.dateFormat);
  const elements = [...doc.elements];
  let right = 0;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const after = /^__after(?::([\d.]+))?$/.exec(el.name ?? '');
    if (after || el.name === '__right') {
      if (el.name === '__right') {
        for (const o of elements) if (o !== el && !o.hidden) right = Math.max(right, elementBox(o, pctx).x + elementBox(o, pctx).w);
      }
      elements[i] = { ...el, x: right + (after?.[1] ? Number(after[1]) : GAP) };
    }
    const b = elementBox(elements[i], pctx);
    right = Math.max(right, b.x + b.w);
  }
  return { ...doc, elements };
});
