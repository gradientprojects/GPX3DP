import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'opentype.js';
import { expect, it } from 'vitest';
import { printSuffix, to3mf } from '../src/core/export';
import { GOOD_GROOVE_NOZZLES, GOOD_WALL_NOZZLES, layoutLabel, type LabelSpec } from '../src/core/label';
import { buildModel, DEFAULT_MODEL, WATER_RIVER, type Part } from '../src/core/model';
import { stampPolyline } from '../src/core/raster';
import { validateMesh } from '../src/core/validate';
import { roundToLayers } from '../src/settings';

/**
 * Test coupons: three flat 2 mm tiles with the underside label at 4, 5.5 and 7 mm (Inter, Death Ride text)
 * and three wavy river grooves on top at 0.6, 0.8 (default) and 1.2 mm wide,
 * 0.6 mm deep. Narrowest groove is the one nearest the label's first line edge (north).
 *   npx vitest run --config scripts/coupon.config.ts   (LAYER=0.2 for another layer height)
 * Writes build/GPX3DP_test_coupons_<suffix>.3mf.
 */
const SIZES = [4, 5.5, 7];
const RIVERS_MM = [0.6, 0.8, 1.2];
const NOZZLE = 0.4, LAYER = +(process.env.LAYER ?? 0.16), CELL = 0.25, MARGIN = 3, GAP = 6;

it('test coupons', () => {
  const ff = readFileSync(new URL('../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff', import.meta.url));
  const font = parse(ff.buffer.slice(ff.byteOffset, ff.byteOffset + ff.byteLength));
  // depths in whole layers, as the app builds them
  const settings = roundToLayers({ ...DEFAULT_MODEL, baseMm: 2, waterSurface: 'off' as const, markersOn: false, routeOwnColor: false }, LAYER);
  console.log(`layer ${LAYER} mm: groove and label ${settings.riverDepthMm} / ${settings.labelDepthMm} mm deep`);

  const all: Part[] = [];
  let y0 = 0;
  for (const size of SIZES) {
    const spec: LabelSpec = {
      lines: ['Death Ride', `13,045 ft · ${size} mm`],
      sizeMm: size,
      edgeX: 'center', offX: 0, edgeY: 'middle', offY: 0, align: 'auto',
    };
    // lay out on a big sheet to measure the text, then size the tile around it
    const probe = layoutLabel(font, spec, 400, 200, MARGIN)!;
    const W = Math.ceil((probe.box[2] - probe.box[0] + 2 * MARGIN + 2) / CELL);
    const H = Math.ceil(Math.max(probe.box[3] - probe.box[1] + 2 * MARGIN + 2, 20) / CELL);
    const label = layoutLabel(font, spec, W * CELL, H * CELL, MARGIN)!;
    expect(label.shrunk).toBe(false);

    const water = new Uint8Array(W * H);
    RIVERS_MM.forEach((w, k) => {
      // narrowest at the top (north), gentle wave so the groove isn't grid-aligned
      const yc = H * (0.75 - k * 0.25);
      const xy: number[] = [];
      for (let x = 2 / CELL; x <= W - 2 / CELL; x += 2) xy.push(x, yc + Math.sin(x * CELL / 6) * 1.5 / CELL);
      stampPolyline(water, W, H, Float64Array.from(xy), w / 2 / CELL, WATER_RIVER);
    });

    const { parts } = buildModel(
      {
        W, H, cellMm: CELL,
        elevation: new Float32Array((W + 1) * (H + 1)),
        mmPerGroundM: 1,
        routeLines: [],
        waterMask: water,
        markers: [],
        label: { rings: label.rings, grid: label.grid },
      },
      settings,
    );
    const rating = (g: number, w: number | null) =>
      g >= GOOD_GROOVE_NOZZLES * NOZZLE && (w ?? 9) >= GOOD_WALL_NOZZLES * NOZZLE ? 'Good' : g >= NOZZLE && (w ?? 9) >= NOZZLE ? 'Tight' : 'Too fine';
    console.log(
      `${size} mm: tile ${(W * CELL).toFixed(1)} x ${(H * CELL).toFixed(1)} mm, lines ${label.lineMm.map((v) => v.toFixed(2)).join('/')} mm,`,
      `groove ${label.strokeMm.toFixed(2)}, wall ${label.wallMm?.toFixed(2)} -> ${rating(label.strokeMm, label.wallMm)}`,
    );
    for (const p of parts) {
      const rep = validateMesh(p.positions, p.indices);
      expect(rep.ok, `${size} ${p.name} ${JSON.stringify(rep)}`).toBe(true);
      for (let i = 1; i < p.positions.length; i += 3) p.positions[i] += y0;
      all.push(p);
    }
    y0 += H * CELL + GAP;
  }

  // one terrain part holding all three tiles (separate closed shells)
  const merged: Part[] = [];
  for (const name of new Set(all.map((p) => p.name))) {
    const ps = all.filter((p) => p.name === name);
    const positions = new Float32Array(ps.reduce((s, p) => s + p.positions.length, 0));
    const indices = new Uint32Array(ps.reduce((s, p) => s + p.indices.length, 0));
    let vo = 0, io = 0;
    for (const p of ps) {
      positions.set(p.positions, vo * 3);
      for (let i = 0; i < p.indices.length; i++) indices[io + i] = p.indices[i] + vo;
      vo += p.positions.length / 3;
      io += p.indices.length;
    }
    merged.push({ name, positions, indices });
  }
  for (const p of merged) expect(validateMesh(p.positions, p.indices).ok).toBe(true);

  mkdirSync('build', { recursive: true });
  const out = `build/GPX3DP_test_coupons${printSuffix(NOZZLE, LAYER)}.3mf`;
  writeFileSync(out, to3mf(merged, { title: 'GPX3DP test coupons', description: 'Underside label at 4 / 5.5 / 7 mm; river grooves 0.6 / 0.8 / 1.2 mm', colors: {}, plate: [256, 256] }));
  console.log('wrote', out);
});
