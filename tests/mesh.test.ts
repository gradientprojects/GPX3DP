import { describe, expect, it } from 'vitest';
import { buildSlab, NONE } from '../src/core/mesh';
import { buildModel, DEFAULT_MODEL, type ModelSettings } from '../src/core/model';
import { validateMesh } from '../src/core/validate';

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('validateMesh', () => {
  const cube = () => {
    const p = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]);
    const i = new Uint32Array([
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
    ]);
    return { p, i };
  };
  it('accepts a closed cube', () => {
    const { p, i } = cube();
    const r = validateMesh(p, i);
    expect(r.ok).toBe(true);
    expect(r.volume).toBeCloseTo(1, 5);
  });
  it('flags a missing triangle as open edges', () => {
    const { p, i } = cube();
    const r = validateMesh(p, i.slice(3));
    expect(r.ok).toBe(false);
    expect(r.openEdges).toBe(3);
  });
  it('flags a flipped triangle', () => {
    const { p, i } = cube();
    [i[1], i[2]] = [i[2], i[1]];
    const r = validateMesh(p, i);
    expect(r.flippedEdges).toBeGreaterThan(0);
  });
  it('flags inside-out meshes', () => {
    const { p, i } = cube();
    for (let t = 0; t < i.length; t += 3) [i[t + 1], i[t + 2]] = [i[t + 2], i[t + 1]];
    expect(validateMesh(p, i).ok).toBe(false);
  });
  it('flags degenerate triangles', () => {
    const { p, i } = cube();
    const j = new Uint32Array([...i, 0, 0, 1]);
    expect(validateMesh(p, j).degenerate).toBe(1);
  });
});

describe('buildSlab', () => {
  it('builds a valid flat-bottom block', () => {
    const W = 5, H = 4;
    const top = new Uint8Array(W * H).fill(3);
    const bot = new Uint8Array(W * H).fill(0);
    const m = buildSlab(W, H, 1, top, bot, (c, code) => (code === 0 ? 0 : 2 + (c % 3) * 0.1), true);
    const r = validateMesh(m.positions, m.indices);
    expect(r).toMatchObject({ ok: true });
  });
  it('a diagonal checkerboard is non-manifold (why model.ts cleans them up)', () => {
    const W = 2, H = 2;
    const top = new Uint8Array([3, NONE, NONE, 3]);
    const bot = new Uint8Array([1, NONE, NONE, 1]);
    const m = buildSlab(W, H, 1, top, bot, (_c, code) => code);
    expect(validateMesh(m.positions, m.indices).nonManifoldEdges).toBeGreaterThan(0);
  });
  it('builds a valid part with holes and steps', () => {
    const W = 6, H = 6;
    const top = new Uint8Array(W * H).fill(NONE);
    const bot = new Uint8Array(W * H).fill(NONE);
    // ring with a hole, two top levels
    for (let y = 1; y < 5; y++)
      for (let x = 1; x < 5; x++) {
        if (x === 2 && y === 2) continue;
        const i = y * W + x;
        top[i] = x < 3 ? 4 : 3;
        bot[i] = 1;
      }
    const m = buildSlab(W, H, 0.5, top, bot, (_c, code) => code);
    expect(validateMesh(m.positions, m.indices).ok).toBe(true);
  });
});

/**
 * Folded (flipped) faces keep a mesh topologically closed, so validateMesh can't see them. A slab's
 * top and bottom cover the same footprint: the XY area of upward faces must equal that of downward ones,
 * and every face must be non-folded within its group.
 */
function foldCheck(P: Float32Array, I: Uint32Array) {
  let up = 0, down = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0) continue;
    if (nz > 0) up += nz / 2;
    else down -= nz / 2;
  }
  return { up, down, ok: Math.abs(up - down) < 1e-3 * Math.max(1, up) };
}

function terrain(W: number, H: number, seed: number) {
  const r = rng(seed);
  const E = new Float32Array((W + 1) * (H + 1));
  for (let y = 0; y <= H; y++)
    for (let x = 0; x <= W; x++) E[y * (W + 1) + x] = 1000 + 300 * Math.sin(x / 7) * Math.cos(y / 5) + 40 * r();
  return E;
}

const combos: Partial<ModelSettings>[] = [];
for (const routeStyle of ['raised', 'flush'] as const)
  for (const routeOwnColor of [true, false])
    for (const waterSurface of ['off', 'flat', 'waterlines', 'parallel'] as const)
      for (const waterOwnColor of [false, true])
        for (const markerColor of ['terrain', 'route', 'own'] as const) {
          if (routeStyle === 'flush' && !routeOwnColor) continue;
          combos.push({ routeStyle, routeOwnColor, waterSurface, waterOwnColor, markerColor });
        }

describe('buildModel', () => {
  const W = 60, H = 45, cell = 0.25;
  const water = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = x - 40, dy = y - 25;
      if (dx * dx + dy * dy * 1.6 < 140 || (x > 5 && x < 12 && y > 30)) water[y * W + x] = 1;
    }
  // a wiggly route crossing the lake, plus a second leg touching the edge
  const pts: number[] = [];
  for (let t = 0; t <= 60; t++) pts.push(1 + t * 0.22, 2 + 6 * (0.5 + 0.4 * Math.sin(t / 4)) + t * 0.05);
  const routeLines = [Float64Array.from(pts), Float64Array.from([14, 1, 14.5, 11.24, 3, 11])];

  for (const c of combos)
    it(`valid parts: ${JSON.stringify(c)}`, () => {
      const s = { ...DEFAULT_MODEL, ...c, markersOn: true };
      const { parts } = buildModel(
        {
          W,
          H,
          cellMm: cell,
          elevation: terrain(W, H, 7),
          mmPerGroundM: 0.004,
          routeLines,
          waterMask: water,
          markers: [
            { xMm: 1, yMm: 4.5, kind: 'start' },
            { xMm: 14.2, yMm: 6, kind: 'finish' },
            { xMm: 8, yMm: 8, kind: 'checkpoint' },
            { xMm: 8.4, yMm: 8.3, kind: 'waypoint' },
            { xMm: 5, yMm: 9.5, kind: 'waypoint' },
          ],
        },
        s,
      );
      const names = parts.map((p) => p.name);
      expect(names[0]).toBe('terrain');
      if (c.routeOwnColor) expect(names).toContain('route');
      if (c.waterOwnColor && c.waterSurface !== 'off') expect(names).toContain('water');
      if (c.markerColor === 'own') expect(names).toContain('markers');
      else expect(names).not.toContain('markers');
      for (const p of parts) {
        const r = validateMesh(p.positions, p.indices);
        expect({ part: p.name, ...r }).toMatchObject({ part: p.name, ok: true });
        expect({ part: p.name, ...foldCheck(p.positions, p.indices) }).toMatchObject({ ok: true });
      }
    });

  it('raised route is the terrain face under it, extruded straight up in z', () => {
    // terrain tilted across the route (rises with y); route runs along x
    const W = 80, H = 40, cell = 0.25;
    const E = new Float32Array((W + 1) * (H + 1));
    for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) E[y * (W + 1) + x] = 1000 + y * 10;
    const s = { ...DEFAULT_MODEL, waterSurface: 'off' as const, markersOn: false, routeOwnColor: true, smoothMm: 0 };
    const mmPerGroundM = 0.0125; // x3 -> 0.375 mm of terrain rise per cell, ~0.9 mm across a 1.2 mm route
    const { parts } = buildModel(
      { W, H, cellMm: cell, elevation: E, mmPerGroundM, routeLines: [Float64Array.from([2, 5, 18, 5])], markers: [] },
      s,
    );
    const route = parts.find((p) => p.name === 'route')!;
    expect(validateMesh(route.positions, route.indices).ok).toBe(true);
    // top of the route at each corner = highest vertex there
    const top = new Map<string, number>();
    const P = route.positions;
    for (let i = 0; i < P.length; i += 3) {
      const k = `${P[i].toFixed(3)},${P[i + 1].toFixed(3)}`;
      top.set(k, Math.max(top.get(k) ?? -Infinity, P[i + 2]));
    }
    const terrainAt = (y: number) => s.baseMm + (y / cell) * 10 * s.exaggeration * mmPerGroundM;
    expect(top.size).toBeGreaterThan(0);
    for (const [k, z] of top) expect(z).toBeCloseTo(terrainAt(+k.split(',')[1]) + s.routeHeightMm, 3);
  });

  it('marker top is flat, markerHeightMm above the highest route top under it', () => {
    const W = 40, H = 40, cell = 0.25;
    const E = new Float32Array((W + 1) * (H + 1));
    for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) E[y * (W + 1) + x] = 1000 + y * 10;
    const mmPerGroundM = 0.0125;
    for (const shape of ['circle', 'square', 'triangle', 'diamond'] as const) {
      const s = { ...DEFAULT_MODEL, waterSurface: 'off' as const, smoothMm: 0, markerColor: 'own' as const, markerShapeCheckpoint: shape };
      const { parts } = buildModel(
        { W, H, cellMm: cell, elevation: E, mmPerGroundM, routeLines: [Float64Array.from([1, 5, 9, 5])], markers: [{ xMm: 5, yMm: 5, kind: 'checkpoint' }] },
        s,
      );
      const m = parts.find((p) => p.name === 'markers')!;
      expect(validateMesh(m.positions, m.indices).ok).toBe(true);
      let top = -Infinity, maxY = -Infinity;
      for (let i = 0; i < m.positions.length; i += 3) top = Math.max(top, m.positions[i + 2]), (maxY = Math.max(maxY, m.positions[i + 1]));
      const terrainAt = (y: number) => s.baseMm + (y / cell) * 10 * mmPerGroundM;
      // highest corner under the marker is its north edge; terrain rises with y
      expect(top).toBeCloseTo(terrainAt(maxY) + s.routeHeightMm + s.markerHeightMm, 3);
    }
  });

  it('smooths stair steps: a diagonal route edge lies on the true edge', () => {
    const W = 80, H = 80, cell = 0.25;
    const E = new Float32Array(81 * 81).fill(1000);
    const s = { ...DEFAULT_MODEL, waterSurface: 'off' as const, markersOn: false, smoothMm: 0 };
    // 30 degrees, so the raster is a real staircase
    const x0 = 2, y0 = 3, x1 = 18, y1 = 3 + 16 * Math.tan(Math.PI / 6);
    const { parts } = buildModel({ W, H, cellMm: cell, elevation: E, mmPerGroundM: 0.001, routeLines: [Float64Array.from([x0, y0, x1, y1])], markers: [] }, s);
    const route = parts.find((p) => p.name === 'route')!;
    const P = route.positions;
    const ux = (x1 - x0) / Math.hypot(x1 - x0, y1 - y0), uy = (y1 - y0) / Math.hypot(x1 - x0, y1 - y0);
    // outline vertices: the ends of vertical wall edges (two vertices at the same XY joined by an edge)
    const onWall = new Set<number>();
    const I = route.indices;
    for (let t = 0; t < I.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = 3 * I[t + k], b = 3 * I[t + ((k + 1) % 3)];
        if (Math.abs(P[a] - P[b]) < 1e-6 && Math.abs(P[a + 1] - P[b + 1]) < 1e-6) onWall.add(a).add(b);
      }
    expect(onWall.size).toBeGreaterThan(20);
    let worst = 0;
    for (const i of onWall) {
      const t = (P[i] - x0) * ux + (P[i + 1] - y0) * uy;
      if (t < 2 || t > Math.hypot(x1 - x0, y1 - y0) - 2) continue; // skip the round caps
      const d = Math.abs((P[i] - x0) * -uy + (P[i + 1] - y0) * ux);
      worst = Math.max(worst, Math.abs(d - s.routeWidthMm / 2));
    }
    expect(worst).toBeLessThan(0.1 * cell);
    expect(foldCheck(route.positions, route.indices).ok).toBe(true);
  });

  it('square markers get sharp corners', () => {
    const W = 40, H = 40, cell = 0.25;
    const s = { ...DEFAULT_MODEL, waterSurface: 'off' as const, smoothMm: 0, markerColor: 'own' as const, markerShapeCheckpoint: 'square' as const };
    // off-grid center so the raster is uneven
    const cx = 5.13, cy = 4.92;
    const { parts } = buildModel(
      { W, H, cellMm: cell, elevation: new Float32Array(41 * 41).fill(1000), mmPerGroundM: 0.001, routeLines: [], markers: [{ xMm: cx, yMm: cy, kind: 'checkpoint' }] },
      s,
    );
    const m = parts.find((p) => p.name === 'markers')!;
    const h = (s.markerDiameterMm / 2) * 0.9;
    const P = m.positions;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      let d = Infinity;
      for (let i = 0; i < P.length; i += 3) d = Math.min(d, Math.hypot(P[i] - (cx + sx * h), P[i + 1] - (cy + sy * h)));
      expect(d).toBeLessThan(0.2 * cell);
    }
  });

  it('survives random label noise (fuzz)', () => {
    const r = rng(42);
    for (let k = 0; k < 6; k++) {
      const wm = new Uint8Array(W * H).map(() => (r() < 0.35 ? 1 : 0));
      const lines: Float64Array[] = [];
      for (let j = 0; j < 8; j++) lines.push(Float64Array.from([r() * 15, r() * 11, r() * 15, r() * 11, r() * 15, r() * 11]));
      const s: ModelSettings = {
        ...DEFAULT_MODEL,
        routeStyle: k % 2 ? 'flush' : 'raised',
        routeOwnColor: true,
        waterSurface: (['flat', 'waterlines', 'parallel'] as const)[k % 3],
        waterOwnColor: k % 3 !== 1,
        markerColor: (['terrain', 'route', 'own'] as const)[k % 3],
        markerShapeCheckpoint: (['circle', 'square', 'triangle', 'diamond'] as const)[k % 4],
        markerShapeWaypoint: (['diamond', 'triangle', 'square', 'circle'] as const)[k % 4],
        waterLineSpacingMm: 0.6,
        waterLineWidthMm: 0.25,
      };
      const markers = Array.from({ length: 10 }, () => ({ xMm: r() * 15, yMm: r() * 11, kind: 'checkpoint' as const }));
      const { parts } = buildModel(
        { W, H, cellMm: cell, elevation: terrain(W, H, k), mmPerGroundM: 0.004, routeLines: lines, waterMask: wm, markers },
        s,
      );
      for (const p of parts) {
        expect({ k, part: p.name, ...validateMesh(p.positions, p.indices) }).toMatchObject({ ok: true });
        expect({ k, part: p.name, ...foldCheck(p.positions, p.indices) }).toMatchObject({ ok: true });
      }
    }
  });
});
