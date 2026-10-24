import { describe, expect, it } from 'vitest';
import { suggestExaggeration } from '../src/core/exaggeration';

describe('suggestExaggeration', () => {
  it('matches the measured rides at 200 mm wide', () => {
    // Death Ride 1:219,000, 8.1 mm relief at 1x: 2.4x by scale, capped to 1.85x by relief -> 1.5x
    expect(suggestExaggeration(219_000, 8.1)).toBe(1.5);
    // SRMR 1:2,528,000, 1.9 mm: 10.5x by scale, capped to 7.9x -> 6x
    expect(suggestExaggeration(2_528_000, 1.9)).toBe(6);
  });

  it('is true scale at large scales and follows the references by scale', () => {
    expect(suggestExaggeration(25_000, 1)).toBe(1);
    expect(suggestExaggeration(50_000, 1)).toBe(1);
    // Knoxville 1:250,000 at 3:1 -> 2.6x -> 2x
    expect(suggestExaggeration(250_000, 1)).toBe(2);
    // Europe at 1:5M (12.5 to 25:1) -> 16x, limited by the slider's 10x
    expect(suggestExaggeration(5_000_000, 0.5)).toBe(10);
  });

  it('caps the relief at 15 mm and never goes below 1x', () => {
    expect(suggestExaggeration(1_000_000, 5)).toBe(3);
    expect(suggestExaggeration(1_000_000, 20)).toBe(1);
  });
});
