import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { Part, PartName } from './model';

export const PART_LABELS: Record<PartName, string> = {
  terrain: 'terrain',
  text: 'text',
  route: 'route',
  lakes: 'lakes',
  rivers: 'rivers',
  markers: 'markers',
};

/**
 * Filament slot (1-based) per part: parts with the same color share a slot, in order of first appearance,
 * so "lakes same as water" and "text same as water" load as one filament.
 */
export function filamentSlots(parts: { name: PartName }[], colors: Partial<Record<PartName, string>>): number[] {
  const seen: string[] = [];
  return parts.map((p) => {
    const c = (colors[p.name] ?? `#${p.name}`).toLowerCase();
    let k = seen.indexOf(c);
    if (k < 0) k = seen.push(c) - 1;
    return k + 1;
  });
}

/** File name ending for the print settings, e.g. 0.4 mm nozzle at 0.16 mm layers → "_0p4N_0p16L". */
export function printSuffix(nozzleMm: number, layerMm: number): string {
  const p = (v: number) => String(+v.toFixed(3)).replace('.', 'p');
  return `_${p(nozzleMm)}N_${p(layerMm)}L`;
}

/** Binary STL of one or more parts (normals computed per facet). */
export function toStl(parts: Part[], header = 'GPX3DP'): Uint8Array {
  const nt = parts.reduce((s, p) => s + p.indices.length / 3, 0);
  const buf = new ArrayBuffer(84 + nt * 50);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  for (let i = 0; i < Math.min(80, header.length); i++) u8[i] = header.charCodeAt(i) & 0x7f;
  dv.setUint32(80, nt, true);
  let o = 84;
  for (const { positions: P, indices: I } of parts)
    for (let t = 0; t < I.length; t += 3) {
      const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      dv.setFloat32(o, nx, true);
      dv.setFloat32(o + 4, ny, true);
      dv.setFloat32(o + 8, nz, true);
      o += 12;
      for (const k of [a, b, c]) {
        dv.setFloat32(o, P[k], true);
        dv.setFloat32(o + 4, P[k + 1], true);
        dv.setFloat32(o + 8, P[k + 2], true);
        o += 12;
      }
      o += 2;
    }
  return u8;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface ThreeMfOptions {
  title: string;
  description: string;
  colors: Partial<Record<PartName, string>>;
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** 'components': one object per part grouped by a parent; 'single': one mesh, parts as triangle ranges */
  layout?: 'components' | 'single';
  /** plate size in mm; the model is placed in its middle */
  plate?: [number, number];
  /** the app's settings as JSON (`settingsJson`), stored as `Metadata/gpx3dp.json` so the file can be dropped back on the app */
  settings?: string;
}

/** where the settings live inside a 3MF, and inside the STL zip */
export const SETTINGS_FILE_3MF = 'Metadata/gpx3dp.json';
export const SETTINGS_FILE_ZIP = 'GPX3DP_settings.json';

/**
 * 3MF with one object whose components are the parts. Bambu Studio / Orca ignore 3MF object names
 * for parts, so `Metadata/model_settings.config` names them and gives each part its own filament slot.
 * The file does not claim to be a Bambu project (that makes Bambu expect a full project).
 */
export function to3mf(parts: Part[], opt: ThreeMfOptions): Uint8Array {
  const chunks: Uint8Array[] = [];
  let err: Error | null = null;
  const zip = new Zip((e, data) => {
    if (e) err = e;
    else chunks.push(data);
  });
  const enc = new TextEncoder();
  const small = (name: string, text: string) => {
    const f = new ZipPassThrough(name);
    zip.add(f);
    f.push(enc.encode(text), true);
  };

  small(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
      '<Default Extension="config" ContentType="text/xml"/>' +
      '<Default Extension="json" ContentType="application/json"/></Types>',
  );
  small(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
  );

  const model = new ZipDeflate('3D/3dmodel.model', { level: opt.level ?? 4 });
  zip.add(model);
  let pending = '';
  const write = (s: string, final = false) => {
    pending += s;
    if (pending.length > 1 << 20 || final) {
      model.push(enc.encode(pending), final);
      pending = '';
    }
  };

  const date = new Date().toISOString().slice(0, 10);
  write(
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"' +
      (opt.layout === 'single'
        ? ' xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"><metadata name="slic3rpe:Version3mf">1</metadata>'
        : '>') +
      `<metadata name="Title">${esc(opt.title)}</metadata>` +
      `<metadata name="Application">GPX3DP</metadata>` +
      `<metadata name="CreationDate">${date}</metadata>` +
      `<metadata name="Description">${esc(opt.description)}</metadata>` +
      '<resources><basematerials id="100">' +
      parts.map((p) => `<base name="${p.name}" displaycolor="${opt.colors[p.name] ?? '#CCCCCC'}"/>`).join('') +
      '</basematerials>',
  );
  const writeVertices = (P: Float32Array) => {
    let s = '';
    for (let i = 0; i < P.length; i += 3) {
      s += `<vertex x="${+P[i].toFixed(4)}" y="${+P[i + 1].toFixed(4)}" z="${+P[i + 2].toFixed(4)}"/>`;
      if (s.length > 1 << 19) write(s), (s = '');
    }
    write(s);
  };
  const writeTriangles = (I: Uint32Array, offset: number, attr = '') => {
    let s = '';
    for (let t = 0; t < I.length; t += 3) {
      s += `<triangle v1="${I[t] + offset}" v2="${I[t + 1] + offset}" v3="${I[t + 2] + offset}"${attr}/>`;
      if (s.length > 1 << 19) write(s), (s = '');
    }
    write(s);
  };

  const single = opt.layout === 'single';
  const asm = single ? 1 : parts.length + 1;
  const slot = filamentSlots(parts, opt.colors);
  let item = '';
  if (opt.plate) {
    let mx = 0, my = 0;
    for (const p of parts)
      for (let i = 0; i < p.positions.length; i += 3) (mx = Math.max(mx, p.positions[i])), (my = Math.max(my, p.positions[i + 1]));
    const tx = (opt.plate[0] - mx) / 2, ty = (opt.plate[1] - my) / 2;
    item = ` transform="1 0 0 0 1 0 0 0 1 ${+tx.toFixed(3)} ${+ty.toFixed(3)} 0"`;
  }
  /** first and last triangle of each part in the single mesh */
  const ranges: [number, number][] = [];
  if (single) {
    write(`<object id="1" name="${esc(opt.title)}" type="model" pid="100" pindex="0"><mesh><vertices>`);
    for (const p of parts) writeVertices(p.positions);
    write('</vertices><triangles>');
    let vo = 0, to = 0;
    parts.forEach((p, k) => {
      writeTriangles(p.indices, vo, k ? ` pid="100" p1="${k}"` : '');
      ranges.push([to, to + p.indices.length / 3 - 1]);
      vo += p.positions.length / 3;
      to += p.indices.length / 3;
    });
    write(`</triangles></mesh></object></resources><build><item objectid="1"${item}/></build></model>`, true);
  } else {
    parts.forEach((p, k) => {
      write(`<object id="${k + 1}" name="${PART_LABELS[p.name]}" type="model" pid="100" pindex="${k}"><mesh><vertices>`);
      writeVertices(p.positions);
      write('</vertices><triangles>');
      writeTriangles(p.indices, 0);
      write('</triangles></mesh></object>');
    });
    write(
      `<object id="${asm}" name="${esc(opt.title)}" type="model"><components>` +
        parts.map((_, k) => `<component objectid="${k + 1}"/>`).join('') +
        `</components></object></resources><build><item objectid="${asm}"${item}/></build></model>`,
      true,
    );
  }

  if (single)
    small(
      'Metadata/Slic3r_PE_model.config',
      '<?xml version="1.0" encoding="UTF-8"?><config><object id="1" instances_count="1">' +
        `<metadata type="object" key="name" value="${esc(opt.title)}"/>` +
        parts
          .map(
            (p, k) =>
              `<volume firstid="${ranges[k][0]}" lastid="${ranges[k][1]}">` +
              `<metadata type="volume" key="name" value="${PART_LABELS[p.name]}"/>` +
              '<metadata type="volume" key="volume_type" value="ModelPart"/>' +
              `<metadata type="volume" key="extruder" value="${slot[k]}"/></volume>`,
          )
          .join('') +
        '</object></config>',
    );

  // Color parts print solid: a color boundary counts as internal, so sparse infill would show through.
  const solid = '<metadata key="sparse_infill_density" value="100%"/>';
  small(
    'Metadata/model_settings.config',
    '<?xml version="1.0" encoding="UTF-8"?><config>' +
      `<object id="${asm}"><metadata key="name" value="${esc(opt.title)}"/><metadata key="extruder" value="1"/>` +
      parts
        .map(
          (p, k) =>
            `<part id="${k + 1}" subtype="normal_part"><metadata key="name" value="${PART_LABELS[p.name]}"/>` +
            `<metadata key="extruder" value="${slot[k]}"/>${p.name === 'terrain' ? '' : solid}</part>`,
        )
        .join('') +
      '</object></config>',
  );
  if (opt.settings) small(SETTINGS_FILE_3MF, opt.settings);
  zip.end();
  if (err) throw err;
  const len = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) out.set(c, o), (o += c.length);
  return out;
}
