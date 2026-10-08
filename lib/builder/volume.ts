// Voxel tools for the in-browser kidney builder: masks, 6-connected
// morphology and components, an exact Euclidean distance transform and an
// exact 3D convex hull. Pure functions on typed arrays, so they run the same
// in the Web Worker and in the Node tests.
//
// Layout: index = x + nx * (y + ny * z), the NIfTI on-disk order.

export type Dims = [number, number, number];
export type Vec3 = [number, number, number];
/** Row-major 4x4, maps voxel indices (i, j, k, 1) to RAS millimetres. */
export type Affine = number[];

export function voxelCount(dims: Dims): number {
  return dims[0] * dims[1] * dims[2];
}

export function countMask(mask: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < mask.length; i += 1) total += mask[i];
  return total;
}

export function anySet(mask: Uint8Array): boolean {
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) return true;
  return false;
}

export function equalsMask(labels: Uint8Array, value: number): Uint8Array {
  const out = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i += 1) out[i] = labels[i] === value ? 1 : 0;
  return out;
}

export function andMask(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] & b[i];
  return out;
}

export function orMask(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] | b[i];
  return out;
}

export function andNotMask(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] & (b[i] ^ 1);
  return out;
}

export function notMask(a: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] ^ 1;
  return out;
}

export type Box = { lo: Vec3; hi: Vec3 };

/** Bounding box of the set voxels, hi exclusive, or null when the mask is empty. */
export function bboxOf(mask: Uint8Array, dims: Dims): Box | null {
  const [nx, ny, nz] = dims;
  let x0 = nx;
  let y0 = ny;
  let z0 = nz;
  let x1 = -1;
  let y1 = -1;
  let z1 = -1;
  let index = 0;
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1, index += 1) {
        if (!mask[index]) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
    }
  }
  if (x1 < 0) return null;
  return { lo: [x0, y0, z0], hi: [x1 + 1, y1 + 1, z1 + 1] };
}

/** Grow a box by pad voxels on every side, clipped to the grid. */
export function padBox(box: Box, pad: Vec3, dims: Dims): Box {
  return {
    lo: [Math.max(0, box.lo[0] - pad[0]), Math.max(0, box.lo[1] - pad[1]), Math.max(0, box.lo[2] - pad[2])],
    hi: [
      Math.min(dims[0], box.hi[0] + pad[0]),
      Math.min(dims[1], box.hi[1] + pad[1]),
      Math.min(dims[2], box.hi[2] + pad[2]),
    ],
  };
}

export function boxDims(box: Box): Dims {
  return [box.hi[0] - box.lo[0], box.hi[1] - box.lo[1], box.hi[2] - box.lo[2]];
}

/** Copy a box out of a volume. */
export function cropVolume<T extends Uint8Array | Float32Array | Float64Array>(
  data: T,
  dims: Dims,
  box: Box,
  make: (length: number) => T,
): T {
  const [nx, ny] = dims;
  const [bx, by, bz] = boxDims(box);
  const out = make(bx * by * bz);
  let o = 0;
  for (let z = 0; z < bz; z += 1) {
    for (let y = 0; y < by; y += 1) {
      const start = box.lo[0] + nx * (box.lo[1] + y + ny * (box.lo[2] + z));
      out.set(data.subarray(start, start + bx), o);
      o += bx;
    }
  }
  return out;
}

/** Translate an affine so index 0 of the box maps where the box's corner did. */
export function shiftAffine(affine: Affine, offset: Vec3): Affine {
  const out = affine.slice();
  for (let r = 0; r < 3; r += 1) {
    out[r * 4 + 3] =
      affine[r * 4 + 3] + affine[r * 4] * offset[0] + affine[r * 4 + 1] * offset[1] + affine[r * 4 + 2] * offset[2];
  }
  return out;
}

/** Scale the index axes of an affine, for a strided (downsampled) grid. */
export function strideAffine(affine: Affine, stride: Vec3): Affine {
  const out = affine.slice();
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) out[r * 4 + c] = affine[r * 4 + c] * stride[c];
  }
  return out;
}

/** Voxel size along each index axis, in mm (the affine's column norms). */
export function spacingOf(affine: Affine): Vec3 {
  const column = (c: number) => Math.hypot(affine[c], affine[4 + c], affine[8 + c]);
  return [column(0), column(1), column(2)];
}

export function determinant3(affine: Affine): number {
  const [a, b, c] = [affine[0], affine[1], affine[2]];
  const [d, e, f] = [affine[4], affine[5], affine[6]];
  const [g, h, i] = [affine[8], affine[9], affine[10]];
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

export function applyAffine(affine: Affine, i: number, j: number, k: number): Vec3 {
  return [
    affine[0] * i + affine[1] * j + affine[2] * k + affine[3],
    affine[4] * i + affine[5] * j + affine[6] * k + affine[7],
    affine[8] * i + affine[9] * j + affine[10] * k + affine[11],
  ];
}

// ---------------------------------------------------------------------------
// Morphology with the 6-connected cross, as scipy.ndimage uses by default.
// Voxels beyond the grid count as empty (scipy's border_value=0).
// ---------------------------------------------------------------------------

export function dilate6(mask: Uint8Array, dims: Dims): Uint8Array {
  const [nx, ny, nz] = dims;
  const sx = 1;
  const sy = nx;
  const sz = nx * ny;
  const out = new Uint8Array(mask.length);
  let index = 0;
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1, index += 1) {
        if (mask[index]) {
          out[index] = 1;
          continue;
        }
        if (
          (x > 0 && mask[index - sx]) ||
          (x < nx - 1 && mask[index + sx]) ||
          (y > 0 && mask[index - sy]) ||
          (y < ny - 1 && mask[index + sy]) ||
          (z > 0 && mask[index - sz]) ||
          (z < nz - 1 && mask[index + sz])
        ) {
          out[index] = 1;
        }
      }
    }
  }
  return out;
}

export function erode6(mask: Uint8Array, dims: Dims): Uint8Array {
  const [nx, ny, nz] = dims;
  const sy = nx;
  const sz = nx * ny;
  const out = new Uint8Array(mask.length);
  let index = 0;
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1, index += 1) {
        if (!mask[index]) continue;
        if (x === 0 || x === nx - 1 || y === 0 || y === ny - 1 || z === 0 || z === nz - 1) continue;
        if (mask[index - 1] && mask[index + 1] && mask[index - sy] && mask[index + sy] && mask[index - sz] && mask[index + sz]) {
          out[index] = 1;
        }
      }
    }
  }
  return out;
}

/** scipy.ndimage.binary_closing with one iteration of the 6-connected cross. */
export function close6(mask: Uint8Array, dims: Dims): Uint8Array {
  return erode6(dilate6(mask, dims), dims);
}

export type Components = { labels: Int32Array; sizes: number[] };

/** 6-connected components (scipy.ndimage.label's default). Labels run from 1. */
export function components6(mask: Uint8Array, dims: Dims): Components {
  const [nx, ny, nz] = dims;
  const sz = nx * ny;
  const labels = new Int32Array(mask.length);
  const sizes: number[] = [];
  let queue: Int32Array | null = null;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start]) continue;
    queue ??= new Int32Array(mask.length);
    const label = sizes.length + 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = label;
    while (head < tail) {
      const index = queue[head++];
      const x = index % nx;
      const y = Math.floor(index / nx) % ny;
      const z = Math.floor(index / sz);
      if (x > 0 && mask[index - 1] && !labels[index - 1]) {
        labels[index - 1] = label;
        queue[tail++] = index - 1;
      }
      if (x < nx - 1 && mask[index + 1] && !labels[index + 1]) {
        labels[index + 1] = label;
        queue[tail++] = index + 1;
      }
      if (y > 0 && mask[index - nx] && !labels[index - nx]) {
        labels[index - nx] = label;
        queue[tail++] = index - nx;
      }
      if (y < ny - 1 && mask[index + nx] && !labels[index + nx]) {
        labels[index + nx] = label;
        queue[tail++] = index + nx;
      }
      if (z > 0 && mask[index - sz] && !labels[index - sz]) {
        labels[index - sz] = label;
        queue[tail++] = index - sz;
      }
      if (z < nz - 1 && mask[index + sz] && !labels[index + sz]) {
        labels[index + sz] = label;
        queue[tail++] = index + sz;
      }
    }
    sizes.push(tail);
  }
  return { labels, sizes };
}

export function componentMask(components: Components, label: number): Uint8Array {
  const out = new Uint8Array(components.labels.length);
  for (let i = 0; i < out.length; i += 1) out[i] = components.labels[i] === label ? 1 : 0;
  return out;
}

/** The largest 6-connected component, and how many others there were. */
export function largestComponent(mask: Uint8Array, dims: Dims): { mask: Uint8Array; others: number } {
  const components = components6(mask, dims);
  if (components.sizes.length <= 1) return { mask, others: 0 };
  let best = 0;
  for (let i = 1; i < components.sizes.length; i += 1) if (components.sizes[i] > components.sizes[best]) best = i;
  return { mask: componentMask(components, best + 1), others: components.sizes.length - 1 };
}

// ---------------------------------------------------------------------------
// Exact Euclidean distance transform (Felzenszwalb and Huttenlocher), with
// anisotropic voxel spacing. Returns squared distances in mm^2 from every
// voxel to the nearest feature voxel. Lines with no feature stay Infinity.
// ---------------------------------------------------------------------------

function transformLine(
  out: Float32Array | Float64Array,
  base: number,
  step: number,
  length: number,
  spacing: number,
  f: Float64Array,
  v: Int32Array,
  z: Float64Array,
) {
  const s2 = spacing * spacing;
  let any = false;
  for (let q = 0; q < length; q += 1) {
    const value = out[base + q * step];
    f[q] = value;
    if (value !== Infinity) any = true;
  }
  if (!any) return;
  let k = -1;
  for (let q = 0; q < length; q += 1) {
    const fq = f[q];
    if (fq === Infinity) continue;
    if (k < 0) {
      k = 0;
      v[0] = q;
      z[0] = -Infinity;
      z[1] = Infinity;
      continue;
    }
    let s = 0;
    for (;;) {
      const p = v[k];
      s = (fq + s2 * q * q - (f[p] + s2 * p * p)) / (2 * s2 * (q - p));
      if (s <= z[k]) {
        k -= 1;
        if (k < 0) break;
      } else {
        break;
      }
    }
    if (k < 0) {
      k = 0;
      v[0] = q;
      z[0] = -Infinity;
      z[1] = Infinity;
      continue;
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < length; q += 1) {
    while (z[k + 1] < q) k += 1;
    const p = v[k];
    // (distance x spacing)^2 rather than distance^2 x spacing^2, the way
    // scipy rounds it, so a gap of exactly 4 mm reads 4 mm.
    const d = (q - p) * spacing;
    out[base + q * step] = d * d + f[p];
  }
}

/**
 * Squared distance (mm^2) from each voxel to the nearest set voxel of
 * `feature`. scipy.ndimage.distance_transform_edt(~feature, sampling=spacing)
 * squared. `precise` keeps float64; otherwise float32 to save memory.
 */
export function edtSquared(
  feature: Uint8Array,
  dims: Dims,
  spacing: Vec3,
  precise = true,
): Float32Array | Float64Array {
  const [nx, ny, nz] = dims;
  const n = nx * ny * nz;
  const out = precise ? new Float64Array(n) : new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = feature[i] ? 0 : Infinity;
  const longest = Math.max(nx, ny, nz);
  const f = new Float64Array(longest);
  const v = new Int32Array(longest);
  const z = new Float64Array(longest + 1);
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) transformLine(out, nx * (j + ny * k), 1, nx, spacing[0], f, v, z);
  }
  for (let k = 0; k < nz; k += 1) {
    for (let i = 0; i < nx; i += 1) transformLine(out, i + nx * ny * k, nx, ny, spacing[1], f, v, z);
  }
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) transformLine(out, i + nx * j, nx * ny, nz, spacing[2], f, v, z);
  }
  return out;
}

/** Smallest distance (mm) from any voxel of `from` to the nearest voxel of `to`, or NaN. */
export function minDistanceMm(from: Uint8Array, to: Uint8Array, dims: Dims, spacing: Vec3): number {
  if (!anySet(from) || !anySet(to)) return Number.NaN;
  const d2 = edtSquared(to, dims, spacing);
  let best = Infinity;
  for (let i = 0; i < from.length; i += 1) if (from[i] && d2[i] < best) best = d2[i];
  return Math.sqrt(best);
}

// ---------------------------------------------------------------------------
// Exact 3D convex hull of voxel centres. Points are small integers, so the
// orientation tests are exact in float64 and coplanar points can't confuse
// the incremental algorithm. Only voxels that are vertices of their own axial
// slice's 2D hull can be vertices of the 3D hull, which keeps the candidate
// set small.
// ---------------------------------------------------------------------------

/** Vertices of the 2D hull of each axial slice, as packed (i, j, k) triples relative to the box. */
function sliceHullCandidates(mask: Uint8Array, dims: Dims, box: Box): Int32Array {
  const [nx, ny] = dims;
  const [bx, by, bz] = boxDims(box);
  const out: number[] = [];
  const px: number[] = [];
  const py: number[] = [];
  const lower: number[] = [];
  const upper: number[] = [];
  const cross = (o: number, a: number, b: number) =>
    (px[a] - px[o]) * (py[b] - py[o]) - (py[a] - py[o]) * (px[b] - px[o]);
  for (let k = 0; k < bz; k += 1) {
    px.length = 0;
    py.length = 0;
    // Row extremes along x; points come out sorted by (y, x).
    for (let j = 0; j < by; j += 1) {
      const row = box.lo[0] + nx * (box.lo[1] + j + ny * (box.lo[2] + k));
      let first = -1;
      let last = -1;
      for (let i = 0; i < bx; i += 1) {
        if (mask[row + i]) {
          if (first < 0) first = i;
          last = i;
        }
      }
      if (first < 0) continue;
      px.push(first);
      py.push(j);
      if (last !== first) {
        px.push(last);
        py.push(j);
      }
    }
    const m = px.length;
    if (m === 0) continue;
    if (m <= 2) {
      for (let p = 0; p < m; p += 1) out.push(px[p], py[p], k);
      continue;
    }
    // Andrew's monotone chain over points sorted by (y, x); drops collinear points.
    lower.length = 0;
    upper.length = 0;
    for (let p = 0; p < m; p += 1) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    for (let p = m - 1; p >= 0; p -= 1) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    for (const p of lower) out.push(px[p], py[p], k);
    for (const p of upper) out.push(px[p], py[p], k);
  }
  return Int32Array.from(out);
}

export type Hull = {
  /** Points the hull was built from (packed triples, box-relative). */
  points: Int32Array;
  /** Faces as packed point-index triples, wound outwards. */
  faces: Int32Array;
  /** Indices into points that are hull vertices. */
  vertices: number[];
};

/** Incremental 3D convex hull with exact integer predicates, or null if the points are coplanar. */
export function convexHull3(points: Int32Array): Hull | null {
  const count = points.length / 3;
  if (count < 4) return null;
  const X = (p: number) => points[3 * p];
  const Y = (p: number) => points[3 * p + 1];
  const Z = (p: number) => points[3 * p + 2];
  const d2 = (a: number, b: number) => (X(a) - X(b)) ** 2 + (Y(a) - Y(b)) ** 2 + (Z(a) - Z(b)) ** 2;
  const crossNorm = (a: number, b: number, c: number) => {
    const ux = X(b) - X(a);
    const uy = Y(b) - Y(a);
    const uz = Z(b) - Z(a);
    const vx = X(c) - X(a);
    const vy = Y(c) - Y(a);
    const vz = Z(c) - Z(a);
    return (uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2;
  };
  const orient = (a: number, b: number, c: number, d: number) => {
    const ux = X(b) - X(a);
    const uy = Y(b) - Y(a);
    const uz = Z(b) - Z(a);
    const vx = X(c) - X(a);
    const vy = Y(c) - Y(a);
    const vz = Z(c) - Z(a);
    const wx = X(d) - X(a);
    const wy = Y(d) - Y(a);
    const wz = Z(d) - Z(a);
    return wx * (uy * vz - uz * vy) + wy * (uz * vx - ux * vz) + wz * (ux * vy - uy * vx);
  };

  // A starting tetrahedron that isn't flat.
  const p0 = 0;
  let p1 = -1;
  let best = 0;
  for (let p = 1; p < count; p += 1) {
    const value = d2(p0, p);
    if (value > best) {
      best = value;
      p1 = p;
    }
  }
  if (p1 < 0) return null;
  let p2 = -1;
  best = 0;
  for (let p = 1; p < count; p += 1) {
    const value = crossNorm(p0, p1, p);
    if (value > best) {
      best = value;
      p2 = p;
    }
  }
  if (p2 < 0) return null;
  let p3 = -1;
  best = 0;
  for (let p = 1; p < count; p += 1) {
    const value = Math.abs(orient(p0, p1, p2, p));
    if (value > best) {
      best = value;
      p3 = p;
    }
  }
  if (p3 < 0) return null;

  const fa: number[] = [];
  const fb: number[] = [];
  const fc: number[] = [];
  const nX: number[] = [];
  const nY: number[] = [];
  const nZ: number[] = [];
  const off: number[] = [];
  const alive: number[] = [];

  const addFace = (a: number, b: number, c: number) => {
    const ux = X(b) - X(a);
    const uy = Y(b) - Y(a);
    const uz = Z(b) - Z(a);
    const vx = X(c) - X(a);
    const vy = Y(c) - Y(a);
    const vz = Z(c) - Z(a);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const id = fa.length;
    fa.push(a);
    fb.push(b);
    fc.push(c);
    nX.push(nx);
    nY.push(ny);
    nZ.push(nz);
    off.push(nx * X(a) + ny * Y(a) + nz * Z(a));
    alive.push(id);
  };
  // Wind each face so the opposite corner is behind it.
  const addOutward = (a: number, b: number, c: number, opposite: number) => {
    if (orient(a, b, c, opposite) > 0) addFace(a, c, b);
    else addFace(a, b, c);
  };
  addOutward(p0, p1, p2, p3);
  addOutward(p0, p1, p3, p2);
  addOutward(p0, p2, p3, p1);
  addOutward(p1, p2, p3, p0);

  // A fixed shuffle keeps the expected cost low and the result repeatable.
  const order: number[] = [];
  for (let p = 0; p < count; p += 1) if (p !== p0 && p !== p1 && p !== p2 && p !== p3) order.push(p);
  let seed = 12345;
  for (let i = order.length - 1; i > 0; i -= 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }

  let dead = new Uint8Array(64);
  const visible: number[] = [];
  const edges = new Set<number>();
  for (const p of order) {
    const x = X(p);
    const y = Y(p);
    const z = Z(p);
    visible.length = 0;
    for (const f of alive) {
      if (nX[f] * x + nY[f] * y + nZ[f] * z - off[f] > 0) visible.push(f);
    }
    if (visible.length === 0) continue;
    if (dead.length < fa.length) {
      const grown = new Uint8Array(Math.max(fa.length * 2, 64));
      grown.set(dead);
      dead = grown;
    }
    edges.clear();
    for (const f of visible) {
      dead[f] = 1;
      edges.add(fa[f] * count + fb[f]);
      edges.add(fb[f] * count + fc[f]);
      edges.add(fc[f] * count + fa[f]);
    }
    const kept = alive.filter((f) => !dead[f]);
    alive.length = 0;
    alive.push(...kept);
    for (const f of visible) {
      const pairs: Array<[number, number]> = [
        [fa[f], fb[f]],
        [fb[f], fc[f]],
        [fc[f], fa[f]],
      ];
      for (const [u, v] of pairs) {
        if (!edges.has(v * count + u)) addFace(u, v, p);
      }
    }
  }

  const faces = new Int32Array(alive.length * 3);
  const used = new Set<number>();
  alive.forEach((f, index) => {
    faces[3 * index] = fa[f];
    faces[3 * index + 1] = fb[f];
    faces[3 * index + 2] = fc[f];
    used.add(fa[f]);
    used.add(fb[f]);
    used.add(fc[f]);
  });
  return { points, faces, vertices: [...used] };
}

/** Hull vertices of a mask, as voxel indices (absolute, packed triples), or all candidates if flat. */
export function hullVertexVoxels(mask: Uint8Array, dims: Dims): Int32Array {
  const box = bboxOf(mask, dims);
  if (!box) return new Int32Array(0);
  const candidates = sliceHullCandidates(mask, dims, box);
  const hull = convexHull3(candidates);
  const pick = hull ? hull.vertices : Array.from({ length: candidates.length / 3 }, (_, i) => i);
  const out = new Int32Array(pick.length * 3);
  pick.forEach((p, index) => {
    out[3 * index] = candidates[3 * p] + box.lo[0];
    out[3 * index + 1] = candidates[3 * p + 1] + box.lo[1];
    out[3 * index + 2] = candidates[3 * p + 2] + box.lo[2];
  });
  return out;
}

/**
 * Voxel mask of the convex hull of the mask's voxel centres, boundary
 * included (renalplan's convex_hull_mask). A flat or tiny mask is returned
 * unchanged, as renalplan does when its hull fails.
 */
export function convexHullMask(mask: Uint8Array, dims: Dims): Uint8Array {
  const box = bboxOf(mask, dims);
  if (!box || countMask(mask) < 5) return mask.slice();
  const candidates = sliceHullCandidates(mask, dims, box);
  const hull = convexHull3(candidates);
  if (!hull) return mask.slice();
  const { points, faces } = hull;
  const planeCount = faces.length / 3;
  const pa = new Float64Array(planeCount);
  const pb = new Float64Array(planeCount);
  const pc = new Float64Array(planeCount);
  const pd = new Float64Array(planeCount);
  for (let f = 0; f < planeCount; f += 1) {
    const a = faces[3 * f];
    const b = faces[3 * f + 1];
    const c = faces[3 * f + 2];
    const ux = points[3 * b] - points[3 * a];
    const uy = points[3 * b + 1] - points[3 * a + 1];
    const uz = points[3 * b + 2] - points[3 * a + 2];
    const vx = points[3 * c] - points[3 * a];
    const vy = points[3 * c + 1] - points[3 * a + 1];
    const vz = points[3 * c + 2] - points[3 * a + 2];
    pa[f] = uy * vz - uz * vy;
    pb[f] = uz * vx - ux * vz;
    pc[f] = ux * vy - uy * vx;
    pd[f] = pa[f] * points[3 * a] + pb[f] * points[3 * a + 1] + pc[f] * points[3 * a + 2];
  }
  const [nx, ny] = dims;
  const [bx, by, bz] = boxDims(box);
  const out = new Uint8Array(mask.length);
  for (let k = 0; k < bz; k += 1) {
    for (let j = 0; j < by; j += 1) {
      let lo = 0;
      let hi = bx - 1;
      for (let f = 0; f < planeCount && lo <= hi; f += 1) {
        const rhs = pd[f] - pb[f] * j - pc[f] * k;
        const a = pa[f];
        if (a > 0) {
          const limit = Math.floor(rhs / a);
          if (limit < hi) hi = limit;
        } else if (a < 0) {
          const limit = Math.ceil(rhs / a);
          if (limit > lo) lo = limit;
        } else if (rhs < 0) {
          hi = -1;
        }
      }
      if (lo > hi) continue;
      const row = box.lo[0] + nx * (box.lo[1] + j + ny * (box.lo[2] + k));
      out.fill(1, row + lo, row + hi + 1);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Small numeric helpers.
// ---------------------------------------------------------------------------

/** numpy.percentile with linear interpolation. Sorts `values` in place. */
export function percentile(values: Float64Array, q: number): number {
  values.sort();
  return percentileSorted(values, q);
}

export function percentileSorted(sorted: Float64Array, q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const position = ((n - 1) * q) / 100;
  const lo = Math.floor(position);
  const hi = Math.min(n - 1, lo + 1);
  const fraction = position - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * fraction;
}

/** Eigen-decomposition of a symmetric 3x3 matrix (Jacobi). Vectors are columns. */
export function symmetricEigen3(matrix: number[]): { values: Vec3; vectors: number[] } {
  const a = matrix.slice();
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 50; sweep += 1) {
    const off = a[1] * a[1] + a[2] * a[2] + a[5] * a[5];
    if (off < 1e-22) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const apq = a[p * 3 + q];
      if (Math.abs(apq) < 1e-300) continue;
      const app = a[p * 3 + p];
      const aqq = a[q * 3 + q];
      const theta = (aqq - app) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k += 1) {
        const akp = a[k * 3 + p];
        const akq = a[k * 3 + q];
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k += 1) {
        const apk = a[p * 3 + k];
        const aqk = a[q * 3 + k];
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k += 1) {
        const vkp = v[k * 3 + p];
        const vkq = v[k * 3 + q];
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  return { values: [a[0], a[4], a[8]], vectors: v };
}

const FLOAT_VIEW = new DataView(new ArrayBuffer(8));

/**
 * Python's round(x, digits) for digits >= 0, exactly. Python rounds the exact
 * binary value of the double (not its shortest decimal form), ties to even,
 * then reads the decimal result back as the nearest double. So 2.675 gives
 * 2.67, because the double nearest 2.675 is just below it. Here the double is
 * split into an integer mantissa and a power of two with BigInt, scaled by
 * 10^digits exactly, and rounded half to even on that exact fraction.
 */
export function pyRound(value: number, digits: number): number {
  if (!Number.isFinite(value) || value === 0) return value;
  if (!Number.isInteger(digits) || digits < 0) throw new RangeError('pyRound needs a whole number of digits, 0 or more.');
  FLOAT_VIEW.setFloat64(0, value);
  const bits = FLOAT_VIEW.getBigUint64(0);
  const negative = bits >> 63n === 1n;
  const biased = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & 0xfffffffffffffn;
  // value = mantissa * 2^exponent, exactly.
  const mantissa = biased === 0 ? fraction : fraction | (1n << 52n);
  const exponent = (biased === 0 ? 1 : biased) - 1075;
  let scaled = mantissa * 10n ** BigInt(digits);
  let rounded: bigint;
  if (exponent >= 0) {
    rounded = scaled << BigInt(exponent);
  } else {
    const denominator = 1n << BigInt(-exponent);
    rounded = scaled / denominator;
    const twiceRemainder = 2n * (scaled - rounded * denominator);
    if (twiceRemainder > denominator || (twiceRemainder === denominator && rounded % 2n === 1n)) rounded += 1n;
  }
  scaled = rounded;
  const result = Number(`${negative ? '-' : ''}${scaled}e-${digits}`);
  // Python keeps the sign of a value that rounds to zero.
  return result === 0 ? (negative ? -0 : 0) : result;
}
