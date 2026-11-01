/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** 'true' runs the API in the browser on sample data (no backend). */
  readonly VITE_DEMO_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
