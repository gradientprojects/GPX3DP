import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { printSuffix, to3mf, toStl } from '../src/core/export';
import { buildModel, DEFAULT_MODEL } from '../src/core/model';
import { validateMesh } from '../src/core/validate';

function sample() {
  const W = 40, H = 30;
  const E = new Float32Array((W + 1) * (H + 1)).map((_, i) => 500 + 50 * Math.sin(i / 9));
  return buildModel(
    {
      W,
      H,
      cellMm: 0.25,
      elevation: E,
      mmPerGroundM: 0.01,
      routeLines: [Float64Array.from([1, 1, 5, 4, 9, 6])],
      markers: [{ xMm: 1, yMm: 1, kind: 'start' }],
    },
    { ...DEFAULT_MODEL, routeOwnColor: true, markerColor: 'own', waterSurface: 'off' },
  ).parts;
}

/** Re-read a 3MF's meshes so the validator can run on exactly what was written. */
function parse3mf(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  const xml = strFromU8(files['3D/3dmodel.model']);
  const objects = [...xml.matchAll(/<object id="(\d+)" name="([^"]+)"[^>]*><mesh>([\s\S]*?)<\/mesh>/g)].map((m) => {
    const v = [...m[3].matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].flatMap((x) => [+x[1], +x[2], +x[3]]);
    const t = [...m[3].matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"[^>]*\/>/g)].flatMap((x) => [+x[1], +x[2], +x[3]]);
    return { id: m[1], name: m[2], positions: Float32Array.from(v), indices: Uint32Array.from(t) };
  });
  return { files, xml, objects };
}

describe('3MF', () => {
  it('writes named parts with Bambu settings and valid meshes', () => {
    const parts = sample();
    const bytes = to3mf(parts, { title: 'Test ride', description: 'attribution', colors: { route: '#D02020' } });
    const { files, xml, objects } = parse3mf(bytes);
    expect(Object.keys(files).sort()).toEqual(
      ['3D/3dmodel.model', 'Metadata/model_settings.config', '[Content_Types].xml', '_rels/.rels'].sort(),
    );
    expect(objects.map((o) => o.name)).toEqual(['terrain', 'route', 'markers']);
    expect(xml).toContain('<components><component objectid="1"/><component objectid="2"/><component objectid="3"/></components>');
    expect(xml).toContain('<build><item objectid="4"/></build>');
    const placed = strFromU8(unzipSync(to3mf(parts, { title: 'T', description: '', colors: {}, plate: [256, 256] }))['3D/3dmodel.model']);
    expect(placed).toMatch(/<item objectid="4" transform="1 0 0 0 1 0 0 0 1 [\d.]+ [\d.]+ 0"\/>/);
    const cfg = strFromU8(files['Metadata/model_settings.config']);
    expect(cfg).toContain('<object id="4">');
    expect(cfg).toMatch(/<part id="2" subtype="normal_part"><metadata key="name" value="route"\/><metadata key="extruder" value="2"\/>/);
    for (const o of objects) expect({ name: o.name, ...validateMesh(o.positions, o.indices) }).toMatchObject({ ok: true });
  });
});

describe('3MF, PrusaSlicer layout', () => {
  it('writes one mesh with named volumes by triangle range', () => {
    const parts = sample();
    const bytes = to3mf(parts, { title: 'T', description: '', colors: {}, layout: 'single' });
    const { files, xml, objects } = parse3mf(bytes);
    expect(xml).toContain('<metadata name="slic3rpe:Version3mf">1</metadata>');
    expect(objects.length).toBe(1);
    const cfg = strFromU8(files['Metadata/Slic3r_PE_model.config']);
    const vols = [...cfg.matchAll(/<volume firstid="(\d+)" lastid="(\d+)"><metadata type="volume" key="name" value="(\w+)"/g)];
    expect(vols.map((v) => v[3])).toEqual(['terrain', 'route', 'markers']);
    let next = 0;
    for (const [i, p] of parts.entries()) {
      expect(+vols[i][1]).toBe(next);
      next += p.indices.length / 3;
      expect(+vols[i][2]).toBe(next - 1);
    }
    expect(objects[0].indices.length / 3).toBe(next);
  });
});

describe('STL', () => {
  it('writes the right triangle count', () => {
    const parts = sample();
    const stl = toStl(parts);
    const n = new DataView(stl.buffer).getUint32(80, true);
    expect(n).toBe(parts.reduce((s, p) => s + p.indices.length / 3, 0));
    expect(stl.length).toBe(84 + n * 50);
  });
});

describe('printSuffix', () => {
  it('names the nozzle and layer height with p for the decimal point', () => {
    expect(printSuffix(0.4, 0.16)).toBe('_0p4N_0p16L');
    expect(printSuffix(0.6, 0.2)).toBe('_0p6N_0p2L');
    expect(printSuffix(0.4, 0.12000000000000001)).toBe('_0p4N_0p12L');
    expect(printSuffix(1, 0.3)).toBe('_1N_0p3L');
  });
});
