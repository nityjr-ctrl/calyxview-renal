import {
  Boxes,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Ruler,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';

import {
  formatDice,
  formatPercent,
  pipelineResults,
  type RegionSummary,
} from '@/lib/pipeline-results';

const REPO = 'https://github.com/nityjr-ctrl/calyxview-renal';

const outputs = [
  {
    icon: <Boxes />,
    title: '3D case bundle',
    body: 'Tumour-side kidney, contralateral kidney, tumour, cyst, renal sinus, a resection-margin envelope, the parenchyma that would remain, hilar vessels and the body outline, as named meshes any web viewer can load.',
  },
  {
    icon: <Ruler />,
    title: 'Computed nephrometry',
    body: 'R.E.N.A.L. and PADUA components derived from the geometry itself: tumour size, exophytic fraction, distance to the sinus or collecting system, anterior or posterior, polar location. Every assumption is written into the report.',
  },
  {
    icon: <SlidersHorizontal />,
    title: 'Resection geometry',
    body: 'Tumour and kidney volumes, tissue inside a chosen margin, residual parenchyma and preserved fraction, tumour-parenchyma contact surface, distances to sinus, vessels and collecting system.',
  },
  {
    icon: <Cpu />,
    title: 'Evaluation and optimisation',
    body: 'Dice, surface Dice, HD95 and volume error with bootstrap confidence intervals; a grid search over explainable clean-up rules for model output; a check that 3D surfaces stay faithful to the outlines they came from.',
  },
];

function RegionDelta({ label, region }: { label: string; region: keyof RegionSummary }) {
  if (!pipelineResults) return null;
  const raw = pipelineResults.evaluation.raw[region];
  const clean = pipelineResults.evaluation.postprocessed[region];
  return (
    <article className="benchmark-result-card">
      <div className="benchmark-result-heading">
        <span>{label}</span>
        <CheckCircle2 aria-hidden="true" />
      </div>
      <dl className="benchmark-metric-grid">
        <div className="benchmark-metric-value">
          <dt>Dice, before → after ↑</dt>
          <dd>
            <strong>{formatDice(clean.dice.mean)}</strong>
            <small>from {formatDice(raw.dice.mean)} · 95% CI {formatDice(clean.dice.ci95[0])}–{formatDice(clean.dice.ci95[1])}</small>
          </dd>
        </div>
        <div className="benchmark-metric-value">
          <dt>HD95, before → after ↓</dt>
          <dd>
            <strong>{clean.hd95_mm.mean.toFixed(1)} mm</strong>
            <small>from {raw.hd95_mm.mean.toFixed(1)} mm · 95% CI {clean.hd95_mm.ci95[0].toFixed(1)}–{clean.hd95_mm.ci95[1].toFixed(1)} mm</small>
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
  const { nephrometry, postprocess, mesh } = pipelineResults;
  const recommended = mesh.recommended.kidney;

  return (
    <section id="planning" className="benchmark-section pipeline-section" aria-labelledby="pipeline-title">
      <div className="site-shell">
        <div className="benchmark-heading-grid">
          <div>
            <p className="eyebrow">CT-to-3D planning pipeline</p>
            <h2 id="pipeline-title">From a CT outline to a measured 3D case, in under a minute.</h2>
          </div>
          <div className="benchmark-intro">
            <p>
              <code>renalplan</code> is the Python side of CalyxView Renal. It takes a CT and a kidney,
              tumour and cyst outline and produces a 3D case bundle, nephrometry computed from the
              geometry, resection quantities and a one-page report. It runs on an ordinary laptop;
              the GPU segmentation models plug in on the workstation.
            </p>
            <p>
              The numbers below come from {nephrometry.casesEvaluated} real kidneys with expert outlines
              from the open KiTS23 dataset. They show that the chain runs, that its measurements are
              consistent, and how much explainable clean-up rules improve a noisy segmentation. They
              are not a clinical validation and have not been compared with surgeon-assigned scores.
            </p>
          </div>
        </div>

        <div className="pipeline-output-grid">
          {outputs.map((item) => (
            <article className="pipeline-output-card" key={item.title}>
              {item.icon}
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>

        <div className="benchmark-current-heading">
          <div>
            <p className="eyebrow">Real kidneys, expert outlines</p>
            <h3 id="pipeline-nephrometry-title">Nephrometry and resection geometry on {nephrometry.casesEvaluated} KiTS23 cases.</h3>
          </div>
          <p>
            Median runtime {nephrometry.medianRuntimeSeconds.toFixed(0)} seconds per case on CPU. The
            margin is a uniform 5 mm band around the tumour, an illustration rather than a plan.
          </p>
        </div>

        <div className="pipeline-table-wrap">
          <table className="pipeline-table" aria-labelledby="pipeline-nephrometry-title">
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col">R.E.N.A.L.</th>
                <th scope="col">PADUA</th>
                <th scope="col">Tumour</th>
                <th scope="col">Diameter</th>
                <th scope="col">Exophytic</th>
                <th scope="col">To sinus</th>
                <th scope="col">Kidney</th>
                <th scope="col">Preserved</th>
              </tr>
            </thead>
            <tbody>
              {nephrometry.cases.map((row) => (
                <tr key={row.case}>
                  <th scope="row">{row.case}</th>
                  <td>
                    <strong>{row.renal}</strong> <small>{row.renalComplexity}</small>
                  </td>
                  <td>
                    <strong>{row.padua}</strong> <small>{row.paduaComplexity}</small>
                  </td>
                  <td>{row.tumourMl.toFixed(1)} ml</td>
                  <td>{row.diameterCm.toFixed(1)} cm</td>
                  <td>{formatPercent(row.exophyticFraction)}</td>
                  <td>{row.tumourToSinusMm.toFixed(1)} mm</td>
                  <td>{row.ipsilateralKidneyMl} ml</td>
                  <td>{formatPercent(row.preservedFraction)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="benchmark-metric-key">
          Cases are numbered, not identified. Preserved = ipsilateral parenchyma outside a 5 mm margin. The
          renal sinus is approximated from the kidney outline when no excretory phase is available.
        </p>

        <div className="benchmark-current-heading">
          <div>
            <p className="eyebrow">Optimisation, measured</p>
            <h3 id="pipeline-postprocess-title">One explainable rule removes the far false positives.</h3>
          </div>
          <p>
            {postprocess.configurationsTried} rule combinations were scored on {postprocess.casesEvaluated} cases.
            Input: {postprocess.inputNote}
          </p>
        </div>

        <div className="pipeline-table-wrap">
          <table className="pipeline-table" aria-labelledby="pipeline-postprocess-title">
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
              {postprocess.rows.map((row, index) => (
                <tr key={row.rules} className={index === postprocess.rows.length - 1 ? 'pipeline-table-best' : ''}>
                  <th scope="row">{row.rules}</th>
                  <td>{formatDice(row.kidneyAndMassDice)}</td>
                  <td>{formatDice(row.massDice)}</td>
                  <td>{formatDice(row.tumourDice)}</td>
                  <td>{row.tumourHd95Mm.toFixed(1)} mm</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="benchmark-results-grid pipeline-results-grid">
          <RegionDelta label="Kidney + mass" region="kidney_and_mass" />
          <RegionDelta label="Mass (tumour + cyst)" region="mass" />
          <RegionDelta label="Tumour" region="tumour" />
        </div>
        <p className="benchmark-metric-key">
          ↑ Higher is better · ↓ Lower is better · Before and after the best clean-up configuration, same
          cases, bootstrap 95% confidence intervals. The remaining tumour Dice gap is the simulated
          one-voxel erosion, which no clean-up rule should recover.
        </p>

        <div className="benchmark-method-grid">
          <article className="benchmark-method-card">
            <span className="benchmark-method-number">01</span>
            <div>
              <h3>Surfaces stay faithful to the outline</h3>
              <p>
                Every smoothing and decimation setting tried on {mesh.casesEvaluated} cases keeps the 3D
                surface above Dice {formatDice(mesh.minDice)} against its source mask with volume error
                under {mesh.maxAbsVolumeErrorPct.toFixed(1)}%.
                {recommended
                  ? ` The cheapest setting that meets the criteria is ${recommended.target_faces.toLocaleString()} faces (Dice ${formatDice(recommended.mean_dice)}, HD95 ${recommended.mean_hd95_mm.toFixed(1)} mm).`
                  : ''}
              </p>
            </div>
          </article>
          <article className="benchmark-method-card">
            <span className="benchmark-method-number">02</span>
            <div>
              <h3>What comes next</h3>
              <p>
                The first study compares computed nephrometry with surgeon-assigned scores on a
                retrospective, anonymised hospital cohort, and measures how well the research model
                outlines kidney and tumour on local scanners. It needs PACS access with arterial,
                nephrographic and excretory phases; the request and the study design are in the
                repository.
              </p>
            </div>
          </article>
          <article className="benchmark-method-card benchmark-method-card-wide">
            <ShieldCheck aria-hidden="true" />
            <div>
              <h3>Research and teaching software, published as aggregates</h3>
              <p>
                No CT voxels, label volumes, predictions or file paths reach this site: it reads one
                small summary file. The pipeline refuses DICOM that still carries identifiers, keeps
                source images on the workstation, and writes every assumption into each report. KiTS23
                is used under CC BY-NC-SA 4.0. The companion CalyxView endourology viewer provides the
                browser 3D viewer, DICOM intake with an identity audit, and the PCNL and URS planning
                modules that load these bundles.
              </p>
              <div className="benchmark-source-links">
                <a href={`${REPO}/tree/main/pipeline`} target="_blank" rel="noreferrer">
                  Pipeline source <ExternalLink aria-hidden="true" />
                </a>
                <a href={`${REPO}/blob/main/pipeline/results/README.md`} target="_blank" rel="noreferrer">
                  Full results <ExternalLink aria-hidden="true" />
                </a>
                <a href={`${REPO}/blob/main/docs/PARTIAL-NEPHRECTOMY-PLANNING-PROPOSAL.md`} target="_blank" rel="noreferrer">
                  Proposal and study design <ExternalLink aria-hidden="true" />
                </a>
                <a href={`${REPO}/blob/main/docs/PACS-DICOM-EXPORT-REQUEST.md`} target="_blank" rel="noreferrer">
                  PACS export request <ExternalLink aria-hidden="true" />
                </a>
                <a href="https://github.com/nityjr-ctrl/CalyxView" target="_blank" rel="noreferrer">
                  CalyxView endourology viewer <ExternalLink aria-hidden="true" />
                </a>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
