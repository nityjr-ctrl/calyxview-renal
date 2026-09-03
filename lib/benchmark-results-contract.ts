export type BenchmarkResultState =
  | 'runningV2'
  | 'completeV2'
  | 'completeV3'
  | 'unavailable';

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

export interface BenchmarkMetrics {
  kidneyAndMass: AggregateMetric;
  mass: AggregateMetric;
  tumour: AggregateMetric;
}

interface BenchmarkProtocolView {
  dataset: string;
  model: string;
  configuration: string;
  cohortSize: number;
  evaluatedCases: number | null;
  successfulCases: number | null;
  failedCases: number | null;
  labelSource: string;
  scope: string;
}

interface BenchmarkEvaluationView {
  mode: 'retrospectiveFeasibility' | 'scriptBlinded';
  operatorBlinded: boolean | null;
  custodyStatement: string;
  completionLabel: string;
}

interface AvailableBenchmarkResultBase {
  researchOnly: true;
  title: string;
  generatedAtUtc: string | null;
  protocol: BenchmarkProtocolView;
  evaluation: BenchmarkEvaluationView;
  metrics: BenchmarkMetrics;
  runtime: {
    medianSecondsPerCase: number | null;
    totalSeconds: number | null;
  };
}

export type AvailableBenchmarkResult =
  | (AvailableBenchmarkResultBase & {
      state: 'runningV2';
      schemaVersion: 2;
    })
  | (AvailableBenchmarkResultBase & {
      state: 'completeV2';
      schemaVersion: 2;
    })
  | (AvailableBenchmarkResultBase & {
      state: 'completeV3';
      schemaVersion: 3;
    });

export interface UnavailableBenchmarkResult {
  state: 'unavailable';
  schemaVersion: null;
  researchOnly: true;
  reason: string;
}

export type BenchmarkResult =
  | AvailableBenchmarkResult
  | UnavailableBenchmarkResult;

interface RawAggregateMetricV2 {
  diceMean: number | null;
  diceMeanCi95: [number, number] | null;
  surfaceDiceMean: number | null;
  surfaceDiceMeanCi95: [number, number] | null;
  hd95MmMean: number | null;
  hd95MmMeanCi95: [number, number] | null;
  volumeMaeMlMean: number | null;
  volumeMaeMlMeanCi95: [number, number] | null;
}

interface RawPublicBenchmarkSummaryV2 {
  schemaVersion: 2;
  status: 'running' | 'complete';
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
    kidneyAndMass: RawAggregateMetricV2;
    mass: RawAggregateMetricV2;
    tumour: RawAggregateMetricV2;
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

interface RawAggregateMetricV3 {
  n: number;
  mean: number;
  median: number;
  standardDeviation: number;
  minimum: number;
  maximum: number;
  ci95: [number, number];
}

interface RawPublicBenchmarkSummaryV3 {
  schemaVersion: 3;
  status: 'complete';
  researchOnly: true;
  clinicalUse: string;
  title: string;
  generatedAtUtc: string;
  evaluation: {
    mode: 'scriptBlinded';
    operatorBlinded: boolean;
    custodyStatement: string;
    scope: string;
    fullDenominatorPolicy: string;
  };
  protocol: {
    dataset: string;
    datasetRevision: string;
    imagingRevision: string;
    selectionNamespace: string;
    publicSeed: number;
    eligibleStudyCount: number;
    cohortSize: number;
    model: string;
    modelTask: string;
    configuration: string;
    foldCount: number;
    ttaEnabled: boolean;
    postprocessing: string;
  };
  completion: {
    evaluatedCases: number;
    successfulCases: number;
    failedCases: number;
    successRate: number;
  };
  metrics: {
    kidneyAndMass: RawRegionMetricsV3;
    mass: RawRegionMetricsV3;
    tumour: RawRegionMetricsV3;
  };
  overall: {
    meanDiceAcrossRegions: RawAggregateMetricV3;
    meanSurfaceDiceAcrossRegions: RawAggregateMetricV3;
    meanHd95MmAcrossRegions: RawAggregateMetricV3;
  };
  runtime: {
    n: number;
    medianSecondsPerStudy: number;
    meanSecondsPerStudy: number;
    totalSeconds: number;
  };
  integrity: {
    manifestSha256: string;
    cohortLockSha256: string;
    modelLockSha256: string;
    inferenceLockSha256: string;
    releaseEvidenceSha256: string;
    evaluatorSummarySha256: string;
    evaluatorReceiptSha256: string;
  };
  limitations: {
    clinical: string;
    custody: string;
    generalisability: string;
  };
}

interface RawRegionMetricsV3 {
  dice: RawAggregateMetricV3;
  surfaceDice: RawAggregateMetricV3;
  hd95Mm: RawAggregateMetricV3;
  volumeMaeMl: RawAggregateMetricV3;
}

const V2_TOP_LEVEL_KEYS = [
  'schemaVersion',
  'status',
  'researchOnly',
  'title',
  'generatedAtUtc',
  'protocol',
  'metrics',
  'runtime',
  'provenance',
] as const;

const V2_PROTOCOL_KEYS = [
  'dataset',
  'model',
  'configuration',
  'cohortSize',
  'evaluatedCases',
  'successfulCases',
  'failedCases',
  'labelSource',
  'scope',
] as const;

const V2_METRIC_KEYS = [
  'diceMean',
  'diceMeanCi95',
  'surfaceDiceMean',
  'surfaceDiceMeanCi95',
  'hd95MmMean',
  'hd95MmMeanCi95',
  'volumeMaeMlMean',
  'volumeMaeMlMeanCi95',
] as const;

const V3_TOP_LEVEL_KEYS = [
  'schemaVersion',
  'status',
  'researchOnly',
  'clinicalUse',
  'title',
  'generatedAtUtc',
  'evaluation',
  'protocol',
  'completion',
  'metrics',
  'overall',
  'runtime',
  'integrity',
  'limitations',
] as const;

const V3_AGGREGATE_KEYS = [
  'n',
  'mean',
  'median',
  'standardDeviation',
  'minimum',
  'maximum',
  'ci95',
] as const;

const REGIONS = ['kidneyAndMass', 'mass', 'tumour'] as const;

const V2_IDENTITY = {
  title: '20-study KiTS23 non-overlapping, within-KiTS feasibility benchmark',
  dataset: 'KiTS23',
  model: 'nnU-Net v1 Task135_KiTS2021',
  configuration:
    '3d_fullres, five-fold ensemble, test-time augmentation disabled, no postprocessing file',
  cohortSize: 20,
  labelSource: 'KiTS23 training reference segmentations',
  scope: 'Non-overlapping, within-KiTS research feasibility only',
  datasetRevision: 'c1088353084c17b8882a11db71429e7c022b7785',
  imagingRevision: '65f1f295873a326230153c7e1de0c7dba10f0b29',
  datasetSourceIdentityScope:
    'Tracked source commit-equivalent; active images, labels, and inputs independently hash-verified',
  portableManifestSha256:
    'bc529b7e5edfa9c5ac0979de1d38a027735b741760e3e82c14acc78ec900c561',
  modelArchiveMd5: 'b27ab702742083080b95baac00ba186f',
  modelArchiveSha256:
    'a9255f78ba05a0f06d7afc638118d131194758f812542508d3a8ae2abaa867d3',
  nnunetCommit: 'db16c6cef5fdd5a180159184e46b58bcca670446',
  runtimeSourceIdentityScope:
    'Tracked source commit-equivalent; ignored runtime artefacts inventoried at capture time but not treated as upstream commit content',
} as const;

const V3_IDENTITY = {
  clinicalUse:
    'Research prototype only. Not a medical device. Not for diagnosis, treatment selection, surgical planning, margin selection, or patient care.',
  title: '20-study protocol-frozen KiTS23 script-blinded evaluation',
  scope:
    'Within-KiTS research feasibility only; not an external clinical validation.',
  fullDenominatorPolicy:
    'All 20 studies remain in every metric denominator, including model failures.',
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
  clinicalLimitation:
    'This feasibility result is not evidence for diagnosis, treatment, or patient care.',
  generalisabilityLimitation:
    'Results are limited to one small within-dataset cohort and require independent external validation.',
  independentCustody:
    'Reference data were held by an independent custodian until the inference lock.',
  sameOperatorCustody:
    'The same operator could access the KiTS reference data; inference was script-blinded but not independently operator-blinded.',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]00:00)$/u.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

function isFiniteNumber(
  value: unknown,
  options: { minimum?: number; maximum?: number } = {},
): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return false;
  }

  return (
    (options.minimum === undefined || value >= options.minimum) &&
    (options.maximum === undefined || value <= options.maximum)
  );
}

function isInteger(value: unknown, minimum = 0): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= minimum
  );
}

function isNullableInteger(value: unknown): value is number | null {
  return value === null || isInteger(value);
}

function isNullableNumber(
  value: unknown,
  options: { minimum?: number; maximum?: number } = {},
): value is number | null {
  return value === null || isFiniteNumber(value, options);
}

function isInterval(
  value: unknown,
  options: { nullable?: boolean; minimum?: number; maximum?: number } = {},
): value is [number, number] | null {
  if (value === null) {
    return options.nullable === true;
  }

  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isFiniteNumber(value[0], options) &&
    isFiniteNumber(value[1], options) &&
    value[0] <= value[1]
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function passesDefenseInDepthPublicScan(value: unknown): boolean {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return false;
  }

  return ![
    /case_[0-9]{5}/iu,
    /\.(?:dcm|nii)(?:\.gz)?(?:["\\/\s]|$)/iu,
    /[a-z]:\\/iu,
    /\\\\[^\\]+\\[^\\]+/iu,
    /\/(?:home|users|mnt|tmp|var\/tmp)\//iu,
    /(?:file|https?):\/\//iu,
    /\b(?:mrn|medical record number|patient name|patient id|study instance uid|series instance uid|sop instance uid)\b/iu,
  ].some((pattern) => pattern.test(serialized));
}

function isRawAggregateMetricV2(value: unknown): value is RawAggregateMetricV2 {
  return (
    hasExactKeys(value, V2_METRIC_KEYS) &&
    isNullableNumber(value.diceMean, { minimum: 0, maximum: 1 }) &&
    isInterval(value.diceMeanCi95, {
      nullable: true,
      minimum: 0,
      maximum: 1,
    }) &&
    isNullableNumber(value.surfaceDiceMean, { minimum: 0, maximum: 1 }) &&
    isInterval(value.surfaceDiceMeanCi95, {
      nullable: true,
      minimum: 0,
      maximum: 1,
    }) &&
    isNullableNumber(value.hd95MmMean, { minimum: 0 }) &&
    isInterval(value.hd95MmMeanCi95, { nullable: true, minimum: 0 }) &&
    isNullableNumber(value.volumeMaeMlMean, { minimum: 0 }) &&
    isInterval(value.volumeMaeMlMeanCi95, { nullable: true, minimum: 0 })
  );
}

function isRawMetricsV2(
  value: unknown,
): value is RawPublicBenchmarkSummaryV2['metrics'] {
  return (
    hasExactKeys(value, REGIONS) &&
    isRawAggregateMetricV2(value.kidneyAndMass) &&
    isRawAggregateMetricV2(value.mass) &&
    isRawAggregateMetricV2(value.tumour)
  );
}

function isV2MetricComplete(metric: RawAggregateMetricV2): boolean {
  return Object.values(metric).every((value) => value !== null);
}

function isV2MetricEmpty(metric: RawAggregateMetricV2): boolean {
  return Object.values(metric).every((value) => value === null);
}

function isRawPublicBenchmarkSummaryV2(
  value: unknown,
): value is RawPublicBenchmarkSummaryV2 {
  if (!hasExactKeys(value, V2_TOP_LEVEL_KEYS)) {
    return false;
  }

  const metricsValue = value.metrics;
  if (
    value.schemaVersion !== 2 ||
    (value.status !== 'running' && value.status !== 'complete') ||
    value.researchOnly !== true ||
    value.title !== V2_IDENTITY.title ||
    !(
      value.generatedAtUtc === null ||
      isUtcTimestamp(value.generatedAtUtc)
    ) ||
    !hasExactKeys(value.protocol, V2_PROTOCOL_KEYS) ||
    value.protocol.dataset !== V2_IDENTITY.dataset ||
    value.protocol.model !== V2_IDENTITY.model ||
    value.protocol.configuration !== V2_IDENTITY.configuration ||
    value.protocol.cohortSize !== V2_IDENTITY.cohortSize ||
    !isNullableInteger(value.protocol.evaluatedCases) ||
    !isNullableInteger(value.protocol.successfulCases) ||
    !isNullableInteger(value.protocol.failedCases) ||
    value.protocol.labelSource !== V2_IDENTITY.labelSource ||
    value.protocol.scope !== V2_IDENTITY.scope ||
    !isRawMetricsV2(metricsValue) ||
    !hasExactKeys(value.runtime, ['medianSecondsPerCase', 'totalSeconds']) ||
    !isNullableNumber(value.runtime.medianSecondsPerCase, { minimum: 0 }) ||
    !isNullableNumber(value.runtime.totalSeconds, { minimum: 0 }) ||
    !hasExactKeys(value.provenance, [
      'datasetRevision',
      'imagingRevision',
      'datasetSourceIdentityScope',
      'portableManifestSha256',
      'modelArchiveMd5',
      'modelArchiveSha256',
      'nnunetCommit',
      'runtimeSourceIdentityScope',
    ]) ||
    value.provenance.datasetRevision !== V2_IDENTITY.datasetRevision ||
    value.provenance.imagingRevision !== V2_IDENTITY.imagingRevision ||
    value.provenance.datasetSourceIdentityScope !==
      V2_IDENTITY.datasetSourceIdentityScope ||
    value.provenance.portableManifestSha256 !==
      V2_IDENTITY.portableManifestSha256 ||
    value.provenance.modelArchiveMd5 !== V2_IDENTITY.modelArchiveMd5 ||
    value.provenance.modelArchiveSha256 !== V2_IDENTITY.modelArchiveSha256 ||
    value.provenance.nnunetCommit !== V2_IDENTITY.nnunetCommit ||
    value.provenance.runtimeSourceIdentityScope !==
      V2_IDENTITY.runtimeSourceIdentityScope
  ) {
    return false;
  }

  const metrics = REGIONS.map((region) => metricsValue[region]);
  if (value.status === 'running') {
    return (
      value.generatedAtUtc === null &&
      value.protocol.evaluatedCases === null &&
      value.protocol.successfulCases === null &&
      value.protocol.failedCases === null &&
      value.runtime.medianSecondsPerCase === null &&
      value.runtime.totalSeconds === null &&
      metrics.every(isV2MetricEmpty)
    );
  }

  return (
    value.generatedAtUtc !== null &&
    value.protocol.evaluatedCases === value.protocol.cohortSize &&
    value.protocol.successfulCases !== null &&
    value.protocol.failedCases !== null &&
    value.protocol.successfulCases + value.protocol.failedCases ===
      value.protocol.evaluatedCases &&
    value.runtime.medianSecondsPerCase !== null &&
    value.runtime.totalSeconds !== null &&
    metrics.every(isV2MetricComplete)
  );
}

function isRawAggregateMetricV3(
  value: unknown,
  unitInterval: boolean,
): value is RawAggregateMetricV3 {
  const maximum = unitInterval ? 1 : undefined;
  if (
    !hasExactKeys(value, V3_AGGREGATE_KEYS) ||
    !isInteger(value.n, 1) ||
    !isFiniteNumber(value.mean, { minimum: 0, maximum }) ||
    !isFiniteNumber(value.median, { minimum: 0, maximum }) ||
    !isFiniteNumber(value.standardDeviation, { minimum: 0 }) ||
    !isFiniteNumber(value.minimum, { minimum: 0, maximum }) ||
    !isFiniteNumber(value.maximum, { minimum: 0, maximum }) ||
    !isInterval(value.ci95, { minimum: 0, maximum })
  ) {
    return false;
  }

  return (
    value.minimum <= value.mean &&
    value.mean <= value.maximum &&
    value.minimum <= value.median &&
    value.median <= value.maximum
  );
}

function isRawRegionMetricsV3(value: unknown): value is RawRegionMetricsV3 {
  return (
    hasExactKeys(value, ['dice', 'surfaceDice', 'hd95Mm', 'volumeMaeMl']) &&
    isRawAggregateMetricV3(value.dice, true) &&
    isRawAggregateMetricV3(value.surfaceDice, true) &&
    isRawAggregateMetricV3(value.hd95Mm, false) &&
    isRawAggregateMetricV3(value.volumeMaeMl, false)
  );
}

function isRawMetricsV3(
  value: unknown,
): value is RawPublicBenchmarkSummaryV3['metrics'] {
  return (
    hasExactKeys(value, REGIONS) &&
    isRawRegionMetricsV3(value.kidneyAndMass) &&
    isRawRegionMetricsV3(value.mass) &&
    isRawRegionMetricsV3(value.tumour)
  );
}

function isRawPublicBenchmarkSummaryV3(
  value: unknown,
): value is RawPublicBenchmarkSummaryV3 {
  if (!hasExactKeys(value, V3_TOP_LEVEL_KEYS)) {
    return false;
  }

  const metricsValue = value.metrics;
  if (
    value.schemaVersion !== 3 ||
    value.status !== 'complete' ||
    value.researchOnly !== true ||
    value.clinicalUse !== V3_IDENTITY.clinicalUse ||
    value.title !== V3_IDENTITY.title ||
    !isUtcTimestamp(value.generatedAtUtc) ||
    !hasExactKeys(value.evaluation, [
      'mode',
      'operatorBlinded',
      'custodyStatement',
      'scope',
      'fullDenominatorPolicy',
    ]) ||
    value.evaluation.mode !== 'scriptBlinded' ||
    typeof value.evaluation.operatorBlinded !== 'boolean' ||
    !isString(value.evaluation.custodyStatement) ||
    value.evaluation.scope !== V3_IDENTITY.scope ||
    value.evaluation.fullDenominatorPolicy !==
      V3_IDENTITY.fullDenominatorPolicy ||
    !hasExactKeys(value.protocol, [
      'dataset',
      'datasetRevision',
      'imagingRevision',
      'selectionNamespace',
      'publicSeed',
      'eligibleStudyCount',
      'cohortSize',
      'model',
      'modelTask',
      'configuration',
      'foldCount',
      'ttaEnabled',
      'postprocessing',
    ]) ||
    value.protocol.dataset !== V3_IDENTITY.dataset ||
    value.protocol.datasetRevision !== V3_IDENTITY.datasetRevision ||
    value.protocol.imagingRevision !== V3_IDENTITY.imagingRevision ||
    value.protocol.selectionNamespace !== V3_IDENTITY.selectionNamespace ||
    value.protocol.publicSeed !== V3_IDENTITY.publicSeed ||
    value.protocol.eligibleStudyCount !== V3_IDENTITY.eligibleStudyCount ||
    value.protocol.cohortSize !== V3_IDENTITY.cohortSize ||
    value.protocol.model !== V3_IDENTITY.model ||
    value.protocol.modelTask !== V3_IDENTITY.modelTask ||
    value.protocol.configuration !== V3_IDENTITY.configuration ||
    value.protocol.foldCount !== V3_IDENTITY.foldCount ||
    value.protocol.ttaEnabled !== V3_IDENTITY.ttaEnabled ||
    value.protocol.postprocessing !== V3_IDENTITY.postprocessing ||
    !hasExactKeys(value.completion, [
      'evaluatedCases',
      'successfulCases',
      'failedCases',
      'successRate',
    ]) ||
    !isInteger(value.completion.evaluatedCases, 1) ||
    !isInteger(value.completion.successfulCases) ||
    !isInteger(value.completion.failedCases) ||
    !isFiniteNumber(value.completion.successRate, { minimum: 0, maximum: 1 }) ||
    !isRawMetricsV3(metricsValue) ||
    !hasExactKeys(value.overall, [
      'meanDiceAcrossRegions',
      'meanSurfaceDiceAcrossRegions',
      'meanHd95MmAcrossRegions',
    ]) ||
    !isRawAggregateMetricV3(value.overall.meanDiceAcrossRegions, true) ||
    !isRawAggregateMetricV3(value.overall.meanSurfaceDiceAcrossRegions, true) ||
    !isRawAggregateMetricV3(value.overall.meanHd95MmAcrossRegions, false) ||
    !hasExactKeys(value.runtime, [
      'n',
      'medianSecondsPerStudy',
      'meanSecondsPerStudy',
      'totalSeconds',
    ]) ||
    !isInteger(value.runtime.n, 1) ||
    !isFiniteNumber(value.runtime.medianSecondsPerStudy, { minimum: 0 }) ||
    !isFiniteNumber(value.runtime.meanSecondsPerStudy, { minimum: 0 }) ||
    !isFiniteNumber(value.runtime.totalSeconds, { minimum: 0 }) ||
    !hasExactKeys(value.integrity, [
      'manifestSha256',
      'cohortLockSha256',
      'modelLockSha256',
      'inferenceLockSha256',
      'releaseEvidenceSha256',
      'evaluatorSummarySha256',
      'evaluatorReceiptSha256',
    ]) ||
    !Object.values(value.integrity).every(isSha256) ||
    !hasExactKeys(value.limitations, [
      'clinical',
      'custody',
      'generalisability',
    ]) ||
    value.limitations.clinical !== V3_IDENTITY.clinicalLimitation ||
    value.limitations.generalisability !==
      V3_IDENTITY.generalisabilityLimitation
  ) {
    return false;
  }

  const cohortSize = value.protocol.cohortSize;
  const allMetrics = [
    ...REGIONS.flatMap((region) => Object.values(metricsValue[region])),
    ...Object.values(value.overall),
  ];

  const expectedCustody = value.evaluation.operatorBlinded
    ? V3_IDENTITY.independentCustody
    : V3_IDENTITY.sameOperatorCustody;

  return (
    cohortSize === 20 &&
    value.completion.evaluatedCases === cohortSize &&
    value.completion.successfulCases + value.completion.failedCases ===
      cohortSize &&
    Math.abs(
      value.completion.successRate -
        value.completion.successfulCases / cohortSize,
    ) < 1e-12 &&
    value.runtime.n === cohortSize &&
    Math.abs(
      value.runtime.totalSeconds -
        value.runtime.meanSecondsPerStudy * cohortSize,
    ) < 0.02 &&
    allMetrics.every((metric) => metric.n === cohortSize) &&
    value.evaluation.custodyStatement === expectedCustody &&
    value.limitations.custody === expectedCustody
  );
}

function cloneV2Metric(metric: RawAggregateMetricV2): AggregateMetric {
  return {
    diceMean: metric.diceMean,
    diceMeanCi95:
      metric.diceMeanCi95 === null ? null : [...metric.diceMeanCi95],
    surfaceDiceMean: metric.surfaceDiceMean,
    surfaceDiceMeanCi95:
      metric.surfaceDiceMeanCi95 === null
        ? null
        : [...metric.surfaceDiceMeanCi95],
    hd95MmMean: metric.hd95MmMean,
    hd95MmMeanCi95:
      metric.hd95MmMeanCi95 === null ? null : [...metric.hd95MmMeanCi95],
    volumeMaeMlMean: metric.volumeMaeMlMean,
    volumeMaeMlMeanCi95:
      metric.volumeMaeMlMeanCi95 === null
        ? null
        : [...metric.volumeMaeMlMeanCi95],
  };
}

function normalizeV2(
  summary: RawPublicBenchmarkSummaryV2,
): AvailableBenchmarkResult {
  return {
    state: summary.status === 'complete' ? 'completeV2' : 'runningV2',
    schemaVersion: 2,
    researchOnly: true,
    title: 'Historical 20-study within-KiTS feasibility result',
    generatedAtUtc: summary.generatedAtUtc,
    protocol: { ...summary.protocol },
    evaluation: {
      mode: 'retrospectiveFeasibility',
      operatorBlinded: null,
      custodyStatement:
        'This earlier feasibility result was not prediction-locked before its references were available locally.',
      completionLabel: 'validator-accepted prediction-file completion rate',
    },
    metrics: {
      kidneyAndMass: cloneV2Metric(summary.metrics.kidneyAndMass),
      mass: cloneV2Metric(summary.metrics.mass),
      tumour: cloneV2Metric(summary.metrics.tumour),
    },
    runtime: { ...summary.runtime },
  };
}

function normalizeV3Metric(region: RawRegionMetricsV3): AggregateMetric {
  return {
    diceMean: region.dice.mean,
    diceMeanCi95: [...region.dice.ci95],
    surfaceDiceMean: region.surfaceDice.mean,
    surfaceDiceMeanCi95: [...region.surfaceDice.ci95],
    hd95MmMean: region.hd95Mm.mean,
    hd95MmMeanCi95: [...region.hd95Mm.ci95],
    volumeMaeMlMean: region.volumeMaeMl.mean,
    volumeMaeMlMeanCi95: [...region.volumeMaeMl.ci95],
  };
}

function normalizeV3(
  summary: RawPublicBenchmarkSummaryV3,
): AvailableBenchmarkResult {
  return {
    state: 'completeV3',
    schemaVersion: 3,
    researchOnly: true,
    title: 'Protocol-frozen 20-study script-blinded evaluation',
    generatedAtUtc: summary.generatedAtUtc,
    protocol: {
      dataset: summary.protocol.dataset,
      model: `${summary.protocol.model} · ${summary.protocol.modelTask}`,
      configuration: summary.protocol.configuration,
      cohortSize: summary.protocol.cohortSize,
      evaluatedCases: summary.completion.evaluatedCases,
      successfulCases: summary.completion.successfulCases,
      failedCases: summary.completion.failedCases,
      labelSource:
        'KiTS23 references copied into the scoring workspace after the prediction lock',
      scope: summary.evaluation.scope,
    },
    evaluation: {
      mode: 'scriptBlinded',
      operatorBlinded: summary.evaluation.operatorBlinded,
      custodyStatement: summary.evaluation.custodyStatement,
      completionLabel: 'valid-output completion rate',
    },
    metrics: {
      kidneyAndMass: normalizeV3Metric(summary.metrics.kidneyAndMass),
      mass: normalizeV3Metric(summary.metrics.mass),
      tumour: normalizeV3Metric(summary.metrics.tumour),
    },
    runtime: {
      medianSecondsPerCase: summary.runtime.medianSecondsPerStudy,
      totalSeconds: summary.runtime.totalSeconds,
    },
  };
}

export function parsePublicBenchmarkSummary(value: unknown): BenchmarkResult {
  if (!passesDefenseInDepthPublicScan(value)) {
    return {
      state: 'unavailable',
      schemaVersion: null,
      researchOnly: true,
      reason:
        'The public benchmark is temporarily unavailable because its aggregate data contract could not be verified.',
    };
  }

  if (isRawPublicBenchmarkSummaryV2(value)) {
    return normalizeV2(value);
  }

  if (isRawPublicBenchmarkSummaryV3(value)) {
    return normalizeV3(value);
  }

  return {
    state: 'unavailable',
    schemaVersion: null,
    researchOnly: true,
    reason:
      'The public benchmark is temporarily unavailable because its aggregate data contract could not be verified.',
  };
}
