import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

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

// Network deadlines: the viewer-request Lambda is hard-killed at 5s, and a kill
// bypasses the fail-open catch — CloudFront serves a 503 (salishsea-io-g9e).
// Budgets must leave the worst-case cold chain (SSM + one data fetch) comfortably
// under 5s so a slow dependency degrades to the shell instead.
const SSM_TIMEOUT_MS = 1500;
const FETCH_TIMEOUT_MS = 2000;

// Module-scoped credential cache — survives warm Lambda invocations
let supabaseUrl: string | undefined;
let supabaseKey: string | undefined;

/** Exported for test teardown only — clears module-level credential cache */
export function _clearCredentialCache(): void {
  supabaseUrl = undefined;
  supabaseKey = undefined;
}

async function getCredentials(): Promise<{ url: string; key: string }> {
  if (supabaseUrl && supabaseKey) return { url: supabaseUrl, key: supabaseKey };
  const ssm = new SSMClient({ region: 'us-east-1' });
  const abortSignal = AbortSignal.timeout(SSM_TIMEOUT_MS);
  const [urlParam, keyParam] = await Promise.all([
    ssm.send(new GetParameterCommand({ Name: '/salishsea/supabase-url' }), { abortSignal }),
    ssm.send(new GetParameterCommand({ Name: '/salishsea/supabase-anon-key', WithDecryption: true }), { abortSignal }),
  ]);
  supabaseUrl = urlParam.Parameter!.Value!;
  supabaseKey = keyParam.Parameter!.Value!;
  return { url: supabaseUrl, key: supabaseKey };
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
  const { url, key } = await getCredentials();
  const apiUrl = `${url}/rest/v1/individuals?primary_designation=eq.${encodeURIComponent(designation)}`
    + '&select=primary_designation,sex,born_earliest,born_latest,life_status,nicknames(name,status)&limit=1';
  const res = await fetch(apiUrl, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return htmlResponse(genericPreviewTags());
  const individuals = await res.json() as Individual[];
  const individual = individuals[0];
  if (!individual) return htmlResponse(genericPreviewTags());
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
  const { url, key } = await getCredentials();
  const apiUrl = `${url}/rest/v1/social_groups?designation=eq.${encodeURIComponent(designation)}`
    + '&kind=eq.matriline&select=designation,nicknames(name,status)&limit=1';
  const res = await fetch(apiUrl, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return htmlResponse(genericPreviewTags());
  const groups = await res.json() as SocialGroup[];
  const group = groups[0];
  if (!group) return htmlResponse(genericPreviewTags());
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
  const { url, key } = await getCredentials();
  const apiUrl = `${url}/rest/v1/social_groups?designation=eq.${encodeURIComponent(designation)}`
    + '&kind=eq.ecotype&select=designation,nicknames(name,status)&limit=1';
  const res = await fetch(apiUrl, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return htmlResponse(genericPreviewTags());
  const groups = await res.json() as SocialGroup[];
  const group = groups[0];
  if (!group) return htmlResponse(genericPreviewTags());
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

    const { url, key } = await getCredentials();
    const apiUrl = `${url}/rest/v1/occurrences?id=eq.${encodeURIComponent(occurrenceId)}&select=id,taxon,observed_at,count,photos&limit=1`;
    const res = await fetch(apiUrl, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
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
  } catch {
    // Fail-open: return the original request so CloudFront serves index.html
    // normally — except profile paths, which have no S3 object and must
    // still be rewritten to their page shell.
    if (profileRoute) {
      request.uri = profileRoute.shell;
    }
    return request;
  }
};
