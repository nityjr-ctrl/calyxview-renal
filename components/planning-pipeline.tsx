import {
  Boxes,
  Cpu,
  ExternalLink,
  Ruler,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';

import { repoFile, repoFolder } from '@/lib/links';
import {
  formatDice,
  formatPercent,
  formatShare,
  pipelineResults,
  type NephrometryCase,
  type RegionSummary,
} from '@/lib/pipeline-results';

// Kidneys A to E in the 3D viewer are the first five rows of the table.
const KIDNEY_LETTERS = ['A', 'B', 'C', 'D', 'E'];

const outputs = [
  {
    icon: <Boxes />,
    title: '3D model',
    body: 'Named surfaces for both kidneys, tumour, cyst, an estimated sinus, a margin envelope and the volume outside it. With CT input, the pipeline can also estimate the body outline and contrast-enhanced vessels near the hilum. Vessel extraction has only been tested on a synthetic phantom containing an aorta; renal arteries and veins have not been tested or separated.',
  },
  {
    icon: <Ruler />,
    title: 'R.E.N.A.L. and PADUA',
    body: 'Rule-based scores from tumour size, exophytic extent, sinus or collecting-system distance, anterior/posterior position and polar location. Reports record the assumptions. Missing anatomy limits which items can be assessed; those limitations are set out below.',
  },
  {
    icon: <SlidersHorizontal />,
    title: 'Volumes and distances',
    body: 'Tumour and kidney volumes, tissue inside and outside a chosen margin, the interface between tumour and kidney and distance to the estimated sinus. Vessel-distance measurements have only been tested on the phantom. Collecting-system distance requires a separate outline and has not yet been tested.',
  },
  {
    icon: <Cpu />,
    title: 'Checks',
    body: 'Overlap, surface distance and volume error quantify agreement with reference outlines. Separate experiments test postprocessing on simulated errors and compare smoothed 3D surfaces with their source label maps.',
  },
];

const SMALL_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

// Counts under ten are written as words, to match the rest of the copy.
function count(value: number): string {
  return Number.isInteger(value) && value >= 0 && value < 10
    ? SMALL_NUMBERS[value]
    : value.toLocaleString('en-GB');
}

function joinList(items: Array<string | number>): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function seconds(value: number): string {
  return Math.round(value).toString();
}

function caseLabel(row: NephrometryCase): string {
  const letter = KIDNEY_LETTERS[row.case - 1];
  return letter ? `${row.case} (${letter})` : `${row.case}`;
}

function casesWord(items: unknown[]): string {
  return items.length === 1 ? 'case' : 'cases';
}

function NewTab() {
  return <span className="sr-only"> (opens in a new tab)</span>;
}

function RegionDelta({ label, region }: { label: string; region: keyof RegionSummary }) {
  if (!pipelineResults) return null;
  const raw = pipelineResults.evaluation.raw[region];
  const clean = pipelineResults.evaluation.postprocessed[region];
  const mm = (value: number) => value.toFixed(1);
  return (
    <article className="benchmark-result-card">
      <div className="benchmark-result-heading">
        <span>{label}</span>
      </div>
      <dl className="benchmark-metric-grid">
        <div className="benchmark-metric-value">
          <dt>
            Mean Dice, before and after&nbsp;<span aria-hidden="true">↑</span>
            <span className="sr-only"> (higher is better)</span>
          </dt>
          <dd>
            <strong>{formatDice(clean.dice.mean)}</strong>
            <small>before {formatDice(raw.dice.mean)}</small>
          </dd>
        </div>
        <div className="benchmark-metric-value">
          <dt>
            Mean HD95, before and after&nbsp;<span aria-hidden="true">↓</span>
            <span className="sr-only"> (lower is better)</span>
          </dt>
          <dd>
            <strong>{mm(clean.hd95_mm.mean)} mm</strong>
            <small>before {mm(raw.hd95_mm.mean)} mm</small>
          </dd>
        </div>
        <div className="benchmark-metric-value">
          <dt>
            Mean volume error, before and after&nbsp;<span aria-hidden="true">↓</span>
            <span className="sr-only"> (lower is better)</span>
          </dt>
          <dd>
            <strong>{mm(clean.volume_error_ml.mean)} ml</strong>
            <small>before {mm(raw.volume_error_ml.mean)} ml</small>
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function PlanningPipeline() {
  if (!pipelineResults) {
    return null;
  }
  const { nephrometry, postprocess, mesh, evaluation } = pipelineResults;
  const recommended = mesh.recommended.kidney;

  const runtimes = nephrometry.cases.map((row) => row.runtimeSeconds);
  const fastest = Math.min(...runtimes);
  const slowest = Math.max(...runtimes);

  // PADUA's collecting-system item defaulted to 1 point; the tumours closest to
  // the sinus are the ones most likely to be scored a point low.
  // A case whose sinus estimate is implausibly large is left out: its distance means little.
  const nearSinus = nephrometry.cases
    .filter((row) => row.tumourToSinusMm <= 1.5 && !row.sinusEstimateTooLarge)
    .map((row) => row.case);
  // Tumours with 5% or less outside the kidney outline are scored E 3. Only
  // name the ones a reader might call exophytic: a sliver under 1% reads as
  // endophytic anyway.
  const smallExophytic = nephrometry.cases.filter(
    (row) => row.exophyticFraction >= 0.01 && row.exophyticFraction <= 0.05,
  );
  // Where the sinus estimate was too small or off-centre to set the polar lines.
  const polarAssumed = nephrometry.cases.filter((row) => row.polarLinesAssumed).map((row) => row.case);
  // Where it was far too big for a renal sinus, so the kidney isn't the usual shape.
  const sinusTooLarge = nephrometry.cases.filter((row) => row.sinusEstimateTooLarge).map((row) => row.case);

  // Built from the data, so a rerun that renumbers the cases can't leave a
  // note pointing at the wrong row.
  const outlineNotes = nephrometry.cases
    .filter((row) => (row.extraTumourPieces ?? 0) > 0)
    .map((row) => {
      const extra = row.extraTumourPieces ?? 0;
      return extra === 1
        ? `Case ${row.case}'s outlines have a second, smaller piece labelled tumour, which may not be in the same kidney. The scores are for the larger one.`
        : `Case ${row.case}'s outlines have ${count(extra)} more, smaller pieces labelled tumour, which may not be in the same kidney. The scores are for the largest one.`;
    });
  // An other-kidney volume near zero means that kidney isn't in the outlines.
  const noOtherKidney = nephrometry.cases
    .filter((row) => row.otherKidneyMl !== undefined && row.otherKidneyMl < 5)
    .map((row) => row.case);
  if (noOtherKidney.length > 0) {
    outlineNotes.push(
      `In ${casesWord(noOtherKidney)} ${joinList(noOtherKidney)} almost nothing is labelled kidney apart from the tumour-side kidney. The outlines can't tell whether the other kidney is missing, outside the scan or joined to this one.`,
    );
  }

  const baseline = postprocess.rows[0];
  const kidneyPiecesOnly = postprocess.rows.length > 2 ? postprocess.rows[1] : null;
  const chosen = postprocess.rows[postprocess.rows.length - 1];
  const settingsPerStructure = mesh.table.filter((row) => row.structure === 'kidney').length;
  // Whether every setting in the sweep met the criteria, so the smallest one tried wins.
  const everySettingMeets =
    mesh.minDice >= mesh.criteria.min_dice &&
    mesh.maxAbsVolumeErrorPct <= mesh.criteria.max_abs_volume_error_pct;
  // Both criteria apply to the means over the sweep cases, not to single cases.
  const criteria = `mean Dice ${mesh.criteria.min_dice.toFixed(2)} or better and mean volume error ${mesh.criteria.max_abs_volume_error_pct}% or less`;
  const recommendedMesh = recommended
    ? `${recommended.target_faces.toLocaleString('en-GB')} triangles, at Dice ${formatDice(recommended.mean_dice)} and HD95 ${recommended.mean_hd95_mm.toFixed(1)} mm`
    : '';

  return (
    <section id="planning" className="benchmark-section pipeline-section" aria-labelledby="pipeline-title">
      <div className="site-shell">
        <div className="benchmark-heading-grid">
          <div>
            <p className="eyebrow">Scoring & model methods</p>
            <h2 id="pipeline-title">Measurements from expert outlines</h2>
          </div>
          <div className="benchmark-intro">
            <p>
              The <code>renalplan</code> Python package builds surface models, calculates R.E.N.A.L.
              and PADUA, and measures volumes from kidney, tumour and cyst label maps on a CPU.
              These results use expert outlines from {count(nephrometry.casesEvaluated)} KiTS23 kidneys.
              They do not test automated segmentation or agreement with clinicians&apos; scores.
              Those outline-based cases did not run TotalSegmentator or nnU-Net. The new local AI pilot
              has separate source records and review requirements.
            </p>
          </div>
        </div>

        <details className="atlas-method-disclosure">
        <summary>Pipeline outputs and implementation scope</summary>
        <div className="pipeline-output-grid">
          {outputs.map((item) => (
            <article className="pipeline-output-card" key={item.title}>
              {item.icon}
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
        </details>

        <div className="benchmark-current-heading">
          <div>
            <p className="eyebrow">KiTS23 kidneys, expert outlines</p>
            <h3 id="pipeline-nephrometry-title">
              Scores and volumes: {count(nephrometry.casesEvaluated)} cases
            </h3>
          </div>
          <p>
            Each run took {seconds(fastest)} to {seconds(slowest)} seconds on a CPU, median{' '}
            {seconds(nephrometry.medianRuntimeSeconds)} seconds. Thin-slice scans took longest.
          </p>
        </div>

        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a table that scrolls sideways must be reachable by keyboard. */}
        <section className="pipeline-table-wrap" tabIndex={0} aria-labelledby="pipeline-nephrometry-title">
          <table className="pipeline-table pipeline-table-sticky" aria-labelledby="pipeline-nephrometry-title">
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col">R.E.N.A.L.</th>
                <th scope="col">PADUA</th>
                <th scope="col">Tumour volume</th>
                <th scope="col">Diameter</th>
                <th scope="col">Exophytic</th>
                <th scope="col">To sinus</th>
                <th scope="col">Tumour-side kidney</th>
                <th scope="col">Kept at 5 mm</th>
              </tr>
            </thead>
            <tbody>
              {nephrometry.cases.map((row) => (
                <tr key={row.case}>
                  <th scope="row">{caseLabel(row)}</th>
                  <td>
                    <strong>{row.renal}</strong> <small>{row.renalComplexity}</small>
                  </td>
                  <td>
                    <strong>{row.padua}</strong> <small>{row.paduaComplexity}</small>
                  </td>
                  <td>{row.tumourMl.toFixed(1)} ml</td>
                  <td>{row.diameterCm.toFixed(1)} cm</td>
                  <td>{formatShare(row.exophyticFraction)}</td>
                  <td>{row.tumourToSinusMm.toFixed(1)} mm</td>
                  <td>{row.ipsilateralKidneyMl} ml</td>
                  <td>{formatPercent(row.preservedFraction)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <div className="benchmark-metric-key grid gap-2">
          <p>
            Kidneys A to E in the 3D viewer are cases 1 to 5. Scoring follows Kutikov and Uzzo, J Urol
            2009 (R.E.N.A.L.) and Ficarra et al., Eur Urol 2009 (PADUA). For the PADUA pole, a tumour
            counts as between the poles only if more than half lies between the polar lines,
            following the automated rule used by Wood et al. (BJU Int 2024).
          </p>
          <p>
            L and the PADUA pole are approximate for every case. Both scores set their lines on axial CT
            slices, and each defines them differently. The pipeline uses one pair of planes across the
            kidney&apos;s own long axis for both, placed from the estimated sinus.
          </p>
          <p>
            With no vessel or collecting-system outlines, the R.E.N.A.L. hilar (h) suffix wasn&apos;t
            assessed, and PADUA&apos;s collecting-system item defaulted to 1 point. A PADUA total
            may therefore be one point low
            {nearSinus.length > 0
              ? `, most likely for ${casesWord(nearSinus)} ${joinList(nearSinus)}, which sit within about 1 mm of the sinus.`
              : '.'}
          </p>
          <p>
            N is the distance to the renal sinus, which is estimated from the kidney outline. A tumour
            with 5% or less outside the kidney&apos;s convex outline is scored as entirely endophytic
            (E 3).
            {smallExophytic.map((row) => (
              <span key={row.case}>
                {' '}
                Case {row.case}, at {formatShare(row.exophyticFraction)}, therefore scores{' '}
                {row.renal}. Counting that {formatShare(row.exophyticFraction)} as exophytic, it
                would be {row.renalTotal - 1}
                {row.renal.replace(/^\d+/, '')} and PADUA {row.padua - 1}.
              </span>
            ))}
          </p>
          {polarAssumed.length > 0 ? (
            <p>
              Cases {joinList(polarAssumed)} use fallback polar lines because the sinus estimate is
              too small or off-centre. Each line leaves 30% of the kidney&apos;s volume beyond it.
              L and the PADUA pole are especially uncertain in these cases. N and PADUA&apos;s rim
              and sinus items still use the small sinus estimate; N may overestimate the distance.
            </p>
          ) : null}
          {sinusTooLarge.length > 0 ? (
            <p>
              Cases {joinList(sinusTooLarge)} have implausibly large sinus estimates, consistent with
              atypical kidney geometry such as a horseshoe kidney. L, N and PADUA&apos;s pole, rim and
              sinus items are unreliable for these shapes.
            </p>
          ) : null}
          {outlineNotes.length > 0 ? <p>{outlineNotes.join(' ')}</p> : null}
          <p>
            &ldquo;Kept at 5 mm&rdquo; is the share of tumour-side parenchyma, tumour excluded,
            outside a uniform 5 mm band round the tumour: volume, not function, and not a surgical
            plan. Enucleation along the pseudocapsule takes less, renorrhaphy and devascularised
            tissue take more, and in one series of 894 partial nephrectomies the median kept was 84%
            (Kazama et al., BJU Int 2024).
          </p>
        </div>

        <div className="benchmark-current-heading">
          <div>
            <p className="eyebrow">Simulated errors</p>
            <h3 id="pipeline-postprocess-title">Postprocessing on simulated errors</h3>
          </div>
          <p>
            Expert outlines for {count(postprocess.casesEvaluated)} kidneys were altered by shrinking
            each tumour by one voxel and adding three remote speckled blobs, approximately 70%
            labelled kidney and 30% tumour. The experiment compared{' '}
            {count(postprocess.configurationsTried)} combinations of clean-up rules.
            {kidneyPiecesOnly
              ? ` Every combination keeps the two largest kidney pieces, and that alone lifts kidney + mass Dice (kidney, tumour and cyst taken as one outline) from ${formatDice(baseline.kidneyAndMassDice)} to ${formatDice(kidneyPiecesOnly.kidneyAndMassDice)}.`
              : ''}{' '}
            Keeping tumour or cyst only within 5 mm of the kidney then clears the tumour-labelled speckle.{' '}
            {postprocess.tiedForBest > 1
              ? `The top score is a tie between ${count(postprocess.tiedForBest)} combinations, identical on every measure. A 10 mm limit gives the same result as 5 mm, and dropping small pieces adds nothing once that limit is on, so this test can't choose the distance.`
              : ''}
          </p>
        </div>

        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a table that scrolls sideways must be reachable by keyboard. */}
        <section className="pipeline-table-wrap" tabIndex={0} aria-labelledby="pipeline-postprocess-title">
          <table className="pipeline-table pipeline-table-rules" aria-labelledby="pipeline-postprocess-title">
            <thead>
              <tr>
                <th scope="col">Clean-up rules</th>
                <th scope="col">Kidney + mass Dice</th>
                <th scope="col">Mass Dice</th>
                <th scope="col">Tumour Dice</th>
                <th scope="col">Tumour HD95</th>
              </tr>
            </thead>
            <tbody>
              {postprocess.rows.map((row) => (
                <tr key={row.rules} className={row === chosen ? 'pipeline-table-best' : ''}>
                  <th scope="row">
                    {row.rules}
                    {row === chosen ? <span className="sr-only"> (the rules used below)</span> : null}
                  </th>
                  <td>{formatDice(row.kidneyAndMassDice)}</td>
                  <td>{formatDice(row.massDice)}</td>
                  <td>{formatDice(row.tumourDice)}</td>
                  <td>{row.tumourHd95Mm.toFixed(1)} mm</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="benchmark-results-grid pipeline-results-grid">
          <RegionDelta label="Kidney + mass" region="kidney_and_mass" />
          <RegionDelta label="Mass (tumour + cyst)" region="mass" />
          <RegionDelta label="Tumour" region="tumour" />
        </div>
        <div className="benchmark-metric-key grid gap-2">
          <p>
            ↑ higher is better, ↓ lower is better. Means over the same{' '}
            {count(postprocess.casesEvaluated)} cases, before and after the last row&apos;s rules.
            Confidence intervals are not reported for this small experiment. HD95 here pools the
            distances measured from both surfaces, so it can read lower than the segmentation benchmark&apos;s HD95, which keeps the
            larger of the two directions.
          </p>
          <p>
            Tumour Dice stops at {formatDice(evaluation.postprocessed.tumour.dice.mean)} because every
            tumour was shrunk by a voxel, and no clean-up rule can put that back. It&apos;s also why
            volume error gets worse after clean-up: with the blobs gone only the shrinkage is left, so
            the volumes read low.
          </p>
          <p>
            Scoring only looks inside a box reaching 40 mm beyond the expert outlines, so a blob
            further out than that isn&apos;t counted, before or after.
          </p>
          <p>
            This tests implementation behaviour on artificial errors. It doesn&apos;t show it
            helps real model output. The next step is to run the last row&apos;s rules, unchanged, on
            the segmentation benchmark&apos;s model outlines, using its scoring method. That
            keeps every scan in, including any that failed. It also looks at the whole scan and counts
            a tumour the rules delete as a miss, which the pipeline&apos;s own scorer doesn&apos;t do
            yet.
          </p>
        </div>

        <div className="benchmark-method-grid">
          <article className="benchmark-method-card benchmark-method-card-wide">
            <div>
              <h3>Surface fidelity and smoothing</h3>
              <p>
                The sweep compared {count(settingsPerStructure)} smoothing and simplification settings
                per structure on {count(mesh.casesEvaluated)} cases against their source outlines.
                Averaged over those {count(mesh.casesEvaluated)}, every setting
                kept Dice at {formatDice(mesh.minDice)} or better, with volume error of{' '}
                {mesh.maxAbsVolumeErrorPct.toFixed(2)}% or less. Single cases went down to Dice{' '}
                {formatDice(mesh.caseMinDice)} and up to {mesh.caseMaxAbsVolumeErrorPct.toFixed(1)}%
                volume error.
                {recommended
                  ? everySettingMeets
                    ? ` Every setting met the stated criteria (${criteria}). The smallest tested setting was ${recommendedMesh}.`
                    : ` The smallest setting meeting the stated criteria (${criteria}) was ${recommendedMesh}.`
                  : ''}{' '}
                This checks the pipeline&apos;s own 3D surfaces. Its default still uses 15 smoothing
                passes, which was not included in the sweep. The surfaces of Kidneys A to E
                came from the separate CalyxView project (not public yet), not from this pipeline. The
                builder&apos;s are drawn from a smoothed distance field on a 1 mm grid instead (coarser for very
                large volumes; the report says the grid used), which
                copes better with thick slices.
              </p>
            </div>
          </article>
          <article className="benchmark-method-card benchmark-method-card-wide">
            <ShieldCheck aria-hidden="true" />
            <div>
              <h3>Published assets and data handling</h3>
              <p>
                Published here: the five kidney meshes (Kidneys A to E in the 3D viewer), the numbers
                calculated by renalplan from the KiTS23 outlines, and cropped, windowed axial CT slices
                round each of those kidneys with their KiTS outlines. Kidney C&apos;s file also has the
                ribs, psoas, colon, spleen, liver and body outline, drawn on the KiTS23 CT by
                TotalSegmentator, an AI model (Wasserthal et al., Radiology: AI 2023).
              </p>
              <p>
                Not published: the full CT volumes, the label volumes and model output. The KiTS case
                numbers are in the repository, so anyone can check a case against the source.
              </p>
              <p>
                For hospital scans, the pipeline&apos;s DICOM loader stops a series if its first file
                has any of 13 identifying header fields filled in, unless the file is flagged as
                de-identified. It doesn&apos;t look at private tags, burned-in text or NIfTI files, so
                it&apos;s a tripwire, not a de-identification check. The anonymising has to happen
                first.
              </p>
              <p>
                The meshes and CT slices are adapted from KiTS23, so they carry its CC BY-NC-SA 4.0
                licence.
              </p>
              <div className="benchmark-source-links">
                <a href={repoFolder('pipeline')} target="_blank" rel="noreferrer">
                  Pipeline source <ExternalLink aria-hidden="true" />
                  <NewTab />
                </a>
                <a href={repoFile('pipeline/results/README.md')} target="_blank" rel="noreferrer">
                  Full results <ExternalLink aria-hidden="true" />
                  <NewTab />
                </a>
                <a href={repoFile('docs/PARTIAL-NEPHRECTOMY-PLANNING-PROPOSAL.md')} target="_blank" rel="noreferrer">
                  Study proposal <ExternalLink aria-hidden="true" />
                  <NewTab />
                </a>
                <a href={repoFile('docs/PACS-DICOM-EXPORT-REQUEST.md')} target="_blank" rel="noreferrer">
                  CalyxView teaching export request <ExternalLink aria-hidden="true" />
                  <NewTab />
                </a>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
