// Implements CONTEXT decisions D-04 (HEAD-on-open metadata fetch), D-10 (Last-Modified source),
// D-11 (relative-time formatting with 7-day absolute fallback), D-12 (failure discrimination).
import { Temporal } from "temporal-polyfill";

// Discriminated union: ok:true carries size/timestamp metadata; ok:false signals failure.
export type DownloadInfo =
  | { ok: true; zipBytes: number | null; parquetBytes: number | null; lastModified: string | null }
  | { ok: false };

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const SIZE_FMT = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

const DEFAULT_BASE = '/dwca/salishsea-occurrences-v1';

/**
 * Format a byte count as a human-readable string.
 * Uses binary thresholds (1 KB = 1024 B) with decimal display.
 * Examples: formatBytes(0) → '0 B'; formatBytes(1024) → '1 KB'; formatBytes(1536) → '1.5 KB'
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${SIZE_FMT.format(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${SIZE_FMT.format(bytes / (1024 * 1024))} MB`;
  return `${SIZE_FMT.format(bytes / (1024 * 1024 * 1024))} GB`;
}

/**
 * Format a Last-Modified HTTP header value as a relative time string,
 * or as an absolute UTC date once the gap exceeds the threshold.
 *
 * Returns '' (empty string) when the header cannot be parsed — Lit interpolates
 * the empty string as no visible content (T-08-02 mitigation).
 *
 * @param lastModifiedHeader - RFC 7231 IMF-fixdate string from the Last-Modified header
 * @param now - injected Temporal.Instant for deterministic tests (defaults to current time)
 * @param absoluteAfterDays - gap threshold in days after which absolute date is shown (default 7)
 */
export function formatRelativeTime(
  lastModifiedHeader: string,
  now: Temporal.Instant = Temporal.Now.instant(),
  absoluteAfterDays = 7,
): string {
  const lmMs = Date.parse(lastModifiedHeader);
  if (Number.isNaN(lmMs)) return '';

  const lm = Temporal.Instant.fromEpochMilliseconds(lmMs);
  const diff = lm.since(now); // negative duration since lm is in the past
  const hoursAgo = -diff.total('hours');

  if (hoursAgo >= 24 * absoluteAfterDays) {
    return `updated ${lm.toZonedDateTimeISO('UTC').toPlainDate().toString()}`;
  }
  if (hoursAgo >= 24) {
    return `updated ${RTF.format(-Math.round(hoursAgo / 24), 'day')}`;
  }
  if (hoursAgo >= 1) {
    return `updated ${RTF.format(-Math.round(hoursAgo), 'hour')}`;
  }
  const minutesAgo = -diff.total('minutes');
  return `updated ${RTF.format(-Math.round(Math.max(minutesAgo, 1)), 'minute')}`;
}

/**
 * Fire two parallel HEAD requests (.zip + .parquet) and resolve to DownloadInfo.
 *
 * Uses Promise.allSettled so a rejection on either side does not reject the outer
 * promise — the Sentry global handler surfaces failures automatically (D-12).
 * No retry logic — the per-session cache lives in the caller (Plan 02).
 *
 * @param basePath - override the default base path (for testing)
 */
export async function fetchArchiveMetadata(basePath = DEFAULT_BASE): Promise<DownloadInfo> {
  const results = await Promise.allSettled([
    fetch(`${basePath}.zip`, { method: 'HEAD' }),
    fetch(`${basePath}.parquet`, { method: 'HEAD' }),
  ]);

  const allOk = results.every(r => r.status === 'fulfilled' && r.value.ok);
  if (!allOk) {
    return { ok: false };
  }

  const [zipRes, parquetRes] = results.map(
    r => (r as PromiseFulfilledResult<Response>).value,
  );

  return {
    ok: true,
    // T-08-01: Number(...) || null — falsy/NaN/missing Content-Length collapses to null
    zipBytes: Number(zipRes!.headers.get('content-length')) || null,
    parquetBytes: Number(parquetRes!.headers.get('content-length')) || null,
    // D-10: Last-Modified from .zip response (same HEAD, no extra fetch)
    lastModified: zipRes!.headers.get('last-modified'),
  };
}
