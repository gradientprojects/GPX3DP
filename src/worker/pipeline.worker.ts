/// <reference lib="webworker" />
import { strToU8, zipSync } from 'fflate';
import { to3mf, toStl } from '../core/export';
import { parseGpx } from '../core/gpx';
import { buildModel, type ModelInput, type Part } from '../core/model';
import { removeSpikes } from '../core/spike';
import { validateMesh } from '../core/validate';
import { parse as parseFont } from 'opentype.js';
import { labelFont } from '../fonts';
import { buildFromRequest, setLabelFont } from './build';
import type { BuildRequest, FromWorker, ParsedLeg, ToWorker } from './messages';
import { TileError } from './tiles';

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

let lastInput: ModelInput | null = null;
let lastBuild: BuildRequest | null = null;
let lastParts: Part[] = [];

const fontLoads = new Map<string, Promise<void>>();
/** a label font, fetched the first time a build uses it */
const loadFont = (id: string) => {
  const f = labelFont(id);
  let p = fontLoads.get(f.id);
  if (!p) {
    p = fetch(f.url)
      .then((r) => {
        if (!r.ok) throw new Error(`label font: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((b) => setLabelFont(parseFont(b), f.id))
      .catch((e) => {
        fontLoads.delete(f.id);
        throw e;
      });
    fontLoads.set(f.id, p);
  }
  return p;
};

async function build(req: BuildRequest) {
  const t0 = performance.now();
  if (req.label) await loadFont((req.labelFont = labelFont(req.labelFont ?? 'inter').id));
  const r = await buildFromRequest(req, (stage, done, total) => post({ type: 'progress', id: req.id, stage, done, total }));
  lastInput = r.input;
  lastBuild = req;
  lastParts = r.parts;

  post({ type: 'progress', id: req.id, stage: 'Checking mesh' });
  const meshes = r.parts.map((p) => ({
    name: p.name,
    positions: p.positions.slice(),
    indices: p.indices.slice(),
    report: validateMesh(p.positions, p.indices),
  }));
  post(
    {
      type: 'built',
      id: req.id,
      parts: meshes,
      widthMm: r.input.W * r.input.cellMm,
      heightMm: r.input.H * r.input.cellMm,
      reliefMm: r.stats.reliefMm,
      maxHeightMm: r.stats.maxHeightMm,
      elevMin: r.stats.elevMin,
      elevMax: r.stats.elevMax,
      zoom: r.zoom,
      tiles: r.tiles,
      crop: r.crop,
      warnings: r.warnings,
      label: r.label,
      ms: performance.now() - t0,
    },
    meshes.flatMap((m) => [m.positions.buffer, m.indices.buffer]),
  );
}

const slug = (s: string) => s.trim().replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'gpx3dp';

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  try {
    if (m.type === 'parse') {
      const legs: ParsedLeg[] = [];
      const errors: string[] = [];
      m.files.forEach((f, i) => {
        post({ type: 'progress', id: m.id, stage: 'Reading GPX', done: i, total: m.files.length });
        const g = parseGpx(f.text, f.name);
        if (!g.lat.length && !g.waypoints.length) {
          errors.push(`${f.name}: no track points found`);
          return;
        }
        const s = removeSpikes(g.lat, g.lon, m.spikeKm);
        legs.push({ file: f.name, name: g.name, lat: s.lat, lon: s.lon, waypoints: g.waypoints, spikesRemoved: s.removed, climbM: g.climbM });
      });
      post({ type: 'parsed', id: m.id, legs, errors }, legs.flatMap((l) => [l.lat.buffer, l.lon.buffer]));
    } else if (m.type === 'build') {
      await build(m);
    } else if (m.type === 'export') {
      if (!lastInput || !lastBuild) throw new Error('Generate the model first.');
      post({ type: 'progress', id: m.id, stage: 'Exporting' });
      const name = slug(m.title);
      const files: { name: string; data: Uint8Array }[] = [];
      if (m.format === '3mf') {
        files.push({
          name: `${name}.3mf`,
          data: to3mf(lastParts, {
            title: m.title || 'GPX3DP model',
            description: m.description,
            colors: m.colors,
            layout: m.slicer === 'prusa' ? 'single' : 'components',
            plate: m.plate,
          }),
        });
      } else if (m.format === 'stl-parts') {
        const z: Record<string, Uint8Array> = {};
        for (const p of lastParts) z[`${name}_${p.name}.stl`] = toStl([p], `GPX3DP ${p.name}`);
        z['ATTRIBUTION.txt'] = strToU8(m.description);
        files.push({ name: `${name}_parts.zip`, data: zipSync(z, { level: 4 }) });
      } else {
        // one clean solid: rebuild with every element folded into the terrain
        const merged = buildModel(lastInput, {
          ...lastBuild.model,
          routeOwnColor: false,
          waterOwnColor: false,
          markerColor: 'terrain',
        }).parts;
        files.push({ name: `${name}_single.stl`, data: toStl(merged, 'GPX3DP merged') });
      }
      post({ type: 'exported', id: m.id, files }, files.map((f) => f.data.buffer));
    }
  } catch (e) {
    post({ type: 'error', id: m.id, message: e instanceof Error ? e.message : String(e), network: e instanceof TileError });
  }
};
