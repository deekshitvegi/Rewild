// Test page (git-excluded): the expedition alone, started anywhere. ?start=<body id>&landed=1&q=0|1|2
import { createRoot } from 'react-dom/client';
import ExpeditionExperience from '../components/expedition/ExpeditionExperience';

import * as story from '../components/expedition/story';
import * as motion from '../components/expedition/motion';
(window as unknown as { __lab: unknown }).__lab = { story, motion };
const params = new URLSearchParams(window.location.search);
createRoot(document.getElementById('root')!).render(
  <ExpeditionExperience
    onExit={() => {}}
    start={{ body: params.get('start') ?? undefined, landed: params.has('landed') ? params.get('landed') === '1' : false }}
    quality={params.get('q') ? (Number(params.get('q')) as 0 | 1 | 2) : undefined}
  />,
);
