import { readFileSync } from 'node:fs';
import { parse } from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { inRing, labelWidthsAt, layoutLabel, ringArea, snapPlacement, thinnestPx, traceRings } from '../src/core/label';
import { LABEL_FONTS } from '../src/fonts';
import { buildSlab } from '../src/core/mesh';
import { buildModel, DEFAULT_MODEL, type ModelSettings } from '../src/core/model';
import { validateMesh } from '../src/core/validate';

const fontFile = readFileSync(new URL('../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff', import.meta.url));
export const font = parse(fontFile.buffer.slice(fontFile.byteOffset, fontFile.byteOffset + fontFile.byteLength));

/** same check as mesh.test.ts: upward and downward XY area must match (folded faces) */
function foldCheck(P: Float32Array, I: Uint32Array) {
  let up = 0, down = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
    const z = (P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[b + 1] - P[a + 1]) * (P[c] - P[a]);
    if (z > 0) up += z;
    else down -= z;
  }
  return { ok: Math.abs(up - down) < 1e-6 * Math.max(up, 1), up, down };
}

const spec = (lines: string[], extra: Partial<Parameters<typeof layoutLabel>[1]> = {}) => ({
  lines,
  sizeMm: 5,
  edgeX: 'center' as const,
  offX: 0,
  edgeY: 'middle' as const,
  offY: 0,
  align: 'auto' as const,
  ...extra,
});

describe('traceRings', () => {
  it('a square with a hole gives a CCW outer ring and a CW island', () => {
    const N = 10, m = new Uint8Array(N * N);
    for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) m[y * N + x] = 1;
    for (let y = 4; y < 6; y++) for (let x = 4; x < 6; x++) m[y * N + x] = 0;
    const r = traceRings(m, N, N).map(ringArea).sort((a, b) => a - b);
    expect(r.length).toBe(2);
    expect(r[0]).toBeLessThan(0);
    expect(r[1]).toBeGreaterThan(0);
  });

  it('diagonal pixels (saddle) stay separate rings', () => {
    const m = Uint8Array.from([1, 0, 0, 1]);
    expect(traceRings(m, 2, 2).length).toBe(2);
  });
});

describe('layoutLabel', () => {
  it('mirrors the text so it reads from below', () => {
    // a left-aligned block anchored at 10% (from below) sits on the +x side seen from above
    const g = layoutLabel(font, spec(['GPX'], { edgeX: 'left', offX: 10 }), 100, 60)!;
    const xs = g.rings.flatMap((r) => [...r].filter((_, i) => i % 2 === 0));
    expect(Math.min(...xs)).toBeGreaterThan(50);
    // traced outline may sit up to one 0.05 mm pixel outside the glyph box
    expect(Math.max(...xs)).toBeLessThanOrEqual(90 + 0.06);
  });

  it('places the box by edge and gap, read from below', () => {
    const W = 100, H = 60;
    // from left 8 mm, from top 5 mm: seen from below the left is model +x
    const a = layoutLabel(font, spec(['Ride'], { edgeX: 'left', offX: 8, edgeY: 'top', offY: 5 }), W, H)!;
    expect(W - a.box[2]).toBeCloseTo(8, 6);
    expect(H - a.box[3]).toBeCloseTo(5, 6);
    // centered with an offset: box center 10 mm right of center (read from below) and 4 mm up
    const c = layoutLabel(font, spec(['Ride'], { offX: 10, offY: 4 }), W, H)!;
    expect(W - (c.box[0] + c.box[2]) / 2 - W / 2).toBeCloseTo(10, 6);
    expect((c.box[1] + c.box[3]) / 2 - H / 2).toBeCloseTo(4, 6);
    // ink stays inside the box (within one tracing pixel)
    for (const r of a.rings)
      for (let i = 0; i < r.length; i += 2) {
        expect(r[i]).toBeGreaterThan(a.box[0] - 0.06);
        expect(r[i]).toBeLessThan(a.box[2] + 0.06);
      }
  });

  it('snaps a box to center or its nearest edge, per axis', () => {
    const W = 100, H = 60;
    // read from below: box spans 6..36 (left gap 6), y 40..50 (top gap 10)
    expect(snapPlacement([W - 36, 40, W - 6, 50], W, H)).toEqual({ edgeX: 'left', offX: 6, edgeY: 'top', offY: 10 });
    // within 3 mm of both center lines
    expect(snapPlacement([W / 2 - 14, H / 2 - 4, W / 2 + 16, H / 2 + 6], W, H)).toEqual({ edgeX: 'center', offX: 0, edgeY: 'middle', offY: 0 });
    // right and bottom, gaps rounded to 0.5 mm
    expect(snapPlacement([4.2, 7.3, 30, 12], W, H)).toEqual({ edgeX: 'right', offX: 4, edgeY: 'bottom', offY: 7.5 });
  });

  it('auto align follows the across edge', () => {
    const lines = ['a long first line', 'short'];
    const left = layoutLabel(font, spec(lines, { edgeX: 'left', offX: 10 }), 100, 60)!;
    const forced = layoutLabel(font, spec(lines, { edgeX: 'left', offX: 10, align: 'left' }), 100, 60)!;
    expect(left.rings.map((r) => r[0])).toEqual(forced.rings.map((r) => r[0]));
  });

  it('letters with islands have CW rings inside CCW ones', () => {
    const g = layoutLabel(font, spec(['O8a']), 100, 60)!;
    const islands = g.rings.filter((r) => ringArea(r) < 0);
    expect(islands.length).toBeGreaterThanOrEqual(3);
    for (const h of islands) expect(g.rings.some((r) => ringArea(r) > 0 && inRing(r, h[0], h[1]))).toBe(true);
  });

  it('stays inside the margin, shrinking when it has to', () => {
    const g = layoutLabel(font, spec(['A very long ride name that will not fit'], { sizeMm: 10, edgeX: 'right', offX: 0 }), 60, 40)!;
    expect(g.shrunk).toBe(true);
    for (const r of g.rings)
      for (let i = 0; i < r.length; i += 2) {
        expect(r[i]).toBeGreaterThanOrEqual(3 - 0.06);
        expect(r[i]).toBeLessThanOrEqual(57 + 0.06);
      }
  });
});

describe('print check', () => {
  it('measures bars of known width within one pixel', () => {
    // vertical ink bars 10, 17 and 24 px wide, with gaps of 8 and 13 px between them (0.05 mm pixels)
    const NX = 120, NY = 80, m = new Uint8Array(NX * NY);
    const bars = [[10, 20], [28, 45], [58, 82]];
    for (const [a, b] of bars) for (let y = 10; y < 70; y++) for (let x = a; x < b; x++) m[y * NX + x] = 1;
    expect(thinnestPx(m, NX, NY, 1, Infinity)).toBeGreaterThanOrEqual(9);
    expect(thinnestPx(m, NX, NY, 1, Infinity)).toBeLessThanOrEqual(11);
    expect(thinnestPx(m, NX, NY, 0, 40)).toBeGreaterThanOrEqual(7);
    expect(thinnestPx(m, NX, NY, 0, 40)).toBeLessThanOrEqual(9);
    // one bar alone has no wall
    const one = new Uint8Array(NX * NY);
    for (let y = 10; y < 70; y++) for (let x = 40; x < 60; x++) one[y * NX + x] = 1;
    expect(thinnestPx(one, NX, NY, 0, 40)).toBeNull();
  });

  it('stroke and wall scale with the letter size', () => {
    const a = layoutLabel(font, spec(['Death Ride 2025'], { sizeMm: 4 }), 150, 60)!;
    const b = layoutLabel(font, spec(['Death Ride 2025'], { sizeMm: 8 }), 150, 60)!;
    expect(b.strokeMm / a.strokeMm).toBeGreaterThan(1.8);
    expect(b.strokeMm / a.strokeMm).toBeLessThan(2.2);
    // Inter Bold: stems about a fifth of the cap height, crossbars and terminals thinner
    expect(b.strokeMm).toBeGreaterThan(1);
    expect(b.strokeMm).toBeLessThan(2);
    expect(a.wallMm).not.toBeNull();
  });

  describe('small line', () => {
    const exag = 'Vertical exaggeration 1.5×';
    const small = (nozzleMm: number, sizeMm = 5) =>
      layoutLabel(font, spec(['Death Ride 2025', exag], { sizeMm, small: { lines: [1], scale: 0.65, nozzleMm } }), 150, 80)!;
    const alone = (sizeMm: number) => layoutLabel(font, spec([exag], { sizeMm }), 150, 80)!;

    it('prints at the scale when that is printable', () => {
      const g = small(0.2);
      expect(g.lineMm[0]).toBe(5);
      expect(g.lineMm[1]).toBeGreaterThanOrEqual(3.25);
      expect(g.lineMm[1]).toBeLessThanOrEqual(3.3);
      // the block is shorter than two full-size lines
      const full = layoutLabel(font, spec(['Death Ride 2025', exag], { sizeMm: 5 }), 150, 80)!;
      expect(g.box[3] - g.box[1]).toBeLessThan(full.box[3] - full.box[1]);
    });

    for (const n of [0.4, 0.6])
      it(`never below the printable size for a ${n} mm nozzle`, () => {
        const g = small(n, 10);
        // 0.4: the line shrinks; 0.6: Inter's near-touching letters leave walls that need the full size
        expect(g.lineMm[1]).toBeLessThanOrEqual(n === 0.6 ? 10 : 9);
        if (g.lineMm[1] === 10) return; // held at the main size: nothing was computed to check
        const a = alone(g.lineMm[1]);
        // within a pixel of the "good" limits (rasterizing isn't exactly linear)
        expect(a.strokeMm).toBeGreaterThanOrEqual(1.5 * n - 0.05);
        if (a.wallMm !== null) expect(a.wallMm).toBeGreaterThanOrEqual(1.75 * n - 0.05);
      });

    it('main widths leave out the small line and any shrink', () => {
      const g = small(0.4, 10);
      const one = layoutLabel(font, spec(['Death Ride 2025'], { sizeMm: 10 }), 1e4, 1e4, 0)!;
      expect(g.scaling.main.strokeMm).toBeCloseTo(one.strokeMm, 5);
      expect(g.strokeMm).toBeLessThan(g.scaling.main.strokeMm);
      // shrunk to fit a small print: main stays at the asked size
      const tiny = layoutLabel(font, spec(['Death Ride 2025'], { sizeMm: 10 }), 60, 40)!;
      expect(tiny.shrunk).toBe(true);
      expect(tiny.scaling.main.strokeMm).toBeCloseTo(one.strokeMm, 5);
    });

    // what the drag readout predicts must match what the rebuild then measures
    for (const [from, to] of [[6, 3], [6, 4.5], [6, 9], [10, 5]])
      it(`predicted widths at ${to} mm (built at ${from} mm) match a layout at ${to} mm`, () => {
        const sp = (sizeMm: number) => spec(['Death Ride 2025', 'Vertical exaggeration 1× (true scale)'], { sizeMm, small: { lines: [1], scale: 0.65, nozzleMm: 0.4 } });
        const built = layoutLabel(font, sp(from), 1e4, 1e4, 0)!;
        const real = layoutLabel(font, sp(to), 1e4, 1e4, 0)!;
        const p = labelWidthsAt(built.scaling, to);
        // rasterizing at 0.05 mm isn't exactly linear, and the small line sits at its wall-driven floor:
        // within four pixels, and the error is pessimistic (the rebuild then rates it better, never worse)
        expect(Math.abs(p.strokeMm - real.strokeMm)).toBeLessThan(0.2);
        expect(Math.abs((p.wallMm ?? 0) - (real.wallMm ?? 0))).toBeLessThan(0.2);
      });

    it('stays at the main size when even that is too fine', () => {
      expect(small(1, 4).lineMm[1]).toBe(4);
    });

    it('follows the line it was given when empty lines are dropped', () => {
      const g = layoutLabel(font, spec(['', 'Death Ride', '  ', exag], { small: { lines: [3], scale: 0.65, nozzleMm: 0.2 } }), 150, 80)!;
      expect(g.lineMm).toEqual([5, 3.3]);
    });
  });

  for (const f of LABEL_FONTS)
    it(`${f.name} parses, lays out and gives a manifold pocket`, () => {
      const file = readFileSync(new URL(`../node_modules/${f.file}`, import.meta.url));
      const ff = parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
      const lines = ['Death Ride 2025', '104 mi · 12,966 ft', 'Vertical exaggeration 1.5×'];
      const g = layoutLabel(ff, spec(lines, { sizeMm: 5, small: { lines: [2], scale: 0.65, nozzleMm: 0.2 } }), 100, 60)!;
      expect(g.lineMm[2]).toBeLessThan(5);
      expect(g.dropped).toEqual([]);
      expect(g.strokeMm).toBeGreaterThan(0.4);
      const n = (c: number) => new Uint8Array(200 * 120).fill(c);
      const m = buildSlab(200, 120, 0.5, n(3), n(0), (_c, code) => (code === 0 ? 0 : 4), true, undefined, undefined, { ...g, depth: 0.6 });
      expect(validateMesh(m.positions, m.indices)).toMatchObject({ ok: true });
    });
});

describe('debossed bottom', () => {
  const W = 120, H = 80, cell = 0.5;
  const flat = (code: number) => new Uint8Array(W * H).fill(code);
  const level = (_c: number, code: number) => (code === 0 ? 0 : 4);

  for (const lines of [['Death Ride 2025'], ['O8a@%&', 'two lines', 'iii lll'], ['tight', 'kerning: AVATAR Wy']])
    it(`closed and manifold: ${lines.join(' / ')}`, () => {
      const g = layoutLabel(font, spec(lines, { sizeMm: 4 }), W * cell, H * cell)!;
      const m = buildSlab(W, H, cell, flat(3), flat(0), level, true, undefined, undefined, { ...g, depth: 0.6 });
      expect(validateMesh(m.positions, m.indices)).toMatchObject({ ok: true });
      expect(foldCheck(m.positions, m.indices)).toMatchObject({ ok: true });
      let zMax = 0;
      for (let i = 2; i < m.positions.length; i += 3) if (m.positions[i] < 4) zMax = Math.max(zMax, m.positions[i]);
      expect(zMax).toBeCloseTo(0.6, 5);
    });

  it('closed when an earcut bridge runs through a ring vertex (T-junction)', () => {
    // found in the browser: this exact layout on a 200 x 133.5 mm print left 3 open edges
    const lines = ['Death Ride 2025', '104 mi · 12,966 ft climbing', 'Vertical exaggeration 1× (true scale)'];
    const g = layoutLabel(font, spec(lines, { sizeMm: 5 }), 200, 133.5)!;
    const n = (c: number) => new Uint8Array(400 * 267).fill(c);
    const m = buildSlab(400, 267, 0.5, n(3), n(0), level, true, undefined, undefined, { ...g, depth: 0.6 });
    expect(validateMesh(m.positions, m.indices)).toMatchObject({ ok: true });
    expect(foldCheck(m.positions, m.indices)).toMatchObject({ ok: true });
  });

  it('every model combination still validates with a label', () => {
    const E = new Float32Array((W + 1) * (H + 1));
    for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) E[y * (W + 1) + x] = 1000 + 200 * Math.sin(x / 9) * Math.cos(y / 7);
    const water = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - 80) ** 2 + (y - 40) ** 2 < 300) water[y * W + x] = 1;
    const g = layoutLabel(font, spec(['Death Ride', '103 mi · 15,000 ft']), W * cell, H * cell)!;
    const routeLines = [Float64Array.from([2, 2, 30, 20, 58, 38])];
    for (const c of [{}, { routeStyle: 'flush' as const }, { waterOwnColor: true, waterSurface: 'flat' as const }, { markerColor: 'own' as const }]) {
      const s: ModelSettings = { ...DEFAULT_MODEL, ...c };
      const { parts, stats } = buildModel(
        { W, H, cellMm: cell, elevation: E, mmPerGroundM: 0.002, routeLines, waterMask: water, markers: [{ xMm: 30, yMm: 20, kind: 'start' }], label: g },
        s,
      );
      expect(stats.labelDepthMm).toBeCloseTo(0.6);
      for (const p of parts) expect({ part: p.name, ...validateMesh(p.positions, p.indices) }).toMatchObject({ ok: true });
    }
  });

  it('caps the depth below the color layer', () => {
    const E = new Float32Array((W + 1) * (H + 1)).fill(100);
    const g = layoutLabel(font, spec(['deep']), W * cell, H * cell)!;
    const s = { ...DEFAULT_MODEL, baseMm: 3, labelDepthMm: 5 };
    const { stats } = buildModel({ W, H, cellMm: cell, elevation: E, mmPerGroundM: 0.002, routeLines: [], markers: [], label: g }, s);
    expect(stats.labelDepthMm).toBeCloseTo(3 - 0.6 - 0.4);
  });
});
