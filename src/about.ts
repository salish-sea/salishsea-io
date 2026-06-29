// Progressive enhancement for the static /about.html page.
//
// The page content (prose, links, download list) is plain static HTML so it is
// fully crawlable and readable with JavaScript disabled. This script only
// *upgrades* the download section: it fills in archive file sizes and replaces
// the static "Updated nightly at 09:00 UTC." line with a relative timestamp,
// using a pair of HEAD requests (see download-info.ts). On failure it leaves the
// static fallbacks untouched.
import { fetchArchiveMetadata, formatBytes, formatRelativeTime } from "./download-info.ts";

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

function setSize(root: ParentNode, key: "zip" | "parquet", bytes: number): void {
  const el = root.querySelector(`[data-size="${key}"]`);
  if (el) el.textContent = ` ${formatBytes(bytes)}`;
}

// Auto-run in the browser; skipped under test, where the test calls
// enhanceAboutDownloads() directly with a controlled root + mocked fetch.
if (import.meta.env.MODE !== "test") {
  enhanceAboutDownloads();
}
