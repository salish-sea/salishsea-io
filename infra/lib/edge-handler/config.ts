// Build-time configuration. infra-stack.ts overwrites the compiled config.js
// with real values at synth, after tsc has run — these placeholder exports only
// serve type-checking and unit tests. Neither value is a secret: the anon key
// ships in every browser bundle by design. Empty values make the handler fail
// open (bots get the page shell instead of OG meta).
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
