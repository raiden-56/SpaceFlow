// Demo mode: builds without a backend (e.g. GitHub Pages) run the SpaceFlow API inside the browser
// against generated sample data. The backend code is only downloaded when demo mode is on.

/** True when the build was made with VITE_DEMO_MODE=true. */
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

/** fetch() for API calls: the network normally, the in-browser demo backend in demo builds. */
export const apiFetch: typeof fetch = DEMO_MODE
  ? async (input, init) => (await import('./server')).demoFetch(input, init)
  : (input, init) => fetch(input, init);
