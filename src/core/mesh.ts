/**
 * Slab mesh builder.
 *
 * A part is a set of grid cells. Each cell in the part spans from a bottom surface to a top surface,
 * both given as a *level code* per cell. A level code names a height field sampled at the cell's four
 * corners (e.g. "terrain", "terrain - 0.6 mm", "route top"). Codes are ordered so that a higher code is
 * strictly higher at every corner; that keeps steps between neighbouring cells from crossing.
 *
 * Vertices are keyed by (corner, code), so cells that share a surface share vertices and parts that
 * touch share identical surfaces. Vertical faces are split at every level present on their corner
 * lines, so there are no T-junctions: the result is a closed, consistently oriented 2-manifold as long
 * as no 2x2 block has a diagonal (checkerboard) pattern at any level, which `model.ts` cleans up first.
 */

import earcut from 'earcut';
import { inRing, ringArea } from './label';

export const NONE = 255;
export const NUM_CODES = 7;

export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
}

class Grow<T extends Float32Array | Uint32Array> {
  len = 0;
  constructor(public buf: T) {}
  push3(a: number, b: number, c: number) {
    if (this.len + 3 > this.buf.length) {
      const nb = new (this.buf.constructor as { new (n: number): T })(this.buf.length * 2);
      nb.set(this.buf);
      this.buf = nb;
    }
    this.buf[this.len++] = a;
    this.buf[this.len++] = b;
    this.buf[this.len++] = c;
  }
  done(): T {
    return this.buf.slice(0, this.len) as T;
  }
}

export function buildSlab(
  W: number,
  H: number,
  cell: number,
  top: Uint8Array,
  bot: Uint8Array,
  level: (corner: number, code: number) => number,
  flatBottom = false,
  /** per-corner (dx, dy) in mm; every code at a corner moves together, so walls stay vertical */
  offset?: Float32Array,
  /** per-cell diagonal: 0 splits on c00-c11, 1 on c10-c01 (parts sharing a surface must pass the same) */
  diag?: Uint8Array,
  /** text debossed into the flat bottom (needs flatBottom) */
  pocket?: Pocket,
): SlabMesh {
  const CW = W + 1;
  const nCorners = CW * (H + 1);
  const vid = new Int32Array(nCorners * NUM_CODES).fill(-1);
  const pos = new Grow(new Float32Array(1 << 16));
  const idx = new Grow(new Uint32Array(1 << 16));
  let nv = 0;

  const cornerCodes = new Uint8Array(nCorners);
  for (let cy = 0; cy < H; cy++)
    for (let cx = 0; cx < W; cx++) {
      const i = cy * W + cx;
      if (top[i] === NONE) continue;
      const bits = (1 << top[i]) | (1 << bot[i]);
      const c00 = cy * CW + cx;
      cornerCodes[c00] |= bits;
      cornerCodes[c00 + 1] |= bits;
      cornerCodes[c00 + CW] |= bits;
      cornerCodes[c00 + CW + 1] |= bits;
    }

  const v = (c: number, code: number) => {
    const k = c * NUM_CODES + code;
    let id = vid[k];
    if (id < 0) {
      id = vid[k] = nv++;
      const dx = offset ? offset[2 * c] : 0, dy = offset ? offset[2 * c + 1] : 0;
      pos.push3((c % CW) * cell + dx, Math.floor(c / CW) * cell + dy, level(c, code));
    }
    return id;
  };

  const L: number[] = [];
  const R: number[] = [];
  const column = (c: number, lo: number, hi: number, out: number[]) => {
    out.length = 0;
    const bits = cornerCodes[c];
    for (let k = lo; k <= hi; k++) if (bits & (1 << k)) out.push(k);
  };
  /** Vertical face on side P->Q (outward from the owning cell), from code lo to hi. */
  const ladder = (P: number, Q: number, lo: number, hi: number) => {
    column(P, lo, hi, L);
    column(Q, lo, hi, R);
    let i = 0, j = 0;
    while (i < L.length - 1 || j < R.length - 1) {
      if (j < R.length - 1 && (i >= L.length - 1 || R[j + 1] <= L[i + 1])) {
        idx.push3(v(P, L[i]), v(Q, R[j]), v(Q, R[j + 1]));
        j++;
      } else {
        idx.push3(v(P, L[i]), v(Q, R[j]), v(P, L[i + 1]));
        i++;
      }
    }
  };

  for (let cy = 0; cy < H; cy++)
    for (let cx = 0; cx < W; cx++) {
      const a = cy * W + cx;
      const t = top[a];
      if (t === NONE) continue;
      const b = bot[a];
      const c00 = cy * CW + cx, c10 = c00 + 1, c11 = c00 + CW + 1, c01 = c00 + CW;

      if (diag && diag[a]) {
        idx.push3(v(c00, t), v(c10, t), v(c01, t));
        idx.push3(v(c10, t), v(c11, t), v(c01, t));
        if (!flatBottom) {
          idx.push3(v(c00, b), v(c01, b), v(c10, b));
          idx.push3(v(c10, b), v(c01, b), v(c11, b));
        }
      } else {
        idx.push3(v(c00, t), v(c10, t), v(c11, t));
        idx.push3(v(c00, t), v(c11, t), v(c01, t));
        if (!flatBottom) {
          idx.push3(v(c00, b), v(c11, b), v(c10, b));
          idx.push3(v(c00, b), v(c01, b), v(c11, b));
        }
      }

      // sides in CCW order seen from above: S, E, N, W
      for (let s = 0; s < 4; s++) {
        let P: number, Q: number, nb: number;
        if (s === 0) (P = c00), (Q = c10), (nb = cy > 0 ? a - W : -1);
        else if (s === 1) (P = c10), (Q = c11), (nb = cx < W - 1 ? a + 1 : -1);
        else if (s === 2) (P = c11), (Q = c01), (nb = cy < H - 1 ? a + W : -1);
        else (P = c01), (Q = c00), (nb = cx > 0 ? a - 1 : -1);
        if (nb < 0 || top[nb] === NONE) {
          ladder(P, Q, b, t);
          continue;
        }
        if (t > top[nb]) ladder(P, Q, top[nb], t);
        if (b < bot[nb]) ladder(P, Q, b, bot[nb]);
      }
    }

  if (flatBottom && pocket?.rings.length) {
    const ring: number[] = [];
    for (let y = 0; y <= H; y++) ring.push(y * CW);
    for (let x = 1; x <= W; x++) ring.push(H * CW + x);
    for (let y = H - 1; y >= 0; y--) ring.push(y * CW + W);
    for (let x = W - 1; x >= 1; x--) ring.push(x);
    const code = bot[0];
    const z0 = level(0, code);
    const plug = pocket.plug ? { pos: new Grow(new Float32Array(1 << 14)), idx: new Grow(new Uint32Array(1 << 14)) } : null;
    nv = pocketBottom(pos, idx, nv, ring.map((c) => v(c, code)), [0, H, H + W, 2 * H + W], W * cell, H * cell, z0, pocket, plug);
    if (plug) return { positions: pos.done(), indices: idx.done(), plug: { positions: plug.pos.done(), indices: plug.idx.done() } };
  } else if (flatBottom) {
    // Fan from a center vertex to the perimeter, clockwise seen from above (normal -z).
    const center = nv++;
    pos.push3((W * cell) / 2, (H * cell) / 2, level(0, 0));
    const ring: number[] = [];
    for (let y = 0; y <= H; y++) ring.push(y * CW);
    for (let x = 1; x <= W; x++) ring.push(H * CW + x);
    for (let y = H - 1; y >= 0; y--) ring.push(y * CW + W);
    for (let x = W - 1; x >= 1; x--) ring.push(x);
    const code = bot[0];
    for (let i = 0; i < ring.length; i++) idx.push3(center, v(ring[i], code), v(ring[(i + 1) % ring.length], code));
  }

  return { positions: pos.done(), indices: idx.done() };
}

export interface Pocket {
  /** closed rings in mm, ink on the left (CCW around letters, CW around islands); must stay inside the bottom */
  rings: Float64Array[];
  /** the grid the ring points lie on (see LabelGeom) */
  grid: { ox: number; oy: number; step: number };
  /** how far the letters go up into the bottom, mm */
  depth: number;
  /** also build the letters as a solid that fills the pocket exactly (a color inlay), returned as `plug` */
  plug?: boolean;
}

export interface SlabMesh extends MeshData {
  /** the pocket's inverse: a closed solid per letter, sharing the pocket's vertex positions bit for bit */
  plug?: MeshData;
}

/** keeps the frame strip clear of the label (labels stay 3 mm inside the edge) */
const POCKET_INSET = 1.5;

/**
 * Flat bottom with debossed letters. A strip from the perimeter to an inset rectangle (so the perimeter's many
 * collinear vertices stay exact), the rectangle minus the letters at z0, the islands inside letters at z0, the
 * letter ceilings at z0 + depth, and walls along every ring. All faces under the part face -z.
 *
 * With `plug`, the inverse solid is written to its own buffers in the same pass: the letters minus their
 * islands as top (+z, at z0 + depth, the same triangles as the ceilings) and bottom (-z, at z0), and the
 * walls facing away from the ink. Same ring points pushed the same way, so the positions match bit for bit.
 */
function pocketBottom(
  pos: Grow<Float32Array>,
  idx: Grow<Uint32Array>,
  nv: number,
  ringIds: number[],
  corners: number[],
  Wmm: number,
  Hmm: number,
  z0: number,
  pocket: Pocket,
  plug: { pos: Grow<Float32Array>; idx: Grow<Uint32Array> } | null = null,
): number {
  const xy = (id: number): [number, number] => [pos.buf[3 * id], pos.buf[3 * id + 1]];
  const tri = (a: number, b: number, c: number) => {
    const [ax, ay] = xy(a), [bx, by] = xy(b), [cx, cy] = xy(c);
    // clockwise seen from above
    if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > 0) idx.push3(a, c, b);
    else idx.push3(a, b, c);
  };
  const vert = (x: number, y: number, z: number) => {
    pos.push3(x, y, z);
    return nv++;
  };

  // inset rectangle, corners in the same order as the perimeter corners: (0,0) (0,H) (W,H) (W,0)
  const s = POCKET_INSET;
  const inner = [vert(s, s, z0), vert(s, Hmm - s, z0), vert(Wmm - s, Hmm - s, z0), vert(Wmm - s, s, z0)];
  const n = ringIds.length;
  for (let k = 0; k < 4; k++) {
    const from = corners[k], to = k === 3 ? n : corners[k + 1];
    const A = inner[k], B = inner[(k + 1) % 4];
    const len = to - from;
    let switched = false;
    for (let j = from; j < to; j++) {
      const p = ringIds[j], q = ringIds[(j + 1) % n];
      const firstHalf = (j - from + 0.5) / len < 0.5;
      if (!firstHalf && !switched) {
        tri(p, B, A);
        switched = true;
      }
      tri(p, q, firstHalf ? A : B);
    }
    if (!switched) tri(ringIds[to % n], B, A);
  }

  // ring nesting: parent = smallest ring containing the first point
  const rings = pocket.rings;
  const area = rings.map(ringArea);
  const parent = rings.map((r, i) => {
    let best = -1;
    for (let j = 0; j < rings.length; j++)
      if (j !== i && Math.abs(area[j]) > Math.abs(area[i]) && inRing(rings[j], r[0], r[1]) && (best < 0 || Math.abs(area[j]) < Math.abs(area[best])))
        best = j;
    return best;
  });
  const lo = rings.map((r) => Array.from({ length: r.length / 2 }, (_, k) => vert(r[2 * k], r[2 * k + 1], z0)));
  const hi = rings.map((r) => Array.from({ length: r.length / 2 }, (_, k) => vert(r[2 * k], r[2 * k + 1], z0 + pocket.depth)));
  // the plug's own copies of the ring vertices, by terrain vertex id
  const toPlug = new Map<number, number>();
  let np = 0;
  if (plug)
    rings.forEach((r, i) =>
      [lo[i], hi[i]].forEach((ids, h) =>
        ids.forEach((id, k) => {
          plug.pos.push3(r[2 * k], r[2 * k + 1], h ? z0 + pocket.depth : z0);
          toPlug.set(id, np++);
        }),
      ),
    );

  // triangulate in grid units: ring points are exact integers there, so collinear means exactly zero
  const { ox, oy, step } = pocket.grid;
  const gx = new Map<number, [number, number]>();
  const toGrid = (x: number, y: number): [number, number] => [(x - ox) / step, (y - oy) / step];
  inner.forEach((id, k) => gx.set(id, toGrid(k < 2 ? s : Wmm - s, k === 0 || k === 3 ? s : Hmm - s)));
  rings.forEach((r, i) =>
    r.forEach((_, k) => {
      if (k % 2) return;
      const g: [number, number] = [Math.round((r[k] - ox) / step), Math.round((r[k + 1] - oy) / step)];
      gx.set(lo[i][k / 2], g);
      gx.set(hi[i][k / 2], g);
    }),
  );
  /** triangulate outer minus holes; into the terrain (facing -z) or, with `up` / `out`, into the plug */
  const face = (outer: number[], holes: number[][], out: Grow<Uint32Array> = idx, up = false) => {
    const ids = [...outer];
    const holeIdx: number[] = [];
    for (const h of holes) {
      holeIdx.push(ids.length);
      ids.push(...h);
    }
    const coords = ids.flatMap((id) => gx.get(id)!);
    const loops = [0, ...holeIdx, ids.length];
    const t = fixTJunctions(fixSlivers(earcut(coords, holeIdx.length ? holeIdx : null), coords), coords, loops);
    const id = out === idx ? (k: number) => ids[k] : (k: number) => toPlug.get(ids[k])!;
    for (const [a, b, c] of t) {
      // clockwise seen from above (normal -z), or the reverse for `up`
      const cr = (coords[2 * b] - coords[2 * a]) * (coords[2 * c + 1] - coords[2 * a + 1]) - (coords[2 * b + 1] - coords[2 * a + 1]) * (coords[2 * c] - coords[2 * a]);
      if (cr > 0 !== up) out.push3(id(a), id(c), id(b));
      else out.push3(id(a), id(b), id(c));
    }
  };
  const islands = (i: number, ids: number[][]) => rings.flatMap((_, j) => (parent[j] === i ? [ids[j]] : []));
  // z0: the rectangle minus the letters, and each island minus any letters inside it
  face(inner, rings.flatMap((_, i) => (parent[i] < 0 ? [lo[i]] : [])));
  rings.forEach((_, i) => {
    if (area[i] < 0) face(lo[i], islands(i, lo));
  });
  // ceilings: each letter minus its islands; the same triangles are the plug's top (+z) and bottom (-z)
  rings.forEach((_, i) => {
    if (area[i] <= 0) return;
    face(hi[i], islands(i, hi));
    if (plug) {
      face(hi[i], islands(i, hi), plug.idx, true);
      face(lo[i], islands(i, lo), plug.idx, false);
    }
  });
  // walls face the ink side (the pocket), which is on the left of each ring; the plug's face the other way
  rings.forEach((_, i) => {
    const L = lo[i], U = hi[i], m = L.length;
    for (let k = 0; k < m; k++) {
      const k1 = (k + 1) % m;
      idx.push3(L[k], U[k1], L[k1]);
      idx.push3(L[k], U[k], U[k1]);
      if (plug) {
        const l = toPlug.get(L[k])!, l1 = toPlug.get(L[k1])!, u = toPlug.get(U[k])!, u1 = toPlug.get(U[k1])!;
        plug.idx.push3(l, l1, u1);
        plug.idx.push3(l, u1, u);
      }
    }
  });
  return nv;
}

/**
 * Earcut can leave zero-area triangles where a hole bridge lines up with ring points (the traced rings sit on a
 * lattice). Each one has a vertex b on its longest edge a-c: split the neighbour across a-c at b instead.
 */
function fixSlivers(flat: number[], coords: number[]): [number, number, number][] {
  const cross = (a: number, b: number, c: number) =>
    (coords[2 * b] - coords[2 * a]) * (coords[2 * c + 1] - coords[2 * a + 1]) - (coords[2 * b + 1] - coords[2 * a + 1]) * (coords[2 * c] - coords[2 * a]);
  const d2 = (a: number, b: number) => (coords[2 * a] - coords[2 * b]) ** 2 + (coords[2 * a + 1] - coords[2 * b + 1]) ** 2;
  const N = coords.length / 2;
  const tris: ([number, number, number] | null)[] = [];
  const byEdge = new Map<number, number[]>();
  const key = (a: number, b: number) => (a < b ? a * N + b : b * N + a);
  const queue: number[] = [];
  const add = (a: number, b: number, c: number) => {
    const t = tris.length;
    tris.push([a, b, c]);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const k = key(p, q);
      const l = byEdge.get(k);
      if (l) l.push(t);
      else byEdge.set(k, [t]);
    }
    if (cross(a, b, c) === 0) queue.push(t);
  };
  for (let k = 0; k < flat.length; k += 3) add(flat[k], flat[k + 1], flat[k + 2]);
  while (queue.length) {
    const t = queue.pop()!;
    const tr = tris[t];
    if (!tr) continue;
    // longest edge a-c, middle vertex b
    let [a, b, c] = tr;
    for (let r = 0; r < 3 && !(d2(a, c) >= d2(a, b) && d2(a, c) >= d2(b, c)); r++) [a, b, c] = [b, c, a];
    const nb = byEdge.get(key(a, c))!.find((u) => u !== t && tris[u]);
    if (nb === undefined) continue; // on the face boundary (doesn't happen: rings never touch)
    const d = tris[nb]!.find((x) => x !== a && x !== c)!;
    tris[t] = tris[nb] = null;
    add(a, b, d);
    add(b, c, d);
  }
  return tris.filter((t): t is [number, number, number] => !!t);
}

/**
 * Earcut can also run a hole bridge exactly through a vertex, leaving an edge u-w with one triangle on one
 * side and the two edges u-v, v-w on the other. Any edge used once that isn't on the face's boundary is one
 * of those: split its triangle at every vertex lying on it. `loops` = start of each ring in coords, then N.
 */
function fixTJunctions(tris: [number, number, number][], coords: number[], loops: number[]): [number, number, number][] {
  const N = coords.length / 2;
  const key = (a: number, b: number) => (a < b ? a * N + b : b * N + a);
  const boundary = new Set<number>();
  for (let r = 0; r + 1 < loops.length; r++)
    for (let k = loops[r]; k < loops[r + 1]; k++) boundary.add(key(k, k + 1 < loops[r + 1] ? k + 1 : loops[r]));
  const uses = new Map<number, number>();
  for (const t of tris) for (let k = 0; k < 3; k++) uses.set(key(t[k], t[(k + 1) % 3]), (uses.get(key(t[k], t[(k + 1) % 3])) ?? 0) + 1);
  const out: [number, number, number][] = [];
  for (const t of tris) {
    let split = false;
    for (let k = 0; k < 3 && !split; k++) {
      const u = t[k], w = t[(k + 1) % 3], x = t[(k + 2) % 3];
      const e = key(u, w);
      if (uses.get(e) !== 1 || boundary.has(e)) continue;
      // vertices strictly inside segment u-w, ordered from u (exact: grid coordinates are integers)
      const ux = coords[2 * u], uy = coords[2 * u + 1], dx = coords[2 * w] - ux, dy = coords[2 * w + 1] - uy;
      const len2 = dx * dx + dy * dy;
      const on: [number, number][] = [];
      for (let v = 0; v < N; v++) {
        const px = coords[2 * v] - ux, py = coords[2 * v + 1] - uy;
        const dot = px * dx + py * dy;
        if (px * dy - py * dx === 0 && dot > 0 && dot < len2) on.push([dot, v]);
      }
      if (!on.length) continue;
      on.sort((a, b) => a[0] - b[0]);
      const chain = [u, ...on.map((o) => o[1]), w];
      for (let i = 0; i + 1 < chain.length; i++) out.push([chain[i], chain[i + 1], x]);
      split = true;
    }
    if (!split) out.push(t);
  }
  return out;
}
