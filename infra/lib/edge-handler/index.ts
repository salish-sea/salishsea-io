import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

// One line per container init: confirms which config the replica is running.
// Edge logs land in a log group of the SAME NAME in the region that served the
// request, not (only) us-east-1 — see the logGroup comment in infra-stack.ts.
console.log(JSON.stringify({
  msg: 'og-edge-init',
  hasConfig: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY),
}));

const BOT_AGENTS = [
  'facebookexternalhit',
  'twitterbot',
  'linkedinbot',
  'slackbot',
  'discordbot',
  'whatsapp',
  'telegrambot',
  'baiduspider',
  'bsky.social',
  'bluesky',
  'google-snippet',
  // "Mozilla/5.0 (compatible; ZulipURLPreview/<version>; +<realm url>)"
  'zulipurlpreview',
];

function isBot(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return BOT_AGENTS.some(bot => ua.includes(bot));
}

// Network deadline: the viewer-request Lambda is hard-killed at 5s, and a kill
// bypasses the fail-open catch — CloudFront serves a 503 (salish-g9e).
// With config baked in at synth the cold chain is init (~0.3s) + one Supabase
// fetch, so 3s leaves ample room to degrade to the shell instead.
const FETCH_TIMEOUT_MS = 3000;

// How long the first real fetch will wait for the init warmup before giving up
// and opening its own connection. Spent FROM the deadline above, never added to
// it (see timedFetch) — the total network budget stays 3s.
// Exported so the tests assert against the real budget instead of restating it.
export const WARMUP_WAIT_MS = 1000;

// Floor on what's left for the fetch after waiting. A near-zero deadline would
// abort instantly and fail open, which is worse than slightly overrunning the
// budget; 1s + the 1s cap above still lands well inside the 5s kill.
const MIN_FETCH_BUDGET_MS = 1000;

// The in-flight init warmup, or null once someone has waited on it.
let pendingWarmup: Promise<void> | null = null;

// Warm the fetch stack during init. The init phase runs at full CPU while the
// handler runs at the ~1/13 vCPU a 128MB viewer-request Lambda is capped at, so
// without this the first fetch per container pays ~2.5s (measured, og-fetch)
// for lazy undici load + DNS + TLS; later fetches run ~150-275ms. Calling
// fetch() here does the expensive stack load synchronously at full speed, and
// the handshake to the same origin proceeds so the handler's real fetch can
// reuse it. The env-var guard keeps imports outside Lambda (unit tests) from
// touching the network.
//
// The promise is kept (not fire-and-forget) so the first real fetch can wait
// for it: an invocation arriving while the warmup is still in flight used to
// open a SECOND connection, and two TLS handshakes competing for 1/13 vCPU is
// how a cold container blew the 3s deadline and served the bare shell
// (salish-cwd). Ending in .catch means awaiting it can only delay the
// handler, never throw into it.
if (SUPABASE_URL && process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const warmupStarted = Date.now();
  pendingWarmup = fetch(`${SUPABASE_URL}/auth/v1/health`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    .then(async res => {
      // Drain: undici returns the socket to its per-origin pool only once the
      // body is consumed — and reuse is half the point of warming.
      await res.arrayBuffer();
      console.log(JSON.stringify({ msg: 'og-warmup', ms: Date.now() - warmupStarted, status: res.status }));
    })
    .catch(err => console.log(JSON.stringify({ msg: 'og-warmup', ms: Date.now() - warmupStarted, error: String(err) })));
}

// Wait out the init warmup, but never longer than `budgetMs`. A warmup slower
// than that is abandoned rather than awaited — it keeps running, and whatever
// connection it opens is still there for the next invocation. Only the first
// caller ever waits; after that the container has a live socket either way.
async function awaitWarmup(budgetMs: number): Promise<void> {
  const warmup = pendingWarmup;
  if (!warmup) return;
  pendingWarmup = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    warmup,
    new Promise<void>(resolve => { timer = setTimeout(resolve, budgetMs); }),
  ]);
  clearTimeout(timer);
}

function getCredentials(): { url: string; key: string } {
  // Values are baked in at synth (see infra-stack.ts). Empty means a synth
  // without --context supabaseAnonKey reached production — fail open, loudly.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('edge config missing: SUPABASE_URL / SUPABASE_ANON_KEY not baked at synth');
  }
  return { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
}

// All Supabase reads go through here: one deadline, one timing/status log line.
// `kind` names the lookup (individual/matriline/ecotype/occurrence) so a slow or
// failing step is attributable straight from the log.
async function timedFetch(kind: string, apiUrl: string, key: string): Promise<Response> {
  const waitStarted = Date.now();
  await awaitWarmup(WARMUP_WAIT_MS);
  const warmupMs = Date.now() - waitStarted;

  // Whatever the wait consumed comes off this fetch's own deadline, so a cold
  // invocation still degrades to the shell inside the total 3s (salish-g9e).
  const budgetMs = Math.max(FETCH_TIMEOUT_MS - warmupMs, MIN_FETCH_BUDGET_MS);

  const started = Date.now();
  try {
    const res = await fetch(apiUrl, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
      signal: AbortSignal.timeout(budgetMs),
    });
    console.log(JSON.stringify({ msg: 'og-fetch', kind, ms: Date.now() - started, warmupMs, status: res.status }));
    return res;
  } catch (err) {
    console.error(JSON.stringify({ msg: 'og-fetch-error', kind, ms: Date.now() - started, warmupMs, error: String(err) }));
    throw err;
  }
}

/** Escape & " < > for safe interpolation into HTML attribute values */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

type OgTags = Record<string, string>;

function buildOgHtml(tags: OgTags): string {
  const metaTags = Object.entries(tags)
    .map(([prop, content]) => {
      // Twitter card uses name= not property=
      if (prop.startsWith('twitter:')) {
        return `  <meta name="${prop}" content="${escapeHtml(content)}">`;
      }
      return `  <meta property="${prop}" content="${escapeHtml(content)}">`;
    })
    .join('\n');
  // Mirror og:title/og:description into a real <title> and meta description so the
  // synthesized page is also useful to search snippet crawlers, not just social cards.
  const titleTag = tags['og:title'] ? `  <title>${escapeHtml(tags['og:title'])}</title>\n` : '';
  const descTag = tags['og:description']
    ? `  <meta name="description" content="${escapeHtml(tags['og:description'])}">\n`
    : '';
  return `<!DOCTYPE html><html><head>\n${titleTag}${descTag}${metaTags}\n</head><body></body></html>`;
}

const SITE_TITLE = 'Salish Sea — Whale & Orca Sightings Map';
const SITE_DESCRIPTION =
  'An interactive map of whale and marine-mammal sightings across the Salish Sea, ' +
  'gathered from community sources like Whale Alert, Orca Network, and HappyWhale.';

// What a card shows, in order of preference: an image OF THE THING SHARED (an
// open-licensed photo, else a rendered map of where it was seen), and failing
// that the brand card — the mark and wordmark, which say "this is SalishSea.io"
// (decision 026, superseding 019). The card 019 rejected was a months-stale map
// screenshot: content-shaped, so it read as a picture of the post and misled.
// An identity-shaped card claims nothing about the post, so it is honest on
// every link, and `summary_large_image` is honest with it because there is now
// always a picture to render.
const BRAND_CARD_TAGS = {
  'og:image': 'https://salishsea.io/social-card.jpg',
  'og:image:width': '1200',
  'og:image:height': '630',
  'twitter:card': 'summary_large_image',
} as const;

function genericPreviewTags(): OgTags {
  return {
    'og:site_name': 'SalishSea.io',
    'og:type': 'website',
    'og:url': 'https://salishsea.io/',
    'og:title': SITE_TITLE,
    'og:description': SITE_DESCRIPTION,
    ...BRAND_CARD_TAGS,
    'fb:app_id': FB_APP_ID,
  };
}

interface Photo {
  src: string;
  license: string | null;
}

interface Occurrence {
  id: string;
  taxon: { vernacular_name: string };
  observed_at: string;
  count: number | null;
  photos: Photo[];
  // Nullable in the schema. Every occurrence has coordinates today, but a map
  // card for one that doesn't would be a URL that can never render — see where
  // this is read below.
  location: { lon: number; lat: number } | null;
  // The rest is read for an acoustic occurrence (an Orcasound bout, decision 053),
  // which spans a time range at a hydrophone and names which whales in `identifiers`.
  provider_slug?: string | null;
  identifiers?: string[] | null;
  observed_until?: string | null;
  attribution?: string | null;
}

// Only cc0 and cc-by are unambiguously open for re-use
const OPEN_LICENSES = ['cc0', 'cc-by'];

// iNaturalist photos are ingested as the 75×75 `square` thumbnail — the right
// size for the map UI, and far below what the social platforms accept: Facebook
// drops og:image under 200×200 and Twitter's summary_large_image wants at least
// 300×157. So the one card type that DOES carry an image was very likely still
// rendering without one (salish-uum). The same path serves `large`
// (1024px, ~150-800KB), so swap that single segment when building the card.
//
// The hosts are matched exactly, not by substring: `src` is ingested data, and a
// lookalike authority (evil-inaturalist.example, or …amazonaws.com.evil.example)
// must not talk us into rewriting a URL whose `large` sibling we know nothing
// about. Everything else — HappyWhale, Spotter, our own uploads — has no variant
// segment to match and passes through untouched.
const INAT_SQUARE_RE =
  /^(https:\/\/(?:inaturalist-open-data\.s3\.amazonaws\.com|static\.inaturalist\.org)\/photos\/\d+\/)square(\.[a-z]+)$/i;

/** Full-size variant of a photo URL, for use as og:image. */
function cardImageUrl(src: string): string {
  return src.replace(INAT_SQUARE_RE, '$1large$2');
}

// Rendered map cards (decision 020). This handler only NAMES these URLs — the
// image is rendered by the /cards/* Lambda, which does its own data fetch. That
// keeps this function inside its 128MB/5s budget and keeps a card URL cacheable
// by id alone.
//
// A crawler fetching the image it was just told about must get bytes, not another
// OG document: /cards/* has no edge function at all, and the handler answers only
// the map page.
function occurrenceCardUrl(id: string): string {
  return `https://salishsea.io/cards/o/${encodeURIComponent(id)}.jpg`;
}

function dayCardUrl(date: string): string {
  return `https://salishsea.io/cards/day/${date}.jpg`;
}

// A `d=` parameter names a Pacific calendar date. Only the shape is checked here
// — the renderer owns the day's real boundaries — but a bogus value must not
// become a card URL that 404s inside somebody's post.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

// The site is organised around Pacific calendar days, so every date and time a
// preview shows must be rendered in that zone. Lambda@Edge runs in UTC, so an
// Intl formatter with no timeZone silently reports UTC: a 6:38 PM Pacific
// sighting became "August 30, 2026 · 1:38 AM" in the card while the site, the
// `d=` parameter, and the map card all said August 29.
const PACIFIC = 'America/Los_Angeles';

/** "July 27, 2026" for a bare calendar date, read in Pacific time. */
function formatCalendarDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: PACIFIC,
  }).format(new Date(`${date}T12:00:00Z`));
}

/**
 * Postgres hands back timestamps without a zone designator; JS would read those
 * as local time and silently shift the date. Treat a bare timestamp as UTC, which
 * is what it is. (Mirrors normalizeInstant in the card renderer.)
 */
function normalizeInstant(iso: string): string {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`;
}

function dayPreviewTags(date: string): OgTags {
  return {
    'og:site_name': 'SalishSea.io',
    'og:type': 'website',
    'og:url': `https://salishsea.io/?d=${encodeURIComponent(date)}`,
    'og:title': `Sightings · ${formatCalendarDate(date)}`,
    'og:description':
      `Whale and marine-mammal sightings reported across the Salish Sea on ${formatCalendarDate(date)}.`,
    'og:image': dayCardUrl(date),
    'twitter:card': 'summary_large_image',
    'fb:app_id': FB_APP_ID,
  };
}
// Public Facebook App ID — links shared content to our FB app for Domain Insights.
// Not a secret; it appears in page meta by design.
const FB_APP_ID = '678644427974059';

const htmlResponse = (tags: OgTags) => ({
  status: '200',
  headers: { 'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }] },
  body: buildOgHtml(tags),
});

export const handler = async (event: any): Promise<any> => {
  const request = event.Records[0].cf.request;

  const ua = request.headers['user-agent']?.[0]?.value ?? '';
  const bot = isBot(ua);

  // Only the map page's preview depends on its query (?o= a sighting, ?d= a day), so only
  // it is answered here. Every other page carries its own tags from the origin, the
  // prerendered profiles included (salish-xv35.16), so a crawler gets it as a person would.
  // Everything else a crawler fetches must reach the origin as bytes too: the /dwca/
  // archive and its GeoParquet sidecar (L-01), /sitemap.xml and /robots.txt, which
  // listed crawlers (baiduspider, google-snippet) read, and any image a card points at,
  // which the same crawlers fetch with their bot UA to render it (an HTML body served as
  // the image is how previews broke once).
  if (!bot || (request.uri !== '/' && request.uri !== '/index.html')) {
    return request;
  }

  try {
    const qs = new URLSearchParams(request.querystring ?? '');
    const occurrenceId = qs.get('o');

    if (!occurrenceId) {
      // A link shared from a particular day gets that day's map. No lookup here:
      // the renderer counts and plots the sightings, so this branch costs nothing.
      const date = qs.get('d');
      if (date && isCalendarDate(date)) {
        return htmlResponse(dayPreviewTags(date));
      }
      return {
        status: '200',
        headers: { 'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }] },
        body: buildOgHtml(genericPreviewTags()),
      };
    }

    const { url, key } = getCredentials();
    const apiUrl = `${url}/rest/v1/occurrences?id=eq.${encodeURIComponent(occurrenceId)}&select=id,taxon,observed_at,count,photos,location,provider_slug,identifiers,observed_until,attribution&limit=1`;
    const res = await timedFetch('occurrence', apiUrl, key);
    if (!res.ok) {
      return {
        status: '200',
        headers: { 'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }] },
        body: buildOgHtml(genericPreviewTags()),
      };
    }
    const occurrences = await res.json() as Occurrence[];
    const occ = occurrences[0];

    if (!occ) {
      console.log(JSON.stringify({ msg: 'og-unknown', kind: 'occurrence', designation: occurrenceId }));
      return {
        status: '200',
        headers: { 'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }] },
        body: buildOgHtml(genericPreviewTags()),
      };
    }

    const species = occ.taxon?.vernacular_name ?? 'Whale sighting';

    // Title: "{species} · {date}" — e.g. "Orca · June 3, 2025", in Pacific time
    const observedAt = new Date(normalizeInstant(occ.observed_at));
    const date = new Intl.DateTimeFormat('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: PACIFIC,
    }).format(observedAt);
    const time = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: PACIFIC,
    }).format(observedAt);

    let title: string;
    let description: string;
    if (occ.provider_slug === 'orcasound') {
      // Heard, not seen: a bout has no count, spans a time range, and says which
      // whales in its identifiers ("J pod, K pod, Southern Resident"). The hydrophone
      // is in the attribution ("Orcasound moderators at Port Townsend").
      title = `${species} heard · ${date}`;
      const until = occ.observed_until
        ? `–${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: PACIFIC })
          .format(new Date(normalizeInstant(occ.observed_until)))}`
        : '';
      const who = occ.identifiers?.length ? occ.identifiers.join(', ') : species;
      const where = occ.attribution?.replace(/^Orcasound moderators at /, '') ?? 'Orcasound';
      description = `${who} · ${time}${until} · ${where} hydrophone`;
    } else {
      title = `${species} · ${date}`;
      // Description: "{count} {species}s · {time}" — e.g. "3 Orcas · 2:32 PM"
      const count = occ.count ?? 1;
      description = `${count} ${species}s · ${time}`;
    }

    // Image: an open-licensed photo of the animal if there is one, otherwise a
    // rendered map of where it was seen. A photo of the actual whale beats a map
    // of its position; the map card fills the ~90% of sightings that have no
    // re-usable photo and were text-only until now (decision 020).
    //
    // A map card is only offered when there is somewhere to put the marker. The
    // renderer 404s on an occurrence with no coordinates, and a card URL that can
    // never resolve is worse than no card URL — it sits broken inside a post. That
    // case falls through to the brand card, which always resolves. No occurrence
    // lacks a location today; the column allows it, so the code does too.
    const photo = (occ.photos ?? []).find((p: Photo) => OPEN_LICENSES.includes(p.license ?? ''));
    const image = photo ? cardImageUrl(photo.src)
      : occ.location ? occurrenceCardUrl(occurrenceId)
      : null;

    const tags: OgTags = {
      'og:site_name': 'SalishSea.io',
      'og:type': 'website',
      'og:url': `https://salishsea.io/?o=${encodeURIComponent(occurrenceId)}`,
      'og:title': title,
      'og:description': description,
      ...(image
        ? { 'og:image': image, 'twitter:card': 'summary_large_image' }
        : BRAND_CARD_TAGS),
      'fb:app_id': FB_APP_ID,
    };

    return {
      status: '200',
      headers: { 'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }] },
      body: buildOgHtml(tags),
    };
  } catch (err) {
    // Fail-open: return the original request so CloudFront serves index.html
    // normally.
    console.error(JSON.stringify({ msg: 'og-fail-open', uri: request.uri, error: String(err) }));
    return request;
  }
};
