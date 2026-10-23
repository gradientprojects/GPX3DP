export const EARTH_R = 6378137;
const D2R = Math.PI / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * D2R;
  const dLon = (lon2 - lon1) * D2R;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * (EARTH_R / 1000) * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Web Mercator meters. */
export const mercX = (lon: number) => EARTH_R * lon * D2R;
export const mercY = (lat: number) => EARTH_R * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
export const invMercX = (x: number) => x / EARTH_R / D2R;
export const invMercY = (y: number) => (2 * Math.atan(Math.exp(y / EARTH_R)) - Math.PI / 2) / D2R;

/** Global pixel coordinate at zoom z for 256 px tiles, from mercator meters. */
export const MERC_HALF = Math.PI * EARTH_R;
export const pxFromMercX = (x: number, z: number) => ((x + MERC_HALF) / (2 * MERC_HALF)) * 256 * 2 ** z;
export const pxFromMercY = (y: number, z: number) => ((MERC_HALF - y) / (2 * MERC_HALF)) * 256 * 2 ** z;

export const KM_PER_MI = 1.609344;
export type Units = 'km' | 'mi';
export const fmtDist = (km: number, u: Units, digits = 1) =>
  u === 'km' ? `${km.toFixed(digits)} km` : `${(km / KM_PER_MI).toFixed(digits)} mi`;
