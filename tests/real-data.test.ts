import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { haversineKm } from '../src/core/geo';
import { parseGpx } from '../src/core/gpx';
import { orderLegs } from '../src/core/order';
import { routeBounds } from '../src/core/project';
import { removeSpikes } from '../src/core/spike';

// Runs only when real rides are present in test-data/srmr (git-ignored; never committed).
const dir = new URL('../test-data/srmr/', import.meta.url);
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.gpx')) : [];

it.runIf(files.length > 0)('loads and orders the real SRMR legs', () => {
  const t0 = performance.now();
  const legs = files.map((f) => {
    const g = parseGpx(readFileSync(new URL(f, dir), 'utf8'), f);
    const s = removeSpikes(g.lat, g.lon, 20);
    let km = 0;
    for (let i = 1; i < s.lat.length; i++) km += haversineKm(s.lat[i - 1], s.lon[i - 1], s.lat[i], s.lon[i]);
    return { file: f, name: g.name, lat: s.lat, lon: s.lon, km, spikes: s.removed, wpts: g.waypoints.length };
  });
  const parseMs = performance.now() - t0;
  const r = orderLegs(
    legs.map((l) => ({ startLat: l.lat[0], startLon: l.lon[0], endLat: l.lat[l.lat.length - 1], endLon: l.lon[l.lon.length - 1] })),
  );
  const b = routeBounds(legs, 0)!;
  const points = legs.reduce((s, l) => s + l.lat.length, 0);
  console.log(
    [
      `parsed ${points} points in ${parseMs.toFixed(0)} ms`,
      ...r.order.map((i, k) => `${k + 1}. ${legs[i].name} (${legs[i].km.toFixed(0)} km, ${legs[i].spikes} spikes, ${legs[i].wpts} wpts)` +
        (k < r.seamKm.length ? ` -> seam ${r.seamKm[k].toFixed(2)} km` : '')),
      `total ${legs.reduce((s, l) => s + l.km, 0).toFixed(0)} km, bbox ${JSON.stringify(b)}`,
    ].join('\n'),
  );
  expect(points).toBeGreaterThan(100000);
  expect(r.totalSeamKm).toBeLessThan(20);
});
