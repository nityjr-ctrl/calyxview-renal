import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parsePublicBenchmarkSummary } from '../lib/benchmark-results-contract.ts';

const currentSummary = JSON.parse(
  await readFile(
    new URL(
      '../research/kits23-feasibility/results/summary.public.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

function statistic({
  mean = 0.7,
  median = mean,
  minimum = 0,
  maximum = 1,
  standardDeviation = 0.1,
  ci95 = [0.6, 0.8],
  n = 20,
} = {}) {
  return {
    n,
    mean,
    median,
    standardDeviation,
    minimum,
    maximum,
    ci95,
  };
}

function regionMetrics() {
  return {
    dice: statistic(),
    surfaceDice: statistic({ mean: 0.65, ci95: [0.55, 0.75] }),
    hd95Mm: statistic({
      mean: 12,
      median: 10,
      minimum: 1,
      maximum: 40,
      standardDeviation: 8,
      ci95: [8, 16],
    }),
    volumeMaeMl: statistic({
      mean: 8,
      median: 7,
      minimum: 0,
      maximum: 30,
      standardDeviation: 6,
      ci95: [5, 11],
    }),
  };
}

function blindedSummaryV3() {
  return {
    schemaVersion: 3,
    status: 'complete',
    researchOnly: true,
    clinicalUse:
      'Research prototype only. Not a medical device. Not for diagnosis, treatment selection, surgical planning, margin selection, or patient care.',
    title: '20-study protocol-frozen KiTS23 script-blinded evaluation',
    generatedAtUtc: '2026-09-03T12:00:00Z',
    evaluation: {
      mode: 'scriptBlinded',
      operatorBlinded: false,
      custodyStatement:
        'The same operator could access the KiTS reference data; inference was script-blinded but not independently operator-blinded.',
      scope:
        'Within-KiTS research feasibility only; not an external clinical validation.',
      fullDenominatorPolicy:
        'All 20 studies remain in every metric denominator, including model failures.',
    },
    protocol: {
      dataset: 'KiTS23',
      datasetRevision: 'c1088353084c17b8882a11db71429e7c022b7785',
      imagingRevision: '65f1f295873a326230153c7e1de0c7dba10f0b29',
      selectionNamespace: 'calyxview-renal-kits23-blinded-v1',
      publicSeed: 20260901,
      eligibleStudyCount: 169,
      cohortSize: 20,
      model: 'Published nnU-Net v1 KiTS21 ensemble',
      modelTask: 'Task135_KiTS2021',
      configuration: '3d_fullres',
      foldCount: 5,
      ttaEnabled: false,
      postprocessing: 'None',
    },
    completion: {
      evaluatedCases: 20,
      successfulCases: 19,
      failedCases: 1,
      successRate: 0.95,
    },
    metrics: {
      kidneyAndMass: regionMetrics(),
      mass: regionMetrics(),
      tumour: regionMetrics(),
    },
    overall: {
      meanDiceAcrossRegions: statistic(),
      meanSurfaceDiceAcrossRegions: statistic({
        mean: 0.65,
        ci95: [0.55, 0.75],
      }),
      meanHd95MmAcrossRegions: statistic({
        mean: 12,
        median: 10,
        minimum: 1,
        maximum: 40,
        standardDeviation: 8,
        ci95: [8, 16],
      }),
    },
    runtime: {
      n: 20,
      medianSecondsPerStudy: 9,
      meanSecondsPerStudy: 10,
      totalSeconds: 200,
    },
    integrity: {
      manifestSha256: '1'.repeat(64),
      cohortLockSha256: '2'.repeat(64),
      modelLockSha256: '3'.repeat(64),
      inferenceLockSha256: '4'.repeat(64),
      releaseEvidenceSha256: '5'.repeat(64),
      evaluatorSummarySha256: '6'.repeat(64),
      evaluatorReceiptSha256: '7'.repeat(64),
    },
    limitations: {
      clinical:
        'This feasibility result is not evidence for diagnosis, treatment, or patient care.',
      custody:
        'The same operator could access the KiTS reference data; inference was script-blinded but not independently operator-blinded.',
      generalisability:
        'Results are limited to one small within-dataset cohort and require independent external validation.',
    },
  };
}

test('current schema v2 is normalized as a historical non-blinded result', () => {
  const parsed = parsePublicBenchmarkSummary(currentSummary);

  assert.equal(parsed.state, 'completeV2');
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(
    parsed.title,
    'Historical 20-study within-KiTS feasibility result',
  );
  assert.equal(parsed.evaluation.mode, 'retrospectiveFeasibility');
  assert.equal(parsed.evaluation.operatorBlinded, null);
  assert.match(parsed.evaluation.custodyStatement, /not prediction-locked/i);
  assert.match(
    parsed.evaluation.completionLabel,
    /prediction-file completion/i,
  );
});

test('schema v2 running state cannot carry partial measurements', () => {
  const running = structuredClone(currentSummary);
  running.status = 'running';
  running.generatedAtUtc = null;
  running.protocol.evaluatedCases = null;
  running.protocol.successfulCases = null;
  running.protocol.failedCases = null;
  running.runtime.medianSecondsPerCase = null;
  running.runtime.totalSeconds = null;
  for (const region of Object.values(running.metrics)) {
    for (const key of Object.keys(region)) {
      region[key] = null;
    }
  }

  assert.equal(parsePublicBenchmarkSummary(running).state, 'runningV2');

  running.metrics.tumour.diceMean = 0.5;
  assert.equal(parsePublicBenchmarkSummary(running).state, 'unavailable');
});

test('schema v2 is bound to the known historical artifact and clones intervals', () => {
  const wrongIdentity = structuredClone(currentSummary);
  wrongIdentity.protocol.dataset = 'Unrelated dataset';
  assert.equal(parsePublicBenchmarkSummary(wrongIdentity).state, 'unavailable');

  const mutable = structuredClone(currentSummary);
  const parsed = parsePublicBenchmarkSummary(mutable);
  assert.equal(parsed.state, 'completeV2');
  mutable.metrics.tumour.diceMeanCi95[0] = 0.01;
  assert.notEqual(parsed.metrics.tumour.diceMeanCi95[0], 0.01);
});

test('schema v3 maps locked evaluation data without calling completion accuracy', () => {
  const parsed = parsePublicBenchmarkSummary(blindedSummaryV3());

  assert.equal(parsed.state, 'completeV3');
  assert.equal(parsed.schemaVersion, 3);
  assert.equal(
    parsed.title,
    'Protocol-frozen 20-study script-blinded evaluation',
  );
  assert.equal(parsed.evaluation.mode, 'scriptBlinded');
  assert.equal(parsed.evaluation.operatorBlinded, false);
  assert.equal(
    parsed.evaluation.completionLabel,
    'valid-output completion rate',
  );
  assert.doesNotMatch(parsed.evaluation.completionLabel, /accuracy/i);
  assert.equal(parsed.protocol.evaluatedCases, 20);
  assert.equal(parsed.protocol.successfulCases, 19);
  assert.equal(parsed.metrics.tumour.diceMean, 0.7);
  assert.deepEqual(parsed.metrics.tumour.diceMeanCi95, [0.6, 0.8]);
});

test('schema v3 rejects denominator drift and misleading custody', () => {
  const wrongDenominator = blindedSummaryV3();
  wrongDenominator.metrics.tumour.dice.n = 19;
  assert.equal(
    parsePublicBenchmarkSummary(wrongDenominator).state,
    'unavailable',
  );

  const misleadingCustody = blindedSummaryV3();
  misleadingCustody.evaluation.custodyStatement =
    'The evaluation was operator-blinded.';
  assert.equal(
    parsePublicBenchmarkSummary(misleadingCustody).state,
    'unavailable',
  );

  const contradictoryCustody = blindedSummaryV3();
  contradictoryCustody.evaluation.operatorBlinded = true;
  assert.equal(
    parsePublicBenchmarkSummary(contradictoryCustody).state,
    'unavailable',
  );

  const independentlyCustodied = blindedSummaryV3();
  independentlyCustodied.evaluation.operatorBlinded = true;
  independentlyCustodied.evaluation.custodyStatement =
    'Reference data were held by an independent custodian until the inference lock.';
  independentlyCustodied.limitations.custody =
    independentlyCustodied.evaluation.custodyStatement;
  assert.equal(
    parsePublicBenchmarkSummary(independentlyCustodied).state,
    'completeV3',
  );
});

test('unsupported or privacy-unsafe aggregate payloads fail closed', () => {
  assert.equal(
    parsePublicBenchmarkSummary({ schemaVersion: 99 }).state,
    'unavailable',
  );

  for (const unsafeText of [
    'See case_00123 for details.',
    'Patient name: Example Person',
    'MRN 123456',
    String.raw`\\server\share\result.json`,
    '../private/result.json',
  ]) {
    const unsafe = blindedSummaryV3();
    unsafe.limitations.custody = unsafeText;
    const parsed = parsePublicBenchmarkSummary(unsafe);
    assert.equal(parsed.state, 'unavailable');
    assert.doesNotMatch(parsed.reason, /case_00123|Example Person|123456/i);
  }
});
