import publicSummary from '@/research/kits23-feasibility/results/summary.public.json';

export type BenchmarkStatus = 'running' | 'complete';

export interface AggregateMetric {
  diceMean: number | null;
  diceMeanCi95: [number, number] | null;
  surfaceDiceMean: number | null;
  surfaceDiceMeanCi95: [number, number] | null;
  hd95MmMean: number | null;
  hd95MmMeanCi95: [number, number] | null;
  volumeMaeMlMean: number | null;
  volumeMaeMlMeanCi95: [number, number] | null;
}

export interface PublicBenchmarkSummary {
  schemaVersion: 2;
  status: BenchmarkStatus;
  researchOnly: true;
  title: string;
  generatedAtUtc: string | null;
  protocol: {
    dataset: string;
    model: string;
    configuration: string;
    cohortSize: number;
    evaluatedCases: number | null;
    successfulCases: number | null;
    failedCases: number | null;
    labelSource: string;
    scope: string;
  };
  metrics: {
    kidneyAndMass: AggregateMetric;
    mass: AggregateMetric;
    tumour: AggregateMetric;
  };
  runtime: {
    medianSecondsPerCase: number | null;
    totalSeconds: number | null;
  };
  provenance: {
    datasetRevision: string;
    imagingRevision: string;
    datasetSourceIdentityScope: string;
    portableManifestSha256: string;
    modelArchiveMd5: string;
    modelArchiveSha256: string;
    nnunetCommit: string;
    runtimeSourceIdentityScope: string;
  };
}

export const benchmarkResults = publicSummary as PublicBenchmarkSummary;

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
