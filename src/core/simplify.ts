/**
 * Douglas-Peucker on interleaved [x0, y0, x1, y1, ...] coordinates (iterative, typed arrays).
 * Returns a new interleaved array.
 */
export function simplifyLine(xy: Float64Array, tolerance: number): Float64Array {
  const n = xy.length / 2;
  if (n <= 2) return xy.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const tol2 = tolerance * tolerance;
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    const ax = xy[2 * a], ay = xy[2 * a + 1];
    const dx = xy[2 * b] - ax, dy = xy[2 * b + 1] - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = xy[2 * i] - ax, py = xy[2 * i + 1] - ay;
      let d2: number;
      if (len2 === 0) d2 = px * px + py * py;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const qx = px - t * dx, qy = py - t * dy;
        d2 = qx * qx + qy * qy;
      }
      if (d2 > maxD) (maxD = d2), (idx = i);
    }
    if (maxD > tol2) {
      keep[idx] = 1;
      stack.push(a, idx, idx, b);
    }
  }
  let m = 0;
  for (let i = 0; i < n; i++) m += keep[i];
  const out = new Float64Array(2 * m);
  for (let i = 0, o = 0; i < n; i++) if (keep[i]) (out[o++] = xy[2 * i]), (out[o++] = xy[2 * i + 1]);
  return out;
}
