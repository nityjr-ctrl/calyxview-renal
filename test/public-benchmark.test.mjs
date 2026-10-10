import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { publicBenchmark } from '../lib/public-benchmark.ts';
import { parsePublicBenchmarkSummary } from '../lib/benchmark-results-contract.ts';

const raw = JSON.parse(await readFile(new URL('../research/kits23-feasibility/results/summary.public.json', import.meta.url)));
test('publication preserves evidence and excludes implementation metadata', () => {
  const internal = parsePublicBenchmarkSummary(raw);
  const published = publicBenchmark(raw);
  assert.notEqual(published.state, 'unavailable');
  for (const key of ['state', 'schemaVersion', 'researchOnly', 'metrics', 'evaluation', 'runtime', 'generatedAtUtc']) {
    assert.deepEqual(published[key], internal[key], key);
  }
  assert.equal(published.protocol.cohortSize, internal.protocol.cohortSize);
  assert.match(published.protocol.configuration, /not the combined model/);
  assert.doesNotMatch(JSON.stringify(published), /nnU-Net|Task135|github|sourceRevision|checkpoint|fold_/i);
  assert.deepEqual(publicBenchmark({}), parsePublicBenchmarkSummary({}));
  const corrupt = structuredClone(raw);
  corrupt.protocol.model = 'different model';
  assert.equal(publicBenchmark(corrupt).state, 'unavailable');
});
