// The public repository and the branch the site's document links point at.
// They point at main, so merge a branch before sharing a deploy of it.
// Otherwise readers follow the links to main's older documents.

export const REPO_URL = 'https://github.com/nityjr-ctrl/calyxview-renal';
export const DOCS_REF = 'main';

/** A file in the repository, as GitHub shows it. */
export function repoFile(path: string): string {
  return `${REPO_URL}/blob/${DOCS_REF}/${path}`;
}

/** A folder in the repository, as GitHub shows it. */
export function repoFolder(path: string): string {
  return `${REPO_URL}/tree/${DOCS_REF}/${path}`;
}
