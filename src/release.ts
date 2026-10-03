/**
 * The commit this site was built from, for the `release` on a feedback report
 * (decision 039) and on Sentry's events.
 *
 * Read from `/release.json`, which the build writes beside the pages, rather
 * than compiled into the bundle: a commit id inside the bundle changes every
 * hashed file on every commit, even one that touches no source, and with them
 * the shells the read-path build renders ~375 profile pages from
 * (salish-xv35.14). Both hosts serve the file no-cache, as they do every
 * unhashed one.
 *
 * Never rejects: a report is worth more than its release, so a failed fetch is
 * 'unknown', and the next call asks again.
 */

const RELEASE_FILE = '/release.json';

let pending: Promise<string> | undefined;

export function release(): Promise<string> {
  pending ??= fetchRelease().then(r => {
    if (r === 'unknown') pending = undefined;
    return r;
  });
  return pending;
}

async function fetchRelease(): Promise<string> {
  try {
    const response = await fetch(RELEASE_FILE, {signal: AbortSignal.timeout(10_000)});
    if (!response.ok) return 'unknown';
    // In development there is no file and the dev server answers with the app's
    // HTML, which doesn't parse.
    const body: unknown = await response.json();
    const value = body && typeof body === 'object' ? (body as {release?: unknown}).release : undefined;
    return typeof value === 'string' && value ? value : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** For tests: forget the last answer. */
export function resetRelease(): void {
  pending = undefined;
}
