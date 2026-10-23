// Synthetic test rides (no real GPX in the repo). Writes into test-data/synthetic/:
//  - srmr-like: 6 legs, ~570k points, ~2,100 km through Kyrgyzstan past Issyk-Kul, files shuffled,
//    with two GPS spikes and one recording dropout
//  - local-loop: ~30 km loop on Mt Tamalpais by San Francisco Bay
// Usage: node scripts/make-synthetic-gpx.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const out = new URL('../test-data/synthetic/', import.meta.url);
mkdirSync(out, { recursive: true });

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const R = 6371;
const kmBetween = (a, b) => {
  const r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Wiggly path through waypoints [lon, lat], one point every `stepM` meters. */
function path(wps, stepM, wiggleKm) {
  const pts = [];
  for (let k = 0; k + 1 < wps.length; k++) {
    const a = wps[k], b = wps[k + 1];
    const n = Math.max(2, Math.round((kmBetween(a, b) * 1000 * 1.35) / stepM));
    const ph1 = rnd() * 6, ph2 = rnd() * 6;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const s = Math.sin(t * Math.PI);
      const dx = (wiggleKm / 111) * s * (Math.sin(t * 37 + ph1) + 0.5 * Math.sin(t * 113 + ph2));
      const dy = (wiggleKm / 111) * s * (Math.cos(t * 41 + ph2) + 0.5 * Math.sin(t * 97 + ph1));
      pts.push([a[0] + (b[0] - a[0]) * t + dx, a[1] + (b[1] - a[1]) * t + dy]);
    }
  }
  pts.push(wps[wps.length - 1]);
  return pts;
}

const gpx = (name, pts, wpts = []) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GPX3DP synthetic" xmlns="http://www.topografix.com/GPX/1/1">\n` +
  wpts.map((w) => `<wpt lat="${w[1]}" lon="${w[0]}"><name>${w[2]}</name></wpt>\n`).join('') +
  `<trk><name>${name}</name><trkseg>\n` +
  pts.map((p) => `<trkpt lat="${p[1].toFixed(6)}" lon="${p[0].toFixed(6)}"></trkpt>`).join('\n') +
  `\n</trkseg></trk></gpx>\n`;

// --- SRMR-like
const wps = [
  [74.2, 42.55], [74.9, 41.75], [75.6, 41.25], [76.4, 40.65], [77.5, 40.95], [78.3, 41.6],
  [77.6, 42.08], [76.6, 42.05], [75.9, 42.2], [75.2, 42.0], [74.6, 41.4], [73.6, 41.05], [74.1, 42.1],
];
const all = path(wps, 3.7, 6);
// two spikes and one dropout
all.splice(100000, 0, [all[100000][0] + 1.5, all[100000][1] + 0.9]);
all.splice(300000, 0, [all[300000][0] - 2.0, all[300000][1]], [all[300000][0] - 2.01, all[300000][1] + 0.01]);
all.splice(420000, 6000);
const cuts = [0, 0.15, 0.32, 0.5, 0.66, 0.83, 1].map((f) => Math.round(f * (all.length - 1)));
const order = [3, 0, 5, 1, 4, 2];
let total = 0;
order.forEach((leg, i) => {
  const pts = all.slice(cuts[leg], cuts[leg + 1] + 1);
  total += pts.length;
  const w = leg === 2 ? [[pts[Math.floor(pts.length / 2)][0], pts[Math.floor(pts.length / 2)][1], 'Hot springs']] : [];
  writeFileSync(new URL(`srmr-like_file${i + 1}.gpx`, out), gpx(`SRMR-like leg ${leg + 1}`, pts, w));
});
console.log(`srmr-like: ${total} points in 6 files`);

// --- local loop (~30 km)
const c = [-122.58, 37.92];
const loop = [];
for (let i = 0; i <= 6000; i++) {
  const t = (i / 6000) * 2 * Math.PI;
  const r = 0.045 * (1 + 0.25 * Math.sin(3 * t) + 0.1 * Math.sin(11 * t));
  loop.push([c[0] + (r * Math.cos(t)) / Math.cos((c[1] * Math.PI) / 180), c[1] + r * Math.sin(t)]);
}
writeFileSync(new URL('local-loop.gpx', out), gpx('Mt Tam loop', loop));
let km = 0;
for (let i = 1; i < loop.length; i++) km += kmBetween(loop[i - 1], loop[i]);
console.log(`local-loop: ${loop.length} points, ${km.toFixed(1)} km`);
