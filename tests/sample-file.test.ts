import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { to3mf, toStl } from '../src/core/export';
import { buildModel, DEFAULT_MODEL } from '../src/core/model';

// Writes a sample 3MF + STL for slicer checks: SAMPLE_OUT=/some/dir npx vitest run tests/sample-file.test.ts
const out = process.env.SAMPLE_OUT;

it.runIf(!!out)('writes sample files', () => {
  const W = 320, H = 200, cell = 0.25;
  const E = new Float32Array((W + 1) * (H + 1));
  for (let y = 0; y <= H; y++)
    for (let x = 0; x <= W; x++) E[y * (W + 1) + x] = 1500 + 600 * Math.sin(x / 40) * Math.cos(y / 30) + 80 * Math.sin(x / 7 + y / 11);
  const water = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - 220) ** 2 + 2 * (y - 120) ** 2 < 1600) water[y * W + x] = 1;
  const pts: number[] = [];
  for (let t = 0; t <= 200; t++) pts.push(5 + t * 0.35, 25 + 12 * Math.sin(t / 15));
  const { parts } = buildModel(
    {
      W,
      H,
      cellMm: cell,
      elevation: E,
      mmPerGroundM: 0.0005,
      routeLines: [Float64Array.from(pts)],
      waterMask: water,
      markers: [
        { xMm: 5, yMm: 25, kind: 'start' },
        { xMm: 75, yMm: 25 + 12 * Math.sin(200 / 15), kind: 'finish' },
        { xMm: 40, yMm: 30, kind: 'checkpoint' },
      ],
    },
    { ...DEFAULT_MODEL, routeOwnColor: true, waterOwnColor: true, markerColor: 'water' },
  );
  const colors = { route: '#D02020', lakes: '#2060D0', rivers: '#2060D0', markers: '#F0C000' };
  writeFileSync(`${out}/sample.3mf`, to3mf(parts, { title: 'GPX3DP sample', description: 'test', colors }));
  writeFileSync(`${out}/single.3mf`, to3mf(parts, { title: 'GPX3DP sample', description: 'test', colors, layout: 'single' }));
  writeFileSync(`${out}/sample.stl`, toStl(parts));
});
