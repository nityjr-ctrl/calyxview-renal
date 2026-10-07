// The built-in sample: renalplan's synthetic phantom (pipeline/renalplan/
// phantom.py), label map only, generated here rather than shipped as a file.
// Two ellipsoid kidneys with a sinus concavity on the medial side, a 3 cm
// lower-pole tumour on the lateral edge of the kidney at +x (the patient's
// right in RAS), partly exophytic, and a small cyst on the other kidney. The
// arithmetic matches phantom.py voxel for voxel, so the browser's scores can
// be checked against renalplan's on the same volume. No patient data.

import type { Affine, Dims, Vec3 } from './volume.ts';

export const PHANTOM_DIMS: Dims = [160, 140, 96];
export const PHANTOM_SPACING: Vec3 = [1.0, 1.0, 1.5];

const RIGHT_KIDNEY = { centre: [55.0, -10.0, 0.0], radii: [26.0, 16.0, 52.0], sign: 1 };
const LEFT_KIDNEY = { centre: [-55.0, -8.0, 4.0], radii: [25.0, 15.0, 50.0], sign: -1 };
const TUMOUR = { centre: [72.0, -6.0, -34.0], radius: 15.0 };
const CYST = { centre: [-62.0, -4.0, 20.0], radius: 7.0 };
const SINUS_DEPTH = 12.0;
const SINUS_RADII = [SINUS_DEPTH, 9.0, 22.0];

export function phantomAffine(): Affine {
  const [nx, ny, nz] = PHANTOM_DIMS;
  const [sx, sy, sz] = PHANTOM_SPACING;
  return [sx, 0, 0, (-nx / 2) * sx, 0, sy, 0, (-ny / 2) * sy, 0, 0, sz, (-nz / 2) * sz, 0, 0, 0, 1];
}

function inEllipsoid(x: number, y: number, z: number, c: number[], r: number[]): boolean {
  const a = (x - c[0]) / r[0];
  const b = (y - c[1]) / r[1];
  const d = (z - c[2]) / r[2];
  return a * a + b * b + d * d <= 1.0;
}

/** Label map of renalplan's phantom: 1 kidney, 2 tumour, 3 cyst. */
export function buildPhantomLabels(): Uint8Array {
  const [nx, ny, nz] = PHANTOM_DIMS;
  const [sx, sy, sz] = PHANTOM_SPACING;
  const labels = new Uint8Array(nx * ny * nz);
  const kidneys = [RIGHT_KIDNEY, LEFT_KIDNEY].map((kidney) => ({
    ...kidney,
    hilum: [kidney.centre[0] - kidney.sign * (kidney.radii[0] - SINUS_DEPTH + 4), kidney.centre[1], kidney.centre[2]],
  }));
  const tumourRadii = [TUMOUR.radius, TUMOUR.radius, TUMOUR.radius];
  const cystRadii = [CYST.radius, CYST.radius, CYST.radius];
  let index = 0;
  for (let k = 0; k < nz; k += 1) {
    const z = (k - nz / 2) * sz;
    for (let j = 0; j < ny; j += 1) {
      const y = (j - ny / 2) * sy;
      for (let i = 0; i < nx; i += 1, index += 1) {
        const x = (i - nx / 2) * sx;
        for (const kidney of kidneys) {
          if (inEllipsoid(x, y, z, kidney.centre, kidney.radii) && !inEllipsoid(x, y, z, kidney.hilum, SINUS_RADII)) {
            labels[index] = 1;
          }
        }
        if (inEllipsoid(x, y, z, TUMOUR.centre, tumourRadii)) labels[index] = 2;
        if (inEllipsoid(x, y, z, CYST.centre, cystRadii)) labels[index] = 3;
      }
    }
  }
  return labels;
}
