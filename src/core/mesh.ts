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

export const NONE = 255;
export const NUM_CODES = 6;

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
): MeshData {
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

  if (flatBottom) {
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
