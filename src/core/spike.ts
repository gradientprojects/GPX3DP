import { haversineKm } from './geo';

/**
 * Drop isolated GPS spikes: up to `maxSpikeLen` points that jump more than `maxJumpKm`
 * from the last good point and then come back within `maxJumpKm` of it (A -> far -> A).
 * One-way jumps (recording dropouts) are kept, so they print as straight lines.
 */
export function removeSpikes(
  lat: Float64Array,
  lon: Float64Array,
  maxJumpKm: number,
  maxSpikeLen = 3,
): { lat: Float64Array; lon: Float64Array; removed: number } {
  const n = lat.length;
  const keep = new Uint8Array(n).fill(1);
  let last = 0;
  let removed = 0;
  let i = 1;
  while (i < n) {
    if (haversineKm(lat[last], lon[last], lat[i], lon[i]) <= maxJumpKm) {
      last = i++;
      continue;
    }
    let back = -1;
    for (let k = 1; k <= maxSpikeLen && i + k < n; k++) {
      if (haversineKm(lat[last], lon[last], lat[i + k], lon[i + k]) <= maxJumpKm) {
        back = i + k;
        break;
      }
    }
    if (back < 0) {
      last = i++;
      continue;
    }
    for (let j = i; j < back; j++) keep[j] = 0;
    removed += back - i;
    last = back;
    i = back + 1;
  }
  if (!removed) return { lat, lon, removed };
  const la = new Float64Array(n - removed);
  const lo = new Float64Array(n - removed);
  for (let j = 0, o = 0; j < n; j++) if (keep[j]) (la[o] = lat[j]), (lo[o++] = lon[j]);
  return { lat: la, lon: lo, removed };
}
