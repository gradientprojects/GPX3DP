import type { Units } from './core/geo';
import type { LabelAlign, LabelEdgeX, LabelEdgeY } from './core/label';
import { DEFAULT_MODEL, type ModelSettings } from './core/model';
import type { Bounds, Edge } from './core/project';

export type Slicer = 'bambu' | 'prusa';
/** The palette: every color the print can use, as hex. Lakes, rivers and text only apply when set to 'own'. */
export type Palette = { terrain: string; water: string; route: string; lakes: string; rivers: string; text: string };
export type PaletteKey = keyof Palette;
/** everything that has a color, resolved to hex (`resolveColors`) */
export type ColorFeature = PaletteKey | 'markers';
export type ResolvedColors = Record<ColorFeature, string>;

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
  colors: Palette;
  /**
   * Where lakes, rivers and the label text get their color. 'terrain' means the feature is shaped into the
   * terrain (flattened lakes, grooved rivers, debossed text) rather than printed as its own part; see
   * `paletteModel`.
   */
  lakesColor: 'terrain' | 'water' | 'own';
  riversColor: 'terrain' | 'water' | 'own';
  textColor: 'terrain' | 'water' | 'route' | 'own';
  /** rivers in the print at all (groove or color follows `riversColor`) */
  riversOn: boolean;
  /** lake surface follows the palette: flat when lakes print in a color, waterlines when they are terrain */
  waterSurfaceAuto: boolean;
  /** underside label: typed lines, plus optional stats and exaggeration lines */
  labelText: string;
  labelStats: boolean;
  labelExag: boolean;
  labelFont: string;
  labelSizeMm: number;
  /** cap heights of the ride-stats lines and the exaggeration line, mm (the typed text uses labelSizeMm) */
  labelStatsMm: number;
  labelExagMm: number;
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
  colors: { terrain: '#d9d4c7', water: '#3a78c2', route: '#d23a2a', lakes: '#3a78c2', rivers: '#3a78c2', text: '#3a78c2' },
  lakesColor: 'water',
  riversColor: 'water',
  textColor: 'terrain',
  riversOn: true,
  waterSurfaceAuto: true,
  labelText: '',
  labelStats: false,
  labelExag: false,
  labelFont: 'inter600',
  labelSizeMm: 5.5,
  labelStatsMm: 4.5,
  labelExagMm: 4,
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

/**
 * The model switches the palette decides: a feature set to the terrain color is shaped into the terrain,
 * any other color makes it a part of its own. Rivers that are off stay off.
 */
export function paletteModel<T extends ModelSettings>(
  m: T,
  s: Pick<AppSettings, 'lakesColor' | 'riversColor' | 'textColor' | 'riversOn' | 'waterSurfaceAuto'>,
): T {
  const lakesOwn = s.lakesColor !== 'terrain';
  return {
    ...m,
    waterOwnColor: lakesOwn,
    // a textured surface makes terrain-colored water read as water; colored water is flat
    waterSurface: s.waterSurfaceAuto ? (lakesOwn ? 'flat' : 'waterlines') : m.waterSurface,
    riverStyle: !s.riversOn ? 'off' : s.riversColor === 'terrain' ? 'groove' : 'color',
    labelStyle: s.textColor === 'terrain' ? 'deboss' : 'color',
  };
}

/** The palette entry a feature's color comes from, so a swatch in that feature's card edits the palette. */
export function paletteKeyFor(s: Pick<AppSettings, 'lakesColor' | 'riversColor' | 'textColor' | 'markerColor'>, f: ColorFeature): PaletteKey {
  switch (f) {
    case 'lakes':
      return s.lakesColor === 'own' ? 'lakes' : s.lakesColor;
    case 'rivers':
      return s.riversColor === 'own' ? 'rivers' : s.riversColor;
    case 'text':
      return s.textColor === 'own' ? 'text' : s.textColor;
    case 'markers':
      return s.markerColor === 'text' ? paletteKeyFor(s, 'text') : s.markerColor;
    default:
      return f;
  }
}

/** Every feature's color as hex. A single-color printer prints everything in the terrain color. */
export function resolveColors(s: Pick<AppSettings, 'colors' | 'multiColor' | 'lakesColor' | 'riversColor' | 'textColor' | 'markerColor'>): ResolvedColors {
  const keys: ColorFeature[] = ['terrain', 'water', 'route', 'lakes', 'rivers', 'text', 'markers'];
  const out = {} as ResolvedColors;
  for (const k of keys) out[k] = s.multiColor ? s.colors[paletteKeyFor(s, k)] : s.colors.terrain;
  return out;
}

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
  const m = /(?:^#?|&)s=([\w-]+)/.exec(hash);
  if (!m) return structuredClone(DEFAULTS);
  try {
    const b = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
    return fromObject(JSON.parse(json) as Partial<AppSettings>);
  } catch {
    return structuredClone(DEFAULTS); // a broken hash
  }
}

/** format of the settings embedded in exports (`settingsJson`); bump when a reader must treat old files differently */
export const SETTINGS_FORMAT = 1;

/** Every setting, with a stamp, for `Metadata/gpx3dp.json` in the 3MF (never the ride: the GPX stays in the browser). */
export function settingsJson(s: AppSettings): string {
  return JSON.stringify({ source: 'gpx3dp', format: SETTINGS_FORMAT, saved: new Date().toISOString().slice(0, 10), settings: s }, null, 1);
}

/** Settings read back from an export, or null when the text isn't ours. Old files reopen as they were built. */
export function settingsFromJson(text: string): AppSettings | null {
  try {
    const d = JSON.parse(text) as { source?: string; settings?: Partial<AppSettings> };
    if (d.source !== 'gpx3dp' || !d.settings || typeof d.settings !== 'object') return null;
    return fromObject(d.settings);
  } catch {
    return null;
  }
}

/** Defaults overlaid with whatever `d` has of the right type; old keys are mapped onto today's. */
function fromObject(d: Partial<AppSettings>): AppSettings {
  const s = structuredClone(DEFAULTS);
  {
    for (const k of Object.keys(d) as (keyof AppSettings)[])
      if (k in DEFAULTS && typeof d[k] === typeof DEFAULTS[k] || (k === 'crop' && d[k])) (s as unknown as Record<string, unknown>)[k] = d[k];
    // links from before the palette: fewer color keys, and markers had a color of their own
    const given = d.colors as Partial<Palette> | undefined;
    s.colors = Object.fromEntries((Object.keys(DEFAULTS.colors) as PaletteKey[]).map((k) => [k, given?.[k] ?? DEFAULTS.colors[k]])) as Palette;
    if ((d.markerColor as string) === 'own') s.markerColor = 'route';
    // links from before the palette owned the switches: the switch says which color the feature had
    if (!('lakesColor' in d) && 'waterOwnColor' in d) s.lakesColor = d.waterOwnColor ? 'water' : 'terrain';
    if (!('riversColor' in d) && d.riverStyle && d.riverStyle !== 'off') s.riversColor = d.riverStyle === 'color' ? 'water' : 'terrain';
    if (!('textColor' in d) && d.labelStyle) s.textColor = d.labelStyle === 'color' ? 'water' : 'terrain';
    if (!('riversOn' in d) && d.riverStyle === 'off') s.riversOn = false;
    // a link that set the surface by hand keeps it
    if (!('waterSurfaceAuto' in d) && d.waterSurface) s.waterSurfaceAuto = false;
  }
  return s;
}
