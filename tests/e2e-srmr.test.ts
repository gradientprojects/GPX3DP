import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { expect, it } from 'vitest';
import { to3mf, toStl } from '../src/core/export';
import { parseGpx } from '../src/core/gpx';
import { DEFAULT_MODEL, type MarkerPin } from '../src/core/model';
import { orderLegs } from '../src/core/order';
import { makeFrame, routeBounds, toMmX, toMmY } from '../src/core/project';
import { simplifyLine } from '../src/core/simplify';
import { removeSpikes } from '../src/core/spike';
import { validateMesh } from '../src/core/validate';
import { buildFromRequest } from '../src/worker/build';
import { setPngDecoder } from '../src/worker/tiles';

// Full pipeline on the real SRMR rides with live tiles, writing 3MFs for slicer checks.
// Needs network and test-data/srmr. Run: E2E_OUT=/some/dir npx vitest run tests/e2e-srmr.test.ts
const out = process.env.E2E_OUT;
const dir = new URL('../test-data/srmr/', import.meta.url);
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.gpx')) : [];

it.runIf(!!out && files.length > 0)('SRMR end to end', async () => {
  setPngDecoder(async (blob) => PNG.sync.read(Buffer.from(await blob.arrayBuffer())).data);
  const t0 = performance.now();
  const legs = files.map((f) => {
    const g = parseGpx(readFileSync(new URL(f, dir), 'utf8'), f);
    return removeSpikes(g.lat, g.lon, 20);
  });
  const { order } = orderLegs(legs.map((l) => ({ startLat: l.lat[0], startLon: l.lon[0], endLat: l.lat.at(-1)!, endLon: l.lon.at(-1)! })));
  const ordered = order.map((i) => legs[i]);
  const bounds = routeBounds(ordered, 0.05)!;
  const frame = makeFrame(bounds, 'width', 200);
  const line: number[] = [];
  for (const l of ordered) {
    const xy = new Float64Array(l.lat.length * 2);
    for (let i = 0; i < l.lat.length; i++) (xy[2 * i] = toMmX(frame, l.lon[i])), (xy[2 * i + 1] = toMmY(frame, l.lat[i]));
    line.push(...simplifyLine(xy, 0.1));
  }
  const markers: MarkerPin[] = [
    { xMm: line[0], yMm: line[1], kind: 'start' },
    { xMm: line.at(-2)!, yMm: line.at(-1)!, kind: 'finish' },
  ];
  const model = { ...DEFAULT_MODEL, routeOwnColor: true, waterOwnColor: true, markerColor: 'water' as const };
  const r = await buildFromRequest(
    { type: 'build', id: 1, bounds, edge: 'width', edgeMm: 200, cellMm: 0.25, rivers: false, riverWidthMm: 0.8, model, routeLines: [Float64Array.from(line)], markers, label: null },
    () => {},
  );
  const ms = performance.now() - t0;
  for (const p of r.parts) expect({ part: p.name, ...validateMesh(p.positions, p.indices) }).toMatchObject({ ok: true });
  const colors = { route: '#d23a2a', lakes: '#3a78c2', rivers: '#3a78c2', markers: '#f2b705' };
  writeFileSync(`${out}/srmr_bambu.3mf`, to3mf(r.parts, { title: 'SRMR', description: 'test', colors }));
  writeFileSync(`${out}/srmr_prusa.3mf`, to3mf(r.parts, { title: 'SRMR', description: 'test', colors, layout: 'single' }));
  writeFileSync(`${out}/srmr_merged.stl`, toStl(r.parts));
  console.log(`SRMR: ${r.parts.map((p) => `${p.name} ${p.indices.length / 3}`).join(', ')} tris; z${r.zoom}, ${r.tiles} tiles; ${(ms / 1000).toFixed(1)} s`);
}, 180000);
