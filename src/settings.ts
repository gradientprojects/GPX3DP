import type { Units } from './core/geo';
import type { LabelAlign, LabelEdgeX, LabelEdgeY } from './core/label';
import { DEFAULT_MODEL, type ModelSettings } from './core/model';
import type { Bounds, Edge } from './core/project';

export type Slicer = 'bambu' | 'prusa';
export type PartColors = { terrain: string; route: string; water: string; markers: string };

export interface AppSettings extends ModelSettings {
  title: string;
  printer: string;
  plateX: number;
  plateY: number;
  multiColor: boolean;
  slicer: Slicer;
  edge: Edge;
  edgeMm: number;
  cellMm: number;
  nozzleMm: number;
  layerHeightMm: number;
  /** smoothing follows suggestedSmoothMm() */
  smoothAuto: boolean;
  units: Units;
  marginPct: number;
  /** null = route bounds + margin */
  crop: Bounds | null;
  spikeKm: number;
  rivers: boolean;
  riverWidthMm: number;
  pinJoins: boolean;
  pinWaypoints: boolean;
  pinStartFinish: boolean;
  /** manual pins, [lat, lon] */
  pins: [number, number][];
  colors: PartColors;
  /** underside label: typed lines, plus optional stats and exaggeration lines */
  labelText: string;
  labelStats: boolean;
  labelExag: boolean;
  labelFont: string;
  labelSizeMm: number;
  labelEdgeX: LabelEdgeX;
  labelOffX: number;
  labelEdgeY: LabelEdgeY;
  labelOffY: number;
  labelAlign: LabelAlign;
}

export const DEFAULTS: AppSettings = {
  ...DEFAULT_MODEL,
  title: '',
  printer: 'x1',
  plateX: 256,
  plateY: 256,
  multiColor: true,
  slicer: 'bambu',
  edge: 'width',
  edgeMm: 200,
  cellMm: 0.25,
  nozzleMm: 0.4,
  layerHeightMm: 0.2,
  smoothAuto: true,
  units: 'km',
  marginPct: 5,
  crop: null,
  spikeKm: 20,
  rivers: false,
  riverWidthMm: 0.8,
  pinJoins: true,
  pinWaypoints: true,
  pinStartFinish: true,
  pins: [],
  colors: { terrain: '#d9d4c7', route: '#d23a2a', water: '#3a78c2', markers: '#f2b705' },
  labelText: '',
  labelStats: false,
  labelExag: false,
  labelFont: 'inter600',
  labelSizeMm: 5.5,
  labelEdgeX: 'center',
  labelOffX: 0,
  labelEdgeY: 'middle',
  labelOffY: 0,
  labelAlign: 'auto',
};

/**
 * Suggested smoothing radius (mm): enough to remove detail the nozzle can't print (half its width) and
 * at least one grid cell of data noise, a little more when heights are exaggerated (noise is stretched too).
 */
export function suggestedSmoothMm(s: Pick<AppSettings, 'nozzleMm' | 'cellMm' | 'exaggeration'>): number {
  const v = Math.max(s.nozzleMm / 2, +s.cellMm) * (1 + (s.exaggeration - 1) / 9);
  return Math.min(1.5, Math.round(v * 20) / 20);
}

/** Whole layers (at least one) for a height in mm. */
export const toLayers = (mm: number, layer: number) => Math.max(1, Math.round(mm / layer));

/** Feature heights rounded to whole layers, so each color layer prints as full layers. */
export function roundToLayers<T extends ModelSettings>(m: T, layer: number): T {
  const r = (mm: number) => +(toLayers(mm, layer) * layer).toFixed(4);
  return {
    ...m,
    routeHeightMm: r(m.routeHeightMm),
    markerHeightMm: r(m.markerHeightMm),
    colorDepthMm: r(m.colorDepthMm),
    waterLineDepthMm: r(m.waterLineDepthMm),
    riverDepthMm: r(m.riverDepthMm),
    labelDepthMm: r(m.labelDepthMm),
  };
}

/** Settings that change only how the model is shared/exported, not the geometry. */
export const NON_GEOMETRY: (keyof AppSettings)[] = ['title', 'units', 'colors', 'slicer'];

// URL hash: only values that differ from the defaults, as base64url JSON. GPX data is never included.
export function toHash(s: AppSettings): string {
  const diff: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULTS) as (keyof AppSettings)[])
    if (JSON.stringify(s[k]) !== JSON.stringify(DEFAULTS[k])) diff[k] = s[k];
  if (!Object.keys(diff).length) return '';
  const b = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(diff))));
  return 's=' + b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromHash(hash: string): AppSettings {
  const s = structuredClone(DEFAULTS);
  const m = /(?:^#?|&)s=([\w-]+)/.exec(hash);
  if (!m) return s;
  try {
    const b = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
    const d = JSON.parse(json) as Partial<AppSettings>;
    for (const k of Object.keys(d) as (keyof AppSettings)[])
      if (k in DEFAULTS && typeof d[k] === typeof DEFAULTS[k] || (k === 'crop' && d[k])) (s as unknown as Record<string, unknown>)[k] = d[k];
  } catch {
    /* ignore a broken hash */
  }
  return s;
}
