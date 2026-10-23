import { describe, expect, it } from 'vitest';
import { haversineKm } from '../src/core/geo';
import { parseGpx } from '../src/core/gpx';
import { orderLegs } from '../src/core/order';
import { fitToPlate } from '../src/core/printers';
import { makeFrame, toMmX, toMmY } from '../src/core/project';
import { distanceInside, fillRings } from '../src/core/raster';
import { simplifyLine } from '../src/core/simplify';
import { removeSpikes } from '../src/core/spike';
import { chooseZoom, decodeTerrarium, groundResM, tileCount } from '../src/core/terrarium';

describe('terrarium', () => {
  it('decodes known values', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(0, 0, 0)).toBe(-32768);
    expect(decodeTerrarium(129, 44, 128)).toBeCloseTo(300.5, 6);
    expect(decodeTerrarium(156, 17, 0)).toBe(7185);
  });
  it('picks the lowest zoom no coarser than a cell and caps tiles', () => {
    const b = { west: 73.0, south: 40.0, east: 78.5, north: 42.6 }; // ~SRMR-sized
    const r = chooseZoom(b, 550);
    expect(groundResM(41.3, r.z)).toBeLessThanOrEqual(550);
    expect(groundResM(41.3, r.z - 1)).toBeGreaterThan(550);
    expect(tileCount(r)).toBeLessThanOrEqual(64);
    const fine = chooseZoom(b, 5);
    expect(fine.z).toBeLessThanOrEqual(13);
    expect(tileCount(fine)).toBeLessThanOrEqual(64);
  });
});

describe('gpx', () => {
  it('reads trkpt, waypoints and names; ignores time', () => {
    const g = parseGpx(
      `<?xml version="1.0"?><gpx><metadata><name>Meta</name></metadata>
      <wpt lat="41.1" lon="75.2"><name>CP1 &amp; Tea</name></wpt>
      <trk><name>Leg 1</name><trkseg>
      <trkpt lat="41.0" lon="75.0"><ele>2000</ele></trkpt>
      <trkpt lon='75.1' lat='41.05'/>
      <trkpt lat="bad" lon="75.2"></trkpt>
      </trkseg></trk></gpx>`,
      'x.gpx',
    );
    expect(g.name).toBe('Leg 1');
    expect(Array.from(g.lat)).toEqual([41.0, 41.05]);
    expect(Array.from(g.lon)).toEqual([75.0, 75.1]);
    expect(g.waypoints).toEqual([{ name: 'CP1 & Tea', lat: 41.1, lon: 75.2 }]);
  });
  it('falls back to route points and the file name', () => {
    const g = parseGpx('<gpx><rte><rtept lat="1" lon="2"/></rte></gpx>', 'My Ride.gpx');
    expect(g.name).toBe('My Ride');
    expect(g.lat.length).toBe(1);
  });
});

describe('orderLegs', () => {
  const chain = [
    [42.0, 74.0, 42.2, 74.5],
    [42.2, 74.51, 41.8, 75.2],
    [41.8, 75.21, 41.5, 76.0],
    [41.5, 76.01, 41.9, 77.0],
    [41.9, 77.0, 42.3, 77.8],
    [42.3, 77.81, 42.6, 78.4],
  ].map(([a, b, c, d]) => ({ startLat: a, startLon: b, endLat: c, endLon: d }));

  it('recovers the true order from a shuffle (exact search)', () => {
    const shuffle = [3, 0, 5, 2, 4, 1];
    const r = orderLegs(shuffle.map((i) => chain[i]));
    expect(r.order.map((i) => shuffle[i])).toEqual([0, 1, 2, 3, 4, 5]);
    expect(r.totalSeamKm).toBeLessThan(5);
  });
  it('uses greedy search for many legs', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      startLat: 40 + i * 0.1,
      startLon: 70,
      endLat: 40 + (i + 1) * 0.1,
      endLon: 70,
    }));
    const shuffle = [7, 2, 11, 0, 5, 9, 1, 3, 10, 4, 8, 6];
    const r = orderLegs(shuffle.map((i) => many[i]));
    expect(r.order.map((i) => shuffle[i])).toEqual([...Array(12).keys()]);
  });
});

describe('removeSpikes', () => {
  it('drops A -> far -> A spikes and keeps one-way gaps', () => {
    const lat = Float64Array.from([41.0, 41.001, 45.0, 41.002, 41.003, 41.004, 41.6, 41.601, 41.602]);
    const lon = Float64Array.from([75.0, 75.0, 75.0, 75.0, 75.0, 75.0, 75.0, 75.0, 75.0]);
    const r = removeSpikes(lat, lon, 20);
    expect(r.removed).toBe(1);
    expect(Array.from(r.lat)).toEqual([41.0, 41.001, 41.002, 41.003, 41.004, 41.6, 41.601, 41.602]);
  });
  it('drops multi-point spikes', () => {
    const lat = Float64Array.from([41, 41.001, 43, 43.01, 41.002, 41.003]);
    const lon = new Float64Array(6).fill(75);
    expect(removeSpikes(lat, lon, 20).removed).toBe(2);
  });
});

describe('projection and plate fit', () => {
  it('maps edge length to print mm and keeps ground scale', () => {
    const b = { west: 75, south: 41, east: 76, north: 41.5 };
    const f = makeFrame(b, 'width', 200);
    expect(toMmX(f, 76)).toBeCloseTo(200, 6);
    expect(toMmY(f, 41.5)).toBeCloseTo(f.heightMm, 6);
    // 0.5 deg of latitude is ~55.6 km on the ground
    const kmNS = haversineKm(41, 75.5, 41.5, 75.5);
    expect(f.heightMm / f.mmPerGroundM / 1000).toBeCloseTo(kmNS, 0);
    const g = makeFrame(b, 'height', 100);
    expect(g.heightMm).toBeCloseTo(100, 6);
  });
  it('fits the plate in either orientation', () => {
    const r = fitToPlate(2, 250, 210);
    expect(r.w).toBeCloseTo(240, 6);
    const tall = fitToPlate(0.5, 250, 210);
    expect(tall.h).toBeCloseTo(240, 6); // rotated onto the long side
  });
});

describe('raster', () => {
  it('fills polygons with holes (even-odd)', () => {
    const W = 10, H = 10, m = new Uint8Array(W * H);
    fillRings(m, W, H, [Float64Array.from([1, 1, 9, 1, 9, 9, 1, 9]), Float64Array.from([4, 4, 6, 4, 6, 6, 4, 6])]);
    expect(m.reduce((a, b) => a + b, 0)).toBe(64 - 4);
    expect(m[5 * W + 5]).toBe(0);
  });
  it('distance transform', () => {
    const W = 7, H = 1, m = Uint8Array.from([0, 1, 1, 1, 1, 1, 0]);
    expect(Array.from(distanceInside(m, W, H))).toEqual([0, 1, 2, 3, 2, 1, 0]);
  });
  it('simplifies a line within tolerance', () => {
    const pts: number[] = [];
    for (let i = 0; i <= 1000; i++) pts.push(i * 0.01, Math.sin(i * 0.01) * 0.001);
    const s = simplifyLine(Float64Array.from(pts), 0.1);
    expect(s.length).toBe(4);
  });
});
