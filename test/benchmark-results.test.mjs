import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const summaryUrl = new URL(
  '../research/kits23-feasibility/results/summary.public.json',
  import.meta.url,
);
const summaryText = await readFile(summaryUrl, 'utf8');
const summary = JSON.parse(summaryText);
const componentText = await readFile(
  new URL('../components/feasibility-benchmark.tsx', import.meta.url),
  'utf8',
);

const allowedTopLevelKeys = [
  'generatedAtUtc',
  'metrics',
  'protocol',
  'provenance',
  'researchOnly',
  'runtime',
  'schemaVersion',
  'status',
  'title',
];

const forbiddenDataKeys = new Set([
  'caseid',
  'caseids',
  'cases',
  'filename',
  'filenames',
  'filepath',
  'patient',
  'patientid',
  'patientname',
  'path',
  'predictionpath',
  'qcimages',
  'rows',
  'samples',
  'seriesinstanceuid',
  'studyinstanceuid',
]);

const allowedProtocolKeys = [
  'cohortSize',
  'configuration',
  'dataset',
  'evaluatedCases',
  'failedCases',
  'labelSource',
  'model',
  'scope',
  'successfulCases',
];
const allowedMetricKeys = [
  'diceMean',
  'diceMeanCi95',
  'hd95MmMean',
  'hd95MmMeanCi95',
  'surfaceDiceMean',
  'surfaceDiceMeanCi95',
  'volumeMaeMlMean',
  'volumeMaeMlMeanCi95',
];
const allowedRuntimeKeys = ['medianSecondsPerCase', 'totalSeconds'];
const allowedProvenanceKeys = [
  'datasetRevision',
  'datasetSourceIdentityScope',
  'imagingRevision',
  'modelArchiveMd5',
  'modelArchiveSha256',
  'nnunetCommit',
  'portableManifestSha256',
  'runtimeSourceIdentityScope',
];

function visitKeys(value, path = 'summary') {
  if (Array.isArray(value)) {
    assert.equal(
      value.length,
      2,
      `Only two-bound aggregate intervals are allowed at ${path}`,
    );
    assert.equal(
      value.every((item) => typeof item === 'number'),
      true,
      `Aggregate interval must contain only numbers at ${path}`,
    );
    value.forEach((item, index) => visitKeys(item, `${path}[${index}]`));
    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalised = key.replaceAll(/[^a-z0-9]/gi, '').toLowerCase();
    assert.equal(
      forbiddenDataKeys.has(normalised),
      false,
      `Patient- or study-level field is not allowed at ${path}.${key}`,
    );
    visitKeys(child, `${path}.${key}`);
  }
}

function assertUnitInterval(value, label) {
  assert.equal(Number.isFinite(value), true, `${label} must be finite`);
  assert.ok(value >= 0 && value <= 1, `${label} must be between 0 and 1`);
}

function assertInterval(value, label) {
  assert.ok(Array.isArray(value), `${label} must be a two-value array`);
  assert.equal(value.length, 2, `${label} must contain exactly two bounds`);
  assertUnitInterval(value[0], `${label}[0]`);
  assertUnitInterval(value[1], `${label}[1]`);
  assert.ok(value[0] <= value[1], `${label} bounds must be ordered`);
}

function assertNonNegative(value, label) {
  assert.equal(Number.isFinite(value), true, `${label} must be finite`);
  assert.ok(value >= 0, `${label} must be non-negative`);
}

function assertNonNegativeInterval(value, label) {
  assert.ok(Array.isArray(value), `${label} must be a two-value array`);
  assert.equal(value.length, 2, `${label} must contain exactly two bounds`);
  assertNonNegative(value[0], `${label}[0]`);
  assertNonNegative(value[1], `${label}[1]`);
  assert.ok(value[0] <= value[1], `${label} bounds must be ordered`);
}

function assertCompletedSummary(candidate) {
  assert.equal(candidate.protocol.cohortSize, 20);
  assert.equal(candidate.protocol.evaluatedCases, 20);
  assert.equal(Number.isInteger(candidate.protocol.successfulCases), true);
  assert.equal(Number.isInteger(candidate.protocol.failedCases), true);
  assert.ok(candidate.protocol.successfulCases >= 0);
  assert.ok(candidate.protocol.failedCases >= 0);
  assert.ok(candidate.protocol.successfulCases <= 20);
  assert.ok(candidate.protocol.failedCases <= 20);
  assert.equal(
    candidate.protocol.successfulCases + candidate.protocol.failedCases,
    candidate.protocol.evaluatedCases,
  );
  assert.ok(
    Number.isFinite(Date.parse(candidate.generatedAtUtc)),
    'generatedAtUtc must be ISO-like',
  );

  for (const [region, metrics] of Object.entries(candidate.metrics)) {
    assertUnitInterval(metrics.diceMean, `${region}.diceMean`);
    assertInterval(metrics.diceMeanCi95, `${region}.diceMeanCi95`);
    assertUnitInterval(metrics.surfaceDiceMean, `${region}.surfaceDiceMean`);
    assertInterval(
      metrics.surfaceDiceMeanCi95,
      `${region}.surfaceDiceMeanCi95`,
    );
    assertNonNegative(metrics.hd95MmMean, `${region}.hd95MmMean`);
    assertNonNegativeInterval(
      metrics.hd95MmMeanCi95,
      `${region}.hd95MmMeanCi95`,
    );
    assertNonNegative(metrics.volumeMaeMlMean, `${region}.volumeMaeMlMean`);
    assertNonNegativeInterval(
      metrics.volumeMaeMlMeanCi95,
      `${region}.volumeMaeMlMeanCi95`,
    );
  }

  assertNonNegative(
    candidate.runtime.medianSecondsPerCase,
    'runtime.medianSecondsPerCase',
  );
  assertNonNegative(candidate.runtime.totalSeconds, 'runtime.totalSeconds');
}

test('public summary contains aggregate-only data and no local artifacts', () => {
  assert.deepEqual(Object.keys(summary).sort(), allowedTopLevelKeys);
  assert.deepEqual(Object.keys(summary.protocol).sort(), allowedProtocolKeys);
  assert.deepEqual(Object.keys(summary.metrics).sort(), [
    'kidneyAndMass',
    'mass',
    'tumour',
  ]);
  assert.deepEqual(Object.keys(summary.runtime).sort(), allowedRuntimeKeys);
  assert.deepEqual(
    Object.keys(summary.provenance).sort(),
    allowedProvenanceKeys,
  );
  for (const metrics of Object.values(summary.metrics)) {
    assert.deepEqual(Object.keys(metrics).sort(), allowedMetricKeys);
  }
  assert.equal(summary.schemaVersion, 2);
  assert.equal(summary.researchOnly, true);
  assert.equal(
    summary.provenance.datasetRevision,
    'c1088353084c17b8882a11db71429e7c022b7785',
  );
  assert.equal(
    summary.provenance.imagingRevision,
    '65f1f295873a326230153c7e1de0c7dba10f0b29',
  );
  assert.match(
    summary.provenance.datasetSourceIdentityScope,
    /tracked source commit-equivalent/i,
  );
  assert.equal(
    summary.provenance.portableManifestSha256,
    'bc529b7e5edfa9c5ac0979de1d38a027735b741760e3e82c14acc78ec900c561',
  );
  assert.equal(
    summary.provenance.modelArchiveMd5,
    'b27ab702742083080b95baac00ba186f',
  );
  assert.equal(
    summary.provenance.modelArchiveSha256,
    'a9255f78ba05a0f06d7afc638118d131194758f812542508d3a8ae2abaa867d3',
  );
  assert.equal(
    summary.provenance.nnunetCommit,
    'db16c6cef5fdd5a180159184e46b58bcca670446',
  );
  assert.match(
    summary.provenance.runtimeSourceIdentityScope,
    /ignored runtime artefacts inventoried/i,
  );
  assert.equal(
    summary.protocol.labelSource,
    'KiTS23 training reference segmentations',
  );
  assert.ok(
    summaryText.length < 12_000,
    'Public summary is unexpectedly large',
  );

  assert.doesNotMatch(
    summaryText,
    /(?:[a-z]:[\\/]|file:\/\/|\/(?:users|home|mnt|tmp)\/|\\\\[^\\]|(?:\"|\s)(?:\.{1,2}|work|scratch)[\\/])/i,
  );
  assert.doesNotMatch(summaryText, /\.(?:dcm|nii)(?:\.gz)?(?:\"|\s|$)/i);
  assert.doesNotMatch(summary.title, /\bexternal\b/i);
  assert.match(summary.title, /non-overlapping, within-KiTS/i);
  assert.match(summary.protocol.scope, /non-overlapping, within-KiTS/i);
  visitKeys(summary);
});

test('public copy states metric directions and offline research boundaries', () => {
  assert.doesNotMatch(componentText, /external (?:feasibility|validation)/i);
  assert.match(componentText, /non-overlapping, within-KiTS/i);
  assert.match(componentText, /↑ Higher is better · ↓ Lower is better/i);
  assert.match(componentText, /no CT inference runs in your browser/i);
  assert.match(componentText, /All 20 selected studies remain/i);
  assert.match(componentText, /must not be used for patient care/i);
  assert.match(componentText, /licensed under CC BY-NC-SA 4\.0/i);
  assert.match(componentText, /downstream reuse must comply/i);
  assert.match(componentText, /Source references do not imply endorsement/i);
  assert.match(
    componentText,
    /https:\/\/huggingface\.co\/datasets\/neheller\/KiTS-Challenge-Imaging/,
  );
  assert.match(componentText, /Mass \(tumour \+ cyst\)/);
  assert.match(componentText, /Dice measures overlap/i);
});

test('running summary cannot present placeholder values as measured results', () => {
  assert.ok(['running', 'complete'].includes(summary.status));

  if (summary.status !== 'running') {
    return;
  }

  assert.equal(summary.generatedAtUtc, null);
  assert.equal(summary.protocol.evaluatedCases, null);
  assert.equal(summary.protocol.successfulCases, null);
  assert.equal(summary.protocol.failedCases, null);
  assert.equal(summary.runtime.medianSecondsPerCase, null);
  assert.equal(summary.runtime.totalSeconds, null);

  for (const [region, metrics] of Object.entries(summary.metrics)) {
    for (const [metric, value] of Object.entries(metrics)) {
      assert.equal(
        value,
        null,
        `${region}.${metric} must stay null while running`,
      );
    }
  }
});

test('a completed summary must have a full denominator and valid aggregate metrics', () => {
  if (summary.status !== 'complete') {
    return;
  }

  assertCompletedSummary(summary);
});

test('completed-summary contract covers physical-unit aggregates', () => {
  const candidate = structuredClone(summary);
  candidate.status = 'complete';
  candidate.generatedAtUtc = '2026-09-01T12:00:00.000Z';
  candidate.protocol.evaluatedCases = 20;
  candidate.protocol.successfulCases = 19;
  candidate.protocol.failedCases = 1;
  candidate.runtime.medianSecondsPerCase = 600;
  candidate.runtime.totalSeconds = 12_000;

  for (const metrics of Object.values(candidate.metrics)) {
    metrics.diceMean = 0.8;
    metrics.diceMeanCi95 = [0.75, 0.85];
    metrics.surfaceDiceMean = 0.7;
    metrics.surfaceDiceMeanCi95 = [0.65, 0.75];
    metrics.hd95MmMean = 14;
    metrics.hd95MmMeanCi95 = [11, 17];
    metrics.volumeMaeMlMean = 9;
    metrics.volumeMaeMlMeanCi95 = [7, 12];
  }

  assertCompletedSummary(candidate);

  candidate.protocol.evaluatedCases = 19;
  assert.throws(() => assertCompletedSummary(candidate));
});
