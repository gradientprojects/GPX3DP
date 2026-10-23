export interface MeshReport {
  ok: boolean;
  triangles: number;
  /** edges used by one triangle only */
  openEdges: number;
  /** edges used by more than two triangles */
  nonManifoldEdges: number;
  /** edges whose two triangles traverse it in the same direction (inconsistent winding) */
  flippedEdges: number;
  degenerate: number;
  /** mm^3; positive when normals face outward */
  volume: number;
}

/**
 * Closed 2-manifold check: every undirected edge is used by exactly two triangles, once in each
 * direction; no zero-area triangles; positive signed volume (outward normals).
 */
export function validateMesh(positions: Float32Array, indices: Uint32Array): MeshReport {
  const nt = indices.length / 3;
  const nv = positions.length / 3;
  const keys = new Float64Array(nt * 3);
  let degenerate = 0;
  let vol = 0;
  for (let t = 0; t < nt; t++) {
    const a = indices[3 * t], b = indices[3 * t + 1], c = indices[3 * t + 2];
    const ax = positions[3 * a], ay = positions[3 * a + 1], az = positions[3 * a + 2];
    const bx = positions[3 * b] - ax, by = positions[3 * b + 1] - ay, bz = positions[3 * b + 2] - az;
    const cx = positions[3 * c] - ax, cy = positions[3 * c + 1] - ay, cz = positions[3 * c + 2] - az;
    const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
    if (a === b || b === c || a === c || nx * nx + ny * ny + nz * nz < 1e-14) degenerate++;
    // signed tetra volume against origin, written relative to a for precision
    vol += (ax * nx + ay * ny + az * nz) / 6;
    const e = [a, b, b, c, c, a];
    for (let k = 0; k < 3; k++) {
      const u = e[2 * k], w = e[2 * k + 1];
      keys[3 * t + k] = (u < w ? u * nv + w : w * nv + u) * 2 + (u < w ? 0 : 1);
    }
  }
  keys.sort();
  let openEdges = 0, nonManifoldEdges = 0, flippedEdges = 0;
  let i = 0;
  while (i < keys.length) {
    const edge = Math.floor(keys[i] / 2);
    let j = i;
    let fwd = 0;
    while (j < keys.length && Math.floor(keys[j] / 2) === edge) fwd += keys[j++] % 2 === 0 ? 1 : 0;
    const n = j - i;
    if (n === 1) openEdges++;
    else if (n > 2) nonManifoldEdges++;
    else if (fwd !== 1) flippedEdges++;
    i = j;
  }
  return {
    ok: !openEdges && !nonManifoldEdges && !flippedEdges && !degenerate && vol > 0,
    triangles: nt,
    openEdges,
    nonManifoldEdges,
    flippedEdges,
    degenerate,
    volume: vol,
  };
}
