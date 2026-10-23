import { buildSlab, NONE, type MeshData } from './mesh';
import { distanceInside, gaussianBlur, stampConvex, stampDisk, stampPolyline } from './raster';

export type RouteStyle = 'raised' | 'flush';
export type WaterSurface = 'off' | 'flat' | 'waterlines' | 'parallel';
export type PartName = 'terrain' | 'route' | 'water' | 'markers';
export type MarkerKind = 'start' | 'finish' | 'checkpoint' | 'waypoint';
export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond';
/** Which part markers print in. 'route' falls back to the terrain when the route has no own color. */
export type MarkerColor = 'terrain' | 'route' | 'own';

export interface ModelSettings {
  baseMm: number;
  exaggeration: number;
  /** terrain smoothing, sigma in mm */
  smoothMm: number;
  routeStyle: RouteStyle;
  routeWidthMm: number;
  routeHeightMm: number;
  routeOwnColor: boolean;
  waterSurface: WaterSurface;
  waterOwnColor: boolean;
  waterLineSpacingMm: number;
  waterLineWidthMm: number;
  waterLineDepthMm: number;
  markersOn: boolean;
  markerColor: MarkerColor;
  markerDiameterMm: number;
  /** flat marker top, this far above the highest route top under the marker */
  markerHeightMm: number;
  markerShapeStart: MarkerShape;
  markerShapeFinish: MarkerShape;
  markerShapeCheckpoint: MarkerShape;
  markerShapeWaypoint: MarkerShape;
  /** thickness of a colored layer that sits in the terrain (flush route, own-color water) */
  colorDepthMm: number;
}

export const DEFAULT_MODEL: ModelSettings = {
  baseMm: 3,
  exaggeration: 1,
  smoothMm: 0.25,
  routeStyle: 'raised',
  routeWidthMm: 1.2,
  routeHeightMm: 1.0,
  routeOwnColor: true,
  waterSurface: 'waterlines',
  waterOwnColor: false,
  waterLineSpacingMm: 1.5,
  waterLineWidthMm: 0.5,
  waterLineDepthMm: 0.4,
  markersOn: true,
  markerColor: 'route',
  markerDiameterMm: 2.5,
  markerHeightMm: 1.5,
  markerShapeStart: 'circle',
  markerShapeFinish: 'square',
  markerShapeCheckpoint: 'triangle',
  markerShapeWaypoint: 'diamond',
  colorDepthMm: 0.6,
};

export interface MarkerPin {
  xMm: number;
  yMm: number;
  kind: MarkerKind;
}

export interface ModelInput {
  /** cells across and up */
  W: number;
  H: number;
  cellMm: number;
  /** elevation in meters at the (W+1) x (H+1) cell corners, row-major from the south-west */
  elevation: Float32Array;
  mmPerGroundM: number;
  /** route polylines in print mm, interleaved x,y */
  routeLines: Float64Array[];
  /** water cells (W x H), optional */
  waterMask?: Uint8Array;
  markers: MarkerPin[];
}

export interface Part extends MeshData {
  name: PartName;
}

export interface ModelStats {
  elevMin: number;
  elevMax: number;
  reliefMm: number;
  maxHeightMm: number;
  cleanupFixes: number;
}

// Cell labels (exclusive, later wins): marker > route > water line > water > land.
const LAND = 0, WATER = 1, WLINE = 2, ROUTE = 3, MARKER = 4;
// Level codes, strictly increasing in height at every corner.
const ZERO = 0, ZCD = 1, ZE = 2, Z = 3, R = 4, M = 5;

interface PartDef {
  name: PartName;
  top: (label: number) => number;
  bot: (label: number) => number;
}

/** The part that marker cells belong to. */
function markerPart(s: ModelSettings): PartName {
  if (s.markerColor === 'own') return 'markers';
  if (s.markerColor === 'route' && s.routeOwnColor) return 'route';
  return 'terrain';
}

/** A marker outline in cell units: a circle, or a convex polygon (interleaved x,y, counter-clockwise). */
type Outline = { circle: [number, number, number] } | { poly: number[] };

function markerOutline(x: number, y: number, r: number, shape: MarkerShape): Outline {
  switch (shape) {
    case 'square': {
      const h = r * 0.9;
      return { poly: [x - h, y - h, x + h, y - h, x + h, y + h, x - h, y + h] };
    }
    case 'triangle': {
      // equilateral, pointing north, centroid on the pin
      const R = r * 1.25;
      const v: number[] = [];
      for (const a of [90, 210, 330]) v.push(x + R * Math.cos((a * Math.PI) / 180), y + R * Math.sin((a * Math.PI) / 180));
      return { poly: v };
    }
    case 'diamond': {
      const R = r * 1.2;
      return { poly: [x + R, y, x, y + R, x - R, y, x, y - R] };
    }
    default:
      return { circle: [x, y, r] };
  }
}

function stampOutline(labels: Uint8Array, W: number, H: number, o: Outline) {
  if ('circle' in o) stampDisk(labels, W, H, o.circle[0], o.circle[1], o.circle[2], MARKER);
  else stampConvex(labels, W, H, o.poly, MARKER);
}

/** Nearest point on an outline to (px, py), and its distance. */
function nearestOnOutline(o: Outline, px: number, py: number): [number, number, number] {
  if ('circle' in o) {
    const [cx, cy, r] = o.circle;
    const d = Math.hypot(px - cx, py - cy);
    if (d < 1e-9) return [cx + r, cy, r];
    return [cx + ((px - cx) * r) / d, cy + ((py - cy) * r) / d, Math.abs(d - r)];
  }
  const v = o.poly;
  let best: [number, number, number] = [px, py, Infinity];
  for (let i = 0; i < v.length; i += 2) {
    const ax = v[i], ay = v[i + 1], bx = v[(i + 2) % v.length], by = v[(i + 3) % v.length];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    const qx = ax + t * dx, qy = ay + t * dy, d = Math.hypot(px - qx, py - qy);
    if (d < best[2]) best = [qx, qy, d];
  }
  return best;
}

/** Largest move of a boundary corner, in cells (a corner is at most ~0.71 cell from the true edge). */
const MAX_MOVE = 0.75;
/** Smallest area (cells^2) a top triangle may shrink to after corners move: thin is fine, folded is not. */
const MIN_TRI_AREA = 1e-3;

/**
 * Smooth the stair-stepped outlines: move each corner that sits on a boundary between two labels onto
 * the true boundary of the higher label (exact for the route and marker shapes, the 0.5 contour of a
 * blurred mask for water and water lines). Vertices are shared per corner by every part and walls are
 * vertical between corners, so moving corners in XY keeps every part closed and the parts matching.
 * Returns per-corner (dx, dy) in mm and the diagonal each cell is split on.
 */
function smoothOutlines(
  labels: Uint8Array,
  W: number,
  H: number,
  cell: number,
  routeLines: Float64Array[],
  routeHalfWidth: number,
  outlines: Outline[],
  waterMask: Uint8Array | null,
): { offset: Float32Array; diag: Uint8Array } {
  const CW = W + 1;
  const nC = CW * (H + 1);
  const off = new Float32Array(2 * nC); // in cells until the end
  const owner = new Int8Array(nC).fill(-1);
  for (let cy = 1; cy < H; cy++)
    for (let cx = 1; cx < W; cx++) {
      const a = labels[(cy - 1) * W + cx - 1], b = labels[(cy - 1) * W + cx], c = labels[cy * W + cx - 1], d = labels[cy * W + cx];
      const hi = Math.max(a, b, c, d), lo = Math.min(a, b, c, d);
      if (hi === lo) continue;
      // exactly two labels around the corner
      if ([a, b, c, d].some((l) => l !== hi && l !== lo)) continue;
      owner[cy * CW + cx] = hi;
    }
  const move = (c: number, tx: number, ty: number) => {
    const cx = c % CW, cy = (c - cx) / CW;
    let dx = tx - cx, dy = ty - cy;
    const len = Math.hypot(dx, dy);
    if (len > 1.5) return; // target is not this corner's boundary
    if (len > MAX_MOVE) (dx *= MAX_MOVE / len), (dy *= MAX_MOVE / len);
    off[2 * c] = dx;
    off[2 * c + 1] = dy;
  };

  // route: nearest point on the centerlines, pushed out by half the width
  const best = new Float32Array(nC).fill(Infinity);
  const near = new Float32Array(2 * nC);
  const reach = routeHalfWidth + 1.5;
  for (const xy of routeLines) {
    const n = xy.length / 2;
    for (let i = 0; i < n; i++) {
      const x0 = xy[2 * i] / cell, y0 = xy[2 * i + 1] / cell;
      const x1 = i + 1 < n ? xy[2 * i + 2] / cell : x0, y1 = i + 1 < n ? xy[2 * i + 3] / cell : y0;
      const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
      const ix0 = Math.max(1, Math.floor(Math.min(x0, x1) - reach)), ix1 = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + reach));
      const iy0 = Math.max(1, Math.floor(Math.min(y0, y1) - reach)), iy1 = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + reach));
      for (let iy = iy0; iy <= iy1; iy++)
        for (let ix = ix0; ix <= ix1; ix++) {
          const c = iy * CW + ix;
          if (owner[c] !== ROUTE) continue;
          const t = len2 > 0 ? Math.max(0, Math.min(1, ((ix - x0) * dx + (iy - y0) * dy) / len2)) : 0;
          const qx = x0 + t * dx, qy = y0 + t * dy, d2 = (ix - qx) ** 2 + (iy - qy) ** 2;
          if (d2 < best[c]) (best[c] = d2), (near[2 * c] = qx), (near[2 * c + 1] = qy);
        }
    }
  }

  // water and water lines: 0.5 contour of the blurred region mask (cell values), Newton step at the corner
  const blurred = (inRegion: (i: number) => boolean) => {
    const m = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) m[i] = inRegion(i) ? 1 : 0;
    return gaussianBlur(m, W, H, 1);
  };
  const waterF = waterMask ? blurred((i) => waterMask[i] === 1) : null;
  const wlineF = waterMask ? blurred((i) => labels[i] === WLINE) : null;
  const contour = (F: Float32Array, c: number) => {
    const cx = c % CW, cy = (c - cx) / CW;
    const f00 = F[(cy - 1) * W + cx - 1], f10 = F[(cy - 1) * W + cx], f01 = F[cy * W + cx - 1], f11 = F[cy * W + cx];
    const f = (f00 + f10 + f01 + f11) / 4 - 0.5;
    const gx = (f10 + f11 - f00 - f01) / 2, gy = (f01 + f11 - f00 - f10) / 2;
    const g2 = gx * gx + gy * gy;
    if (g2 < 1e-6) return;
    move(c, cx - (f * gx) / g2, cy - (f * gy) / g2);
  };

  for (let c = 0; c < nC; c++) {
    const o = owner[c];
    if (o < 0) continue;
    const cx = c % CW, cy = (c - cx) / CW;
    if (o === ROUTE) {
      if (best[c] === Infinity) continue;
      const qx = near[2 * c], qy = near[2 * c + 1], d = Math.sqrt(best[c]);
      if (d < 1e-6) continue;
      move(c, qx + ((cx - qx) * routeHalfWidth) / d, qy + ((cy - qy) * routeHalfWidth) / d);
    } else if (o === MARKER) {
      let pick: [number, number, number] | null = null;
      for (const ol of outlines) {
        const q = nearestOnOutline(ol, cx, cy);
        if (!pick || q[2] < pick[2]) pick = q;
      }
      if (pick) move(c, pick[0], pick[1]);
    } else if (o === WATER && waterF) contour(waterF, c);
    else if (o === WLINE && wlineF) contour(wlineF, c);
  }

  // Split each cell on whichever diagonal keeps both triangles larger. If neither keeps both above
  // MIN_TRI_AREA, pull that cell's corners back (halve, then zero) so nothing folds.
  const diag = new Uint8Array(W * H);
  const area = (a: number, b: number, c: number) => {
    const ax = (a % CW) + off[2 * a], ay = Math.floor(a / CW) + off[2 * a + 1];
    const bx = (b % CW) + off[2 * b], by = Math.floor(b / CW) + off[2 * b + 1];
    const cx = (c % CW) + off[2 * c], cy = Math.floor(c / CW) + off[2 * c + 1];
    return ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
  };
  for (let pass = 0; pass < 8; pass++) {
    let bad = 0;
    for (let cy = 0; cy < H; cy++)
      for (let cx = 0; cx < W; cx++) {
        const c00 = cy * CW + cx, c10 = c00 + 1, c11 = c00 + CW + 1, c01 = c00 + CW;
        const d0 = Math.min(area(c00, c10, c11), area(c00, c11, c01));
        const d1 = Math.min(area(c00, c10, c01), area(c10, c11, c01));
        diag[cy * W + cx] = d1 > d0 ? 1 : 0;
        if (Math.max(d0, d1) >= MIN_TRI_AREA) continue;
        bad++;
        const k = pass < 7 ? 0.5 : 0;
        for (const q of [c00, c10, c11, c01]) (off[2 * q] *= k), (off[2 * q + 1] *= k);
      }
    if (!bad) break;
  }
  // corners pulled back above may have changed a neighbour's best diagonal
  for (let cy = 0; cy < H; cy++)
    for (let cx = 0; cx < W; cx++) {
      const c00 = cy * CW + cx, c10 = c00 + 1, c11 = c00 + CW + 1, c01 = c00 + CW;
      const d0 = Math.min(area(c00, c10, c11), area(c00, c11, c01));
      const d1 = Math.min(area(c00, c10, c01), area(c10, c11, c01));
      diag[cy * W + cx] = d1 > d0 ? 1 : 0;
    }
  for (let i = 0; i < off.length; i++) off[i] *= cell;
  return { offset: off, diag };
}

function partDefs(s: ModelSettings): PartDef[] {
  const raised = s.routeStyle === 'raised';
  const flushOwn = !raised && s.routeOwnColor;
  const waterOn = s.waterSurface !== 'off';
  const mk = markerPart(s);
  const defs: PartDef[] = [
    {
      name: 'terrain',
      top: (l) => {
        switch (l) {
          case WATER:
            return s.waterOwnColor ? ZCD : Z;
          case WLINE:
            return s.waterOwnColor ? ZCD : ZE;
          case ROUTE:
            return raised ? (s.routeOwnColor ? Z : R) : flushOwn ? ZCD : Z;
          case MARKER:
            return mk === 'terrain' ? M : mk === 'route' && flushOwn ? ZCD : Z;
          default:
            return Z;
        }
      },
      bot: () => ZERO,
    },
  ];
  if (s.routeOwnColor)
    defs.push({
      name: 'route',
      top: (l) => (l === ROUTE ? (raised ? R : Z) : l === MARKER && mk === 'route' ? M : NONE),
      bot: () => (raised ? Z : ZCD),
    });
  if (waterOn && s.waterOwnColor)
    defs.push({
      name: 'water',
      top: (l) => (l === WATER ? Z : l === WLINE ? ZE : NONE),
      bot: () => ZCD,
    });
  if (s.markersOn && mk === 'markers')
    defs.push({ name: 'markers', top: (l) => (l === MARKER ? M : NONE), bot: () => Z });
  return defs;
}

/**
 * Remove 2x2 checkerboards at every level of every part's top surface (they would make
 * edges shared by four faces). A low cell is relabelled to its higher diagonal neighbour.
 */
function cleanupDiagonals(labels: Uint8Array, W: number, H: number, defs: PartDef[]): number {
  let fixes = 0;
  const rank = (d: PartDef, i: number) => {
    const t = d.top(labels[i]);
    return t === NONE ? -1 : t;
  };
  for (let pass = 0; pass < 50; pass++) {
    let changed = 0;
    for (const d of defs)
      for (let cy = 0; cy + 1 < H; cy++)
        for (let cx = 0; cx + 1 < W; cx++) {
          const a = cy * W + cx, b = a + 1, c = a + W + 1, e = a + W;
          const ra = rank(d, a), rb = rank(d, b), rc = rank(d, c), re = rank(d, e);
          let hi1: number, hi2: number, lo1: number, lo2: number;
          if (Math.min(ra, rc) > Math.max(rb, re)) (hi1 = a), (hi2 = c), (lo1 = b), (lo2 = e);
          else if (Math.min(rb, re) > Math.max(ra, rc)) (hi1 = b), (hi2 = e), (lo1 = a), (lo2 = c);
          else continue;
          const src = rank(d, hi1) <= rank(d, hi2) ? hi1 : hi2;
          const dst = rank(d, lo1) >= rank(d, lo2) ? lo1 : lo2;
          labels[dst] = labels[src];
          changed++;
        }
    fixes += changed;
    if (!changed) break;
  }
  return fixes;
}

/** Flatten each connected water body to the median elevation along its shore. */
function flattenWater(E: Float32Array, water: Uint8Array, W: number, H: number) {
  const CW = W + 1;
  const comp = new Int32Array(W * H).fill(-1);
  const stack: number[] = [];
  const level = new Float32Array((W + 1) * (H + 1)).fill(NaN);
  let id = 0;
  for (let start = 0; start < W * H; start++) {
    if (!water[start] || comp[start] >= 0) continue;
    const cells: number[] = [];
    comp[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      cells.push(i);
      const x = i % W, y = (i - x) / W;
      if (x > 0 && water[i - 1] && comp[i - 1] < 0) (comp[i - 1] = id), stack.push(i - 1);
      if (x < W - 1 && water[i + 1] && comp[i + 1] < 0) (comp[i + 1] = id), stack.push(i + 1);
      if (y > 0 && water[i - W] && comp[i - W] < 0) (comp[i - W] = id), stack.push(i - W);
      if (y < H - 1 && water[i + W] && comp[i + W] < 0) (comp[i + W] = id), stack.push(i + W);
    }
    // shore = corners of this body that also touch a land cell
    const shore: number[] = [];
    const all: number[] = [];
    for (const i of cells) {
      const x = i % W, y = (i - x) / W;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const cx = x + dx, cy = y + dy;
        const c = cy * CW + cx;
        all.push(E[c]);
        let land = false;
        for (const [ex, ey] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
          const nx = cx + ex, ny = cy + ey;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && !water[ny * W + nx]) land = true;
        }
        if (land) shore.push(E[c]);
      }
    }
    const src = shore.length ? shore : all;
    src.sort((a, b) => a - b);
    const lv = src[Math.floor(src.length / 2)];
    for (const i of cells) {
      const x = i % W, y = (i - x) / W;
      for (const c of [y * CW + x, y * CW + x + 1, (y + 1) * CW + x, (y + 1) * CW + x + 1])
        level[c] = Number.isNaN(level[c]) ? lv : Math.min(level[c], lv);
    }
    id++;
  }
  for (let c = 0; c < level.length; c++) if (!Number.isNaN(level[c])) E[c] = level[c];
}

export function buildModel(input: ModelInput, s: ModelSettings): { parts: Part[]; stats: ModelStats } {
  const { W, H, cellMm: cell } = input;
  const CW = W + 1;
  const nC = CW * (H + 1);
  const E = gaussianBlur(input.elevation, CW, H + 1, s.smoothMm / cell);

  // --- labels
  const labels = new Uint8Array(W * H).fill(LAND);
  const waterOn = s.waterSurface !== 'off' && !!input.waterMask;
  if (waterOn) {
    const wm = input.waterMask!;
    flattenWater(E, wm, W, H);
    for (let i = 0; i < W * H; i++) if (wm[i]) labels[i] = WATER;
    if (s.waterSurface === 'waterlines' || s.waterSurface === 'parallel') {
      const dist = distanceInside(wm, W, H);
      const sp = s.waterLineSpacingMm, lw = s.waterLineWidthMm;
      for (let i = 0; i < W * H; i++) {
        if (!wm[i]) continue;
        const d = dist[i] * cell; // mm from shore (cell center to nearest land cell center)
        let on: boolean;
        if (s.waterSurface === 'waterlines') on = d > sp * 0.6 && (d + lw / 2) % sp < lw;
        else on = d > lw * 1.5 && ((Math.floor(i / W) + 0.5) * cell) % sp < lw;
        if (on) labels[i] = WLINE;
      }
    }
  }
  const route = new Uint8Array(W * H);
  for (const xy of input.routeLines) {
    const c = xy.map((v) => v / cell);
    stampPolyline(route, W, H, c, s.routeWidthMm / 2 / cell);
  }
  for (let i = 0; i < W * H; i++) if (route[i]) labels[i] = ROUTE;
  const outlines: Outline[] = [];
  if (s.markersOn)
    for (const m of input.markers) {
      const big = m.kind === 'start' || m.kind === 'finish';
      const r = ((big ? 1.4 : 1) * s.markerDiameterMm) / 2 / cell;
      const shape = { start: s.markerShapeStart, finish: s.markerShapeFinish, checkpoint: s.markerShapeCheckpoint, waypoint: s.markerShapeWaypoint }[m.kind];
      const o = markerOutline(m.xMm / cell, m.yMm / cell, r, shape);
      stampOutline(labels, W, H, o);
      outlines.push(o);
    }

  const defs = partDefs(s);
  const cleanupFixes = cleanupDiagonals(labels, W, H, defs);
  const { offset, diag } = smoothOutlines(labels, W, H, cell, input.routeLines, s.routeWidthMm / 2 / cell, outlines, waterOn ? input.waterMask! : null);

  // --- height fields (mm)
  let eMin = Infinity, eMax = -Infinity;
  for (let c = 0; c < nC; c++) {
    if (E[c] < eMin) eMin = E[c];
    if (E[c] > eMax) eMax = E[c];
  }
  const vScale = s.exaggeration * input.mmPerGroundM;
  const colorDepth = Math.max(s.colorDepthMm, s.waterLineDepthMm + 0.2);
  const base = Math.max(s.baseMm, colorDepth + 0.4);
  const Zf = new Float32Array(nC);
  for (let c = 0; c < nC; c++) {
    // terrain at the corner's (possibly moved) position, bilinear
    const dx = offset[2 * c] / cell, dy = offset[2 * c + 1] / cell;
    let e = E[c];
    if (dx || dy) {
      const fx = (c % CW) + dx, fy = Math.floor(c / CW) + dy;
      const x0 = Math.min(W - 1, Math.max(0, Math.floor(fx))), y0 = Math.min(H - 1, Math.max(0, Math.floor(fy)));
      const tx = fx - x0, ty = fy - y0, k = y0 * CW + x0;
      e = (E[k] * (1 - tx) + E[k + 1] * tx) * (1 - ty) + (E[k + CW] * (1 - tx) + E[k + CW + 1] * tx) * ty;
    }
    Zf[c] = base + (e - eMin) * vScale;
  }
  // raised route: the terrain face under the route, extruded straight up in z by the route height
  const Rf = new Float32Array(nC);
  for (let c = 0; c < nC; c++) Rf[c] = Zf[c] + s.routeHeightMm;

  // markers: flat tops per 8-connected component, markerHeightMm above the highest route top under it
  // (the route top is the terrain itself when the route is flush)
  const routeTopMm = s.routeStyle === 'raised' ? s.routeHeightMm : 0;
  const Mf = new Float32Array(nC);
  {
    const seen = new Uint8Array(W * H);
    for (let start = 0; start < W * H; start++) {
      if (labels[start] !== MARKER || seen[start]) continue;
      const cells: number[] = [];
      const st = [start];
      seen[start] = 1;
      while (st.length) {
        const i = st.pop()!;
        cells.push(i);
        const x = i % W, y = (i - x) / W;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const j = ny * W + nx;
            if (labels[j] === MARKER && !seen[j]) (seen[j] = 1), st.push(j);
          }
      }
      let top = 0;
      const corners = (i: number) => {
        const x = i % W, y = (i - x) / W, c = y * CW + x;
        return [c, c + 1, c + CW, c + CW + 1];
      };
      for (const i of cells) for (const c of corners(i)) top = Math.max(top, Zf[c] + routeTopMm + Math.max(0.2, s.markerHeightMm));
      for (const i of cells) for (const c of corners(i)) Mf[c] = top;
    }
  }

  const e = s.waterLineDepthMm;
  const level = (c: number, code: number) => {
    switch (code) {
      case ZERO:
        return 0;
      case ZCD:
        return Zf[c] - colorDepth;
      case ZE:
        return Zf[c] - e;
      case Z:
        return Zf[c];
      case R:
        return Rf[c];
      default:
        return Mf[c];
    }
  };

  const parts: Part[] = [];
  for (const d of defs) {
    const top = new Uint8Array(W * H);
    const bot = new Uint8Array(W * H);
    let any = false;
    for (let i = 0; i < W * H; i++) {
      top[i] = d.top(labels[i]);
      bot[i] = top[i] === NONE ? NONE : d.bot(labels[i]);
      if (top[i] !== NONE) any = true;
    }
    if (!any) continue;
    parts.push({ name: d.name, ...buildSlab(W, H, cell, top, bot, level, d.name === 'terrain', offset, diag) });
  }
  let maxH = 0;
  for (const p of parts) for (let i = 2; i < p.positions.length; i += 3) maxH = Math.max(maxH, p.positions[i]);

  return {
    parts,
    stats: { elevMin: eMin, elevMax: eMax, reliefMm: (eMax - eMin) * vScale, maxHeightMm: maxH, cleanupFixes },
  };
}
