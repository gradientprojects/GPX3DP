import { FLAT_RELIEF_MM, suggestCrop, type CropSuggestion } from '../core/crop';
import { pxFromMercX, pxFromMercY } from '../core/geo';
import { buildModel, type ModelInput, type ModelStats, type Part } from '../core/model';
import { makeFrame } from '../core/project';
import { chooseZoom, tileCount } from '../core/terrarium';
import type { BuildRequest } from './messages';
import { sampleMosaic, terrariumMosaic, TileError } from './tiles';
import { waterMask } from './water';

export type Progress = (stage: string, done?: number, total?: number) => void;

export interface BuildResult {
  input: ModelInput;
  parts: Part[];
  stats: ModelStats;
  zoom: number;
  tiles: number;
  /** a tighter crop with more relief, when this one is flat */
  crop: CropSuggestion | null;
  /** problems that didn't stop the build (e.g. water tiles unavailable) */
  warnings: string[];
}

// Elevation and water only depend on the crop and grid, so settings changes reuse them.
let elevKey = '';
let elevCache: { elevation: Float32Array; zoom: number; tiles: number } | null = null;
let waterKey = '';
let waterCache: Uint8Array | undefined;

export async function buildFromRequest(req: BuildRequest, progress: Progress): Promise<BuildResult> {
  const frame = makeFrame(req.bounds, req.edge, req.edgeMm);
  const cell = req.cellMm;
  const W = Math.max(4, Math.round(frame.widthMm / cell));
  const H = Math.max(4, Math.round(frame.heightMm / cell));
  const cellGroundM = cell / frame.mmPerGroundM;

  const ek = JSON.stringify([req.bounds, req.edge, req.edgeMm, cell]);
  if (ek !== elevKey || !elevCache) {
    const range = chooseZoom(req.bounds, cellGroundM);
    const mosaic = await terrariumMosaic(range, (done, total) => progress('Elevation tiles', done, total));
    progress('Resampling elevation');
    const elevation = new Float32Array((W + 1) * (H + 1));
    for (let iy = 0; iy <= H; iy++) {
      const gy = pxFromMercY(frame.my0 + (iy * cell) / frame.k, range.z);
      for (let ix = 0; ix <= W; ix++) {
        const gx = pxFromMercX(frame.mx0 + (ix * cell) / frame.k, range.z);
        elevation[iy * (W + 1) + ix] = sampleMosaic(mosaic, gx, gy);
      }
    }
    elevCache = { elevation, zoom: range.z, tiles: tileCount(range) };
    elevKey = ek;
  }

  let water: Uint8Array | undefined;
  const warnings: string[] = [];
  if (req.model.waterSurface !== 'off') {
    const wk = JSON.stringify([ek, req.rivers, req.riverWidthMm]);
    if (wk !== waterKey) {
      const range = chooseZoom(req.bounds, cellGroundM, 14, 48);
      try {
        waterCache = await waterMask(frame, W, H, cell, range, req.rivers, req.riverWidthMm, (done, total) =>
          progress('Water tiles', done, total),
        );
        waterKey = wk;
      } catch (e) {
        // build without water rather than fail; waterKey stays stale so the next build tries again
        if (!(e instanceof TileError)) throw e;
        waterCache = undefined;
        waterKey = '';
        warnings.push("Water data couldn't be downloaded, so this model has no water. It will try again on the next build.");
      }
    }
    water = waterCache;
  }

  progress('Building mesh');
  const input: ModelInput = {
    W,
    H,
    cellMm: cell,
    elevation: elevCache.elevation,
    mmPerGroundM: frame.mmPerGroundM,
    routeLines: req.routeLines,
    waterMask: water,
    markers: req.markers,
  };
  const { parts, stats } = buildModel(input, req.model);
  // flat at this size: look for a tighter crop over the mountains the ride crosses
  const crop =
    stats.reliefMm < FLAT_RELIEF_MM
      ? suggestCrop(input.elevation, W, H, cell, frame.mmPerGroundM * req.model.exaggeration, req.routeLines)
      : null;
  return { input, parts, stats, zoom: elevCache.zoom, tiles: elevCache.tiles, crop, warnings };
}
