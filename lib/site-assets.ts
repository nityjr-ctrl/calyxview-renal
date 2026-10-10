export function siteAsset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}

export const CALYXVIEW_HOME = import.meta.env.BASE_URL === '/renal/' ? '/' : 'https://calyxview.com/';
