import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { IS_DEMO } from './lib/api';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queries';
import { IconSprite } from './components/Icon';
import { Toasts } from './components/ui';
import { ConfirmHost } from './components/ConfirmHost';
import { App } from './App';
import './lib/theme';
import './styles/prototype.css';
import './styles/app.css';

// The demo lives inside a hosted frame with no server routes, so it keeps the URL in memory.
const Router = IS_DEMO ? MemoryRouter : BrowserRouter;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <IconSprite />
        <App />
        <Toasts />
        <ConfirmHost />
        {IS_DEMO && <div className="demo-ribbon" role="note">Demo · your data stays in this browser</div>}
      </Router>
    </QueryClientProvider>
  </StrictMode>,
);
