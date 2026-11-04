// The variables the frontend reads from the repository's .env (vite.config.ts, envDir). Only
// these exist on import.meta.env: a misspelt or removed one is a type error.
interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  /** Origin of the backend's /api; empty when the API is on the same origin (behind Caddy). */
  readonly VITE_API_BASE_URL?: string;
}
