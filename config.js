/*
 * Vitalis Patient Search — deployment config.
 *
 * The app always tries the same-origin backend first (/api/health probe).
 * If the page is served from a static-only host (e.g. the Vercel mirror),
 * it falls back to this central clinic server, which holds the SQLite
 * registry and notes. No change is needed when running on the VM itself.
 */
/* Backend URL is optional - the app falls back to embedded patients.json when backend is unavailable */
window.VITALIS_API_BASE = "";
