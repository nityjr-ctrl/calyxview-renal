// The builder's whole run, from label map to meshes and scores. Used by the
// Web Worker in the browser and directly by the Node tests. Nothing here
// reads or writes anything except the arrays it's given.

import type { Affine, Dims, Vec3 } from './volume.ts';
import {
  andNotMask,
  anySet,
  bboxOf,
  boxDims,
  components6,
  countMask,
  cropVolume,
  equalsMask,
  orMask,
  padBox,
  shiftAffine,
  spacingOf,
  strideAffine,
  voxelCount,
} from './volume.ts';
import { maskToSurface, meshVolume, type Surface } from './marching-cubes.ts';
import {
  CYST,
  KIDNEY,
  NOTE_NO_COLLECTING,
  NOTE_NO_VESSELS,
  TUMOUR,
  buildGeometry,
  contactSurfaceCm2,
  indexLesion,
  paduaScore,
  planMargin,
  relativePosition,
  renalScore,
  scoringBox,
  tumourBearingKidney,
  tumourDistance,
  type Geometry,
  type PaduaScore,
  type Planning,
  type RenalScore,
} from './nephrometry.ts';
import { INVALID_AFFINE, affineUsable, readNifti, toLabelMap } from './nifti.ts';
import { WARNING } from './report.ts';
import { PHANTOM_DIMS, buildPhantomLabels, phantomAffine } from './phantom.ts';

export { BROWSER_DIFFERENCES, ESTIMATE_LINE, RULES, WARNING, keptPercent, reportJson, reportMarkdown } from './report.ts';

export const BUILDER_VERSION = '1.0.0';
export const RENALPLAN_VERSION = '0.2.0';

/** Grids bigger than this, after cropping, are sampled every nth voxel. */
export const MAX_SIDE = 512;
export const MAX_VOXELS = 20_000_000;

export type Stage = 'reading' | 'checking' | 'labelling' | 'scoring' | 'meshing' | 'done';
export type ProgressFn = (stage: Stage, message: string, fraction: number) => void;

export type StructureMesh = {
  name: string;
  label: string;
  provenance: string;
  colour: string;
  opacity: number;
  visible: boolean;
  framing: boolean;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Volume of the voxels the mesh came from, in ml. */
  volumeMl: number;
  /** Volume enclosed by the mesh, in ml. */
  meshMl: number;
  /** Isotropic grid the surface was built on, in mm. */
  surfaceGridMm: number;
};

export type MeshVolume = { name: string; label: string; voxelMl: number; meshMl: number; gridMm: number };

export type LabelSummary = { value: number; name: string; voxels: number; ml: number };

export type BuildReport = {
  builderVersion: string;
  rulesFrom: string;
  source: 'sample' | 'file';
  grid: {
    fileDims: Dims;
    croppedDims: Dims;
    workingDims: Dims;
    stride: Vec3;
    downsampled: boolean;
    spacingMm: Vec3;
    affineSource: string;
  };
  labels: LabelSummary[];
  scored: boolean;
  notScoredReason: string | null;
  renal: RenalScore | null;
  padua: PaduaScore | null;
  planning: Planning | null;
  flags: {
    polarLinesAssumed: boolean;
    sinusEstimateTooLarge: boolean;
    otherTumourPieces: number;
    contralateralKidneyPresent: boolean;
    /** No voxel face where the tumour meets the scored kidney. */
    tumourDetached: boolean;
    /** The estimated sinus is under 1% of the kidney's volume. */
    sinusEstimateSmall: boolean;
    /** The two largest tumour pieces are within 5% of each other. */
    similarTumourPieces: boolean;
    /** The tumour or the scored kidney reaches a face of the scan. */
    touchesEdge: boolean;
    /** Neither sform nor qform: axes came from pixdim. */
    orientationAssumed: boolean;
    kidneyVolumeUnusual: boolean;
    tumourOver15Cm: boolean;
    kidneyFragmented: boolean;
    spacingUnusual: boolean;
  };
  /** Plain statements that change how the scores should be read. Shown above them. */
  warnings: string[];
  /** Each surface's enclosed volume next to the voxel volume it came from. */
  meshVolumes: MeshVolume[];
  notes: string[];
  timingsMs: Record<string, number>;
  totalMs: number;
};

export type BuildOutput = { report: BuildReport; meshes: StructureMesh[] };

/** What the worker keeps so the margin can be changed afterwards. */
export type MarginState = {
  geometry: Geometry;
  toTumour: Float64Array | Float32Array;
  extras: { contralateralKidneyMl: number; cystMl: number; tumourToSinusMm: number | null; contactSurfaceCm2: number };
  source: 'sample' | 'file';
};

const STRUCTURE_COLOURS = ['#9bd0c4', '#b9a3d6', '#d6c48f', '#8fb0d6', '#d69bb4', '#a6d68f'];

function labelName(value: number): string {
  if (value === KIDNEY) return 'Kidney';
  if (value === TUMOUR) return 'Tumour';
  if (value === CYST) return 'Cyst';
  return `Structure ${value}`;
}

function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

/** Strides that bring the grid under MAX_SIDE a side and MAX_VOXELS in all. */
export function chooseStride(dims: Dims): Vec3 {
  const stride: Vec3 = [1, 1, 1];
  for (let a = 0; a < 3; a += 1) stride[a] = Math.max(1, Math.ceil(dims[a] / MAX_SIDE));
  const size = () => dims.reduce((total, d, a) => total * Math.ceil(d / stride[a]), 1);
  while (size() > MAX_VOXELS) {
    let widest = 0;
    for (let a = 1; a < 3; a += 1) if (Math.ceil(dims[a] / stride[a]) > Math.ceil(dims[widest] / stride[widest])) widest = a;
    stride[widest] += 1;
  }
  return stride;
}

function strideVolume(labels: Uint8Array, dims: Dims, stride: Vec3): { labels: Uint8Array; dims: Dims } {
  const [nx, ny] = dims;
  const out: Dims = [Math.ceil(dims[0] / stride[0]), Math.ceil(dims[1] / stride[1]), Math.ceil(dims[2] / stride[2])];
  const data = new Uint8Array(voxelCount(out));
  let o = 0;
  for (let k = 0; k < out[2]; k += 1) {
    for (let j = 0; j < out[1]; j += 1) {
      const row = nx * (j * stride[1] + ny * k * stride[2]);
      for (let i = 0; i < out[0]; i += 1) data[o++] = labels[row + i * stride[0]];
    }
  }
  return { labels: data, dims: out };
}

function toStructure(
  mesh: Surface | null,
  meta: Omit<StructureMesh, 'positions' | 'normals' | 'indices' | 'meshMl' | 'surfaceGridMm'>,
): StructureMesh | null {
  if (!mesh || mesh.indices.length === 0) return null;
  return {
    ...meta,
    positions: mesh.positions,
    normals: mesh.normals,
    indices: mesh.indices,
    meshMl: meshVolume(mesh) / 1000,
    surfaceGridMm: mesh.gridMm,
  };
}

export function meshVolumes(meshes: StructureMesh[]): MeshVolume[] {
  return meshes.map((mesh) => ({
    name: mesh.name,
    label: mesh.label,
    voxelMl: mesh.volumeMl,
    meshMl: mesh.meshMl,
    gridMm: mesh.surfaceGridMm,
  }));
}

/** Read a .nii or .nii.gz held in memory, then build. */
export async function buildFromNifti(buffer: ArrayBuffer, marginMm: number, progress: ProgressFn) {
  const started = nowMs();
  progress('reading', 'Reading the file', 0.05);
  const volume = await readNifti(buffer);
  const read = nowMs();
  progress('checking', 'Checking it’s an outline, not a CT', 0.12);
  const check = toLabelMap(volume.data);
  if (!check.ok) throw new Error(check.message);
  const result = buildFromLabels(check.labels, volume.dims, volume.affine, volume.affineSource, 'file', marginMm, progress);
  result.output.report.timingsMs = { reading: Math.round(read - started), ...result.output.report.timingsMs };
  result.output.report.totalMs = Math.round(nowMs() - started);
  return result;
}

/** The built-in synthetic sample. */
export function buildSample(marginMm: number, progress: ProgressFn) {
  const started = nowMs();
  progress('reading', 'Making the synthetic sample', 0.05);
  const labels = buildPhantomLabels();
  const made = nowMs();
  const result = buildFromLabels(labels, PHANTOM_DIMS, phantomAffine(), 'sform', 'sample', marginMm, progress);
  result.output.report.timingsMs = { making: Math.round(made - started), ...result.output.report.timingsMs };
  result.output.report.totalMs = Math.round(nowMs() - started);
  return result;
}

export function buildFromLabels(
  fileLabels: Uint8Array,
  fileDims: Dims,
  fileAffine: Affine,
  affineSource: string,
  source: 'sample' | 'file',
  marginMm: number,
  progress: ProgressFn,
): { output: BuildOutput; state: MarginState | null } {
  const timings: Record<string, number> = {};
  let mark = nowMs();
  const lap = (name: string) => {
    const now = nowMs();
    timings[name] = Math.round(now - mark);
    mark = now;
  };
  const notes: string[] = [];
  const warnings: string[] = [];
  const own = source === 'sample' ? 'Synthetic sample' : 'Your outline';
  if (!affineUsable(fileAffine)) throw new Error(INVALID_AFFINE);
  const orientationAssumed = affineSource === 'pixdim';
  if (orientationAssumed) warnings.push(WARNING.orientation);

  // Crop to everything outlined, plus room for a 10 mm margin and the closing.
  progress('labelling', 'Finding the outlined structures', 0.18);
  const anyLabel = new Uint8Array(fileLabels.length);
  for (let i = 0; i < fileLabels.length; i += 1) anyLabel[i] = fileLabels[i] ? 1 : 0;
  const box = bboxOf(anyLabel, fileDims);
  if (!box) throw new Error('Every voxel in this file is 0, so there’s nothing outlined to build.');
  const fileSpacing = spacingOf(fileAffine);
  const spacingUnusual = fileSpacing.some((s) => s < 0.3 || s > 6);
  const pad: Vec3 = [0, 1, 2].map((a) => Math.ceil(12 / fileSpacing[a]) + 2) as Vec3;
  const cropBox = padBox(box, pad, fileDims);
  const croppedDims = boxDims(cropBox);
  let labels = cropVolume(fileLabels, fileDims, cropBox, (n) => new Uint8Array(n));
  let dims = croppedDims;
  let affine = shiftAffine(fileAffine, cropBox.lo);
  const stride = chooseStride(dims);
  const downsampled = stride.some((s) => s > 1);
  if (downsampled) {
    const strided = strideVolume(labels, dims, stride);
    labels = strided.labels;
    dims = strided.dims;
    affine = strideAffine(affine, stride);
  }
  const spacing = spacingOf(affine);
  const voxelMl = (spacing[0] * spacing[1] * spacing[2]) / 1000;
  if (downsampled) {
    notes.push(
      `The outlined region was ${croppedDims.join(' x ')} voxels, so the builder used every ${stride.join(', ')} voxel along each axis (voxels of ${spacing.map((s) => s.toFixed(2)).join(' x ')} mm). Scores and meshes come from that coarser grid.`,
    );
  }

  const counts = new Map<number, number>();
  for (let i = 0; i < labels.length; i += 1) if (labels[i]) counts.set(labels[i], (counts.get(labels[i]) ?? 0) + 1);
  const values = [...counts.keys()].sort((a, b) => a - b);
  const labelSummary: LabelSummary[] = values.map((value) => ({
    value,
    name: labelName(value),
    voxels: counts.get(value) ?? 0,
    ml: (counts.get(value) ?? 0) * voxelMl,
  }));
  lap('labelling');

  const kidneyAll = equalsMask(labels, KIDNEY);
  const tumourAll = equalsMask(labels, TUMOUR);
  const cystAll = equalsMask(labels, CYST);
  const hasKidney = anySet(kidneyAll);
  const hasTumour = anySet(tumourAll);

  let lesion = tumourAll;
  let otherPieces = 0;
  let similarPieces = false;
  let ipsilateral = kidneyAll;
  if (hasTumour) {
    const index = indexLesion(tumourAll, dims);
    lesion = index.mask;
    otherPieces = index.others;
    similarPieces = index.similar;
    if (similarPieces && index.scoredCentre && index.runnerUpCentre) {
      warnings.push(WARNING.similarPieces(relativePosition(index.scoredCentre, index.runnerUpCentre, affine)));
      if (otherPieces > 1) {
        const rest = otherPieces - 1;
        notes.push(
          `${rest === 1 ? 'One more, smaller piece' : `${rest} more, smaller pieces`} labelled tumour ${rest === 1 ? 'is' : 'are'} also in the outline and not scored.`,
        );
      }
    } else if (otherPieces) {
      notes.push(
        `${otherPieces === 1 ? 'One more, smaller piece' : `${otherPieces} more, smaller pieces`} labelled tumour ${otherPieces === 1 ? 'is' : 'are'} in the outline. The scores are for the largest.`,
      );
    }
  }
  if (hasKidney && hasTumour) ipsilateral = tumourBearingKidney(kidneyAll, lesion, dims, spacing);
  const contralateral = andNotMask(kidneyAll, ipsilateral);
  const contralateralPresent = hasTumour && anySet(contralateral);

  // A structure on a face of the scan may continue beyond it.
  const touchesEdge =
    (hasTumour && touchesFileEdge(lesion, dims, cropBox.lo, stride, fileDims)) ||
    (hasKidney && touchesFileEdge(ipsilateral, dims, cropBox.lo, stride, fileDims));
  if (touchesEdge) warnings.push(WARNING.edge);
  const kidneyPieces = hasKidney ? components6(kidneyAll, dims).sizes.filter((size) => size * voxelMl > 1).length : 0;
  const kidneyFragmented = kidneyPieces > 3;
  const ipsilateralMl = hasKidney ? countMask(ipsilateral) * voxelMl : 0;
  const kidneyVolumeUnusual = hasKidney && (ipsilateralMl < 60 || ipsilateralMl > 600);
  lap('kidneys');

  // Scores.
  let renal: RenalScore | null = null;
  let padua: PaduaScore | null = null;
  let planning: Planning | null = null;
  let state: MarginState | null = null;
  let notScoredReason: string | null = null;
  let geometry: Geometry | null = null;
  let envelopeMesh: Surface | null = null;
  let envelopeMl = 0;
  let subAffine: Affine | null = null;
  let sinusEstimateSmall = false;
  if (!hasKidney) notScoredReason = 'There’s no kidney label (1) in the outline, so nothing could be scored.';
  else if (!hasTumour) notScoredReason = 'There’s no tumour label (2) in the outline, so nothing could be scored. The meshes are still built.';
  if (!notScoredReason) {
    progress('scoring', 'Estimating the sinus and scoring', 0.32);
    const sub = scoringBox(ipsilateral, lesion, dims, affine);
    if (sub) {
      try {
        geometry = buildGeometry(sub.kidney, sub.tumour, sub.dims, sub.affine);
        subAffine = sub.affine;
        renal = renalScore(geometry);
        padua = paduaScore(geometry, renal);
        const toTumour = tumourDistance(geometry);
        const extras = {
          contralateralKidneyMl: countMask(contralateral) * voxelMl,
          cystMl: countMask(cystAll) * voxelMl,
          tumourToSinusMm: renal.nearnessRawMm,
          contactSurfaceCm2: contactSurfaceCm2(geometry.tumour, geometry.kidney, geometry.dims, geometry.spacing),
        };
        const margin = planMargin(geometry, toTumour, marginMm, extras);
        planning = margin.planning;
        state = { geometry, toTumour, extras, source };
        notes.push(...geometry.notes, NOTE_NO_VESSELS, NOTE_NO_COLLECTING);
        sinusEstimateSmall = countMask(geometry.sinus) < 0.01 * countMask(geometry.kidney);
        envelopeMesh = maskToSurface(orMask(margin.envelope, geometry.tumour), geometry.dims, sub.affine, { keepLargest: true });
        // The surface is the outer face of the band, so compare it with band plus tumour.
        envelopeMl = (countMask(margin.envelope) + countMask(geometry.tumour)) * voxelMl;
      } catch (error) {
        notScoredReason = error instanceof Error ? error.message : String(error);
        geometry = null;
      }
    }
  }
  lap('scoring');

  const tumourDetached = Boolean(planning && planning.contactSurfaceCm2 === 0);
  if (tumourDetached) warnings.push(WARNING.tumourDetached);
  if (sinusEstimateSmall) warnings.push(WARNING.sinusSmall);
  const tumourOver15Cm = Boolean(renal && renal.radiusCm > 15);
  if (renal && tumourOver15Cm) warnings.push(WARNING.tumourSize(renal.radiusCm));
  if (kidneyVolumeUnusual) warnings.push(WARNING.kidneyVolume(ipsilateralMl));
  if (kidneyFragmented) warnings.push(WARNING.fragmented(kidneyPieces));
  if (spacingUnusual) warnings.push(WARNING.spacing(fileSpacing));

  // Meshes.
  const meshes: StructureMesh[] = [];
  const add = (mesh: StructureMesh | null) => {
    if (mesh) meshes.push(mesh);
  };
  const jobs: Array<{ title: string; run: () => StructureMesh | null }> = [];
  const meshOf = (mask: Uint8Array, keepLargest: boolean) => maskToSurface(mask, dims, affine, { keepLargest });
  if (hasKidney) {
    jobs.push({
      title: 'kidney',
      run: () =>
        toStructure(meshOf(ipsilateral, hasTumour), {
          name: 'parenchyma',
          label: contralateralPresent ? 'Kidney (tumour side)' : 'Kidney',
          provenance: `${own}, label 1`,
          colour: '#c9b79b',
          opacity: 0.34,
          visible: true,
          framing: true,
          volumeMl: countMask(ipsilateral) * voxelMl,
        }),
    });
  }
  if (hasTumour) {
    jobs.push({
      title: 'tumour',
      run: () =>
        toStructure(meshOf(lesion, true), {
          name: 'tumour',
          label: 'Tumour',
          provenance: `${own}, label 2`,
          colour: '#d85c60',
          opacity: 1,
          visible: true,
          framing: true,
          volumeMl: countMask(lesion) * voxelMl,
        }),
    });
    if (otherPieces) {
      const others = andNotMask(tumourAll, lesion);
      jobs.push({
        title: 'other tumour pieces',
        run: () =>
          toStructure(meshOf(others, false), {
            name: 'tumour-other',
            label: similarPieces ? 'Other tumour pieces' : 'Smaller tumour pieces',
            provenance: `${own}, label 2, not scored`,
            colour: '#e8a0a2',
            opacity: 0.8,
            visible: true,
            framing: false,
            volumeMl: countMask(others) * voxelMl,
          }),
      });
    }
  }
  if (contralateralPresent) {
    jobs.push({
      title: 'other kidney',
      run: () =>
        toStructure(meshOf(contralateral, false), {
          name: 'contralateral',
          label: 'Other kidney',
          provenance: `${own}, label 1`,
          colour: '#c9b79b',
          opacity: 0.16,
          visible: true,
          framing: false,
          volumeMl: countMask(contralateral) * voxelMl,
        }),
    });
  }
  if (anySet(cystAll)) {
    jobs.push({
      title: 'cyst',
      run: () =>
        toStructure(meshOf(cystAll, false), {
          name: 'cyst',
          label: 'Cyst',
          provenance: `${own}, label 3`,
          colour: '#8fb8d8',
          opacity: 0.7,
          visible: true,
          framing: false,
          volumeMl: countMask(cystAll) * voxelMl,
        }),
    });
  }
  values
    .filter((value) => value > CYST)
    .forEach((value, order) => {
      jobs.push({
        title: `structure ${value}`,
        run: () => {
          const mask = equalsMask(labels, value);
          return toStructure(meshOf(mask, false), {
            name: `label-${value}`,
            label: `Structure ${value}`,
            provenance: `${own}, label ${value}`,
            colour: STRUCTURE_COLOURS[order % STRUCTURE_COLOURS.length],
            opacity: 0.6,
            visible: true,
            framing: false,
            volumeMl: countMask(mask) * voxelMl,
          });
        },
      });
    });
  if (geometry && subAffine) {
    const g = geometry;
    const a = subAffine;
    if (anySet(g.sinus)) {
      jobs.push({
        title: 'estimated sinus',
        run: () =>
          toStructure(maskToSurface(g.sinus, g.dims, a, { keepLargest: true }), {
            name: 'sinus',
            label: 'Estimated sinus',
            provenance: 'Estimated from the outline',
            colour: '#e6cf86',
            opacity: 0.55,
            visible: false,
            framing: false,
            volumeMl: countMask(g.sinus) * voxelMl,
          }),
      });
    }
    if (envelopeMesh) {
      const mesh = envelopeMesh;
      jobs.push({
        title: 'margin band',
        run: () =>
          toStructure(mesh, {
            name: 'margin',
            label: `${marginMm} mm margin band`,
            provenance: 'Tumour plus a uniform band',
            colour: '#f2b880',
            opacity: 0.3,
            visible: false,
            framing: false,
            volumeMl: envelopeMl,
          }),
      });
    }
  }
  jobs.forEach((job, index) => {
    progress('meshing', `Building the ${job.title} surface`, 0.45 + (0.5 * index) / Math.max(1, jobs.length));
    add(job.run());
  });
  lap('meshing');

  const report: BuildReport = {
    builderVersion: BUILDER_VERSION,
    rulesFrom: `CalyxView reference calculation ${RENALPLAN_VERSION}`,
    source,
    grid: {
      fileDims,
      croppedDims,
      workingDims: dims,
      stride,
      downsampled,
      spacingMm: spacing,
      affineSource,
    },
    labels: labelSummary,
    scored: Boolean(renal && padua && planning),
    notScoredReason,
    renal,
    padua,
    planning,
    flags: {
      polarLinesAssumed: geometry?.polarLinesAssumed ?? false,
      sinusEstimateTooLarge: geometry?.sinusEstimateTooLarge ?? false,
      otherTumourPieces: otherPieces,
      contralateralKidneyPresent: contralateralPresent,
      tumourDetached,
      sinusEstimateSmall,
      similarTumourPieces: similarPieces,
      touchesEdge,
      orientationAssumed,
      kidneyVolumeUnusual,
      tumourOver15Cm,
      kidneyFragmented,
      spacingUnusual,
    },
    warnings,
    meshVolumes: meshVolumes(meshes),
    notes,
    timingsMs: timings,
    totalMs: 0,
  };
  const gridSizes = [...new Set(meshes.map((mesh) => mesh.surfaceGridMm.toFixed(2)))];
  if (gridSizes.length) {
    notes.push(
      `The surfaces are drawn from a smoothed distance field resampled to ${gridSizes.join(' and ')} mm cubes, so thick slices don't show as steps. The scores use the original voxels, not the surfaces.`,
    );
  }
  progress('done', 'Done', 1);
  return { output: { report, meshes }, state };
}

/**
 * Whether a mask in the cropped (and possibly strided) grid reaches a face of
 * the original file. Sampled index i on an axis is file index lo + i * stride;
 * the last sample counts as on the face when the next one would be past it.
 */
export function touchesFileEdge(mask: Uint8Array, dims: Dims, lo: Vec3, stride: Vec3, fileDims: Dims): boolean {
  const [nx, ny, nz] = dims;
  const atLow = [lo[0] === 0, lo[1] === 0, lo[2] === 0];
  const atHigh = [0, 1, 2].map((a) => lo[a] + dims[a] * stride[a] >= fileDims[a]);
  let index = 0;
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1, index += 1) {
        if (!mask[index]) continue;
        if ((x === 0 && atLow[0]) || (y === 0 && atLow[1]) || (z === 0 && atLow[2])) return true;
        if ((x === nx - 1 && atHigh[0]) || (y === ny - 1 && atHigh[1]) || (z === nz - 1 && atHigh[2])) return true;
      }
    }
  }
  return false;
}

/** New margin: new numbers and a new band, without redoing the rest. */
export function remargin(state: MarginState, marginMm: number): { planning: Planning; band: StructureMesh | null } {
  const { geometry: g, toTumour, extras } = state;
  const margin = planMargin(g, toTumour, marginMm, extras);
  const voxelMl = (g.spacing[0] * g.spacing[1] * g.spacing[2]) / 1000;
  const band = toStructure(maskToSurface(orMask(margin.envelope, g.tumour), g.dims, g.affine, { keepLargest: true }), {
    name: 'margin',
    label: `${marginMm} mm margin band`,
    provenance: 'Tumour plus a uniform band',
    colour: '#f2b880',
    opacity: 0.3,
    visible: false,
    framing: false,
    volumeMl: (countMask(margin.envelope) + countMask(g.tumour)) * voxelMl,
  });
  return { planning: margin.planning, band };
}

/** Mesh volume in ml, for checks. */
export function structureVolumeMl(structure: StructureMesh): number {
  return meshVolume({ positions: structure.positions, indices: structure.indices }) / 1000;
}
