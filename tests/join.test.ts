import { describe, expect, it } from 'vitest';
import { haversineKm } from '../src/core/geo';
import { joinPoint } from '../src/core/join';

// tracks along a meridian/parallel near 42N; 1e-5 deg lat ~ 1.11 m
const M = 1 / 111_320;
const track = (pts: [number, number][]) => ({ lat: pts.map((p) => 42 + p[1] * M), lon: pts.map((p) => 75 + (p[0] * M) / Math.cos((42 * Math.PI) / 180)) });
const line = (from: [number, number], to: [number, number], n = 50) =>
  Array.from({ length: n + 1 }, (_, i) => [from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n] as [number, number]);

describe('joinPoint', () => {
  it('moves a join from the tip of a short out-and-back spur to its base', () => {
    // main line runs east along y=0; day ends 800 m up a spur to the north at x=0, next day comes back down
    const a = track([...line([-5000, 0], [0, 0]), ...line([0, 0], [0, 800]).slice(1)]);
    const b = track([...line([0, 800], [0, 0]), ...line([0, 0], [5000, 0]).slice(1)]);
    const p = joinPoint(a.lat, a.lon, b.lat, b.lon, 300, 2000);
    expect(haversineKm(p.lat, p.lon, 42, 75) * 1000).toBeLessThan(350);
  });
  it('keeps the leg end when the shared section is longer than a marker', () => {
    const a = track([...line([-5000, 0], [0, 0]), ...line([0, 0], [0, 8000]).slice(1)]);
    const b = track([...line([0, 8000], [0, 0]), ...line([0, 0], [5000, 0]).slice(1)]);
    const p = joinPoint(a.lat, a.lon, b.lat, b.lon, 300, 2000);
    expect(p).toEqual({ lat: a.lat.at(-1), lon: a.lon.at(-1) });
  });
  it('keeps the leg end when the route just carries on', () => {
    const a = track(line([-5000, 0], [0, 0]));
    const b = track(line([0, 0], [5000, 0]));
    const p = joinPoint(a.lat, a.lon, b.lat, b.lon, 300, 2000);
    expect(haversineKm(p.lat, p.lon, 42, 75) * 1000).toBeLessThan(1);
  });
});
