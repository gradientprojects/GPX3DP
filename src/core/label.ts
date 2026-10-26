import type { Font } from 'opentype.js';
import { fillRings } from './raster';

export type LabelAlign = 'auto' | 'left' | 'center' | 'right';
export type LabelEdgeX = 'left' | 'center' | 'right';
export type LabelEdgeY = 'bottom' | 'middle' | 'top';

/**
 * Placement is per axis, seen from below: an edge and an offset in mm. For left / right / bottom / top the
 * offset is the gap between that print edge and the same side of the text box; for center / middle it is
 * the box center's offset from the print's center line (+ = right / up).
 */
export interface LabelSpec {
  lines: string[];
  /** cap height in mm */
  sizeMm: number;
  edgeX: LabelEdgeX;
  offX: number;
  edgeY: LabelEdgeY;
  offY: number;
  /** line alignment within the block; auto follows edgeX */
  align: LabelAlign;
  /** cap height per line, by index into `lines`; 0 or missing means `sizeMm` (the stats and exaggeration lines have their own) */
  lineSizes?: number[];
}

/**
 * Icons the label can carry, as characters in the private-use area. Each is a filled polygon in cap-height
 * units (u right, v up, baseline at v = 0, drawn from the SVG mock-ups Kiran chose: 1 unit = 32 px there), so
 * it scales with the line like a glyph and goes through the same print check.
 */
export const ICON_DISTANCE = '\uE000', ICON_CLIMB = '\uE001';
const iconPoly = (svg: number[]) => svg.map((v, i) => (i % 2 ? (48 - v) / 32 : v / 32));
export const ICONS: Record<string, { points: number[]; advance: number }> = {
  // a stout right arrow
  [ICON_DISTANCE]: { points: iconPoly([0, 22, 40, 22, 40, 8, 66, 30, 40, 52, 40, 38, 0, 38]), advance: 66 / 32 + 0.3 },
  // twin peaks
  [ICON_CLIMB]: { points: iconPoly([0, 52, 22, 8, 34, 30, 44, 16, 66, 52]), advance: 66 / 32 + 0.3 },
};

/** runs of text and single icons, so a line can mix both */
function runs(text: string): { text: string; icon?: false }[] | { text: string; icon: true }[] {
  const out: { text: string; icon: boolean }[] = [];
  for (const ch of Array.from(text)) {
    if (ICONS[ch]) out.push({ text: ch, icon: true });
    else if (out.length && !out[out.length - 1].icon) out[out.length - 1].text += ch;
    else out.push({ text: ch, icon: false });
  }
  return out as { text: string; icon: true }[];
}

/** advance width of a line at cap height `sizeMm`, icons included */
function lineAdvance(font: Font, text: string, sizeMm: number, capEm: number): number {
  let w = 0;
  for (const r of runs(text)) w += r.icon ? ICONS[r.text].advance * sizeMm : font.getAdvanceWidth(r.text, sizeMm / capEm, { kerning: true });
  return w;
}

/** glyph and icon outlines of a line, as rings in block coordinates (u right, v up from `base`) */
function lineRings(font: Font, text: string, sizeMm: number, capEm: number, off: number, base: number): number[][][] {
  const out: number[][][] = [];
  let x = off;
  for (const r of runs(text)) {
    if (r.icon) {
      const ic = ICONS[r.text];
      out.push([ic.points.map((v, i) => (i % 2 ? base + v * sizeMm : x + v * sizeMm))]);
      x += ic.advance * sizeMm;
      continue;
    }
    font.forEachGlyph(r.text, x, 0, sizeMm / capEm, { kerning: true }, (g, gx, gy, gs) => {
      const rings = flatten(g.getPath(gx, gy, gs).commands, base);
      if (rings.length) out.push(rings);
    });
    x += font.getAdvanceWidth(r.text, sizeMm / capEm, { kerning: true });
  }
  return out;
}

/** print-check limits for a clean deboss, in nozzle widths */
export const GOOD_GROOVE_NOZZLES = 1.5;
export const GOOD_WALL_NOZZLES = 1.75;

/** Box (model mm, x0 y0 x1 y1) to the placement it is nearest to on each axis, seen from below. */
export function snapPlacement(box: [number, number, number, number], widthMm: number, heightMm: number, snapMm = 3) {
  // reading coordinates: seen from below, x is mirrored
  const l = widthMm - box[2], r = box[0], b = box[1], t = heightMm - box[3];
  const cx = (widthMm - box[2] + widthMm - box[0]) / 2 - widthMm / 2, cy = (box[1] + box[3]) / 2 - heightMm / 2;
  const q = (v: number) => Math.max(0, Math.round(v * 2) / 2);
  const x: { edgeX: LabelEdgeX; offX: number } = Math.abs(cx) < snapMm ? { edgeX: 'center', offX: 0 } : l <= r ? { edgeX: 'left', offX: q(l) } : { edgeX: 'right', offX: q(r) };
  const y: { edgeY: LabelEdgeY; offY: number } = Math.abs(cy) < snapMm ? { edgeY: 'middle', offY: 0 } : b <= t ? { edgeY: 'bottom', offY: q(b) } : { edgeY: 'top', offY: q(t) };
  return { ...x, ...y };
}

export interface LabelGeom {
  /** closed rings in model mm, ink on the left: CCW around letters, CW around the islands inside them */
  rings: Float64Array[];
  /** every ring point is exactly (ox + i * step, oy + j * step) for integers i, j: lets the mesh triangulate exactly */
  grid: { ox: number; oy: number; step: number };
  /** the text's box in model mm: x0 y0 x1 y1 */
  box: [number, number, number, number];
  /** the block didn't fit inside the margin and was scaled down */
  shrunk: boolean;
  /** characters the font doesn't have (emoji etc.), left out */
  dropped: string[];
  /** thinnest letter stroke (a groove in the print), mm */
  strokeMm: number;
  /** thinnest plastic between strokes or inside counters, mm; null when there is none (e.g. "I") */
  wallMm: number | null;
  /** cap height of each line before any shrink to fit, mm */
  lineMm: number[];
  /** widths unshrunk, for rating other sizes (`labelWidthsAt`) and for saying which line is the problem */
  scaling: {
    sizeMm: number;
    /** the whole label's widths as measured, at sizeMm (undoing any shrink) */
    built: Widths;
    /** the lines at the main size */
    main: Widths;
    /** every kept line alone: its index in `spec.lines`, its cap height and its widths */
    lines: (Widths & { k: number; sizeMm: number })[];
  };
}

/** bitmap resolution for tracing, mm */
const PX = 0.05;
const LINE_SPACING = 1.6;

/**
 * Lay out text lines for the underside of a print `widthMm` x `heightMm` and trace them into clean rings.
 * Positions are given as seen from below; the result is mirrored left to right so the text reads
 * correctly when the print is turned over. The block stays `marginMm` inside the edges (shrunk if needed).
 */
export function layoutLabel(font: Font, spec: LabelSpec, widthMm: number, heightMm: number, marginMm = 3, measureLines = true): LabelGeom | null {
  const dropped = new Set<string>();
  const kept = spec.lines
    .map((l, k) => ({
      k,
      text: Array.from(l)
        .filter((ch) => {
          const ok = /\s/.test(ch) || !!ICONS[ch] || font.charToGlyphIndex(ch) > 0;
          if (!ok && !/[‍︎️]/.test(ch)) dropped.add(ch);
          return ok;
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim(),
    }))
    .filter((l) => l.text);
  if (!kept.length || spec.sizeMm <= 0) return null;
  const lines = kept.map((l) => l.text);
  const capEm = (font.tables.os2?.sCapHeight || 0.7 * font.unitsPerEm) / font.unitsPerEm;
  // each line's cap height, and each line's widths alone (so the UI can name the line that prints too fine)
  const lineMm = kept.map((l) => Math.max(0.5, spec.lineSizes?.[l.k] || spec.sizeMm));
  // (not when this layout is itself a measurement of one line: that would never end)
  const perLine = measureLines ? kept.map((l, i) => ({ k: l.k, sizeMm: lineMm[i], ...lineWidths(font, l.text, lineMm[i]) })) : [];

  // glyph outlines at size, in block coordinates: u right, v up, first baseline at v = 0
  const widths = lines.map((l, k) => lineAdvance(font, l, lineMm[k], capEm));
  const blockW = Math.max(...widths);
  const glyphs: number[][][] = [];
  const align = spec.align === 'auto' ? spec.edgeX : spec.align;
  let base = 0;
  lines.forEach((line, k) => {
    // room below the line above (descenders and gap) plus this line's cap height: 1.6 x size when equal
    if (k) base -= (LINE_SPACING - 1) * lineMm[k - 1] + lineMm[k];
    const off = align === 'left' ? 0 : align === 'center' ? (blockW - widths[k]) / 2 : blockW - widths[k];
    glyphs.push(...lineRings(font, line, lineMm[k], capEm, off, base));
  });
  if (!glyphs.length) return null;

  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const g of glyphs)
    for (const r of g)
      for (let i = 0; i < r.length; i += 2) {
        u0 = Math.min(u0, r[i]), u1 = Math.max(u1, r[i]);
        v0 = Math.min(v0, r[i + 1]), v1 = Math.max(v1, r[i + 1]);
      }
  // fit inside the margin
  const availW = widthMm - 2 * marginMm, availH = heightMm - 2 * marginMm;
  if (availW <= 0 || availH <= 0) return null;
  const s = Math.min(1, availW / (u1 - u0), availH / (v1 - v0));
  const bw = (u1 - u0) * s, bh = (v1 - v0) * s;
  // box placement seen from below, from the chosen edge on each axis
  let left = spec.edgeX === 'left' ? spec.offX : spec.edgeX === 'right' ? widthMm - spec.offX - bw : (widthMm - bw) / 2 + spec.offX;
  let bottom = spec.edgeY === 'bottom' ? spec.offY : spec.edgeY === 'top' ? heightMm - spec.offY - bh : (heightMm - bh) / 2 + spec.offY;
  left = Math.min(widthMm - marginMm - bw, Math.max(marginMm, left));
  bottom = Math.min(heightMm - marginMm - bh, Math.max(marginMm, bottom));

  // to model coordinates, mirrored: seen from below, +u is -x
  const toX = (u: number) => widthMm - (left + (u - u0) * s);
  const toY = (v: number) => bottom + (v - v0) * s;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const model = glyphs.map((g) =>
    g.map((r) => {
      const out = new Float64Array(r.length);
      for (let i = 0; i < r.length; i += 2) {
        out[i] = toX(r[i]);
        out[i + 1] = toY(r[i + 1]);
        x0 = Math.min(x0, out[i]), x1 = Math.max(x1, out[i]);
        y0 = Math.min(y0, out[i + 1]), y1 = Math.max(y1, out[i + 1]);
      }
      return out;
    }),
  );

  // rasterize each glyph (even-odd) into one bitmap, OR'ed, so touching letters merge cleanly
  const pad = 2;
  const ox = x0 - pad * PX, oy = y0 - pad * PX;
  const NX = Math.ceil((x1 - x0) / PX) + 2 * pad, NY = Math.ceil((y1 - y0) / PX) + 2 * pad;
  const mask = new Uint8Array(NX * NY);
  for (const g of model) {
    const px = g.map((r) => {
      const o = new Float64Array(r.length);
      for (let i = 0; i < r.length; i += 2) (o[i] = (r[i] - ox) / PX), (o[i + 1] = (r[i + 1] - oy) / PX);
      return o;
    });
    fillRings(mask, NX, NY, px);
  }
  // traced points are on half pixels, so on the grid ox + n * PX / 2
  const rings = traceRings(mask, NX, NY).map((r) => {
    const o = new Float64Array(r.length);
    for (let i = 0; i < r.length; i += 2) (o[i] = ox + r[i] * PX), (o[i + 1] = oy + r[i + 1] * PX);
    return o;
  });
  const box: [number, number, number, number] = [widthMm - left - bw, bottom, widthMm - left, bottom + bh];
  const stroke = thinnestPx(mask, NX, NY, 1, Infinity);
  const wall = thinnestPx(mask, NX, NY, 0, WALL_MAX_MM / PX);
  const strokeMm = (stroke ?? 0) * PX, wallMm = wall === null ? null : wall * PX;
  const mainLines = kept.filter((_l, i) => lineMm[i] === spec.sizeMm).map((l) => l.text);
  let main = { strokeMm, wallMm };
  if (mainLines.length && (s < 1 || mainLines.length < lines.length)) {
    const m = layoutLabel(font, { ...spec, lines: mainLines, lineSizes: undefined }, 1e4, 1e4, 0, false);
    if (m) main = { strokeMm: m.strokeMm, wallMm: m.wallMm };
  }
  return {
    rings,
    grid: { ox, oy, step: PX / 2 },
    box,
    shrunk: s < 1,
    dropped: [...dropped],
    strokeMm,
    wallMm,
    lineMm,
    scaling: { sizeMm: spec.sizeMm, built: scaled({ strokeMm, wallMm }, 1 / s), main, lines: perLine },
  };
}

interface Widths {
  strokeMm: number;
  wallMm: number | null;
}

/** thinnest stroke and wall (mm) of one line laid out alone at sizeMm, unshrunk */
function lineWidths(font: Font, text: string, sizeMm: number): Widths {
  const g = layoutLabel(font, { lines: [text], sizeMm, edgeX: 'center', offX: 0, edgeY: 'middle', offY: 0, align: 'left' }, 1e4, 1e4, 0, false);
  return { strokeMm: g?.strokeMm ?? 0, wallMm: g?.wallMm ?? null };
}

const scaled = (w: Widths, f: number): Widths => ({ strokeMm: w.strokeMm * f, wallMm: w.wallMm === null ? null : w.wallMm * f });

/**
 * Thinnest stroke and wall of the label if its main size were `sizeMm` (before any shrink to fit): the 3D
 * drag scales every line in the same proportion, so the built widths scale with it. Lets the UI rate a new
 * size while dragging, without rebuilding.
 */
export function labelWidthsAt(sc: LabelGeom['scaling'], sizeMm: number): Widths {
  return scaled(sc.built, sizeMm / sc.sizeMm);
}

/** wider gaps than this between strokes are open space, not walls */
const WALL_MAX_MM = 2;

/**
 * Thinnest width (pixels) of the `ink` (1) or gap (0) regions, by area: the local thickness of a pixel is the
 * widest disk inside the region that covers it. A 3-4 chamfer distance transform gives the disks at its
 * ridge (pixels at least as far from the edge as all 8 neighbours); width is 2d - 1, since d counts from
 * the pixel center to the nearest other pixel's center. The result is the 5th percentile over the area, so
 * sharp notches and stroke tips (tiny disks covering little) don't count. Gaps count only up to `maxPx`
 * wide (wider is open space), and only between ink: outside the bitmap is unknown, so no ridge touches it.
 */
export function thinnestPx(mask: Uint8Array, NX: number, NY: number, ink: 0 | 1, maxPx: number): number | null {
  const INF = 1e9;
  const d = new Float64Array(NX * NY);
  for (let k = 0; k < d.length; k++) d[k] = mask[k] === ink ? INF : 0;
  // outside the bitmap: background for strokes (distance 0), unknown for gaps (ignored)
  const out = ink ? 0 : INF;
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= NX || j >= NY ? out : d[j * NX + i]);
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      if (d[k]) d[k] = Math.min(d[k], at(i - 1, j) + 3, at(i, j - 1) + 3, at(i - 1, j - 1) + 4, at(i + 1, j - 1) + 4);
    }
  for (let j = NY - 1; j >= 0; j--)
    for (let i = NX - 1; i >= 0; i--) {
      const k = j * NX + i;
      if (d[k]) d[k] = Math.min(d[k], at(i + 1, j) + 3, at(i, j + 1) + 3, at(i + 1, j + 1) + 4, at(i - 1, j + 1) + 4);
    }
  // paint each ridge disk; disks wider than maxPx only need painting out to maxPx (their pixels don't count)
  const thick = new Float32Array(NX * NY);
  const cap = Math.min(maxPx, Math.max(NX, NY)) / 2 + 1;
  for (let j = 1; j < NY - 1; j++)
    for (let i = 1; i < NX - 1; i++) {
      const v = d[j * NX + i];
      if (!v || v >= INF) continue;
      let max = true;
      for (let dj = -1; dj <= 1 && max; dj++)
        for (let di = -1; di <= 1; di++)
          if (d[(j + dj) * NX + i + di] > v) {
            max = false;
            break;
          }
      if (!max) continue;
      const r = v / 3 - 0.5, w = 2 * r, rr = Math.min(r, cap), r2 = rr * rr, n = Math.floor(rr);
      for (let dj = -n; dj <= n; dj++)
        for (let di = -n; di <= n; di++) {
          if (di * di + dj * dj > r2) continue;
          const x = i + di, y = j + dj;
          if (x < 0 || y < 0 || x >= NX || y >= NY) continue;
          const k = y * NX + x;
          if (mask[k] === ink && thick[k] < w) thick[k] = w;
        }
    }
  const vals: number[] = [];
  for (let k = 0; k < thick.length; k++) if (thick[k] && thick[k] <= maxPx) vals.push(thick[k]);
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  // ignore specks: a region needs a few pixels of area to be a stroke or wall
  if (vals.length < 20) return null;
  return vals[Math.floor(0.05 * (vals.length - 1))];
}

type Cmd = { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number };

/** opentype path (y down, baseline 0) to polylines (y up), curves flattened to about 0.05 mm. */
function flatten(cmds: Cmd[], base: number): number[][] {
  const rings: number[][] = [];
  let cur: number[] = [];
  let px = 0, py = 0;
  const add = (x: number, y: number) => cur.push(x, base - y);
  const steps = (len: number) => Math.min(32, Math.max(2, Math.ceil(len / 0.05)));
  const close = () => {
    if (cur.length >= 6) rings.push(cur);
    cur = [];
  };
  for (const c of cmds) {
    if (c.type === 'M') {
      close();
      add((px = c.x!), (py = c.y!));
    } else if (c.type === 'L') add((px = c.x!), (py = c.y!));
    else if (c.type === 'Q') {
      const n = steps(Math.hypot(c.x! - px, c.y! - py) + Math.hypot(c.x1! - px, c.y1! - py));
      for (let k = 1; k <= n; k++) {
        const t = k / n, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), d = t * t;
        add(a * px + b * c.x1! + d * c.x!, a * py + b * c.y1! + d * c.y!);
      }
      (px = c.x!), (py = c.y!);
    } else if (c.type === 'C') {
      const n = steps(Math.hypot(c.x1! - px, c.y1! - py) + Math.hypot(c.x2! - c.x1!, c.y2! - c.y1!) + Math.hypot(c.x! - c.x2!, c.y! - c.y2!));
      for (let k = 1; k <= n; k++) {
        const t = k / n, m = 1 - t;
        const a = m * m * m, b = 3 * m * m * t, e = 3 * m * t * t, d = t * t * t;
        add(a * px + b * c.x1! + e * c.x2! + d * c.x!, a * py + b * c.y1! + e * c.y2! + d * c.y!);
      }
      (px = c.x!), (py = c.y!);
    } else if (c.type === 'Z') close();
  }
  close();
  return rings;
}

/**
 * Marching squares over pixel centers. Each crossing sits on the edge between two pixel centers and belongs
 * to exactly one ring, so rings never touch. Rings keep the ink on their left; saddles keep ink apart.
 * Coordinates are in pixel units (pixel i spans [i, i+1]); exactly collinear points are dropped.
 */
export function traceRings(mask: Uint8Array, NX: number, NY: number): Float64Array[] {
  const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < NX && j < NY ? mask[j * NX + i] : 0);
  // crossing ids: horizontal edge (i,j)-(i+1,j) = 2*(j*NX+i), vertical edge (i,j)-(i,j+1) = 2*(j*NX+i)+1
  const next = new Map<number, number>();
  const e = [0, 0, 0, 0];
  const state = [0, 0, 0, 0];
  for (let j = -1; j < NY; j++)
    for (let i = -1; i < NX; i++) {
      // corners CCW from SW: (i,j) (i+1,j) (i+1,j+1) (i,j+1); edges CCW: S E N W
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      if (a === b && b === c && c === d) continue;
      const corner = [a, b, c, d];
      e[0] = 2 * ((j + 1) * (NX + 2) + (i + 1)); // S: (i,j)-(i+1,j)
      e[1] = 2 * ((j + 1) * (NX + 2) + (i + 2)) + 1; // E: (i+1,j)-(i+1,j+1)
      e[2] = 2 * ((j + 2) * (NX + 2) + (i + 1)); // N: (i,j+1)-(i+1,j+1)
      e[3] = 2 * ((j + 1) * (NX + 2) + (i + 1)) + 1; // W: (i,j)-(i,j+1)
      // walking the cell CCW, edge k goes corner k -> corner k+1: 1 = exit (ink to no ink), 2 = entry
      for (let k = 0; k < 4; k++) {
        const p = corner[k], q = corner[(k + 1) % 4];
        state[k] = p && !q ? 1 : !p && q ? 2 : 0;
      }
      for (let k = 0; k < 4; k++) {
        if (state[k] !== 1) continue;
        let m = (k + 3) % 4;
        while (state[m] !== 2) m = (m + 3) % 4;
        next.set(e[k], e[m]);
      }
    }
  // positions in doubled pixel units (exact integers), on the padded index space
  const pos = (id: number): [number, number] => {
    const vert = id & 1, k = id >> 1, ii = (k % (NX + 2)) - 1, jj = Math.floor(k / (NX + 2)) - 1;
    // sample (i,j) is the center of pixel i: (2i+1, 2j+1) in doubled units
    return vert ? [2 * ii + 1, 2 * jj + 2] : [2 * ii + 2, 2 * jj + 1];
  };
  const rings: Float64Array[] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const pts: [number, number][] = [];
    let id = start;
    do {
      seen.add(id);
      pts.push(pos(id));
      id = next.get(id)!;
    } while (id !== start);
    const kept: [number, number][] = [];
    const n = pts.length;
    for (let k = 0; k < n; k++) {
      const p = pts[(k + n - 1) % n], q = pts[k], r = pts[(k + 1) % n];
      if ((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]) !== 0) kept.push(q);
    }
    if (kept.length < 3) continue;
    const out = new Float64Array(kept.length * 2);
    kept.forEach(([x, y], k) => ((out[2 * k] = x / 2), (out[2 * k + 1] = y / 2)));
    rings.push(out);
  }
  return rings;
}

/** Signed area (positive = CCW). */
export function ringArea(r: Float64Array): number {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += r[2 * j] * r[2 * i + 1] - r[2 * i] * r[2 * j + 1];
  return a / 2;
}

/** Even-odd point in ring. */
export function inRing(r: Float64Array, x: number, y: number): boolean {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
