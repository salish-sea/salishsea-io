/** How an ingest shell reports progress: a message and structured detail. Shared by the
 * Deno function (supabase/functions/ingest) and the read-path build's ingests. */
export type Logger = (msg: string, extra?: Record<string, unknown>) => void;
