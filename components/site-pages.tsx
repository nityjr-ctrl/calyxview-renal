/* oxlint-disable next/no-img-element -- Vite serves the pre-sized local CT WebP assets directly. */
import { useEffect, useRef, useState } from 'react';
import { FeasibilityBenchmark } from './feasibility-benchmark';
import { PlanningPipeline } from './planning-pipeline';
import { referenceCases } from '@/lib/reference-cases';
import { CALYXVIEW_HOME } from '@/lib/site-assets';
import { keyImageUrl } from './ct-slices';

export type OpenWorkspace = (
  mode?: 'plan' | 'build',
  caseId?: string,
  options?: { sample?: boolean; ct?: boolean },
) => void;

const pages = [
  ['cases', 'Cases'],
  ['build', 'Build a model'],
  ['evidence', 'Methods & evidence'],
  ['about', 'About'],
] as const;

export function pageFromHash(hash: string) {
  const key = hash.slice(1).split('/')[0];
  if (key === 'kidneys' || key === 'hand-made') return 'cases';
  if (key === 'planning' || key === 'research') return 'evidence';
  if (key === 'next' || key === 'limits') return 'about';
  return pages.some(([id]) => id === key) ? key : 'home';
}

function Brand() {
  return (
    <a className="atlas-brand" href="#home" aria-label="CalyxView Renal home">
      CalyxView<span>Renal</span>
    </a>
  );
}

function Header({ page }: { page: string }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false);
        toggle.current?.focus();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [expanded]);
  return (
    <header className="atlas-header atlas-shell">
      <Brand />
      <button
        ref={toggle}
        type="button"
        className="atlas-menu"
        aria-controls="atlas-nav"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? 'Close menu' : 'Menu'}
      </button>
      <nav
        id="atlas-nav"
        className={expanded ? 'atlas-nav is-open' : 'atlas-nav'}
        aria-label="Main navigation"
      >
        <a href={CALYXVIEW_HOME}>CalyxView home</a>
        {pages.map(([id, label]) => (
          <a
            href={`#${id}`}
            key={id}
            aria-current={page === id ? 'page' : undefined}
            onClick={() => setExpanded(false)}
          >
            {label}
          </a>
        ))}
      </nav>
    </header>
  );
}

function PageIntro({
  section,
  title,
  children,
}: {
  section: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="atlas-page-intro">
      <p className="atlas-kicker">{section}</p>
      <h1>{title}</h1>
      <div className="atlas-lead">{children}</div>
    </div>
  );
}

function Home({ open }: { open: OpenWorkspace }) {
  return (
    <>
      <section className="atlas-home-opening atlas-shell">
        <div className="atlas-home-copy">
          <p className="atlas-kicker">Renal imaging research</p>
          <h1>CT, 3D anatomy and renal tumour scoring.</h1>
          <p className="atlas-lead">
            Examine five kidneys from the KiTS23 research dataset. Compare the
            CT with the 3D model, inspect the tumour and read the rules behind
            its R.E.N.A.L. and PADUA scores.
          </p>
          <div className="atlas-actions">
            <a className="atlas-button" href="#cases">
              View the cases
            </a>
            <button
              className="atlas-link"
              data-return-focus="home-case-c"
              onClick={() => open('plan', 'reference-c')}
            >
              Open Kidney C in 3D
            </button>
          </div>
          <p className="atlas-research-note">
            A research prototype by Nity G. Not for diagnosis, treatment or
            surgical planning.
          </p>
        </div>
        <figure className="atlas-cover">
          <img
            src={keyImageUrl('reference-c')}
            alt="Axial CT slice of Kidney C with the kidney and tumour outlines overlaid"
            width="512"
            height="512"
            fetchPriority="high"
          />
          <figcaption>
            <span>
              Kidney C <span className="atlas-caption-dot">/</span> Axial CT
            </span>
            <span>KiTS23 expert outlines</span>
          </figcaption>
        </figure>
      </section>
      <section
        className="atlas-index atlas-shell"
        aria-labelledby="site-contents"
      >
        <h2 id="site-contents">Working with the model</h2>
        <div className="atlas-index-rows">
          <a href="#cases">
            <span className="atlas-index-number">01</span>
            <h3>Compare the cases</h3>
            <p>
              Five CT-derived kidneys, their computed scores and an illustrative
              anatomy model.
            </p>
            <span className="atlas-index-action">Cases</span>
          </a>
          <a href="#build">
            <span className="atlas-index-number">02</span>
            <h3>Use your own outline</h3>
            <p>
              Build a surface model from a NIfTI label map. Processing runs in
              your browser.
            </p>
            <span className="atlas-index-action">Build guide</span>
          </a>
          <a href="#evidence">
            <span className="atlas-index-number">03</span>
            <h3>Read the evidence</h3>
            <p>
              Scoring assumptions, mesh checks and the results of a 20-scan
              segmentation benchmark.
            </p>
            <span className="atlas-index-action">Methods</span>
          </a>
        </div>
      </section>
      <section className="atlas-research-band">
        <div className="atlas-shell atlas-two-column">
          <h2>What has been tested?</h2>
          <div>
            <p>
              The published results check technical behaviour on public research
              data. The scores and models have not been clinically validated.
            </p>
            <p>
              A proposed study would compare the calculated scores with
              independent clinician assessments on consecutive partial
              nephrectomy cases.
            </p>
            <a className="atlas-link" href="#about">
              Read the study proposal
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

function Cases({ open }: { open: OpenWorkspace }) {
  return (
    <div className="atlas-shell">
      <PageIntro section="Case collection" title="Five kidneys, from CT to 3D.">
        <p>
          Each case pairs a cropped CT series with a surface model and computed
          nephrometry. Kidney and tumour outlines are from KiTS23 expert
          annotations; scores are calculated from the original label maps.
        </p>
      </PageIntro>
      <div className="atlas-case-note">
        <strong>Before comparing scores</strong>
        <p>
          These are unvalidated estimates. Sinus and polar anatomy are
          approximated; collecting-system involvement and the hilar suffix are
          not assessed. Read the case-specific flags in the viewer and the{' '}
          <a href="#evidence/scoring">scoring methods</a>.
        </p>
      </div>
      <div className="atlas-case-list">
        {referenceCases.map((item, index) => (
          <article className="atlas-case" key={item.id}>
            <figure>
              <img
                src={keyImageUrl(item.id)}
                alt={`Axial CT of ${item.label}, with kidney and tumour outlines`}
                width="512"
                height="512"
                loading={index ? 'lazy' : 'eager'}
              />
              <figcaption>CT with expert outlines</figcaption>
            </figure>
            <div className="atlas-case-description">
              <p className="atlas-kicker">
                KiTS23 / {String(index + 1).padStart(2, '0')}
              </p>
              <h2>{item.label}</h2>
              <p>
                {item.id === 'reference-c'
                  ? 'Includes surrounding organs from unchecked automated outlines.'
                  : 'Kidney and tumour surfaces from the expert label map.'}
              </p>
              {item.nephrometry.polarLinesAssumed && (
                <p className="atlas-case-flag">
                  Polar lines use the volume-based fallback.
                </p>
              )}
              {item.nephrometry.sinusEstimateTooLarge && (
                <p className="atlas-case-flag">
                  Unusual sinus estimate. Interpret the scores with caution.
                </p>
              )}
            </div>
            <dl className="atlas-case-metrics">
              <div>
                <dt>R.E.N.A.L.</dt>
                <dd>{item.nephrometry.renalLabel}</dd>
              </div>
              <div>
                <dt>PADUA</dt>
                <dd>{item.nephrometry.paduaTotal}</dd>
              </div>
              <div>
                <dt>Tumour diameter</dt>
                <dd>
                  {item.nephrometry.diameterCm.toFixed(1)} <span>cm</span>
                </dd>
              </div>
              <div>
                <dt>Tumour volume</dt>
                <dd>
                  {item.nephrometry.tumourMl.toFixed(1)} <span>mL</span>
                </dd>
              </div>
            </dl>
            <div className="atlas-case-actions">
              <button
                className="atlas-button"
                data-return-focus={`case-${item.id}`}
                onClick={() => open('plan', item.id)}
              >
                View {item.label} in 3D
              </button>
              <button
                className="atlas-link"
                data-return-focus={`ct-${item.id}`}
                onClick={() => open('plan', item.id, { ct: true })}
              >
                Read the CT slices
              </button>
            </div>
          </article>
        ))}
      </div>
      <section className="atlas-illustrative atlas-two-column">
        <div><p className="atlas-kicker">CT urography</p><h2>Inside the collecting system</h2></div>
        <div><p>An excretory-phase CT with separate kidney and contrast-filled collecting-system surfaces. Compare the reconstruction with the source slices. Automatic outlines await expert review.</p><button className="atlas-button atlas-button-outline" data-return-focus="urogram" onClick={() => open('plan', 'urogram', { ct: true })}>Open the CT urogram</button><p>TCGA Research Network / TCIA · CC BY 3.0. A separate case from the five KiTS23 kidneys.</p></div>
      </section>
      <section className="atlas-illustrative atlas-two-column">
        <div>
          <p className="atlas-kicker">Illustrative anatomy</p>
          <h2>A model made in code</h2>
        </div>
        <div>
          <p>
            A right kidney with an interpolar tumour, made in code. The vessels
            and collecting system are drawn for illustration. This is a
            synthetic model, not a reconstruction of a patient.
          </p>
          <button
            className="atlas-button atlas-button-outline"
            data-return-focus="synthetic"
            onClick={() => open('plan', 'synthetic')}
          >
            Open the illustrative model
          </button>
        </div>
      </section>
      <p className="atlas-source-line">
        Imaging and labels:{' '}
        <a href="https://kits-challenge.org/kits23/">KiTS23</a>, CC BY-NC-SA
        4.0. Case letters are presentation labels.{' '}
        <a href="#evidence/scoring">Model provenance and scoring assumptions</a>
        .
      </p>
    </div>
  );
}

function Build({ open }: { open: OpenWorkspace }) {
  return (
    <div className="atlas-shell">
      <PageIntro section="Model builder" title="Start with a labelled kidney.">
        <p>
          Turn a NIfTI outline into an interactive 3D model, approximate
          nephrometry scores and a downloadable report. Your file is processed
          locally in this browser.
        </p>
      </PageIntro>
      <div className="atlas-build-layout">
        <section className="atlas-build-start">
          <h2>Open the builder</h2>
          <p>
            Use an anonymised research label map, or load the included sample to
            see the process.
          </p>
          <button
            className="atlas-button"
            data-return-focus="build-own"
            onClick={() => open('build')}
          >
            Choose a label map
          </button>
          <button
            className="atlas-link"
            data-return-focus="build-sample"
            onClick={() => open('build', 'synthetic', { sample: true })}
          >
            Build the sample
          </button>
          <p className="atlas-small">
            Accepts .nii and .nii.gz files. A raw CT scan is not a label map.
          </p>
        </section>
        <div className="atlas-prose atlas-build-instructions">
          <section>
            <h2>Prepare the outline</h2>
            <p>
              Prepare the kidney and tumour outlines outside this site, then
              check them against the scan. Export the reviewed segmentation as
              a NIfTI label map.
            </p>
            <dl className="atlas-label-key">
              <div>
                <dt>1</dt>
                <dd>Kidney</dd>
              </div>
              <div>
                <dt>2</dt>
                <dd>Tumour</dd>
              </div>
              <div>
                <dt>3</dt>
                <dd>Cyst</dd>
              </div>
            </dl>
            <p>
              Other non-zero labels become separate surfaces. When both kidneys
              are present, the builder scores the kidney nearest the tumour.
            </p>
          </section>
          <section>
            <h2>Inspect the result</h2>
            <p>
              Rotate the model, control each layer and compare the points
              awarded for R.E.N.A.L. and PADUA. Adjust the margin to see the
              volume outside a uniform band around the tumour.
            </p>
            <p>
              The sinus is estimated from the outline, so N, L and the PADUA
              pole are approximate. Collecting-system involvement is not
              assessed. The remaining-volume estimate is not renal function or a
              surgical resection plan.
            </p>
            <p>
              The browser reproduces the reference calculation&apos;s scores on the
              synthetic test phantom. On other outlines, raw E and N can differ
              slightly because the browser&apos;s hull is exact, while the
              reference calculation uses a sampled approximation. Agreement on the
              phantom does not establish agreement on patient anatomy.
            </p>
          </section>
          <section>
            <h2>Export your work</h2>
            <p>
              Download the surfaces as GLB or STL and the report as JSON or
              Markdown. Measurements come from the original label map. Display
              surfaces are smoothed on a 1 mm grid, or a coarser grid for large
              volumes; the report records the grid used.
            </p>
          </section>
          <section>
            <h2>File handling</h2>
            <p>
              The browser builder does not upload or store your file. It does
              not anonymise it either. Remove identifying information before
              loading research data. Closing or reloading the page clears the
              working model.
            </p>
            <a className="atlas-link" href="#evidence/scoring">
              Read the methods and limitations
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}

function Evidence({ hash }: { hash: string }) {
  const segmentation =
    hash === '#evidence/segmentation' || hash === '#research';
  return (
    <>
      <div className="atlas-shell">
        <PageIntro
          section="Methods & evidence"
          title="What the results can tell us."
        >
          <p>
            Two distinct checks: measurements calculated from expert outlines,
            and a segmentation model tested against those outlines. Neither
            establishes clinical accuracy.
          </p>
        </PageIntro>
        <section className="atlas-case-note" aria-labelledby="kits-explained">
          <h2 id="kits-explained">What is the KiTS competition?</h2>
          <p>
            KiTS stands for Kidney Tumour Segmentation. Research teams compete
            to teach software to outline the kidney, tumours and cysts on CT.
            The organisers compare those predictions with expert outlines.
            The five kidneys here use KiTS23 expert outlines; they are not
            predictions from our model or evidence that CalyxView won a challenge.
          </p>
          <p>
            <a className="atlas-link" href="https://kits-challenge.org/kits23/">Read the organisers&apos; description of KiTS23</a>
          </p>
          <h3>Why no collecting system in the tumour cases?</h3>
          <p>
            KiTS23 labels the kidney, tumours and cysts. It supplies no separate
            outline of the collecting system. Its scans use corticomedullary or
            nephrographic contrast phases, rather than a dedicated excretory
            series showing contrast in the urine. We have no supported
            calyceal reconstruction to show for these five cases, so we leave
            it out. A missing surface means it was not reconstructed.
          </p>
          <p>
            That limits the scores too: collecting-system involvement is not
            assessed. The separate CT urogram uses different source imaging and
            shows only the contrast-supported lumen, with expert review pending.
            It does not fill the gaps in the KiTS cases.
          </p>
          <a className="atlas-link" href="#workspace/urogram?ct">Compare the separate CT urogram</a>
        </section>
        <section className="atlas-case-note" aria-labelledby="local-ai-workflow">
          <h2 id="local-ai-workflow">Our AI research model</h2>
          <div className="atlas-workflow-copy">
          <p>
            UroRef CalyxView AI brings several research components together to
            draft kidney and tumour outlines, with artery and vein candidates.
            Suitable delayed CT images may also support an outline of the
            contrast-filled collecting system. If the scan does not show enough
            contrast, we leave that structure unassessed. Each draft stays linked
            to the source images so a reviewer can check it.
          </p>
          <p>
            This is an early research tool. The vessels and collecting system
            remain unqualified, and the renal pelvis has no separate automatic
            label. Every mask and any alignment between phases needs review.
            The website does not process clinical CT
            uploads. The local pilot is separate from the benchmark below.
          </p>
          <a className="atlas-link" href="#about">Read the current limits</a>
          </div>
        </section>
        <nav className="atlas-evidence-nav" aria-label="Evidence sections">
          <a
            href="#evidence/scoring"
            aria-current={!segmentation ? 'page' : undefined}
          >
            Scoring & model methods
          </a>
          <a
            href="#evidence/segmentation"
            aria-current={segmentation ? 'page' : undefined}
          >
            Segmentation benchmark
          </a>
        </nav>
      </div>
      {segmentation ? <FeasibilityBenchmark /> : <PlanningPipeline />}
    </>
  );
}

function About() {
  return (
    <div className="atlas-shell">
      <PageIntro
        section="About the project"
        title="Renal planning research, in progress."
      >
        <p>
          CalyxView Renal brings CT-derived anatomy, nephrometry calculations
          and reproducible technical checks into one research prototype.
        </p>
      </PageIntro>
      <div className="atlas-about-layout">
        <aside className="atlas-byline">
          <h2>By Nity G</h2>
          <a href="mailto:nity@uroref.com">nity@uroref.com</a>
          <p>
            Developed by Nity G at UroRef. A research project shaped around the
            questions we ask when looking at a kidney scan.
          </p>
        </aside>
        <div className="atlas-prose">
          <section>
            <h2>Part of CalyxView</h2>
            <p>
              This is the renal tumour research section of CalyxView. The
              endourology lessons on the main site explore the scope and access
              route; here you can compare kidney and tumour outlines, work
              through scoring assumptions and build a model from a label map.
            </p>
            <a className="atlas-link" href={CALYXVIEW_HOME}>Return to the main CalyxView site</a>
          </section>
          <section>
            <h2>Why so plain?</h2>
            <p>
              I want the anatomy to be the thing you notice. The quiet colours,
              readable text and space around the images leave room to compare
              the scan with the model. Movement belongs in the viewer, where
              you can pause it and look again.
            </p>
          </section>
          <section>
            <h2>The next study</h2>
            <p>
              The proposal is to compare computed R.E.N.A.L. and PADUA scores
              with independent assessments by two clinicians in 30 to 50
              consecutive partial nephrectomy cases. Pre-operative scores
              already recorded would provide an additional comparison.
            </p>
            <p>
              It requires approved research access, coded pre-operative scans
              exported through the trust’s de-identification route, and
              consultant review of the outlines and models. The proposed review
              commitment is an hour a fortnight.
            </p>
            <p>
              Processing would use free research tools on trust hardware, with
              IT agreement for a GPU workstation. No licence or cloud spend is
              proposed. These are study requirements, not claims of approval or
              access already granted.
            </p>
            <a
              className="atlas-button atlas-button-outline"
              href="mailto:nity@uroref.com?subject=CalyxView%20renal%20research"
            >
              Discuss the proposed study
            </a>
          </section>
          <section>
            <h2>Current limits</h2>
            <p>
              The public examples demonstrate technical behaviour. No clinician
              has validated these models or computed scores for patient care.
              The browser viewer does not show the full scan, and an incomplete
              set of structures must not be interpreted as absent anatomy.
            </p>
            <p>
              Clinical use would require validated data handling, suitable scan
              protocols and phase registration, reviewed segmentations with
              visible uncertainty, clinical evidence and the appropriate
              quality, safety and regulatory processes.
            </p>
          </section>
          <section className="atlas-use-notice">
            <h2>Research use only</h2>
            <p>
              CalyxView Renal is not intended for diagnosis, treatment or
              surgical planning. It is not UKCA or CE marked and is not FDA
              cleared. Do not use it for patient care.
            </p>
          </section>
          <section>
            <h2>Where the examples come from</h2>
            <p>
              The case collection uses public KiTS23 imaging and expert
              annotations under CC BY-NC-SA 4.0. The methods pages explain the
              scoring assumptions, aggregate results and their limits. These
              expert outlines are separate from our AI drafts.
            </p>
            <a className="atlas-link" href="#evidence">
              Review the published evidence
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}

export function SitePages({
  open,
  hash,
}: {
  open: OpenWorkspace;
  hash: string;
}) {
  const page = pageFromHash(hash);
  return (
    <div className="site-page atlas-site">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="atlas-status">
        <div className="atlas-shell">
          Research prototype <span>Not for patient care</span>
        </div>
      </div>
      <Header key={hash} page={page} />
      <main id="main-content" tabIndex={-1}>
        {page === 'home' ? (
          <Home open={open} />
        ) : page === 'cases' ? (
          <Cases open={open} />
        ) : page === 'build' ? (
          <Build open={open} />
        ) : page === 'evidence' ? (
          <Evidence hash={hash} />
        ) : (
          <About />
        )}
      </main>
      <footer className="atlas-footer">
        <div className="atlas-shell">
          <div className="atlas-footer-top">
            <Brand />
            <a href={CALYXVIEW_HOME}>CalyxView home</a>
            <a href="mailto:nity@uroref.com">Contact Nity G</a>
            <a href="#evidence">
              Methods & evidence
            </a>
          </div>
          <div className="atlas-footer-bottom">
            <p>
              Public research data. Unvalidated models and scores. Not for
              diagnosis, treatment or surgical planning.
            </p>
            <span>Updated October 2026</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
