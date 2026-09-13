import publicSummary from '@/research/kits23-feasibility/results/summary.public.json';

import { parsePublicBenchmarkSummary } from './benchmark-results-contract';

export type {
  AggregateMetric,
  AvailableBenchmarkResult,
  BenchmarkMetrics,
  BenchmarkResult,
  BenchmarkResultState,
  UnavailableBenchmarkResult,
} from './benchmark-results-contract';

export const benchmarkResults = parsePublicBenchmarkSummary(publicSummary);

export function formatBenchmarkPercent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

export function formatConfidenceInterval(
  value: [number, number] | null,
): string {
  if (value === null) {
    return 'Awaiting completed run';
  }

  return `95% CI ${(value[0] * 100).toFixed(1)}–${(value[1] * 100).toFixed(1)}%`;
}

export function formatBenchmarkMeasurement(
  value: number | null,
  unit: 'mm' | 'mL',
): string {
  return value === null ? '—' : `${value.toFixed(1)} ${unit}`;
}

export function formatMeasurementConfidenceInterval(
  value: [number, number] | null,
  unit: 'mm' | 'mL',
): string {
  if (value === null) {
    return 'Awaiting completed run';
  }

  return `95% CI ${value[0].toFixed(1)}–${value[1].toFixed(1)} ${unit}`;
}

export function formatRuntime(value: number | null): string {
  if (value === null) {
    return '—';
  }

  if (value < 60) {
    return `${value.toFixed(1)} sec`;
  }

  return `${(value / 60).toFixed(1)} min`;
}
