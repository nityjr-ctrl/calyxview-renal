import { parsePublicBenchmarkSummary, type BenchmarkResult } from './benchmark-results-contract.ts';

/** Validate the original evidence before projecting it into the public build. */
export function publicBenchmark(summary: unknown): BenchmarkResult {
  const result = parsePublicBenchmarkSummary(summary);
  if (result.state === 'unavailable') return result;
  return {
    ...result,
    protocol: {
      ...result.protocol,
      model: 'UroRef CalyxView AI: historical component test',
      configuration: 'Unchanged research component; not the combined model',
    },
  };
}
