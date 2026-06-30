// Progressive enhancement for the static /about.html page.
//
// The page content (prose, links, download list, "Back to the map" link) is
// plain static HTML so it is fully crawlable and readable with JavaScript
// disabled. This script only *upgrades* two things:
//   1. the download section — fills in archive file sizes and replaces the
//      static "Updated nightly at 09:00 UTC." line with a relative timestamp,
//      via a pair of HEAD requests (see download-info.ts);
//   2. the "Back to the map" link — restores the map permalink the visitor came
//      from (?d/?x/?y/?z/?o) instead of dropping them at the default map view.
// On failure / direct visits it leaves the static fallbacks untouched.
import { fetchArchiveMetadata, formatBytes, formatRelativeTime } from "./download-info.ts";

/**
 * Fill in DwC-A archive sizes and a relative "updated" timestamp from a pair of
 * HEAD requests. No-op (leaves the static fallbacks) when the archive is
 * unreachable, so the page degrades cleanly without JavaScript.
 *
 * @param root - element to query within (defaults to the document)
 */
export async function enhanceAboutDownloads(root: ParentNode = document): Promise<void> {
  const info = await fetchArchiveMetadata();
  if (!info.ok) return;

  if (info.zipBytes != null) setSize(root, "zip", info.zipBytes);
  if (info.parquetBytes != null) setSize(root, "parquet", info.parquetBytes);

  if (info.lastModified != null) {
    const fresh = formatRelativeTime(info.lastModified);
    const el = root.querySelector(".freshness");
    // Only replace the static fallback when we have a parseable timestamp.
    if (el && fresh) el.textContent = fresh;
  }
}

/**
 * Point the "Back to the map" link at the map view the visitor arrived from, so
 * its permalink state (?d/?x/?y/?z/?o) survives the round trip. Only acts when
 * the referrer is a same-origin map URL (path "/"); otherwise the static
 * href="/" fallback stands — correct for direct visits, crawlers, and external
 * referrers.
 *
 * @param root - element to query within (defaults to the document)
 * @param referrer - navigation referrer (injectable for tests)
 * @param origin - current origin (injectable for tests)
 */
export function restoreMapBackLink(
  root: ParentNode = document,
  referrer: string = document.referrer,
  origin: string = location.origin,
): void {
  if (!referrer) return;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return;
  }
  if (url.origin !== origin || url.pathname !== "/") return;
  const back = root.querySelector(".back");
  if (back) back.setAttribute("href", "/" + url.search);
}

function setSize(root: ParentNode, key: "zip" | "parquet", bytes: number): void {
  const el = root.querySelector(`[data-size="${key}"]`);
  if (el) el.textContent = ` ${formatBytes(bytes)}`;
}

// Auto-run in the browser; skipped under test, where tests call the exported
// functions directly with a controlled root + mocked referrer/fetch.
if (import.meta.env.MODE !== "test") {
  restoreMapBackLink();
  enhanceAboutDownloads();
}
