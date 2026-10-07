// Where the printer cuts a job, for the print preview. Mirrors the cut
// commands buildJob sends for the same options. As in Brother's P-touch
// Editor, half cut replaces the cuts between labels: with auto cut on, the
// tape is then fully cut only after the last label.
import type { PrintOptions } from '../model/types';

/** What happens at a join between two labels. */
export type Joint = 'cut' | 'half' | 'none';
/** What happens after the last label. */
export type JobEnd = 'cut' | 'chain' | 'none';

export interface CutPlan {
  /** Joint after label i, for every label but the last. */
  joints: Joint[];
  end: JobEnd;
  summary: string;
}

export function cutPlan(count: number, print: PrintOptions, halfCutSupported: boolean, minimal: boolean): CutPlan {
  const n = Math.max(0, count);
  if (minimal) {
    return { joints: Array(Math.max(0, n - 1)).fill('none'), end: 'cut', summary: "Labels print end to end. Cutting is left to the printer's own settings (minimal command set is on)." };
  }
  const noCut = print.cut === 'none' && !print.chain;
  const every = Math.max(1, Math.round(print.cutEvery || 1));
  const half = print.halfCut && halfCutSupported && !noCut;
  const joints: Joint[] = [];
  for (let i = 0; i < n - 1; i++) joints.push(half ? 'half' : print.cut === 'each' && (i + 1) % every === 0 ? 'cut' : 'none');
  const end: JobEnd = print.chain ? 'chain' : print.cut === 'none' ? 'none' : 'cut';

  let summary: string;
  if (n <= 1) summary = end === 'cut' ? 'Cut off after printing.' : 'Not cut after printing.';
  else if (half) summary = `Printed as one strip with half cuts between labels, so they peel off the backing separately${end === 'cut' ? '. The strip is cut off after the last label' : ''}.`;
  else if (print.cut === 'each' && every === 1) summary = 'Each label is cut off separately.';
  else if (print.cut === 'each') summary = `Printed end to end and cut into strips of ${every} labels.`;
  else if (print.cut === 'end') summary = 'Printed end to end as one strip, cut once at the end.';
  else summary = 'Printed end to end as one strip and not cut.';
  if (end === 'chain') summary += ' The last label stays in the printer until your next print, which saves tape.';
  return { joints, end, summary };
}
