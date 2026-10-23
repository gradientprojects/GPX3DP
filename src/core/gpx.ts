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
 * Timestamps and `<ele>` are ignored: elevation comes from the DEM.
 */
export function parseGpx(text: string, fileName: string): GpxFile {
  let tag = 'trkpt';
  if (!/<trkpt\b/.test(text)) tag = 'rtept';
  const re = new RegExp(`<${tag}\\b([^>]*)>`, 'g');
  const lat: number[] = [];
  const lon: number[] = [];
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

  return { name, lat: Float64Array.from(lat), lon: Float64Array.from(lon), waypoints };
}
