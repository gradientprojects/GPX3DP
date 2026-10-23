/** A smaller crop window (print mm, in the current crop's frame) that shows more relief at the same print size. */
export interface CropSuggestion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** relief the window would have at the same print size */
  reliefMm: number;
}

/** Relief (mm) under which a print counts as flat (the UI shows a note and the crop suggestion). */
export const FLAT_RELIEF_MM = 3;

const SCALES = [1 / 2, 1 / 3, 1 / 4];

/**
 * Find the largest window (same aspect as the crop, 1/2 to 1/4 of its size) that holds a real piece of
 * the ride and reaches `targetReliefMm` at the same print size; else the window with the most relief.
 * Returns null when no window improves on the current relief by at least half again (and 1 mm).
 *
 * `elevation` is meters at the (W+1) x (H+1) cell corners; route lines are print mm.
 */
export function suggestCrop(
  elevation: Float32Array,
  W: number,
  H: number,
  cellMm: number,
  mmPerGroundM: number,
  routeLines: Float64Array[],
  targetReliefMm = 8,
): CropSuggestion | null {
  const CW = W + 1;
  // coarse blocks: min/max elevation and route length per block
  const B = Math.max(1, Math.floor(Math.min(W, H) / 64));
  const Wc = Math.floor(W / B), Hc = Math.floor(H / B);
  if (Wc < 4 || Hc < 4) return null;
  const lo = new Float32Array(Wc * Hc).fill(Infinity), hi = new Float32Array(Wc * Hc).fill(-Infinity);
  for (let by = 0; by < Hc; by++)
    for (let bx = 0; bx < Wc; bx++) {
      const k = by * Wc + bx;
      for (let y = by * B; y <= (by + 1) * B; y++)
        for (let x = bx * B; x <= (bx + 1) * B; x++) {
          const e = elevation[y * CW + x];
          if (e < lo[k]) lo[k] = e;
          if (e > hi[k]) hi[k] = e;
        }
    }
  const blockMm = B * cellMm;
  // route length per block, as a 2D prefix sum
  const len = new Float64Array((Wc + 1) * (Hc + 1));
  for (const xy of routeLines)
    for (let i = 2; i < xy.length; i += 2) {
      const ax = xy[i - 2], ay = xy[i - 1], bx = xy[i], by = xy[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.ceil(L / (blockMm / 2)));
      for (let j = 0; j < n; j++) {
        const t = (j + 0.5) / n;
        const cx = Math.floor((ax + t * (bx - ax)) / blockMm), cy = Math.floor((ay + t * (by - ay)) / blockMm);
        if (cx >= 0 && cy >= 0 && cx < Wc && cy < Hc) len[(cy + 1) * (Wc + 1) + cx + 1] += L / n;
      }
    }
  for (let y = 1; y <= Hc; y++)
    for (let x = 1; x <= Wc; x++)
      len[y * (Wc + 1) + x] += len[(y - 1) * (Wc + 1) + x] + len[y * (Wc + 1) + x - 1] - len[(y - 1) * (Wc + 1) + x - 1];
  const routeIn = (x0: number, y0: number, x1: number, y1: number) =>
    len[y1 * (Wc + 1) + x1] - len[y0 * (Wc + 1) + x1] - len[y1 * (Wc + 1) + x0] + len[y0 * (Wc + 1) + x0];

  let all = -Infinity, allLo = Infinity;
  for (let k = 0; k < Wc * Hc; k++) (all = Math.max(all, hi[k])), (allLo = Math.min(allLo, lo[k]));
  const current = (all - allLo) * mmPerGroundM;

  let best: CropSuggestion | null = null;
  for (const s of SCALES) {
    const ww = Math.max(2, Math.round(Wc * s)), wh = Math.max(2, Math.round(Hc * s));
    const sx = Math.max(1, Math.floor(ww / 4)), sy = Math.max(1, Math.floor(wh / 4));
    const xs: number[] = [], ys: number[] = [];
    for (let x = 0; x + ww <= Wc; x += sx) xs.push(x);
    if (xs[xs.length - 1] !== Wc - ww) xs.push(Wc - ww);
    for (let y = 0; y + wh <= Hc; y += sy) ys.push(y);
    if (ys[ys.length - 1] !== Hc - wh) ys.push(Hc - wh);
    let bestHere: CropSuggestion | null = null;
    for (const y0 of ys)
      for (const x0 of xs) {
        // a real piece of the ride: at least the window's width of route inside it
        if (routeIn(x0, y0, x0 + ww, y0 + wh) < ww * blockMm) continue;
        let mx = -Infinity, mn = Infinity;
        for (let y = y0; y < y0 + wh; y++)
          for (let x = x0; x < x0 + ww; x++) {
            const k = y * Wc + x;
            if (hi[k] > mx) mx = hi[k];
            if (lo[k] < mn) mn = lo[k];
          }
        const reliefMm = ((mx - mn) * mmPerGroundM) / s;
        if (!bestHere || reliefMm > bestHere.reliefMm)
          bestHere = { x0: x0 * blockMm, y0: y0 * blockMm, x1: (x0 + ww) * blockMm, y1: (y0 + wh) * blockMm, reliefMm };
      }
    if (!bestHere) continue;
    if (bestHere.reliefMm >= targetReliefMm) return bestHere;
    if (!best || bestHere.reliefMm > best.reliefMm) best = bestHere;
  }
  return best && best.reliefMm >= Math.max(current * 1.5, current + 1) ? best : null;
}
