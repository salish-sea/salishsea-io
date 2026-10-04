/** How an ingest shell reports progress: a message and structured detail. The read-path
 * build's ingests use it; the retired Deno `ingest` function did too. */
export type Logger = (msg: string, extra?: Record<string, unknown>) => void;
