import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { RenalSite } from '@/components/renal-site';
import '@/app/globals.css';
import '@/app/editorial.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Application root was not found.');
}

createRoot(root).render(
  <StrictMode>
    <RenalSite />
  </StrictMode>,
);
