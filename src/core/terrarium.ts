import { EARTH_R, mercX, mercY, pxFromMercX, pxFromMercY } from './geo';
import type { Bounds } from './project';

export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export const decodeTerrarium = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;

/** Ground meters per pixel at latitude `lat` for 256 px tiles. */
export const groundResM = (lat: number, z: number) =>
  (2 * Math.PI * EARTH_R * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);

export interface TileRange {
  z: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export function tileRange(b: Bounds, z: number): TileRange {
  const n = 2 ** z;
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, v));
  return {
    z,
    x0: clamp(Math.floor(pxFromMercX(mercX(b.west), z) / 256)),
    x1: clamp(Math.floor(pxFromMercX(mercX(b.east), z) / 256)),
    y0: clamp(Math.floor(pxFromMercY(mercY(b.north), z) / 256)),
    y1: clamp(Math.floor(pxFromMercY(mercY(b.south), z) / 256)),
  };
}

export const tileCount = (r: TileRange) => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);

/**
 * Lowest zoom whose pixel is no coarser than one grid cell, capped at `maxZ`,
 * then stepped down until the tile count fits `maxTiles`.
 */
export function chooseZoom(b: Bounds, cellGroundM: number, maxZ = 13, maxTiles = 64): TileRange {
  const lat0 = (b.south + b.north) / 2;
  let z = 0;
  while (z < maxZ && groundResM(lat0, z) > cellGroundM) z++;
  let r = tileRange(b, z);
  while (z > 0 && tileCount(r) > maxTiles) r = tileRange(b, --z);
  return r;
}
