import { describe, expect, it } from 'vitest';
import { suggestCrop } from '../src/core/crop';

describe('suggestCrop', () => {
  // 200 x 100 mm print of a flat plain, 0.25 mm cells; 1 mm = 2.5 km
  const W = 800, H = 400, cell = 0.25, mmPerGroundM = 0.0004;
  const plain = () => new Float32Array((W + 1) * (H + 1)).fill(500);
  const route = [Float64Array.from([5, 50, 195, 50])];

  it('picks the window over the mountains the ride crosses', () => {
    const E = plain();
    // a 4000 m range around x = 150 mm, y = 50 mm
    for (let y = 0; y <= H; y++)
      for (let x = 0; x <= W; x++) {
        const dx = x * cell - 150, dy = y * cell - 50;
        E[y * (W + 1) + x] += 4000 * Math.exp(-(dx * dx + dy * dy) / (2 * 8 * 8));
      }
    // 4000 m at 1 mm = 2.5 km is 1.6 mm of relief now, 3.2 mm at half the crop
    const s = suggestCrop(E, W, H, cell, mmPerGroundM, route, 3)!;
    expect(s).not.toBeNull();
    expect(s.x0).toBeLessThan(150);
    expect(s.x1).toBeGreaterThan(150 - 8); // within the range's sigma
    expect(s.reliefMm).toBeGreaterThanOrEqual(3);
    // largest window that reaches the target: half the crop
    expect(Math.abs(s.x1 - s.x0 - 100)).toBeLessThanOrEqual(1.5); // within a block
  });

  it('ignores mountains away from the ride', () => {
    const E = plain();
    for (let y = 0; y <= H; y++)
      for (let x = 0; x <= W; x++) {
        const dx = x * cell - 30, dy = y * cell - 90;
        E[y * (W + 1) + x] += 4000 * Math.exp(-(dx * dx + dy * dy) / (2 * 5 * 5));
      }
    const s = suggestCrop(E, W, H, cell, mmPerGroundM, [Float64Array.from([100, 5, 195, 5])]);
    expect(s).toBeNull();
  });

  it('returns null for a flat area', () => {
    expect(suggestCrop(plain(), W, H, cell, mmPerGroundM, route)).toBeNull();
  });
});
