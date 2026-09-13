'use client';

import {
  Activity,
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  CircleAlert,
  Eye,
  FileCheck,
  FileUp,
  GraduationCap,
  Layers3,
  LockKeyhole,
  MousePointer2,
  Play,
  Rotate3d,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';

import type { AnatomyLayers } from '@/components/kidney-scene';
import { FeasibilityBenchmark } from '@/components/feasibility-benchmark';
import { PlanningPipeline } from '@/components/planning-pipeline';
import { RenalPlatform } from '@/components/renal-platform';

const KidneyScene = lazy(() =>
  import('@/components/kidney-scene').then((module) => ({ default: module.KidneyScene })),
);

type EntryMode = 'plan' | 'import' | 'learn';

const routeSteps = [
  {
    title: 'Pick where to start',
    body: "The built-in synthetic kidney is the default. If you'd rather see the local file flow, that's there too.",
    icon: <Target />,
  },
  {
    title: 'Confirm the safety boundary',
    body: "If you do select files, use synthetic ones, or data de-identified under your organisation's approved process. Nothing else.",
    icon: <ShieldCheck />,
  },
  {
    title: 'Run the local count',
    body: "It counts files, recognised extensions and total size. It doesn't read metadata or pixels.",
    icon: <ScanLine />,
  },
  {
    title: 'Turn the model',
    body: "Drag to rotate it and change the view. The tumour, vessels and collecting system each show or hide on their own.",
    icon: <Rotate3d />,
  },
  {
    title: 'Finish with the lesson',
    body: "Five short questions, and a note on which information is simulated.",
    icon: <GraduationCap />,
  },
];

const outcomes = [
  {
    number: '01',
    title: 'Turn the kidney round',
    body: "Rotate it, and bring each structure into view on its own.",
    icon: <Eye />,
  },
  {
    number: '02',
    title: 'A worked example',
    body: "Compare approach, clamping and margin choices. The case is synthetic on purpose, so every number is an illustration.",
    icon: <Layers3 />,
  },
  {
    number: '03',
    title: 'Short checks with the reasoning',
    body: "Five of them, with the explanation straight after each answer, and you can see how far through you are.",
    icon: <BookOpen />,
  },
];

const prototypeIncludes = [
  "A built-in synthetic kidney, tumour and branching anatomy",
  "Rotation, view presets, layers, opacity and a cutaway",
  "A local file count, and a processing sequence that only pretends to run",
  "Planning controls that are illustrations only, plus the five-step lesson",
];

const clinicalNeeds = [
  "Handle medical data securely and validate the de-identification.",
  "Check CT protocols and calibration, and register the phases.",
  "Validate the segmentation, show where it is uncertain and let an expert correct it.",
  "Build the clinical evidence, put a quality management system in place, and obtain regulatory authorisation.",
];

const previewLayerConfig: Array<{ key: keyof AnatomyLayers; label: string; color: string }> = [
  { key: 'kidney', label: 'Kidney', color: '#75c9a7' },
  { key: 'tumour', label: 'Tumour', color: '#ef7d69' },
  { key: 'arteries', label: 'Arteries', color: '#f2aa56' },
  { key: 'veins', label: 'Veins', color: '#76bff0' },
  { key: 'collecting', label: 'Collecting system', color: '#9bded7' },
];

function Brand() {
  return (
    <a className="site-brand" href="#top" aria-label="CalyxView Renal home">
      <span className="site-brand-mark"><Activity /></span>
      <span>
        <strong>CalyxView</strong>
        <small>Renal</small>
      </span>
    </a>
  );
}

function SiteHeader({ openDemo }: { openDemo: (mode?: EntryMode) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="site-shell site-header-inner">
        <Brand />
        <button
          className="site-menu-button"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="site-navigation"
          onClick={() => setMenuOpen((current) => !current)}
        >
          Menu
        </button>
        <nav id="site-navigation" className={`site-nav ${menuOpen ? 'site-nav-open' : ''}`} aria-label="Main navigation">
          <a href="#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a>
          <a href="#demo" onClick={() => setMenuOpen(false)}>3D demo</a>
          <a href="#learning" onClick={() => setMenuOpen(false)}>Learning</a>
          <a href="#planning" onClick={() => setMenuOpen(false)}>Pipeline</a>
          <a href="#research" onClick={() => setMenuOpen(false)}>Research</a>
          <a href="#safety" onClick={() => setMenuOpen(false)}>Safety</a>
          <button type="button" className="site-nav-cta" onClick={() => openDemo()}>
            Open the demo <ArrowRight />
          </button>
        </nav>
      </div>
    </header>
  );
}

function EditorialPreview({ openDemo }: { openDemo: (mode?: EntryMode) => void }) {
  const [layers, setLayers] = useState<AnatomyLayers>({
    kidney: true,
    tumour: true,
    arteries: true,
    veins: true,
    collecting: true,
  });

  return (
    <section id="demo" className="demo-section">
      <div className="site-shell">
        <div className="section-heading section-heading-light">
          <p className="eyebrow">Synthetic case, running in this page</p>
          <h2>Show the tumour against the vessels and collecting system.</h2>
          <p>
            Turn the model here, or open the full workspace, where the five real KiTS23 kidneys are.
            Neither needs any files.
          </p>
        </div>

        <div className="demo-stage">
          <div className="demo-canvas" aria-label="Interactive synthetic kidney preview">
            <Suspense fallback={<div className="demo-loading">Preparing the 3D model…</div>}>
              <KidneyScene
                layers={layers}
                kidneyOpacity={72}
                marginMm={5}
                clipPercent={0}
                preset="anterior"
                trainingStep={-1}
              />
            </Suspense>
            <div className="demo-badges">
              <span><Sparkles /> Synthetic teaching model</span>
              <span><LockKeyhole /> No patient data</span>
            </div>
            <div className="demo-hint"><MousePointer2 /> Drag to rotate · scroll to zoom</div>
          </div>

          <aside className="demo-control-panel">
            <p className="eyebrow">Structures you can show and hide</p>
            <h3>Five layers on the one model.</h3>
            <div className="preview-layers">
              {previewLayerConfig.map((layer) => (
                <button
                  type="button"
                  key={layer.key}
                  aria-pressed={layers[layer.key]}
                  onClick={() => setLayers((current) => ({ ...current, [layer.key]: !current[layer.key] }))}
                >
                  <span className="layer-swatch" style={{ background: layer.color }} />
                  <span>{layer.label}</span>
                  <span className="layer-state">{layers[layer.key] ? 'Shown' : 'Hidden'}</span>
                </button>
              ))}
            </div>
            <button type="button" className="button button-mint button-full" onClick={() => openDemo()}>
              Open the full 3D demo <ArrowRight />
            </button>
            <button type="button" className="demo-secondary" onClick={() => openDemo('import')}>
              Try the local file flow <FileUp />
            </button>
            <p className="demo-note">
              Every structure and measurement here is an authored illustration. None of it is a patient
              result.
            </p>
          </aside>
        </div>
      </div>
    </section>
  );
}

function Overview({ openDemo }: { openDemo: (mode?: EntryMode) => void }) {
  return (
    <main className="site-page" id="top">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="prototype-strip" role="note">
        RESEARCH &amp; EDUCATION PROTOTYPE. NOT FOR PATIENT CARE
      </div>
      <SiteHeader openDemo={openDemo} />

      <div id="main-content">
        <section className="hero-section" aria-labelledby="hero-title">
          <div className="site-shell hero-inner">
            <div className="hero-content">
            <p className="hero-eyebrow">Partial nephrectomy, research and education</p>
            <h1 id="hero-title">A CT outline becomes a measured 3D kidney.</h1>
            <p className="hero-copy">
              CalyxView Renal is a research prototype for partial nephrectomy. One part is a 3D
              teaching case you can open and turn in the browser. The other is a Python pipeline that
              takes a CT with the kidney, tumour and cyst outlined and computes the nephrometry and
              resection geometry from the model it builds.
            </p>
            <div className="hero-actions">
              <button type="button" className="button button-mint" onClick={() => openDemo()}>
                <Play /> Explore the 3D demo
              </button>
              <a className="button button-glass" href="#how-it-works">
                See how it works <ArrowDown />
              </a>
            </div>
              <p className="hero-footnote">
                The browser demo doesn&apos;t touch patient scans. The pipeline runs on the workstation, on
                anonymised data only.
              </p>
            </div>
            <figure className="hero-figure">
              {/* oxlint-disable-next-line next/no-img-element -- Vite serves this generated local hero asset directly. */}
              <img
                src="/calyxview-renal-hero.webp"
                alt="Illustrative 3D-printed kidney model with a small tumour and branching anatomy"
                width="1586"
                height="992"
                fetchPriority="high"
              />
            </figure>
          </div>
        </section>

        <section className="intro-section">
          <div className="site-shell intro-grid">
            <div>
              <p className="eyebrow">Demo in the browser, pipeline on the workstation</p>
              <h2>The anatomy is easier to discuss when you can turn it around.</h2>
            </div>
            <div className="intro-copy">
              <p>
                The browser demo carries two kinds of case. One is a synthetic kidney I authored, so
                there&apos;s no patient data in it at all. The other five are real kidneys from the open
                KiTS23 set, meshed by the pipeline, with the nephrometry worked out from the geometry
                rather than typed in.
              </p>
              <p>
                The pipeline stays on the workstation and refuses identified data. What reaches this
                site is the meshes and the numbers computed from them, never the scans. Neither half is
                validated, and neither is a medical device.
              </p>
              <a className="text-link" href="#how-it-works">See the five steps <ArrowRight /></a>
            </div>
          </div>
        </section>

        <section className="outcomes-section" aria-labelledby="outcomes-title">
          <div className="site-shell">
            <div className="section-heading">
              <p className="eyebrow">What you can do in the browser demo</p>
              <h2 id="outcomes-title">The demo opens on a synthetic kidney and carries five real ones.</h2>
            </div>
            <div className="outcome-grid">
              {outcomes.map((outcome) => (
                <article key={outcome.number} className="outcome-card">
                  <div className="outcome-card-top">
                    <span>{outcome.number}</span>
                    {outcome.icon}
                  </div>
                  <h3>{outcome.title}</h3>
                  <p>{outcome.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="steps-section" aria-labelledby="steps-title">
          <div className="site-shell">
            <div className="steps-intro">
              <p className="eyebrow">The route I&apos;d take through the demo</p>
              <h2 id="steps-title">Five steps, ending with the guided lesson.</h2>
              <p>
                Start with the synthetic case. The optional file flow is only there to show how intake
                would work later, so skip it if you&apos;d rather go straight to the model.
              </p>
            </div>
            <ol className="steps-list">
              {routeSteps.map((step, index) => (
                <li key={step.title}>
                  <span className="step-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="step-icon">{step.icon}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="steps-action">
              <button type="button" className="button button-ink" onClick={() => openDemo()}>
                Start with the synthetic case <ArrowRight />
              </button>
              <p>No sign-in, nothing to upload.</p>
            </div>
          </div>
        </section>

        <EditorialPreview openDemo={openDemo} />

        <section id="learning" className="learning-section" aria-labelledby="learning-title">
          <div className="site-shell learning-grid">
            <div className="learning-copy">
              <p className="eyebrow">How the lesson works</p>
              <h2 id="learning-title">Learn one relationship at a time.</h2>
              <p>
                Each step sets one goal and asks one question about it. The reasoning comes with the
                answer.
              </p>
              <button type="button" className="text-link" onClick={() => openDemo('learn')}>
                Open the guided lesson <ArrowRight />
              </button>
            </div>
            <div className="learning-ladder">
              <article>
                <span>01</span>
                <div><h3>Orientation first</h3><p>Orient the kidney and find the tumour.</p></div>
              </article>
              <article>
                <span>02</span>
                <div>
                  <h3>Arteries and collecting system</h3>
                  <p>Follow the arterial supply in, then look at the collecting system.</p>
                </div>
              </article>
              <article>
                <span>03</span>
                <div>
                  <h3>Check what&apos;s simulated</h3>
                  <p>
                    Read the assumptions behind the example, then confirm that every output is
                    synthetic.
                  </p>
                </div>
              </article>
            </div>
          </div>
        </section>

        <PlanningPipeline />

        <FeasibilityBenchmark />

        <section id="safety" className="safety-section" aria-labelledby="safety-title">
          <div className="site-shell">
            <div className="section-heading">
              <p className="eyebrow">The safety boundary</p>
              <h2 id="safety-title">What the prototype does, and what clinical use would need.</h2>
              <p>The demo carries the same labels on the model and in the lesson.</p>
            </div>
            <div className="safety-grid">
              <article className="safety-card safety-card-ready">
                <div className="safety-card-heading"><FileCheck /><span>In the prototype now</span></div>
                <ul>
                  {prototypeIncludes.map((item) => <li key={item}><Check />{item}</li>)}
                </ul>
              </article>
              <article className="safety-card safety-card-future">
                <div className="safety-card-heading"><CircleAlert /><span>Required before any clinical use</span></div>
                <ul>
                  {clinicalNeeds.map((item) => <li key={item}><span className="future-dot" />{item}</li>)}
                </ul>
              </article>
            </div>
            <div className="file-flow-note">
              <FileUp />
              <div>
                <h3>About the optional file flow</h3>
                <p>
                  It doesn&apos;t anonymise anything and it doesn&apos;t look inside the DICOM. It counts the
                  files on your own machine, then opens the built-in synthetic model. No metadata or
                  pixel data is read, uploaded, stored or segmented.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="closing-section">
          <div className="site-shell closing-inner">
            <div>
              <p className="eyebrow">Synthetic and real cases, no sign-in</p>
              <h2>Have a look, and tell me what&apos;s wrong with it.</h2>
            </div>
            <button type="button" className="button button-mint" onClick={() => openDemo()}>
              Open the 3D demo <ArrowRight />
            </button>
          </div>
        </section>
      </div>

      <footer className="site-footer">
        <div className="site-shell footer-top">
          <Brand />
          <div className="footer-links">
            <a href="#how-it-works">How it works</a>
            <a href="#demo">3D demo</a>
            <a href="#learning">Learning</a>
            <a href="#planning">Pipeline</a>
            <a href="#research">Research</a>
            <a href="#safety">Safety</a>
          </div>
        </div>
        <div className="site-shell footer-disclaimer">
          <p>
            CalyxView Renal is an unvalidated research and education prototype. It is not a medical device, has not been cleared or approved by the FDA, and is not UKCA/CE marked as a medical device. Do not use it for diagnosis, treatment, patient management, surgical planning, consent or intraoperative guidance.
          </p>
          <span>© {new Date().getFullYear()} CalyxView Renal</span>
        </div>
      </footer>
    </main>
  );
}

export function RenalSite() {
  const [view, setView] = useState<'overview' | 'workspace'>(() =>
    window.location.hash === '#workspace' ? 'workspace' : 'overview',
  );
  const [workspaceMode, setWorkspaceMode] = useState<EntryMode>('plan');

  useEffect(() => {
    const onHashChange = () => setView(window.location.hash === '#workspace' ? 'workspace' : 'overview');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const openDemo = (mode: EntryMode = 'plan') => {
    setWorkspaceMode(mode);
    window.location.hash = 'workspace';
    setView('workspace');
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const closeDemo = () => {
    window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`);
    setView('overview');
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  return view === 'workspace' ? (
    <RenalPlatform key={workspaceMode} initialMode={workspaceMode} onExit={closeDemo} />
  ) : (
    <Overview openDemo={openDemo} />
  );
}
