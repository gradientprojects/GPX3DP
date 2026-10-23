import { decodeTerrarium, TERRARIUM_URL, type TileRange } from '../core/terrarium';

const CACHE = 'gpx3dp-tiles-v1';

/** Fetch with the Cache API in front, so changing settings never refetches a tile. */
export async function cachedFetch(url: string): Promise<Response> {
  let cache: Cache | null = null;
  try {
    if (typeof caches === 'undefined') throw new Error('no Cache API');
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return hit;
  } catch {
    cache = null; // Cache API unavailable (private mode, file://)
  }
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (res.ok) {
        if (cache) await cache.put(url, res.clone()).catch(() => {});
        return res;
      }
      if (res.status === 404) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw new Error(`Could not download ${url}: ${lastErr}`);
}

export async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

/** Some tiles of one source couldn't be downloaded (after retries). */
export class TileError extends Error {
  constructor(
    public source: 'elevation' | 'water',
    public failed: number,
    public total: number,
  ) {
    super(
      source === 'elevation'
        ? `Couldn't download elevation data (${failed} of ${total} tiles).`
        : `Couldn't download water data (${failed} of ${total} tiles).`,
    );
  }
}

/** Run `fn` on every item; count the ones that throw instead of stopping at the first. */
export async function poolCounting<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<number> {
  let failed = 0;
  await pool(items, n, async (t) => {
    try {
      await fn(t);
    } catch {
      failed++;
    }
  });
  return failed;
}

/** PNG bytes -> RGBA pixels. The browser uses createImageBitmap; tests can plug in a Node decoder. */
export type PngDecoder = (bytes: Blob) => Promise<Uint8ClampedArray | Uint8Array>;

let decodePng: PngDecoder = async (blob) => {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = new OffscreenCanvas(256, 256);
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, 256, 256).data;
};
export const setPngDecoder = (d: PngDecoder) => (decodePng = d);

const decoded = new Map<string, Float32Array>();

async function terrariumTile(z: number, x: number, y: number): Promise<Float32Array> {
  const url = TERRARIUM_URL.replace('{z}', `${z}`).replace('{x}', `${x}`).replace('{y}', `${y}`);
  const hit = decoded.get(url);
  if (hit) return hit;
  const res = await cachedFetch(url);
  const out = new Float32Array(256 * 256);
  if (res.ok) {
    const px = await decodePng(await res.blob());
    for (let i = 0; i < out.length; i++) out[i] = decodeTerrarium(px[4 * i], px[4 * i + 1], px[4 * i + 2]);
  }
  if (decoded.size > 256) decoded.delete(decoded.keys().next().value!);
  decoded.set(url, out);
  return out;
}

export interface Mosaic {
  z: number;
  /** global pixel of the mosaic's top-left */
  px0: number;
  py0: number;
  w: number;
  h: number;
  data: Float32Array;
}

export async function terrariumMosaic(r: TileRange, onTile: (done: number, total: number) => void): Promise<Mosaic> {
  const tw = r.x1 - r.x0 + 1, th = r.y1 - r.y0 + 1;
  const w = tw * 256, h = th * 256;
  const data = new Float32Array(w * h);
  const jobs: [number, number][] = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) jobs.push([x, y]);
  let done = 0;
  onTile(0, jobs.length);
  const failed = await poolCounting(jobs, 8, async ([x, y]) => {
    const t = await terrariumTile(r.z, x, y);
    const ox = (x - r.x0) * 256, oy = (y - r.y0) * 256;
    for (let row = 0; row < 256; row++) data.set(t.subarray(row * 256, row * 256 + 256), (oy + row) * w + ox);
    onTile(++done, jobs.length);
  });
  // a missing elevation tile would print as a hole or cliff, so don't build with gaps
  if (failed) throw new TileError('elevation', failed, jobs.length);
  return { z: r.z, px0: r.x0 * 256, py0: r.y0 * 256, w, h, data };
}

/** Bilinear sample at global pixel coordinates (pixel centers at +0.5). */
export function sampleMosaic(m: Mosaic, gx: number, gy: number): number {
  const x = Math.min(m.w - 1, Math.max(0, gx - m.px0 - 0.5));
  const y = Math.min(m.h - 1, Math.max(0, gy - m.py0 - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(m.w - 1, x0 + 1), y1 = Math.min(m.h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const d = m.data;
  const a = d[y0 * m.w + x0], b = d[y0 * m.w + x1], c = d[y1 * m.w + x0], e = d[y1 * m.w + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}
