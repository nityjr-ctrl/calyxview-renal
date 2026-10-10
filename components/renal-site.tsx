'use client';

import {
  Activity,
  ArrowDown,
  ArrowRight,
  Check,
  CircleAlert,
  FileCheck,
} from 'lucide-react';
import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { AnatomyLayers } from '@/components/kidney-scene';
import { FeasibilityBenchmark } from '@/components/feasibility-benchmark';
import { PlanningPipeline } from '@/components/planning-pipeline';
import { repoFile } from '@/lib/links';
import { formatShare } from '@/lib/pipeline-results';
import { referenceCases } from '@/lib/reference-cases';
import { canonicalHash, parseWorkspaceHash, type WorkspaceRoute } from '@/lib/workspace-route';

const KidneyScene = lazy(() =>
  import('@/components/kidney-scene').then((module) => ({ default: module.KidneyScene })),
);

const RenalPlatform = lazy(() =>
  import('@/components/renal-platform').then((module) => ({ default: module.RenalPlatform })),
);

type EntryMode = 'plan' | 'build';
type OpenDemo = (mode?: EntryMode, caseId?: string, options?: { sample?: boolean; ct?: boolean }) => void;
/** What this site keeps in a viewer history entry. The viewer updates mode as you switch. */
type ViewerHistoryState = { calyxViewer?: boolean; mode?: string } | null;

// The viewer's mode lives in history.state, so Back, Forward and reload
// reopen the screen the reader left, not the one the viewer opened on. The
// builder also has its own address, #workspace/build, so it can be linked.
// Any other saved mode, such as the removed lesson mode, opens the viewer.
function savedMode(): EntryMode {
  if (readRoute().build) return 'build';
  const mode = (window.history.state as ViewerHistoryState)?.mode;
  return mode === 'build' ? 'build' : 'plan';
}

const OVERVIEW_TITLE = 'CalyxView Renal: partial nephrectomy planning research prototype';
const VIEWER_TITLE = 'CalyxView Renal: 3D viewer';
const PROPOSAL_URL = repoFile('docs/PARTIAL-NEPHRECTOMY-PLANNING-PROPOSAL.md');
const CONTACT_EMAIL = 'nity@uroref.com';
// Kidney C shows the most anatomy round the tumour.
const HERO_SCAN = '/ct/reference-c/key.webp';

const navLinks = [
  { href: '#build', label: 'Make a 3D kidney' },
  { href: '#kidneys', label: 'Real kidneys' },
  { href: '#hand-made', label: 'Hand-made kidney' },
  { href: '#planning', label: 'Pipeline' },
  { href: '#research', label: 'Benchmark' },
  { href: '#next', label: 'Next step' },
  { href: '#limits', label: 'Limits' },
];

const buildSteps = [
  {
    label: 'Outline the CT, outside the browser.',
    body: '3D Slicer to draw the tumour; TotalSegmentator can do the kidneys. Save a label map: 1 kidney, 2 tumour, 3 cyst.',
  },
  {
    label: 'Build the surfaces, here.',
    body: "A smoothed distance field on a 1 mm grid, coarser for very large volumes (the report says the grid used), then marching cubes, so thick slices don't show as steps. With both kidneys outlined, the one carrying the tumour is scored.",
  },
  {
    label: 'Score it, here.',
    body: 'Each R.E.N.A.L. and PADUA point with its rule beside it, plus the kidney kept outside a margin you set. The sinus is estimated from the outline, so N, L and the PADUA pole are approximate, and flagged.',
  },
];

const studyNeeds = [
  {
    label: 'Research access',
    body: "an honorary research contract or letter of access, by the trust's R&D route, with the Clinical Director's support.",
  },
  {
    label: 'Scan export',
    body: "coded pre-operative CTs (arterial, nephrographic and, where done, excretory), exported by the PACS team through the trust's de-identification route under the study approval; no PACS or identifiable-record access for me.",
  },
  {
    label: 'Cases',
    body: '30 to 50 consecutive partial nephrectomies, each scored for R.E.N.A.L. and PADUA by two clinicians independently, plus any pre-operative score on record.',
  },
  {
    label: 'Consultant time',
    body: 'an hour a fortnight from a consultant urologist or nominee, to check the outlines and 3D models against the scans.',
  },
  {
    label: 'Compute',
    body: "time on a trust GPU workstation, with IT's agreement to install the research model.",
  },
  { label: 'Spend', body: 'none; free tools on trust hardware, no licence or cloud costs.' },
];

const prototypeIncludes = [
  'The builder: a 3D kidney, R.E.N.A.L. and PADUA from your own outline, in the browser',
  'Five real KiTS23 kidneys: 3D models, computed R.E.N.A.L. and PADUA, and cropped CT slices with the expert outlines',
  'A hand-made kidney with vessels and a collecting system',
  'The offline pipeline and its results on 8 KiTS23 kidneys',
  'A benchmark of a published kidney and tumour segmentation model on 20 KiTS23 scans',
];

const clinicalNeeds = [
  'Validated de-identification, and secure handling of the data',
  'Checks on the scan protocol, with the contrast phases lined up with each other',
  'Validated outlines, with the uncertainty shown and a way for an expert to correct them',
  'Clinical evidence, a quality management system, clinical safety sign-off and regulatory approval',
];

const previewLayerConfig: Array<{ key: keyof AnatomyLayers; label: string; color: string }> = [
  { key: 'kidney', label: 'Kidney', color: '#75c9a7' },
  { key: 'tumour', label: 'Tumour', color: '#ef7d69' },
  { key: 'arteries', label: 'Arteries', color: '#f2aa56' },
  { key: 'veins', label: 'Veins', color: '#76bff0' },
  { key: 'collecting', label: 'Collecting system', color: '#9bded7' },
];

const knownCaseIds = new Set(['synthetic', ...referenceCases.map((item) => item.id)]);

// Kidneys whose polar lines were assumed because the sinus estimate was too small.
const polarLinesAssumed = referenceCases
  .filter((item) => item.nephrometry.polarLinesAssumed)
  .map((item) => item.label.replace(/^Kidney /, ''));

// "Kidney A", or "Kidneys A and D".
function kidneyLetters(letters: string[]): string {
  if (letters.length <= 1) return `Kidney ${letters.join('')}`;
  return `Kidneys ${letters.slice(0, -1).join(', ')} and ${letters[letters.length - 1]}`;
}

function readRoute(): WorkspaceRoute {
  return parseWorkspaceHash(window.location.hash, knownCaseIds);
}

function workspaceHash(caseId: string, mode?: EntryMode, ct = false) {
  return canonicalHash(caseId, mode === 'build', ct);
}

// An unknown or oddly cased kidney id opens the hand-made kidney, so put the
// matching address back in the bar. replaceState keeps history.state and fires
// no hashchange.
function canonicaliseWorkspaceHash() {
  const route = readRoute();
  const hash = workspaceHash(route.caseId, route.build ? 'build' : undefined, route.ct);
  if (route.view === 'workspace' && window.location.hash !== hash) {
    window.history.replaceState(window.history.state, '', hash);
  }
}

// A lazy chunk can fail to load, for example when the site is redeployed while
// the page is open. Show a way out instead of a blank page.
class LoadErrorBoundary extends Component<
  { children: ReactNode; className: string; what: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={this.props.className} role="alert">
        <p>
          The {this.props.what} didn&apos;t load. The site may have just been updated.{' '}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => window.location.reload()}
          >
            Reload the page
          </button>
        </p>
      </div>
    );
  }
}

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

function SiteHeader({ openDemo }: { openDemo: OpenDemo }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  return (
    <header className="site-header">
      <div className="site-shell site-header-inner">
        <Brand />
        <button
          ref={menuButtonRef}
          className="site-menu-button"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="site-navigation"
          onClick={() => setMenuOpen((current) => !current)}
        >
          {menuOpen ? 'Close' : 'Menu'}
        </button>
        <nav id="site-navigation" className={`site-nav ${menuOpen ? 'site-nav-open' : ''}`} aria-label="Main navigation">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)}>{link.label}</a>
          ))}
          <button type="button" className="site-nav-cta" data-return-focus="header" onClick={() => openDemo()}>
            Open the 3D viewer <ArrowRight />
          </button>
        </nav>
      </div>
    </header>
  );
}

function HeroSection({ openDemo }: { openDemo: OpenDemo }) {
  return (
    <section className="hero-section" aria-labelledby="hero-title">
      <div className="site-shell hero-inner">
        <div className="hero-content">
          <p className="hero-eyebrow">Partial nephrectomy research prototype</p>
          <h1 id="hero-title">Renal tumours in 3D, with the nephrometry scored from the outline.</h1>
          <p className="hero-copy">
            Load a kidney and tumour outline to get a 3D model with R.E.N.A.L. and PADUA scored by stated
            rules, or open five real KiTS23 CTs beside their 3D models.
          </p>
          <div className="hero-actions">
            <button type="button" className="button button-mint" data-return-focus="hero" onClick={() => openDemo('build')}>
              Make a 3D kidney <ArrowRight />
            </button>
            <a className="button button-glass" href="#kidneys">
              See the five real kidneys <ArrowDown />
            </a>
          </div>
          <p className="hero-footnote">
            <a href="#limits">Read the limits</a>.
          </p>
        </div>
        <figure className="hero-figure">
          <div className="hero-scan">
            {/* oxlint-disable-next-line next/no-img-element -- Vite serves this local CT still directly. */}
            <img
              src={HERO_SCAN}
              alt="Axial CT through Kidney C, a left kidney with a tumour on its posterolateral surface. The kidney is outlined in beige and the tumour in red."
              width="640"
              height="635"
              fetchPriority="high"
            />
            <span className="hero-scan-tag" aria-hidden="true">Kidney C</span>
          </div>
          <figcaption className="hero-caption">KiTS23 CT, de-identified, CC BY-NC-SA 4.0</figcaption>
        </figure>
      </div>
    </section>
  );
}

function BuildSection({ openDemo }: { openDemo: OpenDemo }) {
  return (
    <section id="build" className="demo-section build-section" aria-labelledby="build-title">
      <div className="site-shell">
        <div className="section-heading section-heading-light">
          <p className="eyebrow">Make a 3D kidney</p>
          <h2 id="build-title">Load an outline, get a 3D kidney and its scores.</h2>
          <p>
            Takes a kidney and tumour label map (.nii or .nii.gz). Returns the 3D model, R.E.N.A.L., PADUA
            and the kidney kept at your margin, by renalplan&apos;s rules. Runs in your browser; nothing is
            uploaded.
          </p>
        </div>

        <div className="build-overview">
          <ol className="steps-list" aria-label="The three steps">
            {buildSteps.map((step) => (
              <li key={step.label}>
                <strong>{step.label}</strong> {step.body}
              </li>
            ))}
          </ol>
          <div className="build-overview-actions">
            <div className="hero-actions">
              <button
                type="button"
                className="button button-mint"
                data-return-focus="build-sample"
                onClick={() => openDemo('build', 'synthetic', { sample: true })}
              >
                Try the sample <ArrowRight />
              </button>
              <button
                type="button"
                className="button button-glass"
                data-return-focus="build-load"
                onClick={() => openDemo('build')}
              >
                Load an outline
              </button>
            </div>
            <p>
              The sample is renalplan&apos;s synthetic test kidney, on which the builder and the pipeline
              give the same scores and volumes. On real outlines, raw E and N can differ slightly because the
              browser&apos;s hull is exact. For a real outline, the{' '}
              <a href="https://github.com/neheller/kits23" target="_blank" rel="noreferrer">
                KiTS23 dataset
                <span className="sr-only"> (opens in a new tab)</span>
              </a>{' '}
              has expert label maps (CC BY-NC-SA 4.0).
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function KidneysSection({ openDemo }: { openDemo: OpenDemo }) {
  return (
    <section id="kidneys" className="kidneys-section" aria-labelledby="kidneys-title">
      <div className="site-shell">
        <div className="section-heading section-heading-light">
          <p className="eyebrow">Five real kidneys</p>
          <h2 id="kidneys-title">Five real CTs, each beside its 3D model.</h2>
          <p>
            De-identified KiTS23 CTs, scored by renalplan from the KiTS expert outlines. The sinus is
            estimated from the outline, so L and the PADUA pole are approximate
            {polarLinesAssumed.length > 0 ? `, more so for ${kidneyLetters(polarLinesAssumed)}` : ''}. Vessels and
            the collecting system weren&apos;t outlined, so the hilar and collecting-system items weren&apos;t assessed.
          </p>
        </div>

        <ul className="kidney-grid">
          {referenceCases.map((item) => {
            const { nephrometry } = item;
            return (
              <li key={item.id} className="kidney-card">
                <div className="kidney-scan">
                  {/* oxlint-disable-next-line next/no-img-element -- Vite serves these local CT stills directly. */}
                  <img
                    src={`/ct/${item.id}/key.webp`}
                    alt={`Axial CT through ${item.label} at the tumour's centre, kidney and tumour outlined`}
                    width="640"
                    height="640"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <h3>{item.label}</h3>
                <dl className="kidney-facts">
                  <div>
                    <dt>R.E.N.A.L.</dt>
                    <dd>{nephrometry.renalLabel}, {nephrometry.renalComplexity}</dd>
                  </div>
                  <div>
                    <dt>PADUA</dt>
                    <dd>{nephrometry.paduaTotal}, {nephrometry.paduaComplexity}</dd>
                  </div>
                  <div>
                    <dt>Tumour diameter</dt>
                    <dd>{nephrometry.diameterCm.toFixed(1)} cm</dd>
                  </div>
                  <div>
                    <dt>Exophytic</dt>
                    <dd>{formatShare(nephrometry.exophyticFraction)}</dd>
                  </div>
                </dl>
                <div className="kidney-actions">
                  <button
                    type="button"
                    className="button button-mint kidney-open"
                    data-return-focus={`kidney-${item.id}`}
                    onClick={() => openDemo('plan', item.id)}
                  >
                    Open {item.label} in 3D
                  </button>
                  <button
                    type="button"
                    className="button button-glass kidney-open"
                    data-return-focus={`kidney-ct-${item.id}`}
                    onClick={() => openDemo('plan', item.id, { ct: true })}
                  >
                    See the CT
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="kidneys-caption">KiTS23 CT, kidney and tumour outlined</p>
      </div>
    </section>
  );
}

function HandMadeSection() {
  const [layers, setLayers] = useState<AnatomyLayers>({
    kidney: true,
    tumour: true,
    arteries: true,
    veins: true,
    collecting: true,
  });
  // The preview turns by itself until someone touches it or presses the button.
  // WCAG 2.2.2 asks for a way to stop moving content, so the button is always there.
  const [turning, setTurning] = useState(true);
  const [reduceMotion] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  // The preview only loads three.js once it's close to the screen.
  const canvasRef = useRef<HTMLDivElement>(null);
  const [sceneWanted, setSceneWanted] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const node = canvasRef.current;
    if (sceneWanted || !node) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSceneWanted(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [sceneWanted]);

  const loading = <div className="demo-loading">Loading the 3D model…</div>;

  return (
    <section id="hand-made" className="demo-section" aria-labelledby="hand-made-title">
      <div className="site-shell">
        <div className="section-heading section-heading-light">
          <p className="eyebrow">Hand-made kidney</p>
          <h2 id="hand-made-title">A right kidney with an interpolar tumour, made in code.</h2>
          <p>
            Arteries, veins and collecting system drawn by hand, so there is no patient in it. The only
            model here with vessels.
          </p>
        </div>

        <div className="demo-stage">
          <div ref={canvasRef} className="demo-canvas">
            {sceneWanted ? (
              <LoadErrorBoundary className="demo-loading" what="3D model">
                <Suspense fallback={loading}>
                  <KidneyScene
                    layers={layers}
                    kidneyOpacity={72}
                    marginMm={5}
                    clipPercent={0}
                    preset="anterior"
                    allowPageScroll
                    autoTurn={turning}
                    onStopTurning={() => setTurning(false)}
                  />
                </Suspense>
              </LoadErrorBoundary>
            ) : (
              loading
            )}
            <div className="demo-badges">
              <span>Hand-made</span>
            </div>
          </div>

          <aside className="demo-control-panel" aria-labelledby="hand-made-layers-title">
            <h3 id="hand-made-layers-title">Layers</h3>
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
            {reduceMotion ? null : (
              <button type="button" className="text-link" onClick={() => setTurning((value) => !value)}>
                {turning ? 'Stop it turning' : 'Let it turn'}
              </button>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}

function NextStepSection() {
  return (
    <section id="next" className="next-section" aria-labelledby="next-title">
      <div className="site-shell next-grid">
        <div className="section-heading section-heading-light next-intro">
          <p className="eyebrow">Next step</p>
          <h2 id="next-title">The study I want to run.</h2>
          <p>
            None of these scores has been compared with clinicians&apos; yet, so on our own partial
            nephrectomies the first question is whether computed R.E.N.A.L. and PADUA agree with
            clinician scoring as well as two clinicians agree with each other. The second is how well the
            research model outlines kidney and tumour on our own scanners.
          </p>
        </div>
        <div className="next-needs">
          <h3 id="next-needs-title">What it needs</h3>
          <ol aria-labelledby="next-needs-title">
            {studyNeeds.map((need) => (
              <li key={need.label}>
                <strong>{need.label}:</strong> {need.body}
              </li>
            ))}
          </ol>
          <a className="text-link" href={PROPOSAL_URL} target="_blank" rel="noreferrer">
            Read the full proposal <ArrowRight />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </div>
    </section>
  );
}

function LimitsSection() {
  return (
    <section id="limits" className="safety-section" aria-labelledby="limits-title">
      <div className="site-shell">
        <div id="safety" className="section-heading section-heading-light">
          <p className="eyebrow">Limits</p>
          <h2 id="limits-title">What&apos;s here now, and what clinical use would need.</h2>
          <p>None of it is validated.</p>
        </div>
        <div className="safety-grid">
          <article className="safety-card safety-card-ready" aria-labelledby="limits-now-title">
            <h3 id="limits-now-title" className="safety-card-heading"><FileCheck />What&apos;s here now</h3>
            <ul>
              {prototypeIncludes.map((item) => <li key={item}><Check />{item}</li>)}
            </ul>
          </article>
          <article className="safety-card safety-card-future" aria-labelledby="limits-needs-title">
            <h3 id="limits-needs-title" className="safety-card-heading"><CircleAlert />What clinical use would need</h3>
            <ul>
              {clinicalNeeds.map((item) => <li key={item}><span className="future-dot" />{item}</li>)}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}

function Overview({ openDemo }: { openDemo: OpenDemo }) {
  return (
    <div className="site-page" id="top">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="prototype-strip" role="note">
        Research and teaching prototype. Not for patient care.
      </div>
      <SiteHeader openDemo={openDemo} />

      <main id="main-content" tabIndex={-1}>
        <HeroSection openDemo={openDemo} />
        <BuildSection openDemo={openDemo} />
        <KidneysSection openDemo={openDemo} />
        <HandMadeSection />

        <PlanningPipeline />

        <FeasibilityBenchmark />

        <NextStepSection />
        <LimitsSection />

        <section className="closing-section" aria-labelledby="closing-title">
          <div className="site-shell closing-inner">
            <div>
              <h2 id="closing-title">Contact</h2>
              <p className="closing-copy">
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-shell footer-top">
          <Brand />
          <nav className="footer-links" aria-label="Footer navigation">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href}>{link.label}</a>
            ))}
          </nav>
        </div>
        <div className="site-shell footer-disclaimer">
          <p>
            CalyxView Renal is for research and teaching only. It isn&apos;t intended for the care of
            any patient, so it isn&apos;t a medical device. It isn&apos;t UKCA or CE marked, and it
            isn&apos;t FDA cleared. Don&apos;t use it for diagnosis, treatment or surgical planning.
          </p>
          <p className="footer-byline">
            By Nity G, <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Python library and
            coding by Nity G. Content organisation and presentation done with help of AI.
          </p>
          <p className="footer-byline">
            CalyxView Renal is a trading name of UroRef Ltd, a company registered in England and Wales
            (company number 17504491). Registered office: 71-75 Shelton Street, Covent Garden, London WC2H 9JQ, United Kingdom.
          </p>
          <div className="footer-meta">
            <span>Last updated September 2026</span>
            <span>© 2026 UroRef Ltd</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function RenalSite() {
  const [view, setView] = useState<'overview' | 'workspace'>(() => readRoute().view);
  const [workspaceMode, setWorkspaceMode] = useState<EntryMode>(savedMode);
  const [workspaceCase, setWorkspaceCase] = useState(() => readRoute().caseId);
  // Set by "See the CT", or a #workspace/reference-x?ct address, so the viewer opens on the CT tab.
  const [workspaceCt, setWorkspaceCt] = useState(() => readRoute().ct);
  // Set when the address named a kidney that doesn't exist.
  const [workspaceNotFound, setWorkspaceNotFound] = useState(() => readRoute().notFound);
  // Set by "Try the sample", so the builder starts on it. Not kept in the address.
  const [startSample, setStartSample] = useState(false);
  // Where the reader was on the overview, so closing the viewer puts them back there.
  const returnTo = useRef<{ focusKey: string | null; scrollY: number } | null>(null);
  const previousView = useRef(view);

  useEffect(() => {
    canonicaliseWorkspaceHash();
    const syncWithLocation = () => {
      // Read before the address is tidied, which drops the unknown kidney id.
      const route = readRoute();
      canonicaliseWorkspaceHash();
      if (route.view === 'workspace') {
        setWorkspaceMode(savedMode());
        setWorkspaceCase(route.caseId);
        setWorkspaceCt(route.ct);
        // A fragment change fires popstate and then hashchange, and the second
        // reads the address already tidied to #workspace. So only a move to a
        // real kidney or the builder clears the not-found notice.
        setWorkspaceNotFound(
          (current) => route.notFound || (current && route.caseId === 'synthetic' && !route.build),
        );
      } else {
        setWorkspaceNotFound(false);
      }
      setView(route.view);
    };
    window.addEventListener('popstate', syncWithLocation);
    window.addEventListener('hashchange', syncWithLocation);
    return () => {
      window.removeEventListener('popstate', syncWithLocation);
      window.removeEventListener('hashchange', syncWithLocation);
    };
  }, []);

  useLayoutEffect(() => {
    const cameFromViewer = previousView.current === 'workspace';
    previousView.current = view;

    if (view === 'workspace') {
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    if (!cameFromViewer) return;

    const saved = returnTo.current;
    returnTo.current = null;
    window.scrollTo({ top: saved?.scrollY ?? 0, behavior: 'auto' });

    // Put focus back on the button that opened the viewer, or on the page content if it has gone.
    const opener = saved?.focusKey
      ? document.querySelector<HTMLElement>(`[data-return-focus="${saved.focusKey}"]`)
      : null;
    opener?.focus({ preventScroll: true });
    if (!opener || document.activeElement !== opener) {
      document.getElementById('main-content')?.focus({ preventScroll: true });
    }
  }, [view]);

  useEffect(() => {
    document.title = view === 'workspace' ? VIEWER_TITLE : OVERVIEW_TITLE;
  }, [view]);

  const openDemo: OpenDemo = (mode = 'plan', caseId = 'synthetic', options = {}) => {
    const active = document.activeElement;
    returnTo.current = {
      focusKey: active instanceof HTMLElement ? (active.dataset.returnFocus ?? null) : null,
      scrollY: window.scrollY,
    };
    setWorkspaceMode(mode);
    setWorkspaceCase(caseId);
    setWorkspaceCt(Boolean(options.ct));
    setWorkspaceNotFound(false);
    setStartSample(Boolean(options.sample));
    window.history.pushState({ calyxViewer: true, mode }, '', workspaceHash(caseId, mode, Boolean(options.ct)));
    setView('workspace');
  };

  const closeDemo = () => {
    const state = window.history.state as { calyxViewer?: boolean } | null;
    if (state?.calyxViewer) {
      // We added this history entry, so going back returns to the overview without a new one.
      window.history.back();
      return;
    }
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    setView('overview');
  };

  return view === 'workspace' ? (
    <LoadErrorBoundary className="route-loading" what="3D viewer">
      <Suspense fallback={<div className="route-loading">Loading the 3D viewer…</div>}>
        <RenalPlatform
          key={`${workspaceMode}${workspaceCase}${workspaceNotFound ? '-not-found' : ''}`}
          initialMode={workspaceMode}
          initialCaseId={workspaceCase}
          startWithSample={startSample}
          startOnCt={workspaceCt}
          kidneyNotFound={workspaceNotFound}
          onExit={closeDemo}
        />
      </Suspense>
    </LoadErrorBoundary>
  ) : (
    <Overview openDemo={openDemo} />
  );
}
