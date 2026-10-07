import publicSummary from '@/pipeline/results/summary.public.json';

// Aggregate, identifier-free results from the renalplan pipeline
// (pipeline/results/summary.public.json, built by pipeline/scripts/make_public_summary.py).
// The site only ever reads this small JSON; no scans, labels or predictions are bundled.

export interface NephrometryCase {
  case: number;
  renal: string;
  renalTotal: number;
  renalComplexity: string;
  padua: number;
  paduaComplexity: string;
  tumourMl: number;
  diameterCm: number;
  exophyticFraction: number;
  tumourToSinusMm: number;
  ipsilateralKidneyMl: number;
  /** The other kidney's outlined volume. Near zero when it isn't in the outlines. */
  otherKidneyMl?: number;
  preservedFraction: number;
  runtimeSeconds: number;
  /** Other tumour-labelled pieces in the label map. The scores are for the largest. */
  extraTumourPieces?: number;
  /**
   * The sinus estimate was too small or off-centre to set the polar lines, so they were put
   * where 30% of the kidney's volume lies beyond each (its 30th and 70th percentiles along the
   * long axis, roughly a third and two thirds of the way along, not 30% and 70% of the length).
   */
  polarLinesAssumed?: boolean;
  /** The sinus estimate was far too big for a renal sinus, so the kidney isn't the usual shape (a horseshoe kidney does this). */
  sinusEstimateTooLarge?: boolean;
}

export interface PostprocessRow {
  rules: string;
  kidneyAndMassDice: number;
  massDice: number;
  tumourDice: number;
  tumourHd95Mm: number;
}

export interface RegionStat {
  mean: number;
  ci95: [number, number];
}

export type RegionSummary = Record<
  'kidney_and_mass' | 'mass' | 'tumour',
  Record<'dice' | 'surface_dice' | 'hd95_mm' | 'volume_error_ml', RegionStat>
>;

export interface MeshRow {
  structure: string;
  taubinIterations: number;
  targetFaces: number;
  dice: number;
  hd95Mm: number;
  absVolumeErrorPct: number;
}

export interface PipelineSummary {
  schemaVersion: number;
  researchOnly: boolean;
  generatedAtUtc: string;
  tool: string;
  dataset: string;
  note: string;
  nephrometry: { cases: NephrometryCase[]; casesEvaluated: number; medianRuntimeSeconds: number };
  postprocess: {
    casesEvaluated: number;
    configurationsTried: number;
    inputNote: string;
    rows: PostprocessRow[];
    best: { name: string; params: Record<string, number | boolean>; meanDice: number };
    /** How many rule combinations share the best score. */
    tiedForBest: number;
    baselineMeanDice: number;
  };
  evaluation: { raw: RegionSummary; postprocessed: RegionSummary };
  mesh: {
    casesEvaluated: number;
    criteria: { min_dice: number; max_abs_volume_error_pct: number };
    recommended: Record<string, { taubin_iter: number; target_faces: number; mean_dice: number; mean_hd95_mm: number; mean_abs_volume_error_pct: number } | null>;
    table: MeshRow[];
    /** Worst per-setting means (each setting averaged over the sweep cases). */
    minDice: number;
    maxAbsVolumeErrorPct: number;
    /** Worst single-case values across the whole sweep. */
    caseMinDice: number;
    caseMaxAbsVolumeErrorPct: number;
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Minimal contract check: the section stays hidden rather than showing a broken table. */
export function parsePipelineSummary(input: unknown): PipelineSummary | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as PipelineSummary;
  if (candidate.schemaVersion !== 1 || candidate.researchOnly !== true) return null;
  const cases = candidate.nephrometry?.cases;
  if (!Array.isArray(cases) || cases.length === 0) return null;
  for (const row of cases) {
    if (!isFiniteNumber(row.case) || typeof row.renal !== 'string' || !isFiniteNumber(row.tumourMl)) {
      return null;
    }
  }
  if (!isFiniteNumber(candidate.nephrometry.medianRuntimeSeconds)) return null;
  if (!Array.isArray(candidate.postprocess?.rows) || candidate.postprocess.rows.length === 0) return null;
  if (!isFiniteNumber(candidate.postprocess.tiedForBest)) return null;
  if (!Array.isArray(candidate.mesh?.table) || candidate.mesh.table.length === 0) return null;
  if (
    !isFiniteNumber(candidate.mesh.minDice) ||
    !isFiniteNumber(candidate.mesh.maxAbsVolumeErrorPct) ||
    !isFiniteNumber(candidate.mesh.caseMinDice) ||
    !isFiniteNumber(candidate.mesh.caseMaxAbsVolumeErrorPct)
  ) {
    return null;
  }
  if (!candidate.evaluation?.raw?.tumour?.dice || !candidate.evaluation?.postprocessed?.tumour?.dice) return null;
  return candidate;
}

export const pipelineResults = parsePipelineSummary(publicSummary);

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** A share in whole percent, or to one decimal between 0 and 10%, so 0.025 reads 2.5% rather than rounding up to 3%. */
export function formatShare(value: number): string {
  return formatPercent(value, value > 0 && value < 0.1 ? 1 : 0);
}

export function formatDice(value: number): string {
  return value.toFixed(3);
}

/** "95% CI 0.993 to 0.996": the site avoids en dashes in ranges. */
export function formatCi(interval: [number, number], format: (value: number) => string, unit = ''): string {
  return `95% CI ${format(interval[0])} to ${format(interval[1])}${unit}`;
}
