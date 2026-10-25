import { haversineKm } from './geo';

export interface Waypoint {
  name: string;
  lat: number;
  lon: number;
}

export interface GpxFile {
  name: string;
  lat: Float64Array;
  lon: Float64Array;
  waypoints: Waypoint[];
  /** distance along the points, km, not counting recording gaps (see `gapMask`) */
  distKm: number;
  /** total climbing from the points' `<ele>`, m, not counting elevation changes across gaps; null without elevations */
  climbM: number | null;
}

/** GPS elevation jitter below this doesn't count as climbing */
export const CLIMB_HYSTERESIS_M = 2;

/**
 * Sum of rises, counting a rise only once it is `hyst` above the last low (NaN = no value). A rise that starts at
 * a `gap` point (the recorder came back on somewhere else) is not counted: barometric altimeters reset there.
 */
export function climbOf(ele: ArrayLike<number>, hyst = CLIMB_HYSTERESIS_M, gap?: Uint8Array): number | null {
  let ref = NaN, climb = 0, any = false;
  for (let i = 0; i < ele.length; i++) {
    const e = ele[i];
    if (!Number.isFinite(e)) continue;
    any = true;
    if (Number.isNaN(ref) || ref - e >= hyst || gap?.[i]) ref = e;
    else if (e - ref >= hyst) {
      climb += e - ref;
      ref = e;
    }
  }
  return any ? climb : null;
}

/** A gap is at least this long, m, whatever the point spacing */
const GAP_MIN_M = 100;
/** ... and at least this many times the typical spacing, so sparse routes are not all gaps */
const GAP_SPACING_FACTOR = 20;

/**
 * Recording gaps: steps far longer than the file's typical point spacing (the device was off and came back on
 * elsewhere). `gap[i]` marks the point after the gap. Distance and climbing across a gap are not the ride's.
 */
export function gapMask(lat: ArrayLike<number>, lon: ArrayLike<number>): { gap: Uint8Array; distKm: number; gaps: number } {
  const n = lat.length;
  const step = new Float64Array(Math.max(0, n - 1));
  for (let i = 1; i < n; i++) step[i - 1] = haversineKm(lat[i - 1], lon[i - 1], lat[i], lon[i]) * 1000;
  const sorted = Float64Array.from(step).sort();
  const median = sorted.length ? sorted[sorted.length >> 1] : 0;
  const limit = Math.max(GAP_MIN_M, GAP_SPACING_FACTOR * median);
  const gap = new Uint8Array(n);
  let distKm = 0, gaps = 0;
  for (let i = 1; i < n; i++) {
    if (step[i - 1] > limit) (gap[i] = 1), gaps++;
    else distKm += step[i - 1] / 1000;
  }
  return { gap, distKm, gaps };
}

const ATTR_LAT = /\blat\s*=\s*["']([^"']+)["']/;
const ATTR_LON = /\blon\s*=\s*["']([^"']+)["']/;

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

/**
 * Fast GPX scan. DOMParser on a 100k-point file is slow and memory hungry, so this
 * reads `trkpt` (or `rtept` when there is no track) attributes with a regex scan.
 * Timestamps are ignored. `<ele>` is only used for the climbing total; the model's heights come from the DEM.
 */
export function parseGpx(text: string, fileName: string): GpxFile {
  let tag = 'trkpt';
  if (!/<trkpt\b/.test(text)) tag = 'rtept';
  const re = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  const lat: number[] = [];
  const lon: number[] = [];
  const ele: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const a = m[1];
    const la = ATTR_LAT.exec(a);
    const lo = ATTR_LON.exec(a);
    if (!la || !lo) continue;
    const y = parseFloat(la[1]);
    const x = parseFloat(lo[1]);
    if (Number.isFinite(y) && Number.isFinite(x) && Math.abs(y) <= 85 && Math.abs(x) <= 180) {
      lat.push(y);
      lon.push(x);
      const e = m[2] ? /<ele>\s*([^<]+)<\/ele>/.exec(m[2]) : null;
      ele.push(e ? parseFloat(e[1]) : NaN);
    }
  }

  const waypoints: Waypoint[] = [];
  const wre = /<wpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/wpt>)/g;
  while ((m = wre.exec(text))) {
    const la = ATTR_LAT.exec(m[1]);
    const lo = ATTR_LON.exec(m[1]);
    if (!la || !lo) continue;
    const nm = m[2] ? /<name>([\s\S]*?)<\/name>/.exec(m[2]) : null;
    waypoints.push({ name: nm ? decode(nm[1]) : 'Waypoint', lat: parseFloat(la[1]), lon: parseFloat(lo[1]) });
  }

  const trk = /<trk\b[\s\S]*?<name>([\s\S]*?)<\/name>/.exec(text);
  const meta = /<metadata\b[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/metadata>/.exec(text);
  const name = (trk && decode(trk[1])) || (meta && decode(meta[1])) || fileName.replace(/\.gpx$/i, '');

  const { gap, distKm } = gapMask(lat, lon);
  return { name, lat: Float64Array.from(lat), lon: Float64Array.from(lon), waypoints, distKm, climbM: climbOf(ele, CLIMB_HYSTERESIS_M, gap) };
}
