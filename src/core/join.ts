import { EARTH_R } from './geo';

const D2R = Math.PI / 180;

/** Arc-length walker over a lat/lon track in local meters, from one end. */
function walker(lat: ArrayLike<number>, lon: ArrayLike<number>, fromEnd: boolean, lat0: number, lon0: number) {
  const kx = EARTH_R * D2R * Math.cos(lat0 * D2R), ky = EARTH_R * D2R;
  const n = lat.length;
  const pt = (k: number) => {
    const i = fromEnd ? n - 1 - k : k;
    return [(lon[i] - lon0) * kx, (lat[i] - lat0) * ky];
  };
  let k = 0, s0 = 0, a = pt(0), b = n > 1 ? pt(1) : a, seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
  /** Point at arc length s (non-decreasing calls), or null past the end of the track. */
  return (s: number): number[] | null => {
    while (s > s0 + seg) {
      if (k + 2 >= n) return null;
      k++;
      s0 += seg;
      a = b;
      b = pt(k + 1);
      seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const t = seg > 0 ? (s - s0) / seg : 0;
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  };
}

/**
 * Where to put the marker for the join between leg A (ending) and leg B (starting).
 * Days often end up a short out-and-back spur (to a camp or hotel), so the leg end sits at the tip
 * of the spur, beside the main line. Walk back along A and forward along B together; while they stay
 * within `tolM` of each other they are the same spur. If the spur is no longer than `maxM`, the
 * marker goes to its base (where the two tracks split). Longer shared sections are real route, so
 * the leg end is kept.
 */
export function joinPoint(
  aLat: ArrayLike<number>,
  aLon: ArrayLike<number>,
  bLat: ArrayLike<number>,
  bLon: ArrayLike<number>,
  tolM: number,
  maxM: number,
): { lat: number; lon: number } {
  const lat0 = aLat[aLat.length - 1], lon0 = aLon[aLon.length - 1];
  const end = { lat: lat0, lon: lon0 };
  if (aLat.length < 2 || bLat.length < 2 || !(tolM > 0)) return end;
  const A = walker(aLat, aLon, true, lat0, lon0), B = walker(bLat, bLon, false, lat0, lon0);
  const step = tolM / 4;
  let base: number[] | null = null, last = 0;
  for (let s = 0; ; s += step) {
    const p = A(s), q = B(s);
    if (!p || !q) return end; // a leg ran out while still overlapping: leave it
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= tolM) {
      base = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      last = s;
      if (s > maxM) return end; // shared section longer than a marker: real route
    } else if (s > last + 2 * tolM) break;
  }
  if (!base || last === 0) return end;
  const kx = EARTH_R * D2R * Math.cos(lat0 * D2R), ky = EARTH_R * D2R;
  return { lat: lat0 + base[1] / ky, lon: lon0 + base[0] / kx };
}
