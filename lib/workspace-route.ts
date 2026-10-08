// The viewer's addresses, parsed without touching the window so the tests can
// check them. #workspace opens the hand-made kidney, #workspace/reference-c a
// KiTS23 kidney, #workspace/reference-c?ct its CT tab and #workspace/build the
// builder. A ct key with any value (?ct=junk) still means the CT tab; any
// other query, such as an old #workspace?learn link, is ignored. The site then
// rewrites the address to its plain form (canonicalHash).

export const HAND_MADE_ID = 'synthetic';
export const BUILD_ROUTE = 'build';

const WORKSPACE_HASH = /^#workspace(?:\/([a-z0-9-]+))?(?:\?([^#]*))?$/i;

export type WorkspaceRoute = {
  view: 'overview' | 'workspace';
  caseId: string;
  build: boolean;
  ct: boolean;
  /** The address named a kidney that doesn't exist; the hand-made kidney opens instead. */
  notFound: boolean;
};

export function parseWorkspaceHash(hash: string, knownCaseIds: ReadonlySet<string>): WorkspaceRoute {
  const match = WORKSPACE_HASH.exec(hash);
  if (!match) return { view: 'overview', caseId: HAND_MADE_ID, build: false, ct: false, notFound: false };
  const requested = match[1]?.toLowerCase();
  if (requested === BUILD_ROUTE) {
    return { view: 'workspace', caseId: HAND_MADE_ID, build: true, ct: false, notFound: false };
  }
  const known = Boolean(requested && knownCaseIds.has(requested));
  const caseId = known && requested ? requested : HAND_MADE_ID;
  const wantsCt = (match[2] ?? '').split('&').some((part) => part.split('=')[0].toLowerCase() === 'ct');
  return {
    view: 'workspace',
    caseId,
    build: false,
    ct: wantsCt && caseId !== HAND_MADE_ID,
    notFound: Boolean(requested) && !known,
  };
}

/** The plain address for a viewer state. */
export function canonicalHash(caseId: string, build = false, ct = false): string {
  if (build) return `#workspace/${BUILD_ROUTE}`;
  if (caseId === HAND_MADE_ID) return '#workspace';
  return ct ? `#workspace/${caseId}?ct` : `#workspace/${caseId}`;
}
