import './style.css';
import { fmtDist, haversineKm, invMercX, invMercY, KM_PER_MI, mercX, mercY } from './core/geo';
import type { MarkerPin, ModelSettings } from './core/model';
import { joinPoint } from './core/join';
import { orderLegs, seams } from './core/order';
import { fitToPlate, PRINTERS } from './core/printers';
import { makeFrame, mmToLat, mmToLon, routeBounds, toMmX, toMmY, type Bounds, type PrintFrame } from './core/project';
import { FLAT_RELIEF_MM } from './core/crop';
import { suggestExaggeration } from './core/exaggeration';
import { printSuffix } from './core/export';
import { GOOD_GROOVE_NOZZLES, GOOD_WALL_NOZZLES, labelWidthsAt, snapPlacement, type LabelSpec } from './core/label';
import { simplifyLine } from './core/simplify';
import { LABEL_FONTS, labelFont } from './fonts';
import { DEFAULTS, fromHash, NON_GEOMETRY, paletteKeyFor, resolveColors, roundToLayers, suggestedSmoothMm, toHash, toLayers, type AppSettings, type ColorFeature, type PaletteKey } from './settings';
import { darker, MapView, type MapPin } from './ui/map';
import { Preview } from './ui/preview3d';
import type { FromWorker, ParsedLeg, PartMesh, ToWorker } from './worker/messages';
import PipelineWorker from './worker/pipeline.worker.ts?worker';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];

const ATTRIBUTION =
  'Made with GPX3DP (https://gradientprojects.github.io/GPX3DP/). Elevation: Terrain Tiles, Mapzen/Tilezen via AWS Open Data ' +
  '(SRTM, GMTED2010, ETOPO1 and others; https://github.com/tilezen/joerd/blob/master/docs/attribution.md). ' +
  'Water: OpenFreeMap, OpenMapTiles, (c) OpenStreetMap contributors (ODbL).';
const PRUSA_PRINTERS = new Set(['mk4', 'core1', 'mini', 'xl']);
const SEAM_JOIN_KM = 2;

// ---------------------------------------------------------------- state
let S: AppSettings = fromHash(location.hash);
let legs: ParsedLeg[] = [];
let legKm: number[] = [];
let order: number[] = [];
let hasModel = false;
let lastParts: PartMesh[] = [];
let jobId = 0;
let buildPending = false;
let building = false;

const worker = new PipelineWorker();
const waiting = new Map<number, (m: FromWorker) => void>();
const call = (msg: ToWorker, transfer: Transferable[] = []) =>
  new Promise<FromWorker>((res) => {
    waiting.set(msg.id, res);
    worker.postMessage(msg, transfer);
  });
worker.onmessage = (ev: MessageEvent<FromWorker>) => {
  const m = ev.data;
  if (m.type === 'progress') return showProgress(m.stage, m.done, m.total);
  const res = waiting.get(m.id);
  waiting.delete(m.id);
  res?.(m);
};

// ---------------------------------------------------------------- derived values
const orderedLegs = () => order.map((i) => legs[i]);

function cropBounds(): Bounds | null {
  return S.crop ?? routeBounds(orderedLegs(), S.marginPct / 100);
}

function frame(): PrintFrame | null {
  const b = cropBounds();
  return b ? makeFrame(b, S.edge, S.edgeMm) : null;
}

function maxEdgeMm(): number | null {
  const b = cropBounds();
  if (!b) return null;
  const f = makeFrame(b, 'width', 100);
  const fit = fitToPlate(f.widthMm / f.heightMm, S.plateX, S.plateY);
  return Math.floor((S.edge === 'width' ? fit.w : fit.h) * 10) / 10;
}

/**
 * What actually gets built: options a single-color printer can't do are folded into the terrain, and
 * feature heights are whole layers.
 */
function effectiveModel(): ModelSettings {
  const m: ModelSettings = roundToLayers({ ...S }, +S.layerHeightMm);
  if (S.smoothAuto) m.smoothMm = suggestedSmoothMm(S);
  if (!S.multiColor) {
    m.routeOwnColor = m.waterOwnColor = false;
    m.markerColor = 'terrain';
    if (m.riverStyle === 'color') m.riverStyle = 'groove';
    m.labelStyle = 'deboss';
  }
  if (m.routeStyle === 'flush' && !m.routeOwnColor) m.routeStyle = 'raised';
  return m;
}

/** Ride stats for the label: all files combined. Climbing only from files that have elevations. */
function statsLine(): string {
  const km = legKm.reduce((a, b) => a + b, 0);
  if (!legs.length) return '';
  const mi = S.units === 'mi';
  const dist = mi ? km / KM_PER_MI : km;
  const parts = [`${dist.toLocaleString('en-US', { maximumFractionDigits: dist >= 100 ? 0 : 1 })} ${mi ? 'mi' : 'km'}`];
  const climbs = legs.map((l) => l.climbM).filter((c): c is number => c !== null);
  if (climbs.length) {
    const m = climbs.reduce((a, b) => a + b, 0);
    parts.push(`${Math.round(mi ? m / 0.3048 : m).toLocaleString('en-US')} ${mi ? 'ft' : 'm'} climbing`);
  }
  return parts.join(' · ');
}

function labelLines(): string[] {
  const lines = S.labelText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (S.labelStats) lines.push(statsLine());
  if (S.labelExag) {
    const x = effectiveModel().exaggeration;
    lines.push(`Vertical exaggeration ${x}×${x === 1 ? ' (true scale)' : ''}`);
  }
  return lines.filter(Boolean);
}

function labelSpec(): LabelSpec | null {
  const lines = labelLines();
  if (!lines.length) return null;
  const small = exagLineIndex(lines);
  return {
    lines,
    sizeMm: S.labelSizeMm,
    edgeX: S.labelEdgeX,
    offX: S.labelOffX,
    edgeY: S.labelEdgeY,
    offY: S.labelOffY,
    align: S.labelAlign,
    ...(small >= 0 && { small: { lines: [small], scale: EXAG_LINE_SCALE, nozzleMm: S.nozzleMm } }),
  };
}

/** the exaggeration note prints smaller than the main text, but never too small to print */
const EXAG_LINE_SCALE = 0.65;
/** index of the exaggeration line (always last) in `lines`, or -1 */
function exagLineIndex(lines: string[]): number {
  return S.labelExag && lines.length > 1 ? lines.length - 1 : -1;
}

function routeLinesMm(f: PrintFrame): Float64Array[] {
  const out: Float64Array[] = [];
  let cur: number[] | null = null;
  orderedLegs().forEach((leg, k) => {
    const xy = new Float64Array(leg.lat.length * 2);
    for (let i = 0; i < leg.lat.length; i++) {
      xy[2 * i] = toMmX(f, leg.lon[i]);
      xy[2 * i + 1] = toMmY(f, leg.lat[i]);
    }
    const s = simplifyLine(xy, 0.1);
    const prev = k > 0 ? legs[order[k - 1]] : null;
    const joined =
      cur && prev && haversineKm(prev.lat[prev.lat.length - 1], prev.lon[prev.lon.length - 1], leg.lat[0], leg.lon[0]) < SEAM_JOIN_KM;
    if (joined) for (const v of s) cur!.push(v);
    else {
      if (cur) out.push(Float64Array.from(cur));
      cur = Array.from(s);
    }
  });
  if (cur) out.push(Float64Array.from(cur));
  return out;
}

function pinList(): MapPin[] {
  const pins: MapPin[] = [];
  const L = orderedLegs().filter((l) => l.lat.length);
  if (S.pinStartFinish && L.length) {
    pins.push({ lat: L[0].lat[0], lon: L[0].lon[0], kind: 'start', title: 'Start' });
    const z = L[L.length - 1];
    pins.push({ lat: z.lat[z.lat.length - 1], lon: z.lon[z.lon.length - 1], kind: 'finish', title: 'Finish' });
  }
  if (S.pinJoins) {
    // in print mm: tracks closer than half a route width are one spur; spurs up to a marker wide are skipped
    const mPerMm = 1 / (frame()?.mmPerGroundM ?? Infinity);
    for (let k = 0; k + 1 < L.length; k++) {
      const a = L[k], b = L[k + 1];
      const p = joinPoint(a.lat, a.lon, b.lat, b.lon, (S.routeWidthMm / 2) * mPerMm, S.markerDiameterMm * mPerMm);
      pins.push({ ...p, kind: 'checkpoint', title: `End of ${a.name}` });
    }
  }
  if (S.pinWaypoints) for (const l of L) for (const w of l.waypoints) pins.push({ lat: w.lat, lon: w.lon, kind: 'waypoint', title: w.name });
  S.pins.forEach(([lat, lon], i) => pins.push({ lat, lon, kind: 'manual', title: 'My pin', manual: i }));
  return pins;
}

function markersMm(f: PrintFrame): MarkerPin[] {
  return pinList()
    .map((p) => ({ xMm: toMmX(f, p.lon), yMm: toMmY(f, p.lat), kind: p.kind === 'manual' ? 'checkpoint' : p.kind }))
    .filter((m) => m.xMm >= 0 && m.yMm >= 0 && m.xMm <= f.widthMm && m.yMm <= f.heightMm) as MarkerPin[];
}

// ---------------------------------------------------------------- map
const mapView = new MapView($('#map'), {
  onCrop: (b) => {
    S.crop = b;
    clampEdge();
    changed(true);
  },
  onAddPin: (lat, lon) => {
    S.pins.push([lat, lon]);
    changed(true);
  },
  onRemovePin: (i) => {
    S.pins.splice(i, 1);
    changed(true);
  },
});

function refreshMap(fit = false) {
  const L = orderedLegs();
  // simplify for display: ~1/3000 of the extent
  const b = routeBounds(L, 0);
  const tol = b ? Math.max(mercX(b.east) - mercX(b.west), mercY(b.north) - mercY(b.south)) / 3000 : 1;
  mapView.setRoute(
    L.map((l) => {
      const xy = new Float64Array(l.lat.length * 2);
      for (let i = 0; i < l.lat.length; i++) (xy[2 * i] = mercX(l.lon[i])), (xy[2 * i + 1] = mercY(l.lat[i]));
      const s = simplifyLine(xy, tol);
      const coords: [number, number][] = [];
      for (let i = 0; i < s.length; i += 2) coords.push([invMercX(s[i]), invMercY(s[i + 1])]);
      return coords;
    }),
  );
  mapView.setCrop(cropBounds());
  mapView.setPins(S.markersOn ? pinList() : []);
  const cb = cropBounds();
  if (fit && cb) mapView.fit(cb);
  // the print's colors and widths, so the map shows what is in the print and how thin the rivers will be
  const eff = effectiveModel(), rc = resolveColors(S), f = frame();
  const lakesOn = S.waterSurface !== 'off', riversOn = S.riverStyle !== 'off';
  mapView.setPrintStyle({
    terrain: rc.terrain,
    lakes: lakesOn ? (eff.waterOwnColor ? rc.lakes : rc.terrain) : null,
    lakesOutlined: !eff.waterOwnColor,
    rivers: riversOn ? (eff.riverStyle === 'color' ? rc.rivers : darker(rc.terrain)) : null,
    riverLines: S.rivers,
    route: eff.routeOwnColor ? rc.route : rc.terrain,
    routeWidthMm: S.routeWidthMm,
    riverWidthMm: S.riverWidthMm,
    mmPerGroundM: f?.mmPerGroundM ?? null,
    lat: cb ? (cb.north + cb.south) / 2 : 0,
  });
}


// ---------------------------------------------------------------- legs list
function renderLegs() {
  const ol = $('#legs');
  ol.innerHTML = '';
  const sm = seams(
    legs.map((l) => ({ startLat: l.lat[0], startLon: l.lon[0], endLat: l.lat[l.lat.length - 1], endLon: l.lon[l.lon.length - 1] })),
    order,
  ).seamKm;
  order.forEach((li, pos) => {
    const leg = legs[li];
    const el = document.createElement('li');
    el.draggable = true;
    el.dataset.pos = `${pos}`;
    el.innerHTML = `<span class="grip">⋮⋮</span><span class="name"></span><span class="meta"></span><button title="Remove">✕</button>`;
    el.querySelector('.name')!.textContent = leg.name;
    (el.querySelector('.name') as HTMLElement).title = leg.file;
    el.querySelector('.meta')!.textContent = fmtDist(legKm[li], S.units, 0) + (leg.spikesRemoved ? ` · ${leg.spikesRemoved} spikes removed` : '');
    el.querySelector('button')!.onclick = () => {
      legs.splice(li, 1);
      legKm.splice(li, 1);
      order = order.filter((i) => i !== li).map((i) => (i > li ? i - 1 : i));
      S.crop = null;
      afterLegsChanged(true);
    };
    el.ondragstart = (e) => {
      e.dataTransfer!.setData('text/plain', `${pos}`);
      el.classList.add('dragging');
    };
    el.ondragend = () => el.classList.remove('dragging');
    el.ondragover = (e) => e.preventDefault();
    el.ondrop = (e) => {
      e.preventDefault();
      const from = +e.dataTransfer!.getData('text/plain');
      const [moved] = order.splice(from, 1);
      order.splice(pos, 0, moved);
      afterLegsChanged(false);
    };
    ol.appendChild(el);
    if (pos < sm.length) {
      const s = document.createElement('li');
      s.className = 'seam' + (sm[pos] > SEAM_JOIN_KM ? ' far' : '');
      s.textContent = sm[pos] > SEAM_JOIN_KM ? `↓ gap ${fmtDist(sm[pos], S.units)} (not joined)` : `↓ joins (${fmtDist(sm[pos], S.units, 2)})`;
      ol.appendChild(s);
    }
  });
  const total = legKm.reduce((a, b) => a + b, 0);
  const pts = legs.reduce((a, l) => a + l.lat.length, 0);
  $('#ride-stats').textContent = legs.length
    ? `${legs.length} file${legs.length > 1 ? 's' : ''} · ${fmtDist(total, S.units, 0)} · ${pts.toLocaleString()} points`
    : '';
}

function afterLegsChanged(refit: boolean) {
  renderLegs();
  clampEdge();
  refreshMap(refit);
  refreshReadouts();
  scheduleBuild(true);
}

async function loadFiles(files: File[]) {
  const gpx = files.filter((f) => /\.gpx$/i.test(f.name) || f.type.includes('gpx'));
  if (!gpx.length) return toast('Those were not GPX files.');
  const texts = await Promise.all(gpx.map(async (f) => ({ name: f.name, text: await f.text() })));
  const res = await call({ type: 'parse', id: ++jobId, files: texts, spikeKm: S.spikeKm });
  hideProgress();
  if (res.type !== 'parsed') return toast(res.type === 'error' ? res.message : 'Could not read the files.');
  if (res.errors.length) toast(res.errors.join('\n'));
  for (const l of res.legs) {
    legs.push(l);
    legKm.push(l.distKm);
  }
  order = orderLegs(legs.map((l) => ({ startLat: l.lat[0], startLon: l.lon[0], endLat: l.lat[l.lat.length - 1], endLon: l.lon[l.lon.length - 1] }))).order;
  if (!S.title) ($('[data-k="title"]') as HTMLInputElement).placeholder = legs[order[0]]?.name ?? 'Model name';
  if (!fromHash(location.hash).crop) S.crop = null;
  afterLegsChanged(true);
}

// ---------------------------------------------------------------- settings binding
function writeInputs() {
  for (const el of $$<HTMLInputElement>('[data-k]')) {
    const v = (S as unknown as Record<string, unknown>)[el.dataset.k!];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = `${v}`;
  }
  for (const el of $$<HTMLInputElement>('[data-color]')) el.value = S.colors[el.dataset.color as PaletteKey];
  // swatches in the feature cards show the color the feature ends up with
  const rc = resolveColors(S);
  for (const el of $$<HTMLInputElement>('[data-feature]')) el.value = rc[el.dataset.feature as ColorFeature];
  for (const el of $$<HTMLInputElement>('input[name="mc"]')) el.checked = (el.value === 'multi') === S.multiColor;
  refreshReadouts();
}

/** After a color edit: every swatch, the 3D preview and the map follow; the geometry doesn't change. */
function colorsChanged() {
  writeInputs();
  saveHash();
  refreshMap(false);
  if (lastParts.length) preview.setColors(resolveColors(S), lastParts.map((p) => p.name));
}

function readInput(el: HTMLInputElement) {
  const k = el.dataset.k as keyof AppSettings;
  const cur = DEFAULTS[k];
  const s = S as unknown as Record<string, unknown>;
  if (el.type === 'checkbox') s[k] = el.checked;
  else if (typeof cur === 'number') {
    const v = parseFloat(el.value);
    if (!Number.isFinite(v)) return;
    s[k] = Math.min(+(el.max || Infinity), Math.max(+(el.min || -Infinity), v));
  } else s[k] = el.value;
}

function clampEdge() {
  const mx = maxEdgeMm();
  if (mx && S.edgeMm > mx) {
    S.edgeMm = mx;
    ($('[data-k="edgeMm"]') as HTMLInputElement).value = `${mx}`;
  }
}

function refreshReadouts() {
  refreshResetButtons();
  const smooth = $('[data-k="smoothMm"]') as HTMLInputElement;
  const suggested = suggestedSmoothMm(S);
  if (S.smoothAuto) smooth.value = `${(S.smoothMm = suggested)}`;
  smooth.disabled = S.smoothAuto;
  $('#smooth-hint').textContent =
    `Suggested ${suggested} mm for a ${S.nozzleMm} mm nozzle` + (S.exaggeration > 1 ? ` at ×${S.exaggeration}` : '') +
    '. Removes data noise and detail too fine to print; more blurs real ridges.';
  const lh = +S.layerHeightMm;
  const eff0 = effectiveModel();
  const layers = (label: string, mm: number) => `${label} ${(toLayers(mm, lh) * lh).toFixed(2)} mm = ${toLayers(mm, lh)} layers`;
  $('#layer-readout').textContent = [
    S.routeStyle === 'raised' ? layers('Route', S.routeHeightMm) : '',
    S.markersOn ? layers('markers +', S.markerHeightMm).replace('+ ', '+') : '',
    S.multiColor && (S.routeStyle === 'flush' || S.waterOwnColor || S.riverStyle === 'color') ? layers('color layer', S.colorDepthMm) : '',
    S.waterSurface === 'waterlines' || S.waterSurface === 'parallel' ? layers('water lines', S.waterLineDepthMm) : '',
    eff0.riverStyle === 'groove' ? layers('river groove', S.riverDepthMm) : '',
    labelLines().length ? layers(eff0.labelStyle === 'color' ? 'text inlay' : 'label', S.labelDepthMm) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  for (const o of $$('output[data-o]')) o.textContent = `${(S as unknown as Record<string, number>)[o.dataset.o!]}`;
  $('#custom-plate').hidden = S.printer !== 'custom';
  const f = frame();
  const mx = maxEdgeMm();
  if (f) {
    const scale = S.units === 'km' ? `1 mm = ${(1 / f.mmPerGroundM / 1000).toFixed(3)} km` : `1 in = ${(25.4 / f.mmPerGroundM / 1000 / KM_PER_MI).toFixed(2)} mi`;
    $('#size-readout').innerHTML =
      `Print <b>${f.widthMm.toFixed(1)} × ${f.heightMm.toFixed(1)} mm</b> · ${scale}<br>` +
      `Area ${fmtDist(f.groundWidthKm, S.units)} × ${fmtDist(f.groundHeightKm, S.units)} · max ${S.edge} ${mx} mm on this plate` +
      `<br>Grid ${Math.round(f.widthMm / S.cellMm)} × ${Math.round(f.heightMm / S.cellMm)} cells`;
  } else $('#size-readout').textContent = 'Load a GPX file to size the print.';

  const single = !S.multiColor;
  for (const k of ['routeOwnColor', 'waterOwnColor']) ($(`[data-k="${k}"]`) as HTMLInputElement).disabled = single;
  for (const o of $$<HTMLOptionElement>('[data-k="markerColor"] option:not([value="terrain"])')) o.disabled = single;
  // the palette: one color on a single-color printer; own-color swatches only when chosen
  for (const el of $$<HTMLElement>('.palette .multi-only')) el.toggleAttribute('data-single', single);
  for (const k of ['lakes', 'rivers', 'text'] as const) {
    const own = S[`${k}Color`] === 'own';
    ($(`[data-color="${k}"]`) as HTMLElement).hidden = !own;
    ($(`[data-color="${k}"]`).nextElementSibling as HTMLElement | null)?.toggleAttribute('hidden', !own); // its reset button
  }
  for (const el of $$<HTMLInputElement>('[data-feature]')) el.disabled = single;
  $('#colors-note').textContent = single
    ? 'Single color: everything prints in the terrain color. Routes, water, markers and the label are shaped into the terrain instead.'
    : 'Each card below says whether its feature prints in its color or as part of the terrain. The map and the 3D preview show these colors.';
  ($('[data-k="labelStyle"] option[value="color"]') as HTMLOptionElement).disabled = single;
  ($('#label-color-swatch') as HTMLElement).hidden = S.labelStyle !== 'color';
  $('#label-style-note').textContent = S.labelStyle === 'color' && single ? 'A color label needs a multi-color printer, so the text is debossed.' : '';
  const flushOpt = $('[data-k="routeStyle"] option[value="flush"]') as HTMLOptionElement;
  flushOpt.disabled = single;
  const eff = effectiveModel();
  $('#route-note').textContent =
    S.routeStyle === 'flush' && eff.routeStyle !== 'flush'
      ? single
        ? 'Flush needs a multi-color printer, so the route is raised.'
        : 'Flush needs the route in its own color, so it is raised for now.'
      : '';
  $('#route-height-row').hidden = eff.routeStyle === 'flush';
  ($('.water-opts') as HTMLElement).hidden = S.waterSurface === 'off';
  for (const el of $$('.lines-only')) el.hidden = S.waterSurface === 'off' || S.waterSurface === 'flat';
  for (const el of $$('.parallel-only')) el.hidden = S.waterSurface !== 'parallel';
  ($('.river-opts') as HTMLElement).hidden = S.riverStyle === 'off';
  for (const el of $$('.groove-only')) el.hidden = eff.riverStyle !== 'groove';
  for (const el of $$('.color-only')) el.hidden = eff.riverStyle !== 'color';
  ($('[data-k="riverStyle"] option[value="color"]') as HTMLOptionElement).disabled = single;
  const riverNotes: string[] = [];
  if (S.riverStyle === 'color' && eff.riverStyle !== 'color') riverNotes.push('Water color needs a multi-color printer, so rivers are grooved.');
  // a groove narrower than about 2 nozzle widths fills in, like the label's letters
  if (S.riverStyle !== 'off' && S.rivers && S.riverWidthMm < 2 * S.nozzleMm)
    riverNotes.push(`Narrow rivers under ${2 * S.nozzleMm} mm (2 nozzle widths) may fill in or print as a blur.`);
  $('#river-note').textContent = riverNotes.join(' ');
  ($('.marker-opts') as HTMLElement).hidden = !S.markersOn;
  $('#marker-note').textContent =
    S.markersOn && S.markerColor !== 'terrain' && (single || (S.markerColor === 'route' && !eff.routeOwnColor))
      ? single
        ? 'Single color: markers print in the terrain color.'
        : 'The route has no own color, so markers print in the terrain color.'
      : '';

  const lines = labelLines();
  const small = exagLineIndex(lines);
  $('#label-preview').replaceChildren(
    ...lines.map((l, k) => {
      const d = document.createElement('div');
      d.textContent = l;
      if (k === small) d.className = 'small-line';
      return d;
    }),
  );
  showPreviewFont();
  refreshExagHint();
  ($('[data-k="labelText"]') as HTMLTextAreaElement).placeholder = legs[order[0]]?.name ?? 'Ride name';
  refreshLabelNote();
}

/** scale (1:n) and relief at true scale of the last build, for the exaggeration suggestion */
let builtScale: { scale: number; relief1xMm: number } | null = null;
/** exaggeration of the model the worker holds (what gets exported) */
let builtExag = 1;
/** nozzle and layer height the worker's model was built for, named in the export file names */
let builtPrint = { nozzleMm: S.nozzleMm, layerMm: +S.layerHeightMm };
/** Suggested exaggeration under Terrain > Advanced: a hint with a button, never applied by itself. */
function refreshExagHint() {
  const hint = $('#exag-hint');
  hint.hidden = !builtScale;
  if (!builtScale) return;
  const x = suggestExaggeration(builtScale.scale, builtScale.relief1xMm);
  const ratio = `1:${(Math.round(builtScale.scale / 1000) * 1000).toLocaleString()}`;
  $('#exag-text').textContent =
    `Suggested for this map: ${x}×${x === 1 ? ' (true scale)' : ''}` +
    ` (scale ${ratio}, ${builtScale.relief1xMm.toFixed(1)} mm relief at true scale, ${(builtScale.relief1xMm * x).toFixed(1)} mm at ${x}×).`;
  const use = $<HTMLButtonElement>('#exag-use');
  use.textContent = `Use ${x}×`;
  use.hidden = S.exaggeration === x;
  use.onclick = () => {
    S.exaggeration = x;
    writeInputs();
    changed(true);
  };
}

/** the label text under the checkboxes, in the chosen font (loaded once per font with the FontFace API) */
const previewFonts = new Map<string, Promise<void>>();
function showPreviewFont() {
  const f = labelFont(S.labelFont);
  const family = `label-${f.id}`;
  if (!previewFonts.has(f.id))
    previewFonts.set(
      f.id,
      new FontFace(family, `url(${f.url})`)
        .load()
        .then((face) => void document.fonts.add(face))
        .catch(() => void previewFonts.delete(f.id)),
    );
  $('#label-preview').style.fontFamily = `'${family}', system-ui, sans-serif`;
}

/** what the last build did with the label */
let builtLabel: Extract<FromWorker, { type: 'built' }>['label'] | null = null;

/** Good / Tight / Too fine for the thinnest groove and wall (mm) with the current nozzle */
function printLevel(g: number, w: number | null): 'good' | 'tight' | 'bad' {
  const n = S.nozzleMm;
  return g >= GOOD_GROOVE_NOZZLES * n && (w === null || w >= GOOD_WALL_NOZZLES * n) ? 'good' : g >= n && (w === null || w >= n) ? 'tight' : 'bad';
}

/** size the drag would set: rounded to 0.5 mm, 2 to 40 mm */
const draggedSize = (scale: number) => Math.min(40, Math.max(2, Math.round(S.labelSizeMm * scale * 2) / 2));

/**
 * Print check from the built text: the strokes are grooves in the first layers (squish closes ones under
 * about 1.5 nozzle widths) and the plastic between them closes up under about 1.75 (Kiran's Bambu print of
 * Inter Bold: the counters nearly filled in while the grooves were fine).
 */
function refreshLabelPrint() {
  const el = $('#label-print');
  el.className = 'small';
  el.textContent = '';
  if (!labelLines().length || !builtLabel?.strokeMm) return;
  const n = S.nozzleMm, g = builtLabel.strokeMm, w = builtLabel.wallMm;
  const level = printLevel(g, w);
  const widths = `Thinnest groove ${g.toFixed(2)} mm (${(g / n).toFixed(1)} nozzle widths)` + (w === null ? '' : `, thinnest wall ${w.toFixed(2)} mm`);
  // size that brings both up to the "good" level: widths scale with the letter size
  const f = Math.max((GOOD_GROOVE_NOZZLES * n) / g, w === null ? 0 : (GOOD_WALL_NOZZLES * n) / w);
  const size = Math.ceil(S.labelSizeMm * f * 2) / 2;
  const fix = builtLabel.shrunk
    ? ' The text was shrunk to fit, so use fewer or shorter lines, a condensed font or a bigger print.'
    : size <= 40
      ? ` Size ${size} mm or more prints cleanly.`
      : ' Use a bigger print or fewer words.';
  // say which limit it is: grooves fill in, walls between strokes don't print
  const thinGroove = g < GOOD_GROOVE_NOZZLES * n, thinWall = w !== null && w < GOOD_WALL_NOZZLES * n;
  const why =
    level === 'tight'
      ? [thinGroove && 'the first layer may partly fill the letters', thinWall && 'the plastic between strokes is barely a line wide'].filter(Boolean).join(', and ')
      : [g < n && 'the letters will close up', w !== null && w < n && 'the plastic between strokes is too thin to print'].filter(Boolean).join(', and ');
  el.classList.add(level);
  el.textContent =
    level === 'good'
      ? `Good for a ${n} mm nozzle. ${widths}.`
      : `${level === 'tight' ? 'Tight' : 'Too fine'} for a ${n} mm nozzle: ${why}. ${widths}.${fix}`;
}

function refreshLabelNote() {
  refreshLabelPrint();
  const notes: string[] = [];
  if (labelLines().length) {
    if (builtLabel?.shrunk) notes.push("The text didn't fit, so it was scaled down to fit inside the edge.");
    const exagMm = builtLabel?.lineMm.length && exagLineIndex(labelLines()) >= 0 ? builtLabel.lineMm[builtLabel.lineMm.length - 1] : 0;
    if (exagMm > EXAG_LINE_SCALE * S.labelSizeMm + 0.1)
      notes.push(`The exaggeration line prints at ${exagMm} mm, the smallest that prints cleanly with a ${S.nozzleMm} mm nozzle.`);
    if (builtLabel?.dropped.length) notes.push(`Left out (not in the font): ${builtLabel.dropped.join(' ')}`);
    const asked = toLayers(S.labelDepthMm, +S.layerHeightMm) * +S.layerHeightMm;
    if (builtLabel && builtLabel.depthMm && builtLabel.depthMm < asked - 1e-6)
      notes.push(`Depth limited to ${builtLabel.depthMm.toFixed(2)} mm to stay under the color layers; a thicker base allows more.`);
  }
  $('#label-note').textContent = notes.join(' ');
}

let hashTimer = 0;
function saveHash() {
  clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => history.replaceState(null, '', '#' + toHash(S)), 300);
}

function changed(geometry: boolean) {
  refreshReadouts();
  saveHash();
  refreshMap(false);
  if (geometry) scheduleBuild(false);
}

$('#panel').addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  // a swatch edits a palette entry: its own, or (in a feature card) the one the feature's color comes from
  const key = el.dataset.color ? (el.dataset.color as PaletteKey) : el.dataset.feature ? paletteKeyFor(S, el.dataset.feature as ColorFeature) : null;
  if (key) {
    S.colors[key] = el.value;
    colorsChanged();
    return;
  }
  if (el.name === 'mc') S.multiColor = el.value === 'multi';
  else if (el.dataset.k) {
    if (el.type === 'number' && e.type === 'input' && el.value === '') return;
    readInput(el);
  } else return;
  const k = el.dataset.k as keyof AppSettings | undefined;
  if (k === 'printer') {
    const p = PRINTERS.find((x) => x.id === S.printer)!;
    if (p.id !== 'custom') (S.plateX = p.x), (S.plateY = p.y);
    S.slicer = PRUSA_PRINTERS.has(p.id) ? 'prusa' : 'bambu';
    writeInputs();
  }
  if (k === 'marginPct') S.crop = null;
  if (k === 'units') renderLegs();
  // choices that move colors around: every swatch and the preview follow at once
  if (k === 'lakesColor' || k === 'riversColor' || k === 'textColor' || k === 'markerColor' || k === 'labelStyle' || el.name === 'mc') colorsChanged();
  if (k === 'printer' || k === 'plateX' || k === 'plateY' || k === 'edge') clampEdge();
  // units are only cosmetic, except in the label's stats line
  changed(!k || !NON_GEOMETRY.includes(k) || (k === 'units' && S.labelStats));
});
$('#panel').addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.k === 'edgeMm') {
    readInput(el);
    clampEdge();
    writeInputs();
  }
});

// ---------------------------------------------------------------- reset to defaults
/** A resettable control: a settings field, a part color, or the printer-type radios. */
type Field = { el: HTMLInputElement; isDefault: () => boolean; reset: () => void };
const fieldResets: { btn: HTMLButtonElement; f: Field }[] = [];
const sectionResets: { btn: HTMLButtonElement; fields: Field[]; section: HTMLElement }[] = [];
const fire = (el: HTMLInputElement) => el.dispatchEvent(new Event('input', { bubbles: true }));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fmtDefault = (v: unknown) => (typeof v === 'boolean' ? (v ? 'on' : 'off') : `${v}`);

function fieldOf(el: HTMLInputElement): Field | null {
  if (el.dataset.k) {
    const k = el.dataset.k as keyof AppSettings;
    return {
      el,
      // smoothing set by Auto is not a user change
      isDefault: () => (k === 'smoothMm' && S.smoothAuto) || same(S[k], DEFAULTS[k]),
      reset: () => {
        if (el.type === 'checkbox') el.checked = DEFAULTS[k] as boolean;
        else el.value = `${DEFAULTS[k]}`;
        fire(el);
      },
    };
  }
  if (el.dataset.color) {
    const c = el.dataset.color as PaletteKey;
    return { el, isDefault: () => S.colors[c] === DEFAULTS.colors[c], reset: () => ((el.value = DEFAULTS.colors[c]), fire(el)) };
  }
  if (el.name === 'mc' && el.value === 'multi') {
    const target = () => $<HTMLInputElement>(`input[name="mc"][value="${DEFAULTS.multiColor ? 'multi' : 'single'}"]`);
    return { el, isDefault: () => S.multiColor === DEFAULTS.multiColor, reset: () => ((target().checked = true), fire(target())) };
  }
  return null;
}

function defaultLabel(el: HTMLInputElement): string {
  if (el.dataset.k) {
    const v = DEFAULTS[el.dataset.k as keyof AppSettings];
    const opt = el instanceof HTMLSelectElement ? [...el.options].find((o) => o.value === `${v}`) : null;
    return opt ? opt.textContent!.trim() : fmtDefault(v);
  }
  if (el.dataset.color) return DEFAULTS.colors[el.dataset.color as PaletteKey];
  return DEFAULTS.multiColor ? 'Multi-color' : 'Single color';
}

function addResetButtons() {
  for (const section of $$<HTMLElement>('#panel section.card')) {
    const fields: Field[] = [];
    for (const el of section.querySelectorAll<HTMLInputElement>('[data-k], [data-color], input[name="mc"]')) {
      const f = fieldOf(el);
      if (!f) continue;
      fields.push(f);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'reset-field';
      btn.textContent = '↺';
      btn.title = `Reset to default (${defaultLabel(el)})`;
      btn.setAttribute('aria-label', btn.title);
      btn.onclick = (e) => {
        e.preventDefault();
        f.reset();
      };
      // after the control, or at the end of its label for check/radio boxes and sliders with a readout
      const label = el.closest('label');
      if (el.type === 'radio') (el.closest('.seg, .row') ?? el.parentElement!).append(btn);
      else if (el.type === 'checkbox' && label) label.append(btn);
      else if (el.nextElementSibling?.tagName === 'OUTPUT') el.nextElementSibling.after(btn);
      else el.after(btn);
      fieldResets.push({ btn, f });
    }
    const resetCrop = section.querySelector<HTMLButtonElement>('#reset-crop');
    if (!fields.length && !resetCrop) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reset-section ghost';
    btn.textContent = 'Reset';
    btn.title = 'Reset this section to defaults';
    btn.onclick = () => {
      for (const f of fields) if (!f.isDefault()) f.reset();
      if (resetCrop && S.crop) resetCrop.click();
    };
    section.querySelector('h2')!.append(btn);
    sectionResets.push({ btn, fields, section });
  }
}

function refreshResetButtons() {
  for (const { btn, f } of fieldResets) btn.hidden = f.isDefault();
  for (const { btn, fields, section } of sectionResets)
    btn.hidden = fields.every((f) => f.isDefault()) && !(section.querySelector('#reset-crop') && S.crop);
}

$('#fit').onclick = () => {
  const mx = maxEdgeMm();
  if (!mx) return;
  S.edgeMm = mx;
  writeInputs();
  changed(true);
};
let suggestedCrop: Bounds | null = null;
$('#crop-mountains').onclick = () => {
  if (!suggestedCrop) return;
  S.crop = suggestedCrop;
  clampEdge();
  writeInputs();
  changed(true);
  mapView.fit(suggestedCrop);
};
$('#fit-flat').onclick = () => $<HTMLButtonElement>('#fit').click();
$('#reset-crop').onclick = () => {
  S.crop = null;
  clampEdge();
  writeInputs();
  changed(true);
  const b = cropBounds();
  if (b) mapView.fit(b);
};
$('#add-pins').onclick = () => {
  const on = !mapView.addMode;
  mapView.setAddMode(on);
  $('#add-pins').classList.toggle('on', on);
  $('#add-pins').textContent = on ? 'Done adding pins' : 'Add pins on map';
  if (on) showTab('map');
};
$('#clear-pins').onclick = () => {
  S.pins = [];
  changed(true);
};

// ---------------------------------------------------------------- files
const drop = $('#drop');
const fileInput = $<HTMLInputElement>('#file');
fileInput.onchange = () => {
  if (fileInput.files?.length) loadFiles([...fileInput.files]);
  fileInput.value = '';
};
for (const t of [drop, document.body]) {
  t.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    drop.classList.add('over');
  });
  t.addEventListener('dragleave', () => drop.classList.remove('over'));
  t.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    drop.classList.remove('over');
    loadFiles([...e.dataTransfer.files]);
  });
}

// ---------------------------------------------------------------- build + export
const preview = new Preview($('#three'));
let buildTimer = 0;

function scheduleBuild(immediate: boolean) {
  if (!hasModel && !immediate) return;
  if (!($('#auto') as HTMLInputElement).checked && hasModel) return;
  if (!legs.length && !S.crop) return;
  clearTimeout(buildTimer);
  buildTimer = window.setTimeout(runBuild, immediate ? 50 : 600);
}

async function runBuild() {
  if (building) {
    buildPending = true;
    return;
  }
  const f = frame();
  if (!f) return;
  building = true;
  buildPending = false;
  const id = ++jobId;
  ($('#generate') as HTMLButtonElement).disabled = true;
  showProgress('Starting');
  const routeLines = routeLinesMm(f);
  const builtModel = effectiveModel();
  const res = await call(
    {
      type: 'build',
      id,
      bounds: f.bounds,
      edge: S.edge,
      edgeMm: S.edgeMm,
      cellMm: +S.cellMm,
      rivers: S.rivers && S.riverStyle !== 'off',
      riverWidthMm: S.riverWidthMm,
      model: builtModel,
      routeLines,
      markers: S.markersOn ? markersMm(f) : [],
      label: labelSpec(),
      labelFont: S.labelFont,
    },
    routeLines.map((l) => l.buffer),
  );
  building = false;
  ($('#generate') as HTMLButtonElement).disabled = false;
  hideProgress();
  if (res.type === 'error' && res.network && !navigator.onLine) {
    rebuildWhenOnline = true;
    toast("You're offline, so map tiles can't be downloaded. The model will build when you're back online.");
  } else if (res.type === 'error' && res.network)
    toast(`${res.message} Check your connection and try again.`, { label: 'Retry', run: () => runBuild() });
  else if (res.type === 'error') toast(res.message);
  if (res.type === 'built') {
    if (res.warnings.length) toast(res.warnings.join(' '));
    builtLabel = res.label;
    refreshLabelNote();
    hasModel = true;
    lastParts = res.parts;
    preview.setParts(res.parts, resolveColors(S), res.widthMm, res.heightMm, res.label.depthMm);
    preview.setLabelBox(res.label.box);
    const tris = res.parts.reduce((s, p) => s + p.report.triangles, 0);
    const bad = res.parts.filter((p) => !p.report.ok);
    $('#dims').textContent = `${res.widthMm.toFixed(1)} × ${res.heightMm.toFixed(1)} × ${res.maxHeightMm.toFixed(1)} mm`;
    $('#model-readout').innerHTML =
      `<b>${res.widthMm.toFixed(1)} × ${res.heightMm.toFixed(1)} × ${res.maxHeightMm.toFixed(1)} mm</b> · relief ${res.reliefMm.toFixed(1)} mm` +
      (S.exaggeration > 1 ? ` (heights ×${S.exaggeration})` : '') +
      ` (${Math.round(res.elevMin)}–${Math.round(res.elevMax)} m)<br>` +
      `Parts: ${res.parts.map((p) => p.name).join(', ')} · ${tris.toLocaleString()} triangles<br>` +
      (bad.length
        ? `<span class="bad">Mesh check failed for ${bad.map((p) => p.name).join(', ')}</span>`
        : 'Mesh check: closed and manifold ✓') +
      `<br>Elevation zoom ${res.zoom}, ${res.tiles} tiles · built in ${(res.ms / 1000).toFixed(1)} s`;
    const fr = frame();
    builtScale = fr ? { scale: 1000 / fr.mmPerGroundM, relief1xMm: res.reliefMm / builtModel.exaggeration } : null;
    builtExag = builtModel.exaggeration;
    builtPrint = { nozzleMm: S.nozzleMm, layerMm: +S.layerHeightMm };
    refreshExagHint();
    const flat = res.reliefMm < FLAT_RELIEF_MM;
    $('#relief-note').textContent = flat
      ? `Only ${res.reliefMm.toFixed(1)} mm of relief: this area is very flat at this print size. ` +
        'A tighter crop or a bigger print shows more; Advanced has vertical exaggeration.'
      : '';
    suggestedCrop = res.crop
      ? { west: mmToLon(f, res.crop.x0), east: mmToLon(f, res.crop.x1), south: mmToLat(f, res.crop.y0), north: mmToLat(f, res.crop.y1) }
      : null;
    const cropBtn = $<HTMLButtonElement>('#crop-mountains');
    cropBtn.hidden = !flat || !suggestedCrop;
    if (res.crop) cropBtn.textContent = `Crop to the mountains (about ${res.crop.reliefMm.toFixed(0)} mm relief)`;
    const mx = maxEdgeMm();
    $<HTMLButtonElement>('#fit-flat').hidden = !flat || !mx || S.edgeMm >= mx - 0.5;
    $('#relief-actions').hidden = cropBtn.hidden && $<HTMLButtonElement>('#fit-flat').hidden;
    for (const b of $$<HTMLButtonElement>('#dl-3mf, #dl-stl-parts, #dl-stl-merged')) b.disabled = false;
    // the view stays where the user put it; a dot on the 3D tab says there's a new model to see
    if ($('#three').hidden) $('.tab[data-tab="3d"]').classList.add('fresh');
  }
  if (buildPending) runBuild();
}

$('#generate').onclick = () => runBuild();

async function download(format: '3mf' | 'stl-parts' | 'stl-merged') {
  const title = S.title || legs[order[0]]?.name || 'GPX3DP model';
  const res = await call({
    type: 'export',
    id: ++jobId,
    format,
    slicer: S.slicer,
    plate: [S.plateX, S.plateY],
    title,
    // say when heights are stretched, so the file isn't mistaken for true scale
    description: ATTRIBUTION + (builtExag !== 1 ? ` Vertical exaggeration ${builtExag}×.` : ''),
    colors: resolveColors(S),
    suffix: printSuffix(builtPrint.nozzleMm, builtPrint.layerMm),
  });
  hideProgress();
  if (res.type === 'error') return toast(res.message);
  if (res.type !== 'exported') return;
  for (const f of res.files) {
    const url = URL.createObjectURL(new Blob([f.data as BlobPart]));
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}
$('#dl-3mf').onclick = () => download('3mf');
$('#dl-stl-parts').onclick = () => download('stl-parts');
$('#dl-stl-merged').onclick = () => download('stl-merged');

// ---------------------------------------------------------------- tabs, progress, toast
function showTab(t: 'map' | '3d') {
  for (const b of $$('.tab')) b.classList.toggle('active', b.dataset.tab === t);
  $('#map').hidden = t !== 'map';
  $('#three').hidden = t !== '3d';
  if (t === 'map') mapView.resize();
  else {
    $('.tab[data-tab="3d"]').classList.remove('fresh');
    preview.resize();
  }
}
for (const b of $$('.tab')) b.onclick = () => showTab(b.dataset.tab as 'map' | '3d');
for (const b of $$<HTMLButtonElement>('.view-toggle button'))
  b.onclick = () => {
    for (const o of $$('.view-toggle button')) o.classList.toggle('active', o === b);
    preview.setView(b.dataset.view as 'top' | 'bottom');
  };

// ---------------------------------------------------------------- label placement
function placeLabel(p: Partial<Pick<AppSettings, 'labelEdgeX' | 'labelOffX' | 'labelEdgeY' | 'labelOffY' | 'labelSizeMm'>>) {
  Object.assign(S, p);
  writeInputs();
  changed(true);
}
$('#label-center').onclick = () => placeLabel({ labelEdgeX: 'center', labelOffX: 0, labelEdgeY: 'middle', labelOffY: 0 });
$('#label-show').onclick = () => {
  if (!builtLabel?.box) return toast(labelLines().length ? 'Generate the model first, then drag the text there.' : 'Add some label text first.');
  showTab('3d');
  ($('[data-view="bottom"]') as HTMLButtonElement).click();
};
// dragged or scaled in the Underside view: snap each axis to center or its nearest edge
// while scaling: widths scale with the letter size, so the last build's widths rate the new size
preview.labelReadout = (scale) => {
  if (!builtLabel?.scaling?.main.strokeMm) return null;
  const size = draggedSize(scale);
  const w = labelWidthsAt(builtLabel.scaling, size);
  const level = printLevel(w.strokeMm, w.wallMm);
  return { text: `${size} mm` + (level === 'good' ? '' : level === 'tight' ? ' · tight' : ' · too fine'), level };
};
preview.onLabelEdit = (box, scale) => {
  const size = draggedSize(scale);
  const p = snapPlacement(box, preview.widthMm, preview.heightMm);
  placeLabel({ labelEdgeX: p.edgeX, labelOffX: p.offX, labelEdgeY: p.edgeY, labelOffY: p.offY, labelSizeMm: size });
};

function showProgress(stage: string, done?: number, total?: number) {
  const p = $('#progress');
  p.hidden = false;
  const det = total !== undefined && done !== undefined && total > 0;
  p.classList.toggle('indet', !det);
  p.style.setProperty('--p', det ? `${(100 * done!) / total!}%` : '30%');
  p.querySelector('span')!.textContent = det ? `${stage} ${done} of ${total}` : `${stage}…`;
}
function hideProgress() {
  $('#progress').hidden = true;
}
let toastTimer = 0;
/** Show a message; with an action it gets a button and stays until clicked or dismissed. */
function toast(msg: string, action?: { label: string; run: () => void }) {
  const t = $('#toast');
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'primary';
    b.textContent = action.label;
    b.onclick = (e) => {
      e.stopPropagation();
      t.hidden = true;
      action.run();
    };
    t.append(' ', b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  if (!action) toastTimer = window.setTimeout(() => (t.hidden = true), 8000);
}
$('#toast').onclick = () => ($('#toast').hidden = true);

// offline: say so, and build once the connection is back
let rebuildWhenOnline = false;
window.addEventListener('online', () => {
  if (!rebuildWhenOnline) return;
  rebuildWhenOnline = false;
  $('#toast').hidden = true;
  runBuild();
});

// ---------------------------------------------------------------- init
$('#printer').innerHTML = PRINTERS.map((p) => `<option value="${p.id}">${p.name}${p.id === 'custom' ? '' : ` (${p.x}×${p.y})`}</option>`).join('');
const SHAPES = [['circle', '● Circle'], ['square', '■ Square'], ['triangle', '▲ Triangle'], ['diamond', '◆ Diamond']];
$('#label-font').innerHTML = LABEL_FONTS.map((f) => `<option value="${f.id}">${f.name} (${f.note})</option>`).join('');
for (const sel of $$('.shape-sel')) sel.innerHTML = SHAPES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
addResetButtons();
writeInputs();
refreshMap(true);
if (S.crop) scheduleBuild(true);
