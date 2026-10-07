// Marching cubes on a binary mask, and the surface clean-up renalplan's mesh
// step does: keep the largest piece, Taubin smoothing, vertex normals.
//
// The 256-case triangle table is built when the module loads rather than
// typed in. On each cube face the crossing edges are joined in pairs, and on
// an ambiguous face (two inside corners diagonally opposite) the pairing that
// keeps the inside corners apart is always used. Neighbouring cubes see the
// same face the same way, so the surface is always closed, which the
// classic hand-typed table doesn't guarantee.

import type { Affine, Dims, Vec3 } from './volume.ts';
import { bboxOf, determinant3, edtSquared, spacingOf } from './volume.ts';

// Corners (x, y, z) and edges in the usual (Lorensen and Cline, Bourke) numbering.
const CORNERS: Array<[number, number, number]> = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
const EDGES: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [3, 2],
  [0, 3],
  [4, 5],
  [5, 6],
  [7, 6],
  [4, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];
// Each face's corners in order round the face.
const FACES: Array<[number, number, number, number]> = [
  [0, 1, 2, 3],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [3, 2, 6, 7],
  [0, 3, 7, 4],
  [1, 2, 6, 5],
];

function edgeBetween(a: number, b: number): number {
  return EDGES.findIndex(([p, q]) => (p === a && q === b) || (p === b && q === a));
}

function buildTable(): Int8Array[] {
  const table: Int8Array[] = [];
  for (let cube = 0; cube < 256; cube += 1) {
    const inside = (corner: number) => (cube >> corner) & 1;
    const links = new Map<number, number[]>();
    const link = (a: number, b: number) => {
      if (!links.has(a)) links.set(a, []);
      if (!links.has(b)) links.set(b, []);
      links.get(a)?.push(b);
      links.get(b)?.push(a);
    };
    for (const face of FACES) {
      const crossing: number[] = [];
      for (let s = 0; s < 4; s += 1) {
        const a = face[s];
        const b = face[(s + 1) % 4];
        if (inside(a) !== inside(b)) crossing.push(edgeBetween(a, b));
      }
      if (crossing.length === 2) {
        link(crossing[0], crossing[1]);
      } else if (crossing.length === 4) {
        // Ambiguous: cut off each inside corner on its own.
        for (let s = 0; s < 4; s += 1) {
          const corner = face[s];
          if (!inside(corner)) continue;
          const before = face[(s + 3) % 4];
          const after = face[(s + 1) % 4];
          link(edgeBetween(before, corner), edgeBetween(corner, after));
        }
      }
    }
    const triangles: number[] = [];
    const seen = new Set<number>();
    for (const start of links.keys()) {
      if (seen.has(start)) continue;
      const loop = [start];
      seen.add(start);
      let previous = -1;
      let current = start;
      for (;;) {
        const next = (links.get(current) ?? []).find((e) => e !== previous && !seen.has(e));
        if (next === undefined) break;
        loop.push(next);
        seen.add(next);
        previous = current;
        current = next;
      }
      // Wind the loop so its normal points from the inside corners outwards.
      const mid = loop.map((e) => {
        const [a, b] = EDGES[e];
        return CORNERS[a].map((value, axis) => (value + CORNERS[b][axis]) / 2);
      });
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let i = 0; i < mid.length; i += 1) {
        const p = mid[i];
        const q = mid[(i + 1) % mid.length];
        nx += (p[1] - q[1]) * (p[2] + q[2]);
        ny += (p[2] - q[2]) * (p[0] + q[0]);
        nz += (p[0] - q[0]) * (p[1] + q[1]);
      }
      let outward = 0;
      for (const e of loop) {
        const [a, b] = EDGES[e];
        const [from, to] = inside(a) ? [a, b] : [b, a];
        outward +=
          nx * (CORNERS[to][0] - CORNERS[from][0]) +
          ny * (CORNERS[to][1] - CORNERS[from][1]) +
          nz * (CORNERS[to][2] - CORNERS[from][2]);
      }
      if (outward < 0) loop.reverse();
      for (let i = 1; i + 1 < loop.length; i += 1) triangles.push(loop[0], loop[i], loop[i + 1]);
    }
    table.push(Int8Array.from(triangles));
  }
  return table;
}

export const TRIANGLE_TABLE: Int8Array[] = buildTable();

// Where each edge's vertex sits: lower corner offset and axis (0 x, 1 y, 2 z).
const EDGE_ORIGIN: Array<[number, number, number, number]> = EDGES.map(([a, b]) => {
  const pa = CORNERS[a];
  const pb = CORNERS[b];
  const axis = pa[0] !== pb[0] ? 0 : pa[1] !== pb[1] ? 1 : 2;
  const low = pa[axis] < pb[axis] ? pa : pb;
  return [low[0], low[1], low[2], axis];
});

export type Mesh = {
  positions: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
};

/**
 * Surface of a binary mask at level 0.5, in voxel-index coordinates. Voxels
 * beyond the grid count as empty, which pads the volume by one voxel so a
 * structure touching the edge still closes.
 */
export function marchingCubes(mask: Uint8Array, dims: Dims): Mesh {
  const [nx, ny, nz] = dims;
  const box = bboxOf(mask, dims);
  if (!box) return { positions: new Float32Array(0), indices: new Uint32Array(0) };
  const value = (x: number, y: number, z: number) =>
    x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? 0 : mask[x + nx * (y + ny * z)];
  const px = nx + 2;
  const py = ny + 2;
  const vertexOf = new Map<number, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  const corner = new Uint8Array(8);
  for (let z = box.lo[2] - 1; z < box.hi[2]; z += 1) {
    for (let y = box.lo[1] - 1; y < box.hi[1]; y += 1) {
      for (let x = box.lo[0] - 1; x < box.hi[0]; x += 1) {
        let cube = 0;
        for (let c = 0; c < 8; c += 1) {
          const [dx, dy, dz] = CORNERS[c];
          corner[c] = value(x + dx, y + dy, z + dz);
          cube |= corner[c] << c;
        }
        if (cube === 0 || cube === 255) continue;
        const triangles = TRIANGLE_TABLE[cube];
        for (let t = 0; t < triangles.length; t += 1) {
          const [ox, oy, oz, axis] = EDGE_ORIGIN[triangles[t]];
          const gx = x + ox;
          const gy = y + oy;
          const gz = z + oz;
          const key = (((gz + 1) * py + (gy + 1)) * px + (gx + 1)) * 3 + axis;
          let vertex = vertexOf.get(key);
          if (vertex === undefined) {
            vertex = positions.length / 3;
            vertexOf.set(key, vertex);
            positions.push(gx + (axis === 0 ? 0.5 : 0), gy + (axis === 1 ? 0.5 : 0), gz + (axis === 2 ? 0.5 : 0));
          }
          indices.push(vertex);
        }
      }
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

/** Unique vertex neighbours, in compressed rows. */
function neighbours(vertexCount: number, indices: Uint32Array): { start: Int32Array; list: Int32Array } {
  const seen = new Set<number>();
  const pairs: number[] = [];
  const add = (a: number, b: number) => {
    const key = a < b ? a * vertexCount + b : b * vertexCount + a;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push(a, b);
  };
  for (let t = 0; t < indices.length; t += 3) {
    add(indices[t], indices[t + 1]);
    add(indices[t + 1], indices[t + 2]);
    add(indices[t + 2], indices[t]);
  }
  const degree = new Int32Array(vertexCount + 1);
  for (let i = 0; i < pairs.length; i += 1) degree[pairs[i] + 1] += 1;
  for (let i = 0; i < vertexCount; i += 1) degree[i + 1] += degree[i];
  const fill = degree.slice(0, vertexCount);
  const list = new Int32Array(pairs.length);
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i];
    const b = pairs[i + 1];
    list[fill[a]++] = b;
    list[fill[b]++] = a;
  }
  return { start: degree, list };
}

/**
 * Taubin smoothing as trimesh.smoothing.filter_taubin does it: equal-weight
 * Laplacian, a lambda step on even iterations and a -nu step on odd ones.
 */
export function taubinSmooth(mesh: Mesh, iterations = 15, lambda = 0.5, nu = 0.53): Mesh {
  const positions = mesh.positions.slice();
  const count = positions.length / 3;
  if (count === 0 || iterations <= 0) return { ...mesh, positions };
  const { start, list } = neighbours(count, mesh.indices);
  const next = new Float32Array(positions.length);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const factor = iteration % 2 === 0 ? lambda : -nu;
    for (let v = 0; v < count; v += 1) {
      const from = start[v];
      const to = start[v + 1];
      const x = positions[3 * v];
      const y = positions[3 * v + 1];
      const z = positions[3 * v + 2];
      if (to === from) {
        next[3 * v] = x;
        next[3 * v + 1] = y;
        next[3 * v + 2] = z;
        continue;
      }
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let n = from; n < to; n += 1) {
        const u = list[n];
        sx += positions[3 * u];
        sy += positions[3 * u + 1];
        sz += positions[3 * u + 2];
      }
      const inv = 1 / (to - from);
      next[3 * v] = x + factor * (sx * inv - x);
      next[3 * v + 1] = y + factor * (sy * inv - y);
      next[3 * v + 2] = z + factor * (sz * inv - z);
    }
    positions.set(next);
  }
  return { ...mesh, positions };
}

function triangleArea(p: Float32Array, a: number, b: number, c: number): number {
  const ux = p[3 * b] - p[3 * a];
  const uy = p[3 * b + 1] - p[3 * a + 1];
  const uz = p[3 * b + 2] - p[3 * a + 2];
  const vx = p[3 * c] - p[3 * a];
  const vy = p[3 * c + 1] - p[3 * a + 1];
  const vz = p[3 * c + 2] - p[3 * a + 2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

/** The connected piece with the largest surface area, as trimesh's split does it. */
export function keepLargestPiece(mesh: Mesh): Mesh {
  const count = mesh.positions.length / 3;
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i += 1) parent[i] = i;
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const up = parent[i];
      parent[i] = root;
      i = up;
    }
    return root;
  };
  const { indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    const a = find(indices[t]);
    const b = find(indices[t + 1]);
    const c = find(indices[t + 2]);
    parent[b] = a;
    parent[find(c)] = a;
  }
  const area = new Map<number, number>();
  for (let t = 0; t < indices.length; t += 3) {
    const root = find(indices[t]);
    area.set(root, (area.get(root) ?? 0) + triangleArea(mesh.positions, indices[t], indices[t + 1], indices[t + 2]));
  }
  if (area.size <= 1) return mesh;
  let best = -1;
  let bestArea = -1;
  for (const [root, value] of area) {
    if (value > bestArea) {
      bestArea = value;
      best = root;
    }
  }
  const remap = new Int32Array(count).fill(-1);
  const positions: number[] = [];
  const kept: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    if (find(indices[t]) !== best) continue;
    for (let s = 0; s < 3; s += 1) {
      const v = indices[t + s];
      if (remap[v] < 0) {
        remap[v] = positions.length / 3;
        positions.push(mesh.positions[3 * v], mesh.positions[3 * v + 1], mesh.positions[3 * v + 2]);
      }
      kept.push(remap[v]);
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(kept) };
}

/** Move vertices from voxel indices to millimetres; keeps triangles wound outwards. */
export function transformMesh(mesh: Mesh, affine: Affine): Mesh {
  const p = mesh.positions;
  const out = new Float32Array(p.length);
  for (let v = 0; v < p.length; v += 3) {
    const i = p[v];
    const j = p[v + 1];
    const k = p[v + 2];
    out[v] = affine[0] * i + affine[1] * j + affine[2] * k + affine[3];
    out[v + 1] = affine[4] * i + affine[5] * j + affine[6] * k + affine[7];
    out[v + 2] = affine[8] * i + affine[9] * j + affine[10] * k + affine[11];
  }
  let indices = mesh.indices;
  if (determinant3(affine) < 0) {
    // A mirroring affine turns the surface inside out; swap two corners back.
    indices = indices.slice();
    for (let t = 0; t < indices.length; t += 3) {
      const b = indices[t + 1];
      indices[t + 1] = indices[t + 2];
      indices[t + 2] = b;
    }
  }
  return { positions: out, indices };
}

/** Area-weighted vertex normals. */
export function vertexNormals(mesh: Mesh): Float32Array {
  const p = mesh.positions;
  const normals = new Float32Array(p.length);
  const { indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    const ux = p[3 * b] - p[3 * a];
    const uy = p[3 * b + 1] - p[3 * a + 1];
    const uz = p[3 * b + 2] - p[3 * a + 2];
    const vx = p[3 * c] - p[3 * a];
    const vy = p[3 * c + 1] - p[3 * a + 1];
    const vz = p[3 * c + 2] - p[3 * a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      normals[3 * v] += nx;
      normals[3 * v + 1] += ny;
      normals[3 * v + 2] += nz;
    }
  }
  for (let v = 0; v < normals.length; v += 3) {
    const length = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1;
    normals[v] /= length;
    normals[v + 1] /= length;
    normals[v + 2] /= length;
  }
  return normals;
}

/** Enclosed volume (signed; positive when wound outwards), in the mesh's units cubed. */
export function meshVolume(mesh: Mesh): number {
  const p = mesh.positions;
  const { indices } = mesh;
  let total = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = 3 * indices[t];
    const b = 3 * indices[t + 1];
    const c = 3 * indices[t + 2];
    total +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
      p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return total / 6;
}

/** True when every edge is shared by exactly two triangles, in opposite directions. */
export function isClosed(mesh: Mesh): boolean {
  const count = mesh.positions.length / 3;
  const directed = new Map<number, number>();
  const { indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    for (let s = 0; s < 3; s += 1) {
      const a = indices[t + s];
      const b = indices[t + ((s + 1) % 3)];
      const key = a * count + b;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  }
  for (const [key, uses] of directed) {
    if (uses !== 1) return false;
    const a = Math.floor(key / count);
    const b = key % count;
    if (directed.get(b * count + a) !== 1) return false;
  }
  return indices.length > 0;
}

/**
 * Marching cubes on a scalar field at level 0, inside where the value is
 * negative. Vertices are placed by linear interpolation along each edge, in
 * grid-index coordinates. Only cells inside the grid are visited, so the
 * field should be positive on its border.
 */
export function marchingCubesField(field: Float32Array, dims: Dims): Mesh {
  const [nx, ny, nz] = dims;
  const vertexOf = new Map<number, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  const value = new Float64Array(8);
  for (let z = 0; z < nz - 1; z += 1) {
    for (let y = 0; y < ny - 1; y += 1) {
      for (let x = 0; x < nx - 1; x += 1) {
        let cube = 0;
        for (let c = 0; c < 8; c += 1) {
          const [dx, dy, dz] = CORNERS[c];
          value[c] = field[x + dx + nx * (y + dy + ny * (z + dz))];
          if (value[c] < 0) cube |= 1 << c;
        }
        if (cube === 0 || cube === 255) continue;
        const triangles = TRIANGLE_TABLE[cube];
        for (let t = 0; t < triangles.length; t += 1) {
          const edge = triangles[t];
          const [ox, oy, oz, axis] = EDGE_ORIGIN[edge];
          const gx = x + ox;
          const gy = y + oy;
          const gz = z + oz;
          const key = ((gz * ny + gy) * nx + gx) * 3 + axis;
          let vertex = vertexOf.get(key);
          if (vertex === undefined) {
            vertex = positions.length / 3;
            vertexOf.set(key, vertex);
            const [a, b] = EDGES[edge];
            const low = CORNERS[a][axis] < CORNERS[b][axis] ? a : b;
            const high = low === a ? b : a;
            const v0 = value[low];
            const v1 = value[high];
            const along = v0 === v1 ? 0.5 : Math.min(1, Math.max(0, v0 / (v0 - v1)));
            positions.push(gx + (axis === 0 ? along : 0), gy + (axis === 1 ? along : 0), gz + (axis === 2 ? along : 0));
          }
          indices.push(vertex);
        }
      }
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

/** Largest number of isotropic grid points a surface is built on. */
export const MAX_SURFACE_VOXELS = 8_000_000;

export type SurfaceOptions = {
  keepLargest: boolean;
  /** Taubin passes after marching cubes. */
  smoothingIterations?: number;
  /** Gaussian on the resampled distance field, in grid voxels (0 for none). */
  sigma?: number;
};

export type Surface = Mesh & {
  normals: Float32Array;
  /** Isotropic grid spacing the surface was built on, in mm. */
  gridMm: number;
  /** True when the grid was coarsened to stay under MAX_SURFACE_VOXELS. */
  coarsened: boolean;
};

function gaussianSmooth(field: Float32Array, dims: Dims, sigma: number) {
  if (sigma <= 0) return;
  const radius = Math.max(1, Math.ceil(2 * sigma));
  const weights: number[] = [];
  let total = 0;
  for (let k = -radius; k <= radius; k += 1) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    weights.push(w);
    total += w;
  }
  for (let k = 0; k < weights.length; k += 1) weights[k] /= total;
  const [nx, ny, nz] = dims;
  const steps = [1, nx, nx * ny];
  const lengths = [nx, ny, nz];
  const line = new Float64Array(Math.max(nx, ny, nz));
  for (let axis = 0; axis < 3; axis += 1) {
    const step = steps[axis];
    const length = lengths[axis];
    const others = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
    for (let b = 0; b < lengths[others[1]]; b += 1) {
      for (let a = 0; a < lengths[others[0]]; a += 1) {
        const base = a * steps[others[0]] + b * steps[others[1]];
        for (let i = 0; i < length; i += 1) line[i] = field[base + i * step];
        for (let i = 0; i < length; i += 1) {
          let sum = 0;
          for (let k = -radius; k <= radius; k += 1) {
            const j = Math.min(length - 1, Math.max(0, i + k));
            sum += weights[k + radius] * line[j];
          }
          field[base + i * step] = sum;
        }
      }
    }
  }
}

/**
 * A smooth surface for a mask on an anisotropic grid. The scoring never uses
 * this; it only draws the structure.
 *
 * 1. Signed distance in mm at the original spacing on the structure's box
 *    plus a pad: distance to the structure outside, minus distance to the
 *    background inside. Zero sits half-way between an inside and an outside
 *    voxel centre, where the binary surface would be.
 * 2. Trilinear resampling onto an isotropic grid, spacing the larger of the
 *    finest original spacing and 1 mm, coarser if needed to stay under
 *    MAX_SURFACE_VOXELS.
 * 3. A light Gaussian on that field, marching cubes at 0, the largest piece,
 *    a few Taubin passes, and into millimetres with the affine.
 */
export function maskToSurface(mask: Uint8Array, dims: Dims, affine: Affine, options: SurfaceOptions): Surface | null {
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) count += mask[i];
  if (count < 10) return null;
  const tight = bboxOf(mask, dims);
  if (!tight) return null;
  const spacing = spacingOf(affine);
  let gridMm = Math.max(Math.min(spacing[0], spacing[1], spacing[2]), 1.0);
  const extentMm = (box: { lo: Vec3; hi: Vec3 }) =>
    [0, 1, 2].map((a) => (box.hi[a] - box.lo[a] - 1) * spacing[a]) as Vec3;
  // Pad so the distance field is positive all round the iso grid's border.
  const padFor = (mm: number): Vec3 => [0, 1, 2].map((a) => Math.ceil((3 * mm) / spacing[a]) + 1) as Vec3;
  // Not clipped to the grid: a structure touching the edge of the scan still
  // closes, because voxels beyond the grid count as empty.
  const grow = (pad: Vec3) => ({
    lo: [tight.lo[0] - pad[0], tight.lo[1] - pad[1], tight.lo[2] - pad[2]] as Vec3,
    hi: [tight.hi[0] + pad[0], tight.hi[1] + pad[1], tight.hi[2] + pad[2]] as Vec3,
  });
  let box = grow(padFor(gridMm));
  const gridDims = (mm: number, b: { lo: Vec3; hi: Vec3 }): Dims =>
    extentMm(b).map((e) => Math.floor(e / mm) + 1) as Dims;
  let iso = gridDims(gridMm, box);
  let coarsened = false;
  while (iso[0] * iso[1] * iso[2] > MAX_SURFACE_VOXELS) {
    gridMm *= Math.cbrt((iso[0] * iso[1] * iso[2]) / MAX_SURFACE_VOXELS) * 1.01;
    box = grow(padFor(gridMm));
    iso = gridDims(gridMm, box);
    coarsened = true;
  }

  // 1. Signed distance on the original grid, in mm.
  const subDims: Dims = [box.hi[0] - box.lo[0], box.hi[1] - box.lo[1], box.hi[2] - box.lo[2]];
  const sub = new Uint8Array(subDims[0] * subDims[1] * subDims[2]);
  for (let k = Math.max(0, box.lo[2]); k < Math.min(dims[2], box.hi[2]); k += 1) {
    for (let j = Math.max(0, box.lo[1]); j < Math.min(dims[1], box.hi[1]); j += 1) {
      const from = dims[0] * (j + dims[1] * k);
      const to = subDims[0] * (j - box.lo[1] + subDims[1] * (k - box.lo[2])) - box.lo[0];
      for (let i = Math.max(0, box.lo[0]); i < Math.min(dims[0], box.hi[0]); i += 1) sub[to + i] = mask[from + i];
    }
  }
  const outside = edtSquared(sub, subDims, spacing, false);
  const background = new Uint8Array(sub.length);
  for (let i = 0; i < sub.length; i += 1) background[i] = sub[i] ^ 1;
  const inside = edtSquared(background, subDims, spacing, false);
  const sdf = new Float32Array(sub.length);
  for (let i = 0; i < sub.length; i += 1) sdf[i] = sub[i] ? -Math.sqrt(inside[i]) : Math.sqrt(outside[i]);

  // 2. Trilinear resampling onto the isotropic grid.
  const [sx, sy, sz] = subDims;
  const step: Vec3 = [gridMm / spacing[0], gridMm / spacing[1], gridMm / spacing[2]];
  const field = new Float32Array(iso[0] * iso[1] * iso[2]);
  const at = (i: number, j: number, k: number) => sdf[i + sx * (j + sy * k)];
  let o = 0;
  for (let w = 0; w < iso[2]; w += 1) {
    const fz = Math.min(w * step[2], sz - 1);
    const k0 = Math.min(Math.floor(fz), sz - 2 < 0 ? 0 : sz - 2);
    const tz = sz > 1 ? fz - k0 : 0;
    const k1 = Math.min(k0 + 1, sz - 1);
    for (let v = 0; v < iso[1]; v += 1) {
      const fy = Math.min(v * step[1], sy - 1);
      const j0 = Math.min(Math.floor(fy), sy - 2 < 0 ? 0 : sy - 2);
      const ty = sy > 1 ? fy - j0 : 0;
      const j1 = Math.min(j0 + 1, sy - 1);
      for (let u = 0; u < iso[0]; u += 1, o += 1) {
        const fx = Math.min(u * step[0], sx - 1);
        const i0 = Math.min(Math.floor(fx), sx - 2 < 0 ? 0 : sx - 2);
        const tx = sx > 1 ? fx - i0 : 0;
        const i1 = Math.min(i0 + 1, sx - 1);
        const c00 = at(i0, j0, k0) * (1 - tx) + at(i1, j0, k0) * tx;
        const c10 = at(i0, j1, k0) * (1 - tx) + at(i1, j1, k0) * tx;
        const c01 = at(i0, j0, k1) * (1 - tx) + at(i1, j0, k1) * tx;
        const c11 = at(i0, j1, k1) * (1 - tx) + at(i1, j1, k1) * tx;
        const c0 = c00 * (1 - ty) + c10 * ty;
        const c1 = c01 * (1 - ty) + c11 * ty;
        field[o] = c0 * (1 - tz) + c1 * tz;
      }
    }
  }

  // 3. Smooth, extract, clean up.
  gaussianSmooth(field, iso, options.sigma ?? 1);
  let mesh = marchingCubesField(field, iso);
  if (mesh.indices.length === 0) return null;
  if (options.keepLargest) mesh = keepLargestPiece(mesh);
  mesh = taubinSmooth(mesh, options.smoothingIterations ?? 5);
  // Iso-grid index to the box's original index, then to millimetres.
  const toMm = affine.slice();
  for (let r = 0; r < 3; r += 1) {
    toMm[r * 4 + 3] = affine[r * 4 + 3] + affine[r * 4] * box.lo[0] + affine[r * 4 + 1] * box.lo[1] + affine[r * 4 + 2] * box.lo[2];
    for (let c = 0; c < 3; c += 1) toMm[r * 4 + c] = affine[r * 4 + c] * step[c];
  }
  mesh = transformMesh(mesh, toMm);
  return { ...mesh, normals: vertexNormals(mesh), gridMm, coarsened };
}
