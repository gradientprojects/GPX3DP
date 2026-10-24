import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { MERC_HALF } from '../core/geo';
import type { PrintFrame } from '../core/project';
import { WATER_LAKE, WATER_RIVER } from '../core/model';
import { fillRings, stampPolyline } from '../core/raster';
import type { TileRange } from '../core/terrarium';
import { cachedFetch, poolCounting, TileError } from './tiles';

export const OPENFREEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet';

let tileUrl: string | null = null;

async function vectorTileUrl(): Promise<string> {
  if (tileUrl) return tileUrl;
  // The TileJSON points at the current dated build; don't cache it in the Cache API.
  const res = await fetch(OPENFREEMAP_TILEJSON);
  if (!res.ok) throw new Error(`OpenFreeMap TileJSON: HTTP ${res.status}`);
  const tj = (await res.json()) as { tiles: string[] };
  return (tileUrl = tj.tiles[0]);
}

const SKIP_CLASSES = new Set(['swimming_pool']);
const RIVER_CLASSES = new Set(['river', 'canal']);



/**
 * Water cells for the print grid, from OpenFreeMap (OpenMapTiles schema): LAKE for `water` polygons (lakes,
 * ponds, sea...), RIVER for river-class polygons (wide rivers) and, when `rivers` is on, `waterway`
 * rivers/canals stamped at `riverWidthMm`. Lakes win where the two overlap.
 */
export async function waterMask(
  frame: PrintFrame,
  W: number,
  H: number,
  cell: number,
  r: TileRange,
  rivers: boolean,
  riverWidthMm: number,
  onTile: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const jobsTotal = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  const url = await vectorTileUrl().catch(() => {
    throw new TileError('water', jobsTotal, jobsTotal);
  });
  const mask = new Uint8Array(W * H);
  const river = new Uint8Array(W * H);
  const n = 2 ** r.z;
  // global tile coordinate -> grid cell units
  const toCellX = (tx: number) => ((tx / n) * 2 * MERC_HALF - MERC_HALF - frame.mx0) * frame.k / cell;
  const toCellY = (ty: number) => ((MERC_HALF - (ty / n) * 2 * MERC_HALF) - frame.my0) * frame.k / cell;
  const jobs: [number, number][] = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) jobs.push([x, y]);
  let done = 0;
  onTile(0, jobs.length);
  const failed = await poolCounting(jobs, 6, async ([x, y]) => {
    const res = await cachedFetch(url.replace('{z}', `${r.z}`).replace('{x}', `${x}`).replace('{y}', `${y}`));
    if (res.ok) {
      const tile = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())));
      const clip: [number, number, number, number] = [toCellX(x), toCellY(y + 1), toCellX(x + 1), toCellY(y)];
      const water = tile.layers.water;
      if (water)
        for (let i = 0; i < water.length; i++) {
          const f = water.feature(i);
          if (f.type !== 3 || SKIP_CLASSES.has(String(f.properties.class))) continue;
          const ext = f.extent;
          const rings = f.loadGeometry().map((ring) => {
            const a = new Float64Array(ring.length * 2);
            ring.forEach((p, k) => {
              a[2 * k] = toCellX(x + p.x / ext);
              a[2 * k + 1] = toCellY(y + p.y / ext);
            });
            return a;
          });
          fillRings(f.properties.class === 'river' ? river : mask, W, H, rings, clip);
        }
      const ways = tile.layers.waterway;
      if (rivers && ways)
        for (let i = 0; i < ways.length; i++) {
          const f = ways.feature(i);
          if (f.type !== 2 || !RIVER_CLASSES.has(String(f.properties.class))) continue;
          const ext = f.extent;
          for (const line of f.loadGeometry()) {
            const a = new Float64Array(line.length * 2);
            line.forEach((p, k) => {
              a[2 * k] = toCellX(x + p.x / ext);
              a[2 * k + 1] = toCellY(y + p.y / ext);
            });
            stampPolyline(river, W, H, a, riverWidthMm / 2 / cell);
          }
        }
    }
    onTile(++done, jobs.length);
  });
  // a partial water mask would print half a lake, so it's all or nothing
  if (failed) throw new TileError('water', failed, jobs.length);
  for (let i = 0; i < mask.length; i++) mask[i] = mask[i] ? WATER_LAKE : river[i] ? WATER_RIVER : 0;
  return mask;
}
