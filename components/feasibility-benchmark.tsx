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
  benchmarkResults,
  formatBenchmarkMeasurement,
  formatBenchmarkPercent,
  formatConfidenceInterval,
  formatMeasurementConfidenceInterval,
  formatRuntime,
} from '@/lib/benchmark-results';

const regionRows: Array<{ label: string; metric: AggregateMetric }> = [
  { label: 'Kidney + mass', metric: benchmarkResults.metrics.kidneyAndMass },
  { label: 'Mass (tumour + cyst)', metric: benchmarkResults.metrics.mass },
  { label: 'Tumour', metric: benchmarkResults.metrics.tumour },
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
      <span>{label}</span>
      <strong>{formatBenchmarkPercent(value)}</strong>
      <small>{formatConfidenceInterval(interval)}</small>
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
      <span>{label}</span>
      <strong>{formatBenchmarkMeasurement(value, unit)}</strong>
      <small>{formatMeasurementConfidenceInterval(interval, unit)}</small>
    </div>
  );
}

function ResultGrid() {
  return (
    <div
      className="benchmark-results-grid"
      aria-label="Aggregate benchmark results"
    >
      {regionRows.map(({ label, metric }) => (
        <article className="benchmark-result-card" key={label}>
          <div className="benchmark-result-heading">
            <span>{label}</span>
            <Beaker aria-hidden="true" />
          </div>
          <div className="benchmark-metric-grid">
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
          </div>
        </article>
      ))}
    </div>
  );
}

export function FeasibilityBenchmark() {
  const isComplete = benchmarkResults.status === 'complete';

  return (
    <section
      id="research"
      className="benchmark-section"
      aria-labelledby="benchmark-title"
    >
      <div className="site-shell">
        <div className="benchmark-heading-grid">
          <div>
            <p className="eyebrow">Transparent research benchmark</p>
            <h2 id="benchmark-title">Evidence first. Claims later.</h2>
          </div>
          <div className="benchmark-intro">
            <p>
              {isComplete ? 'We ran' : 'We are running'} the published KiTS21
              nnU-Net model on a fixed set of 20 public KiTS23 CT studies. The
              selected cohort does not
              overlap the model&apos;s KiTS21 training studies, making this a
              bounded, non-overlapping, within-KiTS feasibility check—not
              clinical validation.
            </p>
            <p>
              Only cohort-wide measurements will appear here. Source scans,
              predictions and study-level results remain outside the website;
              no CT inference runs in your browser.
            </p>
          </div>
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
          <div>
            <strong>
              {isComplete ? 'Benchmark complete' : 'Benchmark run in progress'}
            </strong>
            <p>
              {isComplete
                ? `${benchmarkResults.protocol.evaluatedCases} of ${benchmarkResults.protocol.cohortSize} studies were evaluated: ${benchmarkResults.protocol.successfulCases} completed successfully and ${benchmarkResults.protocol.failedCases} failed. Every study remains in the aggregate denominator.`
                : 'No measured score is shown until all 20 studies have been processed and checked under the fixed full-denominator policy.'}
            </p>
          </div>
          <span className="benchmark-status-tag">Research only</span>
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

        <ResultGrid />

        <p className="benchmark-metric-key">
          ↑ Higher is better · ↓ Lower is better · Values are cohort means with
          bootstrap 95% confidence intervals.
        </p>

        <div className="benchmark-method-grid">
          <article className="benchmark-method-card">
            <span className="benchmark-method-number">01</span>
            <div>
              <h3>What is measured</h3>
              <p>
                Dice measures overlap. Surface Dice measures how closely the
                predicted and reference boundaries align. HD95 reports a robust
                worst-case boundary distance, and volume MAE reports the average
                absolute volume difference. Each is compared with the KiTS23
                training reference segmentations for kidney plus mass, tumour
                plus cyst, and tumour.
              </p>
            </div>
          </article>
          <article className="benchmark-method-card">
            <span className="benchmark-method-number">02</span>
            <div>
              <h3>What it does not prove</h3>
              <p>
                This non-overlapping, within-KiTS benchmark does not establish
                safety, clinical benefit, generalisation across hospitals, or
                suitability for partial-nephrectomy decisions.
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
                protocol traceable without exposing medical-image artifacts.
                All 20 selected studies remain in the metric denominator;
                failures use the predefined evaluation policy rather than being
                silently removed. KiTS data are licensed under CC BY-NC-SA 4.0;
                downstream reuse must comply with its attribution,
                non-commercial and share-alike terms. The published model
                is treated as a non-commercial research asset pending separate
                rights clarification. Source references do not imply endorsement.
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

        <p className="benchmark-footnote">
          {benchmarkResults.title}. {benchmarkResults.protocol.scope}. Results
          are descriptive and must not be used for patient care.
        </p>
      </div>
    </section>
  );
}
