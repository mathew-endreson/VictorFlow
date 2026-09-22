import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import '@fontsource-variable/jost/wght.css';
import '@fontsource-variable/cairo/wght.css';
import { App } from './App';
import { BackendGate } from './components/BackendGate';
import { ToastProvider } from './components/ui';
import { I18nProvider } from './i18n';
import { ApiError } from './lib/api';
import { AuthProvider } from './lib/auth';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      // Don't hammer the server with retries for errors that retrying can't fix (4xx).
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        {/* HashRouter: works unchanged inside Tauri's custom-protocol webview, where deep links have no server to answer them. */}
        <HashRouter>
          <ToastProvider>
            <BackendGate>
              <AuthProvider>
                <App />
              </AuthProvider>
            </BackendGate>
          </ToastProvider>
        </HashRouter>
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
);
