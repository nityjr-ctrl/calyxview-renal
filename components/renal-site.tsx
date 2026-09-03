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
    title: 'Choose your route',
    body: 'Start with the built-in synthetic kidney. If you want, you can also try the local file-flow demonstration.',
    icon: <Target />,
  },
  {
    title: 'Confirm the safety boundary',
    body: 'If you select files, use only synthetic data or data de-identified under your organisation’s approved process.',
    icon: <ShieldCheck />,
  },
  {
    title: 'Run the local check',
    body: 'The prototype counts files, recognised extensions and total size. It does not read metadata or pixels.',
    icon: <ScanLine />,
  },
  {
    title: 'Explore the 3D anatomy',
    body: 'Rotate the model, change the view and reveal the tumour, vessels and collecting system.',
    icon: <Rotate3d />,
  },
  {
    title: 'Complete the guided review',
    body: 'Answer five short questions, read the explanations and check which information is simulated.',
    icon: <GraduationCap />,
  },
];

const outcomes = [
  {
    number: '01',
    title: 'See the anatomy',
    body: 'Turn the kidney in space and bring each structure into view without opening a patient study.',
    icon: <Eye />,
  },
  {
    number: '02',
    title: 'Explore an example',
    body: 'Compare illustrative approach, clamping and margin choices in a deliberately synthetic case.',
    icon: <Layers3 />,
  },
  {
    number: '03',
    title: 'Learn by doing',
    body: 'Work through five focused checks with immediate explanations and visible progress.',
    icon: <BookOpen />,
  },
];

const prototypeIncludes = [
  'A built-in synthetic kidney, tumour and branching anatomy',
  'Interactive rotation, view presets, layers, opacity and cutaway',
  'A local file inventory and simulated processing sequence',
  'Illustrative planning controls and a five-step lesson',
];

const clinicalNeeds = [
  'Secure medical-data handling and validated de-identification',
  'CT protocol checks, calibration and multi-phase registration',
  'Validated segmentation, uncertainty and expert correction',
  'Clinical evidence, quality management and regulatory authorisation',
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
          <p className="eyebrow">Interactive synthetic case</p>
          <h2>Bring the important relationships into view.</h2>
          <p>Try the model here, then open the full workspace when you are ready. No files are required.</p>
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
            <p className="eyebrow">What you can reveal</p>
            <h3>One model. Five relationships.</h3>
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
            <p className="demo-note">All structures and measurements are authored illustrations, not patient results.</p>
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
        RESEARCH &amp; EDUCATION PROTOTYPE — NOT FOR PATIENT CARE
      </div>
      <SiteHeader openDemo={openDemo} />

      <div id="main-content">
        <section className="hero-section" aria-labelledby="hero-title">
          {/* oxlint-disable-next-line next/no-img-element -- Vite serves this generated local hero asset directly. */}
          <img
            src="/calyxview-renal-hero.webp"
            alt="Illustrative 3D-printed kidney model with a small tumour and branching anatomy"
            width="1586"
            height="992"
            fetchPriority="high"
          />
          <div className="hero-shade" />
          <div className="site-shell hero-content">
            <p className="hero-eyebrow">Partial nephrectomy · research &amp; education</p>
            <h1 id="hero-title">From CT to a measured 3D kidney.</h1>
            <p className="hero-copy">
              A research prototype for partial nephrectomy: a 3D teaching case you can explore in the
              browser, and a tested pipeline that turns a CT outline into a 3D model with computed
              nephrometry and resection geometry.
            </p>
            <div className="hero-actions">
              <button type="button" className="button button-mint" onClick={() => openDemo()}>
                <Play /> Explore the 3D demo
              </button>
              <a className="button button-glass" href="#how-it-works">
                See how it works <ArrowDown />
              </a>
            </div>
            <p className="hero-footnote">The browser demo does not analyse patient scans. The pipeline runs on the workstation, on anonymised data only.</p>
          </div>
        </section>

        <section className="intro-section">
          <div className="site-shell intro-grid">
            <div>
              <p className="eyebrow">CalyxView Renal</p>
              <h2>Complex anatomy, made easier to see and discuss.</h2>
            </div>
            <div className="intro-copy">
              <p>
                CT data contains spatial information. This prototype shows two halves of turning it into a
                reviewed 3D planning experience: a browser demo built on authored anatomy, and a Python
                pipeline that has already produced measured 3D cases from real, expert-outlined kidneys.
              </p>
              <p>
                The browser demo never touches patient scans. The pipeline runs on the workstation, refuses
                identified data, and publishes only aggregate results here. Neither is a medical device.
              </p>
              <a className="text-link" href="#how-it-works">Follow the five steps <ArrowRight /></a>
            </div>
          </div>
        </section>

        <section className="outcomes-section" aria-labelledby="outcomes-title">
          <div className="site-shell">
            <div className="section-heading">
              <p className="eyebrow">What it helps you do</p>
              <h2 id="outcomes-title">See more. Understand more. Learn in context.</h2>
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
              <p className="eyebrow">Your route through the demo</p>
              <h2 id="steps-title">Five steps. One clear path.</h2>
              <p>Start with the synthetic case. The optional file flow is there only to demonstrate the future intake journey.</p>
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
              <p>No sign-in and no upload required.</p>
            </div>
          </div>
        </section>

        <EditorialPreview openDemo={openDemo} />

        <section id="learning" className="learning-section" aria-labelledby="learning-title">
          <div className="site-shell learning-grid">
            <div className="learning-copy">
              <p className="eyebrow">Guided learning</p>
              <h2 id="learning-title">Learn one relationship at a time.</h2>
              <p>
                Each lesson gives you one goal, one observation and one short knowledge check. The rationale appears immediately, so the model becomes a place to think—not just something to look at.
              </p>
              <button type="button" className="text-link" onClick={() => openDemo('learn')}>
                Open the guided lesson <ArrowRight />
              </button>
            </div>
            <div className="learning-ladder">
              <article>
                <span>01</span>
                <div><h3>Build orientation</h3><p>Orient the kidney and locate the tumour.</p></div>
              </article>
              <article>
                <span>02</span>
                <div><h3>Read the relationships</h3><p>Trace arterial supply and inspect the collecting system.</p></div>
              </article>
              <article>
                <span>03</span>
                <div><h3>Review the example</h3><p>Explore assumptions, then confirm that every output is synthetic.</p></div>
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
              <h2 id="safety-title">Know what is real—and what is not.</h2>
              <p>The distinction stays visible everywhere in the experience.</p>
            </div>
            <div className="safety-grid">
              <article className="safety-card safety-card-ready">
                <div className="safety-card-heading"><FileCheck /><span>Available in this prototype</span></div>
                <ul>
                  {prototypeIncludes.map((item) => <li key={item}><Check />{item}</li>)}
                </ul>
              </article>
              <article className="safety-card safety-card-future">
                <div className="safety-card-heading"><CircleAlert /><span>Required before clinical use</span></div>
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
                  The prototype does not anonymise or inspect DICOM content. It counts files, recognised extensions and total size locally, then opens the built-in synthetic model. No metadata or pixel data is read, uploaded, stored or segmented.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="closing-section">
          <div className="site-shell closing-inner">
            <div>
              <p className="eyebrow">Ready when you are</p>
              <h2>Explore the model in three dimensions.</h2>
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
