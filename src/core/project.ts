import { invMercX, invMercY, mercX, mercY } from './geo';

/** Degrees. */
export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type Edge = 'width' | 'height';

/**
 * Maps lat/lon to print millimeters (x east, y north, origin at the crop's south-west corner).
 * Web Mercator scaled by cos(center latitude), so print mm match ground distance near the center.
 */
export interface PrintFrame {
  bounds: Bounds;
  lat0: number;
  /** print mm per Web Mercator meter */
  k: number;
  mx0: number;
  my0: number;
  widthMm: number;
  heightMm: number;
  /** print mm per ground meter */
  mmPerGroundM: number;
  groundWidthKm: number;
  groundHeightKm: number;
}

export function groundSizeKm(b: Bounds): { w: number; h: number; lat0: number } {
  const lat0 = (b.south + b.north) / 2;
  const c = Math.cos((lat0 * Math.PI) / 180);
  return {
    w: ((mercX(b.east) - mercX(b.west)) * c) / 1000,
    h: ((mercY(b.north) - mercY(b.south)) * c) / 1000,
    lat0,
  };
}

export function makeFrame(bounds: Bounds, edge: Edge, edgeMm: number): PrintFrame {
  const g = groundSizeKm(bounds);
  const c = Math.cos((g.lat0 * Math.PI) / 180);
  const mmPerGroundM = edgeMm / ((edge === 'width' ? g.w : g.h) * 1000);
  const k = mmPerGroundM * c;
  return {
    bounds,
    lat0: g.lat0,
    k,
    mx0: mercX(bounds.west),
    my0: mercY(bounds.south),
    widthMm: g.w * 1000 * mmPerGroundM,
    heightMm: g.h * 1000 * mmPerGroundM,
    mmPerGroundM,
    groundWidthKm: g.w,
    groundHeightKm: g.h,
  };
}

export const toMmX = (f: PrintFrame, lon: number) => (mercX(lon) - f.mx0) * f.k;
export const toMmY = (f: PrintFrame, lat: number) => (mercY(lat) - f.my0) * f.k;
export const mmToLon = (f: PrintFrame, x: number) => invMercX(f.mx0 + x / f.k);
export const mmToLat = (f: PrintFrame, y: number) => invMercY(f.my0 + y / f.k);

/** Bounding box of all points, grown by `margin` (fraction of each side's extent, min ~200 m). */
export function routeBounds(tracks: { lat: Float64Array; lon: Float64Array }[], margin: number): Bounds | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const t of tracks)
    for (let i = 0; i < t.lat.length; i++) {
      const y = t.lat[i], x = t.lon[i];
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  if (!Number.isFinite(w)) return null;
  const dx = Math.max((e - w) * margin, 0.002);
  const dy = Math.max((n - s) * margin, 0.002);
  return { west: w - dx, south: s - dy, east: e + dx, north: n + dy };
}
