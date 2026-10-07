// R.E.N.A.L. and PADUA from kidney and tumour masks: a port of renalplan
// 0.2.0's nephrometry.py and planning.py to run in the browser. The rules and
// cut-offs are the same. The differences are listed in BROWSER_DIFFERENCES
// and shown with every result.

import type { Affine, Dims, Vec3 } from './volume.ts';
import {
  andMask,
  andNotMask,
  anySet,
  bboxOf,
  boxDims,
  components6,
  componentMask,
  convexHullMask,
  countMask,
  cropVolume,
  dilate6,
  edtSquared,
  hullVertexVoxels,
  largestComponent,
  orMask,
  padBox,
  percentileSorted,
  pyRound,
  shiftAffine,
  spacingOf,
  symmetricEigen3,
} from './volume.ts';

export const KIDNEY = 1;
export const TUMOUR = 2;
export const CYST = 3;

// ---------------------------------------------------------------------------
// Cut-offs, as in renalplan. Small pure functions so the tests can pin them.
// ---------------------------------------------------------------------------

/** R: 4 cm or less = 1, over 4 and under 7 cm = 2, 7 cm or more = 3. */
export function renalRPoints(diameterCm: number): number {
  return diameterCm <= 4 ? 1 : diameterCm < 7 ? 2 : 3;
}

/** E (and PADUA exophytic): 50% or more outside = 1, more than 5% = 2, 5% or less = 3. */
export function exophyticPoints(fraction: number): number {
  return fraction >= 0.5 ? 1 : fraction > 0.05 ? 2 : 3;
}

/** N: 7 mm or more = 1, over 4 and under 7 mm = 2, 4 mm or less = 3. */
export function nearnessPoints(mm: number): number {
  return mm >= 7 ? 1 : mm > 4 ? 2 : 3;
}

/** PADUA size: 4 cm or less = 1, over 4 up to 7 cm = 2, over 7 cm = 3. */
export function paduaSizePoints(diameterCm: number): number {
  return diameterCm <= 4 ? 1 : diameterCm <= 7 ? 2 : 3;
}

export function renalComplexity(total: number): string {
  return total <= 6 ? 'low' : total <= 9 ? 'moderate' : 'high';
}

export function paduaComplexity(total: number): string {
  return total <= 7 ? 'low' : total <= 9 ? 'intermediate' : 'high';
}

export const MIN_POLAR_SPAN_MM = 20;
export const MAX_SINUS_VOLUME_FRACTION = 0.25;
export const MAX_SINUS_SPAN_FRACTION = 0.5;

/** Polar lines (mm along the long axis from the kidney centroid) and whether the sinus set them. */
export function polarLines(sinusAlong: Float64Array | null, kidneyAlong: Float64Array): { lo: number; hi: number; fromSinus: boolean } {
  if (sinusAlong && sinusAlong.length) {
    const sorted = sinusAlong.slice().sort();
    const lo = percentileSorted(sorted, 5);
    const hi = percentileSorted(sorted, 95);
    if (hi - lo >= MIN_POLAR_SPAN_MM && lo < 0 && hi > 0) return { lo, hi, fromSinus: true };
  }
  const sorted = kidneyAlong.slice().sort();
  return { lo: percentileSorted(sorted, 30), hi: percentileSorted(sorted, 70), fromSinus: false };
}

export function sinusEstimateTooLarge(sinusVoxels: number, kidneyVoxels: number, spanMm: number, kidneyLengthMm: number): boolean {
  return sinusVoxels > MAX_SINUS_VOLUME_FRACTION * kidneyVoxels || spanMm > MAX_SINUS_SPAN_FRACTION * kidneyLengthMm;
}

/** R.E.N.A.L. L from tumour positions along the long axis. */
export function renalLocation(tumourAlong: Float64Array, lo: number, hi: number): { points: number; detail: string } {
  const sorted = tumourAlong.slice().sort();
  const tLo = percentileSorted(sorted, 2);
  const tHi = percentileSorted(sorted, 98);
  let between = 0;
  for (let i = 0; i < tumourAlong.length; i += 1) if (tumourAlong[i] >= lo && tumourAlong[i] <= hi) between += 1;
  const betweenFraction = between / tumourAlong.length;
  const midline = 0.5 * (lo + hi);
  if (tLo >= lo && tHi <= hi) return { points: 3, detail: 'entirely between the polar lines' };
  if (tLo < midline && midline < tHi) return { points: 3, detail: 'crosses the axial renal midline' };
  if (betweenFraction > 0.5) return { points: 3, detail: 'more than half between the polar lines' };
  if (tHi <= lo || tLo >= hi) return { points: 1, detail: 'entirely above or below the polar lines' };
  return { points: 2, detail: 'crosses a polar line' };
}

/** PADUA polar location: middle (2) when more than half lies between the lines, otherwise the pole holding more (1). */
export function paduaPolar(tumourAlong: Float64Array, lo: number, hi: number): { location: string; points: number } {
  let between = 0;
  let above = 0;
  let below = 0;
  for (let i = 0; i < tumourAlong.length; i += 1) {
    const t = tumourAlong[i];
    if (t >= lo && t <= hi) between += 1;
    if (t > hi) above += 1;
    if (t < lo) below += 1;
  }
  if (between / tumourAlong.length > 0.5) return { location: 'middle', points: 2 };
  return { location: above >= below ? 'superior' : 'inferior', points: 1 };
}

// ---------------------------------------------------------------------------
// Notes, worded for the viewer.
// ---------------------------------------------------------------------------

export const NOTE_POLAR_LINES =
  'Polar lines here are planes across the kidney’s own long axis, not axial CT slices, and one pair serves both R.E.N.A.L. L and PADUA’s polar item. PADUA’s pole counts as middle when more than half the tumour lies between the lines (Wood et al., BJU Int 2024). So L and the PADUA pole are approximations.';
export const NOTE_NO_SINUS_LINES =
  'No sinus estimate to set the polar lines, so they were assumed where 30% of the kidney’s volume lies beyond each. L and the PADUA pole are rougher than usual.';
export const NOTE_SINUS_TOO_SMALL =
  'The estimated sinus was too short or off-centre to set the polar lines, so they were assumed where 30% of the kidney’s volume lies beyond each. L and the PADUA pole are rougher than usual. N and PADUA’s rim and sinus items still use the small estimate, so N can read long.';
export const NOTE_SINUS_TOO_LARGE =
  'The estimated sinus is far too big for a renal sinus, so the kidney isn’t the usual shape (a horseshoe or malrotated kidney does this). L, N and PADUA’s pole, rim and sinus items are unreliable here.';
export const NOTE_SINUS_APPROX =
  'There’s no collecting-system outline, so the renal sinus is estimated as the space inside the convex hull of kidney and tumour that is neither, opened with a 4 mm ball. N is measured to that estimate and can read long.';
export const NOTE_NO_VESSELS = 'No vessel outline, so the hilar (h) suffix isn’t assessed.';
export const NOTE_NO_COLLECTING =
  'No collecting-system outline, so PADUA’s collecting-system item isn’t assessed and is scored 1. The PADUA total can be one point low.';

export type Geometry = {
  kidney: Uint8Array;
  tumour: Uint8Array;
  sinus: Uint8Array;
  dims: Dims;
  affine: Affine;
  spacing: Vec3;
  kidneyCentroid: Vec3;
  longAxis: Vec3;
  anteriorAxis: Vec3;
  medialAxis: Vec3;
  polarLo: number;
  polarHi: number;
  polarLinesAssumed: boolean;
  sinusEstimateTooLarge: boolean;
  notes: string[];
};

export type RenalScore = {
  diameterMm: number;
  radiusCm: number;
  radiusPoints: number;
  exophyticFraction: number;
  exophyticPoints: number;
  nearnessMm: number | null;
  /** N's distance before rounding to 0.1 mm. */
  nearnessRawMm: number | null;
  nearnessPoints: number;
  anteriorOffsetMm: number;
  face: 'a' | 'p' | 'x';
  locationPoints: number;
  locationDetail: string;
  hilarAssessed: false;
  total: number;
  complexity: string;
  label: string;
};

export type PaduaScore = {
  polarLocation: string;
  polarPoints: number;
  exophyticPoints: number;
  rim: 'medial' | 'lateral';
  rimPoints: number;
  sinusInvolved: boolean;
  sinusPoints: number;
  collectingAssessed: false;
  collectingPoints: number;
  sizePoints: number;
  total: number;
  complexity: string;
};

export type Planning = {
  marginMm: number;
  tumourMl: number;
  ipsilateralKidneyMl: number;
  contralateralKidneyMl: number;
  resectionMl: number;
  parenchymaRemovedMl: number;
  residualIpsilateralMl: number;
  preservedFraction: number;
  cystMl: number;
  tumourToSinusMm: number | null;
  contactSurfaceCm2: number;
};

/** Voxel positions in mm for a mask (all voxels, no sampling). */
function coordsMm(mask: Uint8Array, dims: Dims, affine: Affine): Float64Array {
  const [nx, ny] = dims;
  const count = countMask(mask);
  const out = new Float64Array(count * 3);
  let o = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const i = index % nx;
    const j = Math.floor(index / nx) % ny;
    const k = Math.floor(index / (nx * ny));
    out[o++] = affine[0] * i + affine[1] * j + affine[2] * k + affine[3];
    out[o++] = affine[4] * i + affine[5] * j + affine[6] * k + affine[7];
    out[o++] = affine[8] * i + affine[9] * j + affine[10] * k + affine[11];
  }
  return out;
}

function mean3(points: Float64Array): Vec3 {
  const n = points.length / 3;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let p = 0; p < points.length; p += 3) {
    x += points[p];
    y += points[p + 1];
    z += points[p + 2];
  }
  return [x / n, y / n, z / n];
}

function along(points: Float64Array, origin: Vec3, axis: Vec3): Float64Array {
  const out = new Float64Array(points.length / 3);
  for (let p = 0, o = 0; p < points.length; p += 3, o += 1) {
    out[o] = (points[p] - origin[0]) * axis[0] + (points[p + 1] - origin[1]) * axis[1] + (points[p + 2] - origin[2]) * axis[2];
  }
  return out;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function rejectAlong(v: Vec3, axis: Vec3): Vec3 {
  const d = dot(v, axis);
  const out: Vec3 = [v[0] - d * axis[0], v[1] - d * axis[1], v[2] - d * axis[2]];
  const length = Math.hypot(out[0], out[1], out[2]) || 1;
  return [out[0] / length, out[1] / length, out[2] / length];
}

/** The largest tumour piece and how many smaller ones there are. */
export function indexLesion(tumour: Uint8Array, dims: Dims): { mask: Uint8Array; others: number } {
  return largestComponent(tumour, dims);
}

/**
 * renalplan's tumour_bearing_kidney: among substantial kidney pieces (at
 * least 10% of the largest, or 20 ml) the one nearest the tumour, plus small
 * fragments within 5 mm of it.
 */
export function tumourBearingKidney(kidneyAll: Uint8Array, tumour: Uint8Array, dims: Dims, spacing: Vec3): Uint8Array {
  const components = components6(kidneyAll, dims);
  const { sizes, labels } = components;
  if (sizes.length <= 1 || !anySet(tumour)) return kidneyAll;
  const voxelMl = (spacing[0] * spacing[1] * spacing[2]) / 1000;
  const floor = Math.min(0.1 * Math.max(...sizes), 20 / voxelMl);
  const toTumour = edtSquared(tumour, dims, spacing, false);
  const nearest = new Float64Array(sizes.length).fill(Infinity);
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    if (label && toTumour[i] < nearest[label - 1]) nearest[label - 1] = toTumour[i];
  }
  let best = -1;
  for (let c = 0; c < sizes.length; c += 1) {
    if (sizes[c] < floor) continue;
    if (best < 0 || nearest[c] < nearest[best]) best = c;
  }
  if (best < 0) {
    best = 0;
    for (let c = 1; c < sizes.length; c += 1) if (sizes[c] > sizes[best]) best = c;
  }
  const chosen = componentMask(components, best + 1);
  const toChosen = edtSquared(chosen, dims, spacing, false);
  const join = new Set<number>();
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    if (label && sizes[label - 1] < floor && toChosen[i] <= 25) join.add(label);
  }
  if (join.size) for (let i = 0; i < labels.length; i += 1) if (join.has(labels[i])) chosen[i] = 1;
  return chosen;
}

/** renalplan's build_geometry, on a grid holding just this kidney and its tumour. */
export function buildGeometry(kidney: Uint8Array, tumour: Uint8Array, dims: Dims, affine: Affine): Geometry {
  const spacing = spacingOf(affine);
  const notes: string[] = [];
  const outline = orMask(kidney, tumour);
  const hull = convexHullMask(outline, dims);
  const cavity = andNotMask(hull, outline);
  let sinus = cavity;
  if (anySet(cavity)) {
    // Keep the deep medial concavity: open the cavity with a 4 mm ball.
    const toOutside = edtSquared(cavity.map((v) => v ^ 1), dims, spacing);
    const core = new Uint8Array(cavity.length);
    let anyCore = false;
    for (let i = 0; i < core.length; i += 1) {
      if (cavity[i] && Math.sqrt(toOutside[i]) >= 4) {
        core[i] = 1;
        anyCore = true;
      }
    }
    if (anyCore) {
      const toCore = edtSquared(core, dims, spacing);
      sinus = new Uint8Array(cavity.length);
      for (let i = 0; i < sinus.length; i += 1) sinus[i] = cavity[i] && Math.sqrt(toCore[i]) <= 4 ? 1 : 0;
    }
  }
  sinus = largestComponent(sinus, dims).mask;
  notes.push(NOTE_SINUS_APPROX);

  const kidneyCount = countMask(kidney);
  if (kidneyCount < 50) throw new Error('There’s too little kidney in the outline (fewer than 50 voxels) to score.');
  if (countMask(tumour) < 10) throw new Error('There’s no tumour in the outline. Scoring needs a tumour label (2).');

  const points = coordsMm(kidney, dims, affine);
  const c = mean3(points);
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const n = points.length / 3;
  for (let p = 0; p < points.length; p += 3) {
    const d = [points[p] - c[0], points[p + 1] - c[1], points[p + 2] - c[2]];
    for (let r = 0; r < 3; r += 1) for (let s = 0; s < 3; s += 1) cov[r * 3 + s] += d[r] * d[s];
  }
  for (let i = 0; i < 9; i += 1) cov[i] /= n - 1;
  const { values, vectors } = symmetricEigen3(cov);
  let largest = 0;
  for (let i = 1; i < 3; i += 1) if (values[i] > values[largest]) largest = i;
  let longAxis: Vec3 = [vectors[largest], vectors[3 + largest], vectors[6 + largest]];
  if (longAxis[2] < 0) longAxis = [-longAxis[0], -longAxis[1], -longAxis[2]];
  const anteriorAxis = rejectAlong([0, 1, 0], longAxis);
  const hasSinus = anySet(sinus);
  let medialAxis: Vec3;
  let sinusPoints: Float64Array | null = null;
  if (hasSinus) {
    sinusPoints = coordsMm(sinus, dims, affine);
    const sc = mean3(sinusPoints);
    medialAxis = rejectAlong([sc[0] - c[0], sc[1] - c[1], sc[2] - c[2]], longAxis);
  } else {
    medialAxis = rejectAlong([-Math.sign(c[0]) || 1, 0, 0], longAxis);
    notes.push('No sinus region found, so the medial direction is assumed to point to the midline.');
  }
  const kidneyAlong = along(points, c, longAxis);
  const sinusAlong = sinusPoints ? along(sinusPoints, c, longAxis) : null;
  const lines = polarLines(sinusAlong, kidneyAlong);
  notes.push(NOTE_POLAR_LINES);
  let tooLarge = false;
  if (!lines.fromSinus) {
    notes.push(sinusAlong ? NOTE_SINUS_TOO_SMALL : NOTE_NO_SINUS_LINES);
  } else {
    let kMin = Infinity;
    let kMax = -Infinity;
    for (const value of kidneyAlong) {
      if (value < kMin) kMin = value;
      if (value > kMax) kMax = value;
    }
    tooLarge = sinusEstimateTooLarge(countMask(sinus), kidneyCount, lines.hi - lines.lo, kMax - kMin);
    if (tooLarge) notes.push(NOTE_SINUS_TOO_LARGE);
  }
  return {
    kidney,
    tumour,
    sinus,
    dims,
    affine,
    spacing,
    kidneyCentroid: c,
    longAxis,
    anteriorAxis,
    medialAxis,
    polarLo: lines.lo,
    polarHi: lines.hi,
    polarLinesAssumed: !lines.fromSinus,
    sinusEstimateTooLarge: tooLarge,
    notes,
  };
}

/** Largest distance between voxel centres of the mask, in mm (exact, over its hull vertices). */
export function maxDiameterMm(mask: Uint8Array, dims: Dims, affine: Affine): number {
  const vertices = hullVertexVoxels(mask, dims);
  const count = vertices.length / 3;
  const mm = new Float64Array(vertices.length);
  for (let p = 0; p < count; p += 1) {
    const i = vertices[3 * p];
    const j = vertices[3 * p + 1];
    const k = vertices[3 * p + 2];
    mm[3 * p] = affine[0] * i + affine[1] * j + affine[2] * k + affine[3];
    mm[3 * p + 1] = affine[4] * i + affine[5] * j + affine[6] * k + affine[7];
    mm[3 * p + 2] = affine[8] * i + affine[9] * j + affine[10] * k + affine[11];
  }
  let best = 0;
  for (let a = 0; a < count; a += 1) {
    for (let b = a + 1; b < count; b += 1) {
      const d =
        (mm[3 * a] - mm[3 * b]) ** 2 + (mm[3 * a + 1] - mm[3 * b + 1]) ** 2 + (mm[3 * a + 2] - mm[3 * b + 2]) ** 2;
      if (d > best) best = d;
    }
  }
  return Math.sqrt(best);
}

export function renalScore(g: Geometry): RenalScore {
  const diameterMm = maxDiameterMm(g.tumour, g.dims, g.affine);
  const radiusCm = pyRound(diameterMm / 10, 2);
  const radiusPoints = renalRPoints(radiusCm);
  // E: share of the tumour outside the convex hull of the kidney alone.
  const hullK = convexHullMask(g.kidney, g.dims);
  const tumourCount = countMask(g.tumour);
  const inside = countMask(andMask(g.tumour, hullK));
  const exophyticFraction = pyRound(1 - inside / Math.max(1, tumourCount), 3);
  const ePoints = exophyticPoints(exophyticFraction);
  // N: to the estimated sinus.
  let nearnessMm: number | null = null;
  let nearnessRawMm: number | null = null;
  let nPoints = 1;
  if (anySet(g.sinus)) {
    const d2 = edtSquared(g.sinus, g.dims, g.spacing);
    let best = Infinity;
    for (let i = 0; i < d2.length; i += 1) if (g.tumour[i] && d2[i] < best) best = d2[i];
    nearnessRawMm = Math.sqrt(best);
    nearnessMm = pyRound(nearnessRawMm, 1);
    nPoints = nearnessPoints(nearnessMm);
  } else {
    g.notes.push('No sinus found, so N is scored 1.');
  }
  const tumourPoints = coordsMm(g.tumour, g.dims, g.affine);
  const tc = mean3(tumourPoints);
  const offset: Vec3 = [tc[0] - g.kidneyCentroid[0], tc[1] - g.kidneyCentroid[1], tc[2] - g.kidneyCentroid[2]];
  const anteriorOffsetMm = dot(offset, g.anteriorAxis);
  const face = anteriorOffsetMm > 5 ? 'a' : anteriorOffsetMm < -5 ? 'p' : 'x';
  const tumourAlong = along(tumourPoints, g.kidneyCentroid, g.longAxis);
  const location = renalLocation(tumourAlong, g.polarLo, g.polarHi);
  const total = radiusPoints + ePoints + nPoints + location.points;
  return {
    diameterMm,
    radiusCm,
    radiusPoints,
    exophyticFraction,
    exophyticPoints: ePoints,
    nearnessMm,
    nearnessRawMm,
    nearnessPoints: nPoints,
    anteriorOffsetMm,
    face,
    locationPoints: location.points,
    locationDetail: location.detail,
    hilarAssessed: false,
    total,
    complexity: renalComplexity(total),
    label: `${total}${face}`,
  };
}

export function paduaScore(g: Geometry, renal: RenalScore): PaduaScore {
  const tumourPoints = coordsMm(g.tumour, g.dims, g.affine);
  const tumourAlong = along(tumourPoints, g.kidneyCentroid, g.longAxis);
  const polar = paduaPolar(tumourAlong, g.polarLo, g.polarHi);
  const ePoints = exophyticPoints(renal.exophyticFraction);
  const tc = mean3(tumourPoints);
  const medialOffset = dot([tc[0] - g.kidneyCentroid[0], tc[1] - g.kidneyCentroid[1], tc[2] - g.kidneyCentroid[2]], g.medialAxis);
  const rim = medialOffset > 0 ? 'medial' : 'lateral';
  const rimPoints = rim === 'medial' ? 2 : 1;
  const sinusInvolved = anySet(g.sinus) ? anySet(andMask(g.tumour, dilate6(g.sinus, g.dims))) : false;
  const sinusPoints = sinusInvolved ? 2 : 1;
  const collectingPoints = 1;
  const sizePoints = paduaSizePoints(renal.radiusCm);
  const total = polar.points + ePoints + rimPoints + sinusPoints + collectingPoints + sizePoints;
  return {
    polarLocation: polar.location,
    polarPoints: polar.points,
    exophyticPoints: ePoints,
    rim,
    rimPoints,
    sinusInvolved,
    sinusPoints,
    collectingAssessed: false,
    collectingPoints,
    sizePoints,
    total,
    complexity: paduaComplexity(total),
  };
}

/** Area (cm^2) of voxel faces where tumour meets kidney. */
export function contactSurfaceCm2(tumour: Uint8Array, kidney: Uint8Array, dims: Dims, spacing: Vec3): number {
  const [nx, ny, nz] = dims;
  const faceArea = [spacing[1] * spacing[2], spacing[0] * spacing[2], spacing[0] * spacing[1]];
  const steps = [1, nx, nx * ny];
  const limits = [nx, ny, nz];
  let area = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const step = steps[axis];
    let pairs = 0;
    let index = 0;
    for (let z = 0; z < nz; z += 1) {
      for (let y = 0; y < ny; y += 1) {
        for (let x = 0; x < nx; x += 1, index += 1) {
          const position = axis === 0 ? x : axis === 1 ? y : z;
          if (position >= limits[axis] - 1) continue;
          const next = index + step;
          if ((tumour[index] && kidney[next]) || (tumour[next] && kidney[index])) pairs += 1;
        }
      }
    }
    area += pairs * faceArea[axis];
  }
  return area / 100;
}

/** Squared distance to the tumour, kept so the margin can change without redoing the rest. */
export function tumourDistance(g: Geometry): Float64Array | Float32Array {
  return edtSquared(g.tumour, g.dims, g.spacing);
}

/** renalplan's plan(): a uniform margin round the tumour and what's left. */
export function planMargin(
  g: Geometry,
  toTumour: Float64Array | Float32Array,
  marginMm: number,
  extras: { contralateralKidneyMl: number; cystMl: number; tumourToSinusMm: number | null; contactSurfaceCm2: number },
): { planning: Planning; envelope: Uint8Array } {
  const voxelMl = (g.spacing[0] * g.spacing[1] * g.spacing[2]) / 1000;
  const envelope = new Uint8Array(g.kidney.length);
  let resection = 0;
  let removed = 0;
  let residual = 0;
  let ipsilateral = 0;
  let tumourCount = 0;
  for (let i = 0; i < envelope.length; i += 1) {
    const inEnvelope = marginMm <= 0 ? g.tumour[i] === 1 : Math.sqrt(toTumour[i]) <= marginMm;
    if (inEnvelope && !g.tumour[i]) envelope[i] = 1;
    if (g.kidney[i]) {
      ipsilateral += 1;
      if (inEnvelope) removed += 1;
      else residual += 1;
    }
    if (g.tumour[i]) tumourCount += 1;
    if (inEnvelope && (g.kidney[i] || g.tumour[i])) resection += 1;
  }
  return {
    planning: {
      marginMm,
      tumourMl: tumourCount * voxelMl,
      ipsilateralKidneyMl: ipsilateral * voxelMl,
      contralateralKidneyMl: extras.contralateralKidneyMl,
      resectionMl: resection * voxelMl,
      parenchymaRemovedMl: removed * voxelMl,
      residualIpsilateralMl: residual * voxelMl,
      preservedFraction: residual / Math.max(1, ipsilateral),
      cystMl: extras.cystMl,
      tumourToSinusMm: extras.tumourToSinusMm,
      contactSurfaceCm2: extras.contactSurfaceCm2,
    },
    envelope,
  };
}

/** Cut a grid down to the tumour-side kidney and tumour, with room for a 10 mm margin. */
export function scoringBox(kidney: Uint8Array, tumour: Uint8Array, dims: Dims, affine: Affine) {
  const spacing = spacingOf(affine);
  const box = bboxOf(orMask(kidney, tumour), dims);
  if (!box) return null;
  const pad: Vec3 = [Math.ceil(12 / spacing[0]) + 1, Math.ceil(12 / spacing[1]) + 1, Math.ceil(12 / spacing[2]) + 1];
  const padded = padBox(box, pad, dims);
  const make = (length: number) => new Uint8Array(length);
  return {
    dims: boxDims(padded),
    affine: shiftAffine(affine, padded.lo),
    kidney: cropVolume(kidney, dims, padded, make),
    tumour: cropVolume(tumour, dims, padded, make),
    offset: padded.lo,
  };
}
