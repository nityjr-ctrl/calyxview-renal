import {
  Beaker,
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  GitCommitHorizontal,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';

import {
  type AggregateMetric,
  type BenchmarkMetrics,
  benchmarkResults,
  formatBenchmarkMeasurement,
  formatBenchmarkPercent,
  formatConfidenceInterval,
  formatMeasurementConfidenceInterval,
  formatRuntime,
} from '@/lib/benchmark-results';

const nextRunSteps = [
  {
    label: 'CT only',
    body: 'Select 20 studies under a written rule without using their answer masks.',
  },
  {
    label: 'Run the model',
    body: 'Give the frozen model each CT image alone and record every success or failure.',
  },
  {
    label: 'Lock outputs',
    body: 'Seal predictions, failures, timings, model files and program hashes before scoring.',
  },
  {
    label: 'Release references',
    body: 'Only then copy the matching KiTS reference segmentations into a separate workspace.',
  },
  {
    label: 'Score all 20',
    body: 'Measure reference agreement and keep failed studies in every denominator.',
  },
];

function PercentMetricValue({
  label,
  value,
  interval,
}: {
  label: string;
  value: number | null;
  interval: [number, number] | null;
}) {
  return (
    <div className="benchmark-metric-value">
      <dt>{label}</dt>
      <dd>
        <strong>{formatBenchmarkPercent(value)}</strong>
        <small>{formatConfidenceInterval(interval)}</small>
      </dd>
    </div>
  );
}

function MeasurementMetricValue({
  label,
  value,
  interval,
  unit,
}: {
  label: string;
  value: number | null;
  interval: [number, number] | null;
  unit: 'mm' | 'mL';
}) {
  return (
    <div className="benchmark-metric-value">
      <dt>{label}</dt>
      <dd>
        <strong>{formatBenchmarkMeasurement(value, unit)}</strong>
        <small>{formatMeasurementConfidenceInterval(interval, unit)}</small>
      </dd>
    </div>
  );
}

function ResultGrid({ metrics }: { metrics: BenchmarkMetrics }) {
  const regionRows: Array<{ label: string; metric: AggregateMetric }> = [
    { label: 'Kidney + mass', metric: metrics.kidneyAndMass },
    { label: 'Mass (tumour + cyst)', metric: metrics.mass },
    { label: 'Tumour', metric: metrics.tumour },
  ];

  return (
    <section
      className="benchmark-results-grid"
      aria-labelledby="current-benchmark-results-title"
    >
      {regionRows.map(({ label, metric }) => (
        <article className="benchmark-result-card" key={label}>
          <div className="benchmark-result-heading">
            <span>{label}</span>
            <Beaker aria-hidden="true" />
          </div>
          <dl className="benchmark-metric-grid">
            <PercentMetricValue
              label="Mean Dice ↑"
              value={metric.diceMean}
              interval={metric.diceMeanCi95}
            />
            <PercentMetricValue
              label="Mean surface Dice ↑"
              value={metric.surfaceDiceMean}
              interval={metric.surfaceDiceMeanCi95}
            />
            <MeasurementMetricValue
              label="Mean HD95 ↓"
              value={metric.hd95MmMean}
              interval={metric.hd95MmMeanCi95}
              unit="mm"
            />
            <MeasurementMetricValue
              label="Volume MAE ↓"
              value={metric.volumeMaeMlMean}
              interval={metric.volumeMaeMlMeanCi95}
              unit="mL"
            />
          </dl>
        </article>
      ))}
    </section>
  );
}

export function FeasibilityBenchmark() {
  if (benchmarkResults.state === 'unavailable') {
    return (
      <section
        id="research"
        className="benchmark-section"
        aria-labelledby="benchmark-title"
      >
        <div className="site-shell">
          <div className="benchmark-heading-grid">
            <div>
              <p className="eyebrow">Research evidence</p>
              <h2 id="benchmark-title">
                Benchmark result temporarily unavailable.
              </h2>
            </div>
            <div className="benchmark-intro">
              <p>{benchmarkResults.reason}</p>
              <p>
                No stale or partially verified score is substituted. The rest of
                this training prototype remains available without processing or
                uploading medical images.
              </p>
            </div>
          </div>
          <output className="benchmark-status" aria-live="polite">
            <span className="benchmark-status-icon">
              <ShieldCheck aria-hidden="true" />
            </span>
            <span className="benchmark-status-copy">
              <strong>Aggregate result withheld safely</strong>
              <span>
                The published data must match a supported, privacy-checked
                contract before any measurement can appear here.
              </span>
            </span>
            <span className="benchmark-status-tag">Research only</span>
          </output>
        </div>
      </section>
    );
  }

  const isComplete = benchmarkResults.state !== 'runningV2';
  const isScriptBlinded = benchmarkResults.state === 'completeV3';
  const resultLabel = isScriptBlinded
    ? 'Protocol-frozen script-blinded result'
    : 'Historical within-KiTS feasibility result';

  return (
    <section
      id="research"
      className="benchmark-section"
      aria-labelledby="benchmark-title"
    >
      <div className="site-shell">
        <div className="benchmark-heading-grid">
          <div>
            <p className="eyebrow">Current 20-study result</p>
            <h2 id="benchmark-title">
              Reference agreement, not clinical accuracy.
            </h2>
          </div>
          <div className="benchmark-intro">
            {isScriptBlinded ? (
              <p>
                The numbers below compare prediction-locked outputs from a
                published KiTS21 nnU-Net model with KiTS23 references copied
                into the scoring workspace only after that lock. The model run
                was script-blinded. This is still a small within-KiTS
                feasibility check, not external clinical validation.
              </p>
            ) : (
              <p>
                The numbers below compare outputs from a published KiTS21
                nnU-Net model with KiTS23 reference segmentations on 20 studies.
                Selected KiTS23 identifiers fall outside the model&apos;s
                documented KiTS21 training identifier range, but this remains a
                small within-KiTS feasibility check. It does not establish
                patient-level independence or external validation. This earlier
                result was not prediction-locked before its references were
                available locally.
              </p>
            )}
            <p>
              A random unlabelled CT can show whether a frozen pipeline runs and
              produces a mask. It cannot establish accuracy because there is no
              reference segmentation to compare with the prediction. These
              values measure agreement with the KiTS research references—not
              clinical accuracy, patient safety or performance across hospitals.
            </p>
            <p>
              Only cohort-wide measurements appear here. Source scans,
              predictions and study-level results remain outside the website; no
              CT inference runs in your browser.
            </p>
          </div>
        </div>

        <div className="benchmark-current-heading">
          <div>
            <p className="eyebrow">{resultLabel}</p>
            <h3 id="current-benchmark-results-title">
              {isComplete
                ? `All ${benchmarkResults.protocol.cohortSize} studies remain visible in the denominator.`
                : 'Scores stay hidden until the full denominator is complete.'}
            </h3>
          </div>
          <p>
            {isComplete
              ? `${benchmarkResults.protocol.successfulCases} studies produced a validator-accepted prediction file. ${benchmarkResults.protocol.failedCases} failed after the predefined attempts and is scored conservatively rather than removed.`
              : 'No provisional or partial result is presented as a completed benchmark.'}
          </p>
        </div>

        <output
          className={`benchmark-status ${isComplete ? 'benchmark-status-complete' : ''}`}
          aria-live="polite"
        >
          <span className="benchmark-status-icon">
            {isComplete ? (
              <CheckCircle2 aria-hidden="true" />
            ) : (
              <LoaderCircle aria-hidden="true" />
            )}
          </span>
          <span className="benchmark-status-copy">
            <strong>
              {isComplete
                ? 'Reference-agreement benchmark complete'
                : 'Reference-agreement benchmark in progress'}
            </strong>
            <span>
              {isComplete
                ? `${benchmarkResults.protocol.evaluatedCases} of ${benchmarkResults.protocol.cohortSize} studies were evaluated: ${benchmarkResults.protocol.successfulCases} produced a valid output and ${benchmarkResults.protocol.failedCases} failed. This is a ${benchmarkResults.evaluation.completionLabel}, not an accuracy rate. Every study remains in the aggregate denominator.`
                : 'No measured score is shown until all 20 studies have been processed and checked under the fixed full-denominator policy.'}
            </span>
          </span>
          <span className="benchmark-status-tag">
            {isScriptBlinded ? 'Script-blinded' : 'Not blinded'}
          </span>
        </output>

        <div className="benchmark-protocol-grid">
          <article>
            <Database aria-hidden="true" />
            <div>
              <span>Public dataset</span>
              <strong>{benchmarkResults.protocol.dataset}</strong>
            </div>
          </article>
          <article>
            <Beaker aria-hidden="true" />
            <div>
              <span>Fixed protocol</span>
              <strong>{benchmarkResults.protocol.cohortSize} CT studies</strong>
            </div>
          </article>
          <article>
            <GitCommitHorizontal aria-hidden="true" />
            <div>
              <span>Model</span>
              <strong>nnU-Net · Task135</strong>
            </div>
          </article>
          <article>
            <Clock3 aria-hidden="true" />
            <div>
              <span>Median runtime</span>
              <strong>
                {formatRuntime(benchmarkResults.runtime.medianSecondsPerCase)}
              </strong>
            </div>
          </article>
        </div>

        <ResultGrid metrics={benchmarkResults.metrics} />

        <p className="benchmark-metric-key">
          ↑ Higher is better · ↓ Lower is better · Values are cohort means with
          bootstrap 95% confidence intervals.
        </p>

        <div className="benchmark-method-grid">
          <article className="benchmark-method-card">
            <span className="benchmark-method-number">01</span>
            <div>
              <h3>What the current numbers mean</h3>
              <p>
                Dice measures overlap. Surface Dice measures how closely the
                predicted and reference boundaries align. HD95 reports the
                95th-percentile symmetric surface distance, and volume MAE
                reports the average absolute volume difference. Each is compared
                with {benchmarkResults.protocol.labelSource} for kidney plus
                mass, tumour plus cyst, and tumour. Each metric quantifies
                reference agreement; none is a clinical-accuracy measure.
              </p>
            </div>
          </article>
          <article className="benchmark-method-card">
            <span className="benchmark-method-number">02</span>
            <div>
              <h3>What these numbers do not prove</h3>
              <p>
                This within-KiTS benchmark does not establish clinical accuracy,
                safety, clinical benefit, patient-level independence,
                generalisation across hospitals, or suitability for
                partial-nephrectomy decisions.
              </p>
            </div>
          </article>
          <article className="benchmark-method-card benchmark-method-card-wide">
            <ShieldCheck aria-hidden="true" />
            <div>
              <h3>Aggregate-only publication</h3>
              <p>
                The public result contains no scan files, model predictions,
                local computer paths, patient identifiers or study-level rows.
                Benchmark inference runs offline; this browser displays a small
                aggregate JSON summary only. Revisions and hashes keep the
                protocol traceable without exposing medical-image artifacts. All
                20 selected studies remain in the metric denominator; failures
                use the predefined evaluation policy rather than being silently
                removed. KiTS data are licensed under CC BY-NC-SA 4.0;
                downstream reuse must comply with its attribution,
                non-commercial and share-alike terms. The published model is
                treated as a non-commercial research asset pending separate
                rights clarification. Source references do not imply
                endorsement.
              </p>
              <div className="benchmark-source-links">
                <a
                  href="https://github.com/nityjr-ctrl/calyxview-renal/blob/main/research/kits23-feasibility/BENCHMARK_PROMPT.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  Reusable run prompt <ExternalLink aria-hidden="true" />
                </a>
                <a
                  href="https://github.com/nityjr-ctrl/calyxview-renal/tree/main/research/kits23-feasibility"
                  target="_blank"
                  rel="noreferrer"
                >
                  Method &amp; scripts <ExternalLink aria-hidden="true" />
                </a>
                <a
                  href="https://huggingface.co/datasets/neheller/KiTS-Challenge-Imaging"
                  target="_blank"
                  rel="noreferrer"
                >
                  Official CT source <ExternalLink aria-hidden="true" />
                </a>
                <a
                  href="https://github.com/neheller/kits23"
                  target="_blank"
                  rel="noreferrer"
                >
                  KiTS23 source <ExternalLink aria-hidden="true" />
                </a>
                <a
                  href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Data licence <ExternalLink aria-hidden="true" />
                </a>
                <a
                  href="https://zenodo.org/records/5126443"
                  target="_blank"
                  rel="noreferrer"
                >
                  Published model <ExternalLink aria-hidden="true" />
                </a>
              </div>
            </div>
          </article>
        </div>

        {isScriptBlinded ? (
          <div
            className="benchmark-next-run benchmark-next-run-complete"
            aria-labelledby="evaluation-custody-title"
          >
            <div className="benchmark-next-run-heading">
              <div>
                <p className="eyebrow">Evaluation custody</p>
                <h3 id="evaluation-custody-title">
                  Predictions were locked before references entered the scoring
                  workspace.
                </h3>
              </div>
              <span>
                {benchmarkResults.evaluation.operatorBlinded
                  ? 'Operator-blinded'
                  : 'Script-blinded only'}
              </span>
            </div>
            <div className="benchmark-blinding-limit" role="note">
              <strong>Recorded custody boundary</strong>
              <p>{benchmarkResults.evaluation.custodyStatement}</p>
            </div>
          </div>
        ) : (
          <div className="benchmark-next-run" aria-labelledby="next-run-title">
            <div className="benchmark-next-run-heading">
              <div>
                <p className="eyebrow">Next validation · not yet run</p>
                <h3 id="next-run-title">
                  Lock each prediction before references enter the scoring
                  workspace.
                </h3>
              </div>
              <span>Protocol under review</span>
            </div>
            <p className="benchmark-next-run-intro">
              The current draft uses a reproducible operator-chosen seed. That
              supports repeatability, but it cannot rule out seed shopping,
              independently reduce selection bias or establish accuracy. The
              next cohort follows this fixed order:
            </p>
            <ol
              className="benchmark-validation-flow"
              aria-label="Planned blinded evaluation sequence"
            >
              {nextRunSteps.map((step, index) => (
                <li key={step.label}>
                  <span className="benchmark-flow-number">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h4>{step.label}</h4>
                    <p>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="benchmark-blinding-limit" role="note">
              <strong>Blinding limit</strong>
              <p>
                The planned local evaluation is script-blinded, not
                operator-blinded. The inference programs cannot access
                references before the lock, but the same operator account can
                access the KiTS repository. A separate custodian is still
                required for true operator blinding.
              </p>
            </div>
          </div>
        )}

        <p className="benchmark-footnote">
          {isScriptBlinded
            ? `Current result: protocol-frozen and script-blinded within KiTS. ${benchmarkResults.evaluation.custodyStatement}`
            : 'Current result: identifiers outside the documented Task135 training range, evaluated within KiTS. This earlier result was not blinded.'}{' '}
          Results are descriptive and must not be used for patient care.
        </p>
      </div>
    </section>
  );
}
