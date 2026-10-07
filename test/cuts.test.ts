import { describe, expect, it } from 'vitest';
import { cutPlan } from '../src/printer/cuts';
import type { PrintOptions } from '../src/model/types';

const opts = (over: Partial<PrintOptions> = {}): PrintOptions => ({
  copies: 1, cut: 'each', cutEvery: 1, halfCut: false, chain: false, mirror: false, reverse: false, cutMarks: false, splitEvery: 0, splitOrigin: 0,
  ...over,
});

describe('cutPlan', () => {
  it('cuts between every label', () => {
    const p = cutPlan(3, opts(), true, false);
    expect(p.joints).toEqual(['cut', 'cut']);
    expect(p.end).toBe('cut');
  });

  it('cuts every N labels', () => {
    expect(cutPlan(5, opts({ cutEvery: 2 }), true, false).joints).toEqual(['none', 'cut', 'none', 'cut']);
  });

  it('half cuts between labels and fully cuts only after the last, as Brother does', () => {
    for (const cut of ['each', 'end'] as const) {
      expect(cutPlan(3, opts({ cut, cutEvery: 2, halfCut: true }), true, false)).toMatchObject({ joints: ['half', 'half'], end: 'cut' });
    }
  });

  it('keeps one strip when cutting at the end', () => {
    expect(cutPlan(3, opts({ cut: 'end' }), true, false)).toMatchObject({ joints: ['none', 'none'], end: 'cut' });
  });

  it('ignores half cut on printers without it', () => {
    expect(cutPlan(2, opts({ cut: 'end', halfCut: true }), false, false).joints).toEqual(['none']);
  });

  it('never cuts, and chain leaves the last label in the printer', () => {
    expect(cutPlan(2, opts({ cut: 'none' }), true, false)).toMatchObject({ joints: ['none'], end: 'none' });
    expect(cutPlan(2, opts({ chain: true }), true, false).end).toBe('chain');
  });
});
