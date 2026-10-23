import { haversineKm } from './geo';

export interface LegEnds {
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
}

export interface LegOrder {
  order: number[];
  /** seamKm[i] = gap between order[i] end and order[i+1] start. */
  seamKm: number[];
  totalSeamKm: number;
}

/**
 * Chain legs end-to-start so the total seam distance is smallest.
 * Exact search for up to 8 legs (8! = 40k orders, pruned), greedy from every start beyond that.
 */
export function orderLegs(legs: LegEnds[]): LegOrder {
  const n = legs.length;
  if (n === 0) return { order: [], seamKm: [], totalSeamKm: 0 };
  const d: number[][] = legs.map((a) => legs.map((b) => haversineKm(a.endLat, a.endLon, b.startLat, b.startLon)));

  let best: number[] = [];
  let bestCost = Infinity;

  if (n <= 8) {
    const used = new Array(n).fill(false);
    const path: number[] = [];
    const rec = (cost: number) => {
      if (cost >= bestCost) return;
      if (path.length === n) {
        bestCost = cost;
        best = path.slice();
        return;
      }
      for (let j = 0; j < n; j++) {
        if (used[j]) continue;
        const add = path.length ? d[path[path.length - 1]][j] : 0;
        used[j] = true;
        path.push(j);
        rec(cost + add);
        path.pop();
        used[j] = false;
      }
    };
    rec(0);
  } else {
    for (let s = 0; s < n; s++) {
      const used = new Array(n).fill(false);
      const path = [s];
      used[s] = true;
      let cost = 0;
      while (path.length < n) {
        const last = path[path.length - 1];
        let bj = -1;
        for (let j = 0; j < n; j++) if (!used[j] && (bj < 0 || d[last][j] < d[last][bj])) bj = j;
        cost += d[last][bj];
        used[bj] = true;
        path.push(bj);
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = path;
      }
    }
  }

  return { order: best, ...seams(legs, best) };
}

export function seams(legs: LegEnds[], order: number[]): { seamKm: number[]; totalSeamKm: number } {
  const seamKm: number[] = [];
  for (let i = 0; i + 1 < order.length; i++) {
    const a = legs[order[i]];
    const b = legs[order[i + 1]];
    seamKm.push(haversineKm(a.endLat, a.endLon, b.startLat, b.startLon));
  }
  return { seamKm, totalSeamKm: seamKm.reduce((s, x) => s + x, 0) };
}
