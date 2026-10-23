/**
 * Grid rasterizers. Coordinates are in cell units: cell (cx, cy) covers [cx, cx+1) x [cy, cy+1),
 * and a cell is "inside" when its center (cx + 0.5, cy + 0.5) is.
 */

/** Set every cell whose center is within `r` of the polyline (round caps and joins). */
export function stampPolyline(mask: Uint8Array, W: number, H: number, xy: Float64Array, r: number, value = 1) {
  const n = xy.length / 2;
  if (n === 1) {
    stampDisk(mask, W, H, xy[0], xy[1], r, value);
    return;
  }
  const r2 = r * r;
  for (let i = 0; i + 1 < n; i++) {
    const x0 = xy[2 * i], y0 = xy[2 * i + 1], x1 = xy[2 * i + 2], y1 = xy[2 * i + 3];
    const cx0 = Math.max(0, Math.floor(Math.min(x0, x1) - r - 0.5));
    const cx1 = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + r - 0.5));
    const cy0 = Math.max(0, Math.floor(Math.min(y0, y1) - r - 0.5));
    const cy1 = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + r - 0.5));
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    for (let cy = cy0; cy <= cy1; cy++) {
      const py = cy + 0.5 - y0;
      for (let cx = cx0; cx <= cx1; cx++) {
        const px = cx + 0.5 - x0;
        const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
        const qx = px - t * dx, qy = py - t * dy;
        if (qx * qx + qy * qy <= r2) mask[cy * W + cx] = value;
      }
    }
  }
}

export function stampDisk(mask: Uint8Array, W: number, H: number, x: number, y: number, r: number, value = 1) {
  const r2 = r * r;
  for (let cy = Math.max(0, Math.floor(y - r - 0.5)); cy <= Math.min(H - 1, Math.ceil(y + r - 0.5)); cy++)
    for (let cx = Math.max(0, Math.floor(x - r - 0.5)); cx <= Math.min(W - 1, Math.ceil(x + r - 0.5)); cx++) {
      const dx = cx + 0.5 - x, dy = cy + 0.5 - y;
      if (dx * dx + dy * dy <= r2) mask[cy * W + cx] = value;
    }
}

export function stampSquare(mask: Uint8Array, W: number, H: number, x: number, y: number, half: number, value = 1) {
  for (let cy = Math.max(0, Math.ceil(y - half - 0.5)); cy <= Math.min(H - 1, Math.floor(y + half - 0.5)); cy++)
    for (let cx = Math.max(0, Math.ceil(x - half - 0.5)); cx <= Math.min(W - 1, Math.floor(x + half - 0.5)); cx++)
      mask[cy * W + cx] = value;
}

/** Fill cells whose centers are inside a convex polygon (vertices interleaved x,y, counter-clockwise). */
export function stampConvex(mask: Uint8Array, W: number, H: number, v: number[], value = 1) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < v.length; i += 2) {
    x0 = Math.min(x0, v[i]), x1 = Math.max(x1, v[i]);
    y0 = Math.min(y0, v[i + 1]), y1 = Math.max(y1, v[i + 1]);
  }
  const n = v.length / 2;
  for (let cy = Math.max(0, Math.floor(y0 - 0.5)); cy <= Math.min(H - 1, Math.ceil(y1 - 0.5)); cy++)
    for (let cx = Math.max(0, Math.floor(x0 - 0.5)); cx <= Math.min(W - 1, Math.ceil(x1 - 0.5)); cx++) {
      const px = cx + 0.5, py = cy + 0.5;
      let inside = true;
      for (let i = 0; i < n && inside; i++) {
        const ax = v[2 * i], ay = v[2 * i + 1], bx = v[(2 * i + 2) % v.length], by = v[(2 * i + 3) % v.length];
        if ((bx - ax) * (py - ay) - (by - ay) * (px - ax) < 0) inside = false;
      }
      if (inside) mask[cy * W + cx] = value;
    }
}

/**
 * Even-odd fill of a set of rings (one feature, holes included). Only cells whose centers are inside
 * `clip` = [x0, y0, x1, y1) are written, so tiles that overlap at their buffers don't double-fill.
 */
export function fillRings(
  mask: Uint8Array,
  W: number,
  H: number,
  rings: Float64Array[],
  clip: [number, number, number, number] = [0, 0, W, H],
  value = 1,
) {
  const rowY0 = Math.max(0, Math.ceil(clip[1] - 0.5));
  const rowY1 = Math.min(H - 1, Math.ceil(clip[3] - 0.5) - 1);
  if (rowY1 < rowY0) return;
  const rows: number[][] = [];
  for (const ring of rings) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const xa = ring[2 * i], ya = ring[2 * i + 1], xb = ring[2 * j], yb = ring[2 * j + 1];
      if (ya === yb) continue;
      const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
      // rows whose center y is in [lo, hi)
      const r0 = Math.max(rowY0, Math.ceil(lo - 0.5));
      const r1 = Math.min(rowY1, Math.ceil(hi - 0.5) - 1);
      for (let r = r0; r <= r1; r++) {
        const yc = r + 0.5;
        const x = xa + ((yc - ya) * (xb - xa)) / (yb - ya);
        (rows[r - rowY0] ??= []).push(x);
      }
    }
  }
  const cxMin = Math.max(0, Math.ceil(clip[0] - 0.5));
  const cxMax = Math.min(W - 1, Math.ceil(clip[2] - 0.5) - 1);
  for (let r = rowY0; r <= rowY1; r++) {
    const xs = rows[r - rowY0];
    if (!xs) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(cxMin, Math.ceil(xs[k] - 0.5));
      const c1 = Math.min(cxMax, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let cx = c0; cx <= c1; cx++) mask[r * W + cx] = value;
    }
  }
}

/** 1D squared distance transform (Felzenszwalb & Huttenlocher). */
function dt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    if (f[q] === Infinity) continue;
    if (f[v[k]] === Infinity) {
      v[k] = q;
      continue;
    }
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  if (f[v[0]] === Infinity) {
    d.fill(Infinity, 0, n);
    return;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) ** 2 + f[v[k]];
  }
}

/**
 * Euclidean distance (in cells) from each cell with mask=1 to the nearest cell with mask=0.
 * Cells outside the grid count as inside (mask=1), so a crop edge is not a shore.
 */
export function distanceInside(mask: Uint8Array, W: number, H: number): Float32Array {
  const g = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = mask[i] ? Infinity : 0;
  const m = Math.max(W, H);
  const f = new Float64Array(m), d = new Float64Array(m), z = new Float64Array(m + 1);
  const v = new Int32Array(m);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = g[y * W + x];
    dt1(f, H, d, v, z);
    for (let y = 0; y < H; y++) g[y * W + x] = d[y];
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = g[y * W + x];
    dt1(f, W, d, v, z);
    for (let x = 0; x < W; x++) out[y * W + x] = Math.sqrt(d[x]);
  }
  return out;
}

/** Separable Gaussian blur with clamped edges. */
export function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0.01) return src.slice();
  const rad = Math.ceil(sigma * 3);
  const k = new Float32Array(2 * rad + 1);
  let sum = 0;
  for (let i = -rad; i <= rad; i++) sum += k[i + rad] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -rad; i <= rad; i++) s += k[i + rad] * src[row + Math.min(w - 1, Math.max(0, x + i))];
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -rad; i <= rad; i++) s += k[i + rad] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x];
      out[y * w + x] = s;
    }
  return out;
}
