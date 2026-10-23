import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL } from '../src/core/model';
import type { BuildRequest } from '../src/worker/messages';
import { buildFromRequest } from '../src/worker/build';
import { setPngDecoder, TileError } from '../src/worker/tiles';

// flat "tiles": every pixel decodes to the same elevation
setPngDecoder(async () => new Uint8Array(256 * 256 * 4).fill(128));

const req = (west: number, waterSurface: 'off' | 'flat'): BuildRequest => ({
  type: 'build',
  id: 1,
  bounds: { west, east: west + 0.05, south: 42, north: 42.03 },
  edge: 'width',
  edgeMm: 40,
  cellMm: 0.5,
  rivers: false,
  riverWidthMm: 0.8,
  model: { ...DEFAULT_MODEL, waterSurface, markersOn: false },
  routeLines: [],
  markers: [],
});

afterEach(() => vi.unstubAllGlobals());

describe('tile download failures', () => {
  it('elevation: stops with a TileError naming how many tiles failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const err = await buildFromRequest(req(10, 'off'), () => {}).catch((e) => e);
    expect(err).toBeInstanceOf(TileError);
    expect(err.source).toBe('elevation');
    expect(err.failed).toBe(err.total);
    expect(err.message).toMatch(/Couldn't download elevation data/);
  }, 30_000);

  it('water: builds without water and says so', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('openfreemap') ? Promise.reject(new TypeError('Failed to fetch')) : new Response(new Uint8Array(8)),
      ),
    );
    const r = await buildFromRequest(req(20, 'flat'), () => {});
    expect(r.parts.length).toBeGreaterThan(0);
    expect(r.input.waterMask).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/no water/);
  }, 30_000);
});
