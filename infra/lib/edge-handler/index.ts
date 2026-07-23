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
];

function isBot(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return BOT_AGENTS.some(bot => ua.includes(bot));
}

// Image assets a crawler may fetch directly (e.g. og:image = /preview.jpg). These
// must pass through to origin as raw bytes, never be intercepted for OG-meta HTML.
const STATIC_ASSET_RE = /\.(jpe?g|png|gif|svg|webp|ico|avif)$/i;

// Network deadline: the viewer-request Lambda is hard-killed at 5s, and a kill
// bypasses the fail-open catch — CloudFront serves a 503 (salishsea-io-g9e).
// With config baked in at synth the cold chain is init (~0.3s) + one Supabase
// fetch, so 3s leaves ample room to degrade to the shell instead.
const FETCH_TIMEOUT_MS = 3000;

// Warm the fetch stack during init. The init phase runs at full CPU while the
// handler runs at the ~1/13 vCPU a 128MB viewer-request Lambda is capped at, so
// without this the first fetch per container pays ~2.5s (measured, og-fetch)
// for lazy undici load + DNS + TLS; later fetches run ~150-275ms. Calling
// fetch() here does the expensive stack load synchronously at full speed, and
// the handshake to the same origin proceeds so the handler's real fetch can
// reuse it. Fire-and-forget: never awaited, and a failure is irrelevant — the
// real fetch has its own deadline and fail-open. The env-var guard keeps
// imports outside Lambda (unit tests) from touching the network.
if (SUPABASE_URL && process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const warmupStarted = Date.now();
  fetch(`${SUPABASE_URL}/auth/v1/health`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).then(
    res => console.log(JSON.stringify({ msg: 'og-warmup', ms: Date.now() - warmupStarted, status: res.status })),
    err => console.log(JSON.stringify({ msg: 'og-warmup', ms: Date.now() - warmupStarted, error: String(err) })),
  );
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
  const started = Date.now();
  try {
    const res = await fetch(apiUrl, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    console.log(JSON.stringify({ msg: 'og-fetch', kind, ms: Date.now() - started, status: res.status }));
    return res;
  } catch (err) {
    console.error(JSON.stringify({ msg: 'og-fetch-error', kind, ms: Date.now() - started, error: String(err) }));
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

function genericPreviewTags(): OgTags {
  return {
    'og:site_name': 'SalishSea.io',
    'og:type': 'website',
    'og:url': 'https://salishsea.io/',
    'og:title': SITE_TITLE,
    'og:description': SITE_DESCRIPTION,
    'og:image': FALLBACK_IMAGE,
    'twitter:card': 'summary_large_image',
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
}

interface Individual {
  primary_designation: string;
  sex: 'female' | 'male' | null;
  born_earliest: number | null;
  born_latest: number | null;
  life_status: string;
  nicknames: { name: string; status: string }[];
}

interface SocialGroup {
  designation: string;
  nicknames: { name: string; status: string }[];
}

function individualPreviewTags(individual: Individual): OgTags {
  const name = individual.nicknames.find(n => n.status === 'official')?.name
    ?? individual.nicknames.find(n => n.status !== 'deprecated')?.name;
  const designation = individual.primary_designation;
  const title = name ? `${name} (${designation})` : designation;
  const vitals = [
    individual.sex === 'female' ? 'Female' : individual.sex === 'male' ? 'Male' : null,
    individual.born_earliest !== null && individual.born_latest !== null
      ? (individual.born_earliest === individual.born_latest
        ? `born ${individual.born_earliest}`
        : `born ${individual.born_earliest}–${individual.born_latest}`)
      : individual.born_latest !== null ? `born by ${individual.born_latest}`
      : individual.born_earliest !== null ? `born after ${individual.born_earliest}` : null,
  ].filter(Boolean).join(', ');
  const description = `${vitals ? `${vitals} · ` : ''}Names, family, and sighting history of ${title} in the Salish Sea.`;
  return {
    'og:site_name': 'SalishSea.io',
    'og:type': 'profile',
    'og:url': `https://salishsea.io/individuals/${encodeURIComponent(designation)}`,
    'og:title': title,
    'og:description': description,
    'og:image': FALLBACK_IMAGE,
    'twitter:card': 'summary_large_image',
    'fb:app_id': FB_APP_ID,
  };
}

// Only cc0 and cc-by are unambiguously open for re-use
const OPEN_LICENSES = ['cc0', 'cc-by'];
const FALLBACK_IMAGE = 'https://salishsea.io/preview.jpg';
// Public Facebook App ID — links shared content to our FB app for Domain Insights.
// Not a secret; it appears in page meta by design.
const FB_APP_ID = '678644427974059';

const htmlResponse = (tags: OgTags) => ({
  status: '200',
  headers: { 'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }] },
  body: buildOgHtml(tags),
});

// OG-meta response for a bot fetching an individual's profile page. Unknown
// designations fall back to the generic site card — same contract as ?o=.
async function individualPreview(designation: string): Promise<any> {
  const { url, key } = getCredentials();
  const apiUrl = `${url}/rest/v1/individuals?primary_designation=eq.${encodeURIComponent(designation)}`
    + '&select=primary_designation,sex,born_earliest,born_latest,life_status,nicknames(name,status)&limit=1';
  const res = await timedFetch('individual', apiUrl, key);
  if (!res.ok) return htmlResponse(genericPreviewTags());
  const individuals = await res.json() as Individual[];
  const individual = individuals[0];
  if (!individual) {
    console.log(JSON.stringify({ msg: 'og-unknown', kind: 'individual', designation }));
    return htmlResponse(genericPreviewTags());
  }
  return htmlResponse(individualPreviewTags(individual));
}

function matrilinePreviewTags(group: SocialGroup): OgTags {
  const name = group.nicknames.find(n => n.status === 'official')?.name
    ?? group.nicknames.find(n => n.status !== 'deprecated')?.name;
  const designation = group.designation;
  const title = name ? `${name} (${designation} matriline)` : `The ${designation} matriline`;
  const description =
    `Members, naming, and sighting history of the ${designation} matriline of Bigg's killer whales in the Salish Sea.`;
  return {
    'og:site_name': 'SalishSea.io',
    'og:type': 'profile',
    'og:url': `https://salishsea.io/matrilines/${encodeURIComponent(designation)}`,
    'og:title': title,
    'og:description': description,
    'og:image': FALLBACK_IMAGE,
    'twitter:card': 'summary_large_image',
    'fb:app_id': FB_APP_ID,
  };
}

// OG-meta response for a bot fetching a matriline's profile page.
async function matrilinePreview(designation: string): Promise<any> {
  const { url, key } = getCredentials();
  const apiUrl = `${url}/rest/v1/social_groups?designation=eq.${encodeURIComponent(designation)}`
    + '&kind=eq.matriline&select=designation,nicknames(name,status)&limit=1';
  const res = await timedFetch('matriline', apiUrl, key);
  if (!res.ok) return htmlResponse(genericPreviewTags());
  const groups = await res.json() as SocialGroup[];
  const group = groups[0];
  if (!group) {
    console.log(JSON.stringify({ msg: 'og-unknown', kind: 'matriline', designation }));
    return htmlResponse(genericPreviewTags());
  }
  return htmlResponse(matrilinePreviewTags(group));
}

// Well-known killer whale ecotype descriptors. notes on the social_groups row
// carries this too, but notes are never rendered (D-21), so it lives in code.
const ECOTYPE_LABELS: Record<string, string> = {
  Biggs: "Bigg's (transient) killer whales",
};

function ecotypePreviewTags(group: SocialGroup): OgTags {
  const designation = group.designation;
  const label = ECOTYPE_LABELS[designation] ?? `The ${designation} ecotype`;
  const description = `The matrilines and aggregated sighting history of ${label} in the Salish Sea.`;
  return {
    'og:site_name': 'SalishSea.io',
    'og:type': 'profile',
    'og:url': `https://salishsea.io/ecotypes/${encodeURIComponent(designation)}`,
    'og:title': label,
    'og:description': description,
    'og:image': FALLBACK_IMAGE,
    'twitter:card': 'summary_large_image',
    'fb:app_id': FB_APP_ID,
  };
}

// OG-meta response for a bot fetching an ecotype's profile page.
async function ecotypePreview(designation: string): Promise<any> {
  const { url, key } = getCredentials();
  const apiUrl = `${url}/rest/v1/social_groups?designation=eq.${encodeURIComponent(designation)}`
    + '&kind=eq.ecotype&select=designation,nicknames(name,status)&limit=1';
  const res = await timedFetch('ecotype', apiUrl, key);
  if (!res.ok) return htmlResponse(genericPreviewTags());
  const groups = await res.json() as SocialGroup[];
  const group = groups[0];
  if (!group) {
    console.log(JSON.stringify({ msg: 'og-unknown', kind: 'ecotype', designation }));
    return htmlResponse(genericPreviewTags());
  }
  return htmlResponse(ecotypePreviewTags(group));
}

// Profile pages rendered client-side from a static shell (decision 015/016/017):
// humans get the shell rewrite, bots get synthesized OG meta. S3 has no object
// at these paths, so even the fail-open branch must rewrite to the shell.
const PROFILE_ROUTES = [
  { re: /^\/individuals\/([^/]+)\/?$/, shell: '/individual.html', preview: individualPreview },
  { re: /^\/matrilines\/([^/]+)\/?$/, shell: '/matriline.html', preview: matrilinePreview },
  { re: /^\/ecotypes\/([^/]+)\/?$/, shell: '/ecotype.html', preview: ecotypePreview },
];

function matchProfileRoute(uri: string): { shell: string; preview: (designation: string) => Promise<any>; designation: string } | null {
  for (const { re, shell, preview } of PROFILE_ROUTES) {
    const match = uri.match(re);
    if (match) return { shell, preview, designation: match[1]! };
  }
  return null;
}

export const handler = async (event: any): Promise<any> => {
  const request = event.Records[0].cf.request;

  // L-01: bypass OG-meta interception for /dwca/* binary downloads (DwC-A archive +
  // GeoParquet sidecar). Path-prefix gate runs BEFORE the bot-UA branch so crawlers
  // (Slackbot, Facebook, etc.) receive the binary, not synthesized HTML.
  // Ref: .planning/phases/07-nightly-workflow-hosting/07-CONTEXT.md §L-01
  //
  // Same rationale for /sitemap.xml and /robots.txt: search crawlers that ARE in
  // BOT_AGENTS (baiduspider, google-snippet) must receive the raw file, never
  // synthesized HTML, or the sitemap/robots directives are unreadable.
  //
  // Same rationale for static image assets: og:image points at /preview.jpg, which
  // the very same crawlers (facebookexternalhit, twitterbot, …) fetch to render the
  // card. Without this carve-out the handler answers that image request with OG-meta
  // HTML — an HTML body served as the image — and the preview breaks. Any path with
  // an image extension must pass through to origin as raw bytes.
  if (
    request.uri.startsWith('/dwca/') ||
    request.uri === '/sitemap.xml' ||
    request.uri === '/robots.txt' ||
    STATIC_ASSET_RE.test(request.uri)
  ) {
    return request;
  }

  const ua = request.headers['user-agent']?.[0]?.value ?? '';
  const profileRoute = matchProfileRoute(request.uri);

  if (!isBot(ua)) {
    // Humans get the page shell; the page reads the designation from the path.
    // S3 has no object at /individuals/* or /matrilines/*, so without this
    // rewrite the path 404s.
    if (profileRoute) {
      request.uri = profileRoute.shell;
    }
    return request;
  }

  try {
    if (profileRoute) {
      return await profileRoute.preview(decodeURIComponent(profileRoute.designation));
    }

    const qs = new URLSearchParams(request.querystring ?? '');
    const occurrenceId = qs.get('o');

    if (!occurrenceId) {
      return {
        status: '200',
        headers: { 'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }] },
        body: buildOgHtml(genericPreviewTags()),
      };
    }

    const { url, key } = getCredentials();
    const apiUrl = `${url}/rest/v1/occurrences?id=eq.${encodeURIComponent(occurrenceId)}&select=id,taxon,observed_at,count,photos&limit=1`;
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

    // Title: "{species} · {date}" — e.g. "Orca · June 3, 2025"
    // Normalize observed_at: append 'Z' if no timezone indicator so Node treats it as UTC
    const observedAt = occ.observed_at.endsWith('Z') || occ.observed_at.includes('+')
      ? occ.observed_at
      : occ.observed_at + 'Z';
    const date = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      .format(new Date(observedAt));
    const title = `${species} · ${date}`;

    // Description: "{count} {species}s · {time}" — e.g. "3 Orcas · 2:32 PM"
    const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
      .format(new Date(observedAt));
    const count = occ.count ?? 1;
    const description = `${count} ${species}s · ${time}`;

    // Image: first photo with cc0 or cc-by license only
    const photo = (occ.photos ?? []).find((p: Photo) => OPEN_LICENSES.includes(p.license ?? ''));
    const imageUrl = photo?.src ?? FALLBACK_IMAGE;

    const tags: OgTags = {
      'og:site_name': 'SalishSea.io',
      'og:type': 'website',
      'og:url': `https://salishsea.io/?o=${encodeURIComponent(occurrenceId)}`,
      'og:title': title,
      'og:description': description,
      'og:image': imageUrl,
      'twitter:card': 'summary_large_image',
      'fb:app_id': FB_APP_ID,
    };

    return {
      status: '200',
      headers: { 'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }] },
      body: buildOgHtml(tags),
    };
  } catch (err) {
    // Fail-open: return the original request so CloudFront serves index.html
    // normally — except profile paths, which have no S3 object and must
    // still be rewritten to their page shell.
    console.error(JSON.stringify({ msg: 'og-fail-open', uri: request.uri, error: String(err) }));
    if (profileRoute) {
      request.uri = profileRoute.shell;
    }
    return request;
  }
};
