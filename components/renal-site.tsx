'use client';

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
import { SitePages, pageFromHash, type OpenWorkspace } from './site-pages';
import { referenceCases } from '@/lib/reference-cases';
import { canonicalHash, parseWorkspaceHash } from '@/lib/workspace-route';

const RenalPlatform = lazy(() =>
  import('./renal-platform').then((module) => ({
    default: module.RenalPlatform,
  })),
);
const knownCaseIds = new Set([
  'synthetic',
  ...referenceCases.map((item) => item.id),
]);
type EntryMode = 'plan' | 'build';
type ViewerHistoryState = { calyxViewer?: boolean; mode?: string } | null;

function readRoute() {
  return parseWorkspaceHash(window.location.hash, knownCaseIds);
}
function savedMode(): EntryMode {
  if (readRoute().build) return 'build';
  return (window.history.state as ViewerHistoryState)?.mode === 'build'
    ? 'build'
    : 'plan';
}
function canonicaliseWorkspaceHash() {
  const route = readRoute();
  const hash = canonicalHash(route.caseId, route.build, route.ct);
  if (route.view === 'workspace' && window.location.hash !== hash)
    window.history.replaceState(window.history.state, '', hash);
}

class LoadErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="route-loading" role="alert">
        <p>
          The 3D viewer could not load. The site may have been updated.{' '}
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

export function RenalSite() {
  const [view, setView] = useState<'overview' | 'workspace'>(
    () => readRoute().view,
  );
  const [pageHash, setPageHash] = useState(() => window.location.hash);
  const [workspaceMode, setWorkspaceMode] = useState<EntryMode>(savedMode);
  const [workspaceCase, setWorkspaceCase] = useState(() => readRoute().caseId);
  const [workspaceCt, setWorkspaceCt] = useState(() => readRoute().ct);
  const [workspaceNotFound, setWorkspaceNotFound] = useState(
    () => readRoute().notFound,
  );
  const [startSample, setStartSample] = useState(false);
  const returnTo = useRef<{ focusKey: string | null; scrollY: number } | null>(
    null,
  );
  const previousView = useRef(view);
  const previousPage = useRef(pageHash);

  useEffect(() => {
    canonicaliseWorkspaceHash();
    const syncWithLocation = () => {
      const route = readRoute();
      canonicaliseWorkspaceHash();
      if (route.view === 'workspace') {
        setWorkspaceMode(savedMode());
        setWorkspaceCase(route.caseId);
        setWorkspaceCt(route.ct);
        setWorkspaceNotFound(
          (current) =>
            route.notFound ||
            (current && route.caseId === 'synthetic' && !route.build),
        );
      } else {
        setWorkspaceNotFound(false);
        setPageHash(window.location.hash);
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
    const changedPage = previousPage.current !== pageHash;
    previousView.current = view;
    previousPage.current = pageHash;
    if (view === 'workspace') {
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    if (cameFromViewer) {
      const saved = returnTo.current;
      returnTo.current = null;
      window.scrollTo({ top: saved?.scrollY ?? 0, behavior: 'auto' });
      const opener = saved?.focusKey
        ? document.querySelector<HTMLElement>(
            `[data-return-focus="${saved.focusKey}"]`,
          )
        : null;
      opener?.focus({ preventScroll: true });
      if (!opener || document.activeElement !== opener)
        document.getElementById('main-content')?.focus({ preventScroll: true });
    } else if (changedPage) {
      window.scrollTo({ top: 0, behavior: 'auto' });
      document.getElementById('main-content')?.focus({ preventScroll: true });
    }
  }, [view, pageHash]);

  useEffect(() => {
    const page = pageFromHash(pageHash);
    const titles: Record<string, string> = {
      home: 'CT, 3D anatomy and renal tumour scoring',
      cases: 'Cases',
      build: 'Build a model',
      evidence: 'Methods & evidence',
      about: 'About the research',
    };
    document.title = `CalyxView Renal | ${view === 'workspace' ? '3D viewer' : titles[page]}`;
  }, [view, pageHash]);

  const openDemo: OpenWorkspace = (
    mode = 'plan',
    caseId = 'synthetic',
    options = {},
  ) => {
    const active = document.activeElement;
    returnTo.current = {
      focusKey:
        active instanceof HTMLElement
          ? (active.dataset.returnFocus ?? null)
          : null,
      scrollY: window.scrollY,
    };
    setWorkspaceMode(mode);
    setWorkspaceCase(caseId);
    setWorkspaceCt(Boolean(options.ct));
    setWorkspaceNotFound(false);
    setStartSample(Boolean(options.sample));
    window.history.pushState(
      { calyxViewer: true, mode },
      '',
      canonicalHash(caseId, mode === 'build', Boolean(options.ct)),
    );
    setView('workspace');
  };

  const closeDemo = () => {
    if ((window.history.state as ViewerHistoryState)?.calyxViewer) {
      window.history.back();
      return;
    }
    window.history.replaceState(null, '', '#cases');
    setPageHash('#cases');
    setView('overview');
  };

  return view === 'workspace' ? (
    <LoadErrorBoundary>
      <Suspense
        fallback={<div className="route-loading">Loading the 3D viewer…</div>}
      >
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
    <SitePages open={openDemo} hash={pageHash} />
  );
}
