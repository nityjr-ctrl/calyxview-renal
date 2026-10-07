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
const platformText = await readFile(
  new URL('../components/renal-platform.tsx', import.meta.url),
  'utf8',
);
const stylesheetText = await readFile(
  new URL('../app/globals.css', import.meta.url),
  'utf8',
);
const pipelineComponentText = await readFile(
  new URL('../components/planning-pipeline.tsx', import.meta.url),
  'utf8',
);
const pipelineSummaryText = await readFile(
  new URL('../pipeline/results/summary.public.json', import.meta.url),
  'utf8',
);
const pipelineSummary = JSON.parse(pipelineSummaryText);
const formatterTexts = await Promise.all(
  ['../lib/benchmark-results.ts', '../lib/pipeline-results.ts'].map((path) =>
    readFile(new URL(path, import.meta.url), 'utf8'),
  ),
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
  assert.match(summary.protocol.scope, /within-KiTS/i);
  visitKeys(summary);
});

// The copy is meant to be rewritten in plain words, so these tests check the
// facts any honest version has to keep, not exact phrases.
test('benchmark copy keeps the facts a reader needs', () => {
  // The result is rendered from the data, not typed in.
  assert.match(componentText, /\bsuccessfulCases\b/);
  assert.match(componentText, /\bcohortSize\b/);
  assert.match(componentText, /\bfailedCases\b/);

  // Which model, which data, and what kind of check it is.
  assert.match(componentText, /KiTS21/);
  assert.match(componentText, /KiTS23/);
  assert.match(componentText, /within\s+KiTS/i);
  assert.match(componentText, /not\s+external\s+validation/i);
  assert.match(componentText, /not\s+clinical\s+accuracy/i);
  assert.match(componentText, /(?:not|none of it is)\s+for\s+patient\s+care/i);

  // The failure rule is stated, not just alluded to.
  assert.match(componentText, /Dice 0/);
  assert.match(componentText, /stays?[\s\S]{0,30}in\s+every\s+average/i);
  assert.match(componentText, /diagonal/i);

  // HD95 is described as the larger of the two directed 95th percentiles
  // (in plain words, leaving out the worst 5% of points), and the surface Dice
  // tolerance is given.
  assert.match(componentText, /(?:95th-percentile|worst 5% of points)[\s\S]{0,160}larger/i);
  assert.doesNotMatch(componentText, /symmetric surface distance/i);
  assert.match(componentText, /1\.03 mm/);

  // Licences: data CC BY-NC-SA 4.0, model weights CC BY 4.0.
  assert.match(componentText, /CC BY-NC-SA 4\.0/);
  assert.match(componentText, /CC BY 4\.0/);

  // Metric direction key.
  assert.match(
    componentText,
    /↑\s*higher is better,?\s*↓\s*lower is better/i,
  );

  assert.match(
    componentText,
    /https:\/\/huggingface\.co\/datasets\/neheller\/KiTS-Challenge-Imaging/,
  );
  assert.match(componentText, /Mass \(tumour \+ cyst\)/);

  // Removed on purpose: an instruction file for an AI agent, and jargon.
  assert.doesNotMatch(componentText, /BENCHMARK_PROMPT/);
  assert.doesNotMatch(componentText, /validator-accepted/i);
  assert.doesNotMatch(componentText, /seed shopping/i);
});

test('next-run copy keeps prediction, reference and custody in the right order', () => {
  assert.match(componentText, /<details[\s\S]*How the next run will be done/i);
  assert.doesNotMatch(componentText, /before seeing the reference/i);
  assert.doesNotMatch(componentText, /references were released/i);
  assert.match(
    componentText,
    /CT only[\s\S]*Run the model[\s\S]*Lock the outputs[\s\S]*copy in the outlines[\s\S]*Score all 20/i,
  );
  assert.match(componentText, /script-blinded, not\s+operator-blinded/i);
  assert.match(componentText, /separate\s+custodian/i);
  assert.match(componentText, /seed/i);
});

test('benchmark semantics and the phone safety entry point remain accessible', () => {
  assert.doesNotMatch(componentText, /<output[\s\S]*aria-live/i);
  assert.match(
    componentText,
    /<section[\s\S]*className="benchmark-results-grid"/i,
  );
  assert.match(componentText, /<dl className="benchmark-metric-grid">/i);
  assert.match(componentText, /<dt>\{label\}<\/dt>/i);
  assert.match(
    componentText,
    /aria-labelledby="current-benchmark-results-title"/i,
  );
  // The research chip in the 3D viewer keeps an accessible name, whatever it says.
  assert.match(
    platformText,
    /className="research-chip"[\s\S]{0,200}?aria-label="[^"]+"|aria-label="[^"]+"[\s\S]{0,200}?className="research-chip"/,
  );
  assert.match(
    stylesheetText,
    /@media \(max-width: 520px\)[\s\S]*?\.research-chip \{[\s\S]*?display: inline-grid;/i,
  );
  assert.match(
    stylesheetText,
    /\.research-chip span \{[\s\S]*?display: none !important;/i,
  );
});

test('pipeline and benchmark copy avoid en and em dashes', () => {
  for (const text of [componentText, pipelineComponentText, ...formatterTexts]) {
    assert.doesNotMatch(text, /[–—]/);
  }
});

// The voice rule covers every page, and lib/reference-cases.ts is regenerated
// by a script, so guard the rest of the site copy too.
test('the rest of the site copy avoids en and em dashes too', async () => {
  const paths = [
    '../components/renal-site.tsx',
    '../components/renal-platform.tsx',
    '../components/kidney-scene.tsx',
    '../components/reference-case-scene.tsx',
    '../components/kidney-builder.tsx',
    '../components/viewer-ui.tsx',
    '../lib/export-model.ts',
    '../lib/reference-cases.ts',
    '../lib/prototype-pipeline.ts',
    '../index.html',
  ];
  for (const path of paths) {
    const text = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /[–—]/, path);
  }
});

test('pipeline section states its limits and links nothing private', () => {
  assert.doesNotMatch(pipelineComponentText, /under a minute/i);
  assert.doesNotMatch(pipelineComponentText, /laptop/i);
  assert.doesNotMatch(pipelineComponentText, /every assumption/i);
  // The CalyxView endourology repository is private; don't link to it.
  assert.doesNotMatch(pipelineComponentText, /github\.com\/nityjr-ctrl\/CalyxView(?!-)/);
  assert.match(pipelineComponentText, /not public yet/i);
  assert.match(pipelineComponentText, /Kidneys A to E[\s\S]{0,80}cases 1 to 5/);
  assert.match(pipelineComponentText, /hilar \(h\) suffix/i);
  assert.match(pipelineComponentText, /collecting-system item/i);
  assert.match(pipelineComponentText, /5% or less/);
  assert.match(pipelineComponentText, /not function/i);
  assert.match(pipelineComponentText, /Kutikov and Uzzo/);
  assert.match(pipelineComponentText, /Ficarra/);
  assert.match(pipelineComponentText, /TotalSegmentator/);
  assert.match(pipelineComponentText, /tripwire/i);
  assert.match(pipelineComponentText, /CC BY-NC-SA 4\.0/);
  assert.match(pipelineComponentText, /doesn&apos;t show it\s+helps real model output/i);
});

test('pipeline summary is aggregate-only and its numbers are computed correctly', () => {
  assert.doesNotMatch(
    pipelineSummaryText,
    /case_\d{5}|(?:^|["'\s(])(?:[a-z]:[\/])|file:\/\/|\/(?:users|home|mnt|tmp|root)\//im,
  );
  assert.doesNotMatch(
    pipelineSummaryText,
    /patientname|patientid|studyinstanceuid|seriesinstanceuid/i,
  );

  const { nephrometry, postprocess, evaluation, mesh } = pipelineSummary;

  // Median of an even count is the mean of the two middle values.
  const runtimes = nephrometry.cases.map((row) => row.runtimeSeconds).sort((a, b) => a - b);
  const middle = runtimes.length / 2;
  const median =
    runtimes.length % 2 === 0
      ? (runtimes[middle - 1] + runtimes[middle]) / 2
      : runtimes[Math.floor(middle)];
  assert.ok(
    Math.abs(nephrometry.medianRuntimeSeconds - median) <= 0.05,
    `medianRuntimeSeconds ${nephrometry.medianRuntimeSeconds} should be ${median}`,
  );

  // Rounded once: the tiles and the table must agree at 3 dp.
  const bestRow = postprocess.rows[postprocess.rows.length - 1];
  assert.equal(
    evaluation.postprocessed.kidney_and_mass.dice.mean.toFixed(3),
    bestRow.kidneyAndMassDice.toFixed(3),
  );

  // The always-on rule is named in every row that uses it.
  for (const row of postprocess.rows.slice(1)) {
    assert.match(row.rules, /two largest kidney pieces/i);
  }
  assert.doesNotMatch(postprocess.inputNote, /boundary noise|holes/i);
  assert.ok(Number.isInteger(postprocess.tiedForBest) && postprocess.tiedForBest >= 1);

  // Mesh: per-setting means and single-case extremes are both published.
  assert.ok(mesh.caseMinDice <= mesh.minDice);
  assert.ok(mesh.caseMaxAbsVolumeErrorPct >= mesh.maxAbsVolumeErrorPct);
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
