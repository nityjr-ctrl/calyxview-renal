import publicResult from 'virtual:calyxview-benchmark';

export type {
  AggregateMetric,
  AvailableBenchmarkResult,
  BenchmarkMetrics,
  BenchmarkResult,
  BenchmarkResultState,
  UnavailableBenchmarkResult,
} from './benchmark-results-contract';

export const benchmarkResults = publicResult;

// Visible placeholders avoid dashes; they only show if a value is missing.
const NOT_YET = 'not yet';

/** Dice and surface Dice on a 0 to 1 scale, 3 dp, the same as the pipeline section. */
export function formatBenchmarkScore(value: number | null): string {
  return value === null ? NOT_YET : value.toFixed(3);
}

export function formatScoreConfidenceInterval(
  value: [number, number] | null,
): string {
  if (value === null) {
    return 'Waiting for the full run';
  }

  return `95% CI ${value[0].toFixed(3)} to ${value[1].toFixed(3)}`;
}

export function formatBenchmarkMeasurement(
  value: number | null,
  unit: 'mm' | 'ml',
): string {
  return value === null ? NOT_YET : `${value.toFixed(1)} ${unit}`;
}

export function formatMeasurementConfidenceInterval(
  value: [number, number] | null,
  unit: 'mm' | 'ml',
): string {
  if (value === null) {
    return 'Waiting for the full run';
  }

  return `95% CI ${value[0].toFixed(1)} to ${value[1].toFixed(1)} ${unit}`;
}

export function formatRuntime(value: number | null): string {
  if (value === null) {
    return NOT_YET;
  }

  if (value < 60) {
    return `${value.toFixed(1)} s`;
  }

  return `${(value / 60).toFixed(1)} min`;
}
