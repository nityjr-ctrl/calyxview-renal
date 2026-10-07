// The builder's report text: the estimate line, the rules, how it differs
// from renalplan, and the JSON and Markdown downloads. Kept apart from the
// maths so the viewer can show it without loading the builder itself.

import type { BuildReport } from './build.ts';

export const ESTIMATE_LINE =
  'Estimated in the browser from the outline; same rules as renalplan but approximate; not validated.';

export const BROWSER_DIFFERENCES = [
  'Uses every voxel for the centroids, long axis and percentiles, where renalplan samples up to 60,000.',
  'The largest tumour diameter is exact over the voxel centres, where renalplan samples 8,000 surface voxels.',
  'The surfaces come from a signed distance field resampled to an isotropic grid of at least 1 mm, lightly smoothed, then marching cubes and 5 Taubin passes, where renalplan meshes the binary mask directly with 15 passes and decimates. They are for display; the scores use the voxels.',
  'A large outline is sampled every nth voxel before anything else runs, and the report says so.',
];

export const RULES = [
  'R: largest tumour diameter. 4 cm or less scores 1, over 4 and under 7 cm 2, 7 cm or more 3.',
  'E: share of the tumour outside the convex hull of the kidney. 50% or more scores 1, more than 5% scores 2, 5% or less counts as endophytic and scores 3.',
  'N: distance from the tumour to the collecting system or sinus. 7 mm or more scores 1, over 4 and under 7 mm 2, 4 mm or less 3. Here it is measured to an estimated sinus.',
  'A: tumour centre against the kidney centre along the anterior axis. More than 5 mm anterior is a, more than 5 mm posterior is p, otherwise x.',
  'L: tumour extent (2nd to 98th percentile) against the polar lines. Entirely between them, crossing the axial midline, or more than half between scores 3. Entirely above or below scores 1. Otherwise 2.',
  'R.E.N.A.L. total 4 to 6 is low complexity, 7 to 9 moderate, 10 to 12 high. The h suffix needs a vessel outline.',
  'PADUA: pole (middle 2, upper or lower 1), exophytic rate (as E), rim (medial 2, lateral 1), renal sinus (involved 2), collecting system (involved 2), size (4 cm or less 1, over 4 up to 7 cm 2, over 7 cm 3). 6 or 7 is low, 8 or 9 intermediate, 10 or more high.',
  'Kept kidney: share of the tumour-side kidney outside a uniform band round the tumour. Volume, not function, and not a surgical plan.',
];

const DISCLAIMER =
  'Research and teaching only. Not validated, not a medical device, not for diagnosis, treatment or surgical planning.';

export function reportJson(report: BuildReport): string {
  return JSON.stringify(
    {
      tool: 'CalyxView Renal browser builder',
      ...report,
      estimate: ESTIMATE_LINE,
      rules: RULES,
      browserDifferences: BROWSER_DIFFERENCES,
      coordinates: 'Meshes are in RAS millimetres from the file’s affine (+x patient right, +y anterior, +z superior).',
      disclaimer: DISCLAIMER,
    },
    null,
    2,
  );
}

const fixed = (value: number | null | undefined, digits: number) =>
  value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : value.toFixed(digits);

export function reportMarkdown(report: BuildReport): string {
  const lines: string[] = [];
  lines.push('# CalyxView Renal: browser build report', '');
  lines.push(`> ${ESTIMATE_LINE}`, `> ${DISCLAIMER}`, '');
  lines.push(`Source: ${report.source === 'sample' ? 'the built-in synthetic sample (no patient data)' : 'a label map loaded in the browser'}.`);
  lines.push(
    `Grid: ${report.grid.workingDims.join(' x ')} voxels of ${report.grid.spacingMm.map((s) => s.toFixed(2)).join(' x ')} mm${report.grid.downsampled ? ' (sampled from a larger grid)' : ''}. Orientation from the ${report.grid.affineSource}.`,
  );
  lines.push(`Rules: ${report.rulesFrom}. Built in ${(report.totalMs / 1000).toFixed(1)} s.`, '');
  lines.push('## Structures', '');
  for (const label of report.labels) lines.push(`- Label ${label.value} (${label.name}): ${label.ml.toFixed(1)} ml`);
  lines.push('');
  if (report.renal && report.padua && report.planning) {
    const r = report.renal;
    const p = report.padua;
    const m = report.planning;
    lines.push('## Scores', '');
    lines.push(`- R.E.N.A.L. ${r.label} (${r.complexity}): R ${r.radiusPoints}, E ${r.exophyticPoints}, N ${r.nearnessPoints}, L ${r.locationPoints}, ${r.face}. h not assessed.`);
    lines.push(`- PADUA ${p.total} (${p.complexity}): pole ${p.polarPoints} (${p.polarLocation}), exophytic ${p.exophyticPoints}, rim ${p.rimPoints} (${p.rim}), sinus ${p.sinusPoints}, collecting system ${p.collectingPoints} (not assessed), size ${p.sizePoints}.`);
    lines.push(`- Tumour: ${fixed(r.radiusCm, 2)} cm largest diameter, ${fixed(m.tumourMl, 1)} ml, ${(r.exophyticFraction * 100).toFixed(1)}% outside the kidney's hull.`);
    lines.push(`- Distance to the estimated sinus: ${fixed(r.nearnessMm, 1)} mm. Location: ${r.locationDetail}.`);
    lines.push(`- Tumour-side kidney ${fixed(m.ipsilateralKidneyMl, 1)} ml; other kidney ${fixed(m.contralateralKidneyMl, 1)} ml; cyst ${fixed(m.cystMl, 1)} ml.`);
    lines.push(`- Kept at a ${m.marginMm} mm margin: ${(m.preservedFraction * 100).toFixed(1)}% of the tumour-side kidney.`, '');
  } else {
    lines.push('## Scores', '', `Not scored. ${report.notScoredReason ?? ''}`, '');
  }
  if (report.meshVolumes.length) {
    lines.push('## Surfaces', '');
    for (const v of report.meshVolumes) {
      lines.push(`- ${v.label}: mesh ${v.meshMl.toFixed(1)} ml, voxels ${v.voxelMl.toFixed(1)} ml, on a ${v.gridMm.toFixed(2)} mm grid`);
    }
    lines.push('');
  }
  lines.push('## Rules', '');
  for (const rule of RULES) lines.push(`- ${rule}`);
  lines.push('', '## Flags and notes', '');
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push('', '## How this differs from renalplan', '');
  for (const item of BROWSER_DIFFERENCES) lines.push(`- ${item}`);
  lines.push('', 'Meshes are in RAS millimetres from the file’s affine (+x patient right, +y anterior, +z superior).', '');
  return lines.join('\n');
}
