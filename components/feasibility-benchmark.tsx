import {
  Beaker,
  Clock3,
  Database,
  ExternalLink,
  GitCommitHorizontal,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import type { ReactNode } from 'react';

import {
  type AggregateMetric,
  type AvailableBenchmarkResult,
  type BenchmarkMetrics,
  benchmarkResults,
  formatBenchmarkMeasurement,
  formatBenchmarkScore,
  formatMeasurementConfidenceInterval,
  formatRuntime,
  formatScoreConfidenceInterval,
} from '@/lib/benchmark-results';
import { repoFolder } from '@/lib/links';

// The order matters: no outline is copied in until the outputs are locked.
const nextRunSteps = [
  {
    label: 'CT only',
    body: 'Select 20 scans using a recorded rule, without inspecting their reference outlines.',
  },
  {
    label: 'Run the model',
    body: 'Run the unchanged model on each CT, with at most two attempts per scan. Record every success and failure.',
  },
  {
    label: 'Lock the outputs',
    body: 'Lock predictions, failures, timings and file hashes. Publish the lock-file hash on GitHub before scoring.',
  },
  {
    label: 'Then copy in the outlines',
    body: 'Only after the lock, copy the matching KiTS expert outlines into a separate folder.',
  },
  {
    label: 'Score all 20',
    body: 'Compare with the expert outlines, with every failure kept in the averages.',
  },
];

const sourceLinks = [
  {
    href: repoFolder('research/kits23-feasibility'),
    label: 'Method and scripts',
  },
  { href: 'https://github.com/neheller/kits23', label: 'KiTS23 source' },
  {
    href: 'https://huggingface.co/datasets/neheller/KiTS-Challenge-Imaging',
    label: 'KiTS23 imaging (Hugging Face)',
  },
  {
    href: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    label: 'Data licence',
  },
  { href: 'https://zenodo.org/records/5126443', label: 'Published model' },
];

// The arrow is for sighted readers. Screen readers hear the words instead.
function Better({ label, higher = false }: { label: string; higher?: boolean }) {
  return (
    <>
      {label}&nbsp;<span aria-hidden="true">{higher ? '↑' : '↓'}</span>
      <span className="sr-only">{higher ? ' (higher is better)' : ' (lower is better)'}</span>
    </>
  );
}

function ScoreValue({
  label,
  value,
  interval,
}: {
  label: ReactNode;
  value: number | null;
  interval: [number, number] | null;
}) {
  return (
    <div className="benchmark-metric-value">
      <dt>{label}</dt>
      <dd>
        <strong>{formatBenchmarkScore(value)}</strong>
        <small>{formatScoreConfidenceInterval(interval)}</small>
      </dd>
    </div>
  );
}

function MeasurementValue({
  label,
  value,
  interval,
  unit,
}: {
  label: ReactNode;
  value: number | null;
  interval: [number, number] | null;
  unit: 'mm' | 'ml';
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
            <ScoreValue
              label={<Better label="Mean Dice" higher />}
              value={metric.diceMean}
              interval={metric.diceMeanCi95}
            />
            <ScoreValue
              label={<Better label="Mean surface Dice" higher />}
              value={metric.surfaceDiceMean}
              interval={metric.surfaceDiceMeanCi95}
            />
            <MeasurementValue
              label={<Better label="Mean HD95" />}
              value={metric.hd95MmMean}
              interval={metric.hd95MmMeanCi95}
              unit="mm"
            />
            <MeasurementValue
              label={<Better label="Mean volume error" />}
              value={metric.volumeMaeMlMean}
              interval={metric.volumeMaeMlMeanCi95}
              unit="ml"
            />
          </dl>
        </article>
      ))}
    </section>
  );
}

function runMonth(generatedAtUtc: string | null): string | null {
  if (!generatedAtUtc) return null;
  const date = new Date(generatedAtUtc);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function AvailableBenchmark({ result }: { result: AvailableBenchmarkResult }) {
  const { protocol, metrics, runtime, evaluation } = result;
  const { cohortSize, successfulCases, failedCases } = protocol;
  const isComplete = result.state !== 'runningV2';
  const isScriptBlinded = result.state === 'completeV3';
  const month = runMonth(result.generatedAtUtc);

  const failed = failedCases ?? 0;
  const ran = successfulCases ?? 0;
  const kidneyDice = metrics.kidneyAndMass.diceMean;
  // A failed scan scores Dice 0, so the mean over the scans that ran is the
  // full-cohort mean scaled by cohort / successes.
  const kidneyDiceOverRan =
    kidneyDice !== null && ran > 0 ? (kidneyDice * cohortSize) / ran : null;

  const hd95Means = [metrics.kidneyAndMass, metrics.mass, metrics.tumour]
    .map((metric) => metric.hd95MmMean)
    .filter((value): value is number => value !== null);

  let resultHeading: string;
  if (!isComplete) {
    resultHeading = `Awaiting all ${cohortSize} scans`;
  } else if (failed === 0) {
    resultHeading = `${cohortSize} scans completed`;
  } else if (failed === 1) {
    resultHeading = `${ran} completed, 1 failed. All ${cohortSize} included.`;
  } else {
    resultHeading = `${ran} completed, ${failed} failed. All ${cohortSize} included.`;
  }

  let failureRule: string;
  if (!isComplete) {
    failureRule = 'Results remain hidden until the full cohort has been processed and checked.';
  } else if (failed === 0) {
    failureRule = 'Every reported mean includes the full cohort.';
  } else {
    failureRule =
      `${failed === 1 ? 'It stays' : 'They stay'} in every average, scored as a complete miss: Dice 0, surface Dice 0, an HD95 equal to the scan's full diagonal (or 1,000 mm if that can't be worked out), and a volume error equal to the whole reference volume.` +
      (kidneyDiceOverRan !== null
        ? ` Leave ${failed === 1 ? 'it' : 'them'} out and kidney + mass Dice over the ${ran} that ran is about ${kidneyDiceOverRan.toFixed(2)}.`
        : '');
  }

  return (
    <section
      id="research"
      className="benchmark-section"
      aria-labelledby="benchmark-title"
    >
      <div className="site-shell">
        <div className="benchmark-heading-grid">
          <div>
            <p className="eyebrow">Segmentation benchmark</p>
            <h2 id="benchmark-title">
              Automated outlines on {cohortSize} CT scans.{' '}
              {isScriptBlinded
                ? 'Script-blinded evaluation.'
                : 'An initial technical check.'}
            </h2>
          </div>
          <div className="benchmark-intro">
            <p>
              A published KiTS21 model, built with nnU-Net, was run unchanged on {cohortSize} KiTS23 scans
              {isScriptBlinded
                ? ', locking each output before the expert outlines were copied in.'
                : " it wasn't trained on (cases 400 to 419), without test-time augmentation."}{' '}
              This is a check within KiTS, from one US hospital system, not external validation
              {isScriptBlinded ? '' : ", and it wasn't blinded"}: the numbers measure agreement with the
              expert outlines, not clinical accuracy, and none of it is for patient care.
            </p>
          </div>
        </div>

        <div className="benchmark-current-heading">
          <div>
            <p className="eyebrow">
              {isScriptBlinded
                ? 'Blinded by the scripts'
                : `Historical run${month ? `, ${month}` : ''}. Not blinded.`}
            </p>
            <h3 id="current-benchmark-results-title">{resultHeading}</h3>
          </div>
          <p>{failureRule}</p>
        </div>

        {isComplete ? null : (
          <div className="benchmark-status" role="note">
            <span className="benchmark-status-icon">
              <LoaderCircle aria-hidden="true" />
            </span>
            <span className="benchmark-status-copy">
              <strong>Still running</strong>
              <span>
                No score is shown until all {cohortSize} scans have been through
                the model and been checked.
              </span>
            </span>
            <span className="benchmark-status-tag">Not blinded</span>
          </div>
        )}

        <div className="benchmark-protocol-grid">
          <article>
            <Database aria-hidden="true" />
            <div>
              <span>Dataset</span>
              <strong>{protocol.dataset} (public)</strong>
            </div>
          </article>
          <article>
            <Beaker aria-hidden="true" />
            <div>
              <span>Scans</span>
              <strong>{cohortSize} contrast CTs</strong>
            </div>
          </article>
          <article>
            <GitCommitHorizontal aria-hidden="true" />
            <div>
              <span>Model</span>
              <strong>nnU-Net, trained for KiTS21</strong>
            </div>
          </article>
          <article>
            <Clock3 aria-hidden="true" />
            <div>
              <span>
                {isScriptBlinded
                  ? 'Median time per scan'
                  : 'Median time per scan, 16 GB GPU'}
              </span>
              <strong>{formatRuntime(runtime.medianSecondsPerCase)}</strong>
            </div>
          </article>
        </div>

        {isComplete ? (
          <>
            <ResultGrid metrics={metrics} />
            <p className="benchmark-metric-key">
              ↑ higher is better, ↓ lower is better. Each value is the mean over
              all {cohortSize} scans. The 95% confidence interval with it is a
              percentile bootstrap from 10,000 resamples of the {cohortSize} scans.
              With {cohortSize} scans, these intervals are imprecise. HD95 and volume-error intervals
              are particularly sensitive to the few extreme values selected in each resample.
            </p>
          </>
        ) : null}

        <div className="benchmark-method-grid">
          <article className="benchmark-method-card">
            <div>
              <h3>Metric definitions</h3>
              <p>
                Dice is the overlap between the model&apos;s outline and the
                expert one, where 1.0 means identical. Surface Dice is the share
                of both surfaces that sit within about 1 mm of each other, at
                the KiTS23 tolerances (1.03 mm for kidney + mass, 1.13 mm for
                the mass, 1.15 mm for tumour). HD95 is how far apart the two
                surfaces are, leaving out the worst 5% of points. It&apos;s
                measured from each surface to the other, and the larger figure
                is kept. It isn&apos;t one of the official KiTS23 measures.
                Volume error is the average absolute difference in volume, in
                ml. The mass is tumour + cyst, and kidney + mass is all three
                taken as one outline.
              </p>
            </div>
          </article>
          {isComplete ? (
            <article className="benchmark-method-card">
              <div>
                <h3>Interpreting the high HD95 means</h3>
                <p>
                  {hd95Means.length > 0
                    ? `A mean HD95 of ${Math.round(Math.min(...hd95Means))} to ${Math.round(Math.max(...hd95Means))} mm doesn't mean the model is usually centimetres out. `
                    : ''}
                  {failed > 0
                    ? `Two things pull it up. ${failed === 1 ? 'The failed scan counts' : 'The failed scans count'} at the full scan diagonal, which is hundreds of mm, and so does any region a scan that ran left empty, such as a missed tumour. And a few of the others have stray false positives far from the kidney.`
                    : 'Any region the model left empty, such as a missed tumour, counts at the full scan diagonal, which is hundreds of mm. And a few scans have stray false positives far from the kidney, which pull the average up.'}{' '}
                  {isScriptBlinded
                    ? ''
                    : "This run's public file only has means, so there are no medians to show. "}
                  The postprocessing experiment addresses remote false positives, but those rules
                  have not yet been tested on these model outputs.
                </p>
              </div>
            </article>
          ) : null}
          <article className="benchmark-method-card benchmark-method-card-wide">
            <ShieldCheck aria-hidden="true" />
            <div>
              <h3>Sources, publication and licences</h3>
              <p>
                This benchmark publishes aggregate results from an offline run as JSON, without
                scans, outlines, per-scan results or file paths. KiTS23 imaging
                and outlines are CC BY-NC-SA 4.0.
                The model weights are Fabian Isensee&apos;s pretrained nnU-Net
                for KiTS21 (DKFZ), published on Zenodo under CC BY 4.0. They
                were trained on KiTS data, which is non-commercial, so I treat
                them as non-commercial too.
              </p>
              <div className="benchmark-source-links">
                {sourceLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {link.label} <ExternalLink aria-hidden="true" />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ))}
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
                <p className="eyebrow">How this run was done</p>
                <h3 id="evaluation-custody-title">
                  Each output was locked before the expert outlines were copied
                  in.
                </h3>
              </div>
              <span>
                {evaluation.operatorBlinded
                  ? 'Operator-blinded'
                  : 'Script-blinded only'}
              </span>
            </div>
            <div className="benchmark-blinding-limit" role="note">
              <strong>Who could see what</strong>
              <p>{evaluation.custodyStatement}</p>
            </div>
          </div>
        ) : (
          <details className="benchmark-next-run">
            <summary className="cursor-pointer">
              <h3 id="next-run-title" className="inline text-[1.375rem]">
                How the next run will be done
              </h3>
              <span className="ml-3 inline-block align-middle text-sm text-[var(--ink-muted)]">
                Draft, not run yet
              </span>
            </summary>
            <div className="mt-5">
              <p className="benchmark-next-run-intro">
                The next {cohortSize} scans will be blinded by the scripts, in
                this order:
              </p>
              <ol
                className="benchmark-validation-flow"
                aria-label="Order of the next run"
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
                <strong>Limits of blinding</strong>
                <p>
                  It&apos;s script-blinded, not operator-blinded. The
                  model&apos;s scripts can&apos;t see the outlines before the
                  lock, but I&apos;m running it myself and my account can open
                  the KiTS files. I also pick the 20 with a random seed I set.
                  That makes the pick repeatable, but it doesn&apos;t prove I
                  didn&apos;t try a few seeds first. A separate custodian
                  holding the data and the seed would close both gaps.
                </p>
              </div>
            </div>
          </details>
        )}
      </div>
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
              <p className="eyebrow">The benchmark</p>
              <h2 id="benchmark-title">
                Benchmark results unavailable
              </h2>
            </div>
            <div className="benchmark-intro">
              <p>
                The results file failed validation and cannot be displayed.
                The cases and model builder remain available.
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return <AvailableBenchmark result={benchmarkResults} />;
}
