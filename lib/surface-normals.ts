import type { BufferGeometry } from 'three';

/** Legacy closed meshes include inward-facing triangle winding. */
export function orientSurfaceOutward(geometry: BufferGeometry) {
  const p = geometry.getAttribute('position'), index = geometry.getIndex();
  if (!index) return;
  let volume = 0;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    volume += p.getX(a) * (p.getY(b) * p.getZ(c) - p.getZ(b) * p.getY(c)) + p.getY(a) * (p.getZ(b) * p.getX(c) - p.getX(b) * p.getZ(c)) + p.getZ(a) * (p.getX(b) * p.getY(c) - p.getY(b) * p.getX(c));
  }
  if (volume < 0) {
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, b);
    }
    index.needsUpdate = true;
    geometry.computeVertexNormals();
  }
}

/** Repair lighting on legacy exports without altering the anatomical boundary. */
export function ensureSurfaceNormals(geometry: BufferGeometry) {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
}

/** Taubin display smoothing, capped at 1 mm from each source vertex.
 * Connectivity and the source files are preserved. Never use this for scoring.
 */
export function smoothDisplaySurface(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!index) return;
  const original = Float64Array.from(position.array);
  let current = original.slice();
  const neighbours = Array.from({ length: position.count }, () => new Set<number>());
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    neighbours[a].add(b).add(c); neighbours[b].add(a).add(c); neighbours[c].add(a).add(b);
  }
  for (let pass = 0; pass < 20; pass++) {
    const next = current.slice();
    const weight = pass % 2 === 0 ? .5 : -.53;
    for (let i = 0; i < position.count; i++) {
      if (!neighbours[i].size) continue;
      for (let axis = 0; axis < 3; axis++) {
        let sum = 0;
        for (const j of neighbours[i]) sum += current[j * 3 + axis];
        next[i * 3 + axis] += weight * (sum / neighbours[i].size - current[i * 3 + axis]);
      }
      const offset = [0, 1, 2].map(axis => next[i * 3 + axis] - original[i * 3 + axis]);
      const length = Math.hypot(...offset);
      if (length > 1) for (let axis = 0; axis < 3; axis++) next[i * 3 + axis] = original[i * 3 + axis] + offset[axis] / length;
    }
    current = next;
  }
  for (let i = 0; i < position.count; i++) position.setXYZ(i, current[i * 3], current[i * 3 + 1], current[i * 3 + 2]);
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}
