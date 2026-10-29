import { describe, expect, it } from 'vitest';
import { changedPositions, placeAt } from '../../src/lib/ordering';

describe('placeAt', () => {
  it('inserts at the requested index and clamps out-of-range positions', () => {
    expect(placeAt(['a', 'b', 'c'], 'x', 1)).toEqual(['a', 'x', 'b', 'c']);
    expect(placeAt(['a', 'b'], 'x', 99)).toEqual(['a', 'b', 'x']);
    expect(placeAt(['a', 'b'], 'x', -3)).toEqual(['x', 'a', 'b']);
  });

  it('moves an existing id instead of duplicating it', () => {
    expect(placeAt(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
  });
});

describe('changedPositions', () => {
  it('returns only rows whose position changed', () => {
    const previous = [
      { id: 'a', position: 0 },
      { id: 'b', position: 1 },
      { id: 'c', position: 5 },
    ];
    expect(changedPositions(previous, ['a', 'c', 'b'])).toEqual([
      { id: 'c', position: 1 },
      { id: 'b', position: 2 },
    ]);
  });
});
