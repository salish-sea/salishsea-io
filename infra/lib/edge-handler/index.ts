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

// Image assets a crawler may fetch directly (icons, and any og:image we ever serve
// from our own origin). These must pass through to origin as raw bytes, never be
// intercepted for OG-meta HTML.
const STATIC_ASSET_RE = /\.(jpe?g|png|gif|svg|webp|ico|avif)$/i;

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
}

interface Individual {
  entity_id: string | null;
  primary_designation: string;
  sex: 'female' | 'male' | null;
  born_earliest: number | null;
  born_latest: number | null;
  life_status: string;
  nicknames: { name: string; status: string }[];
}

interface SocialGroup {
  entity_id: string | null;
  designation: string;
  nicknames: { name: string; status: string }[];
}

// ---- Profile URLs (decision 034) -------------------------------------------
//
// A profile URL keys on the register's identifier and carries the designation
// as a slug that is composed here and ignored on read:
//
//   /individuals/0010193/T065A      canonical — the only segment READ is 0010193
//   /individuals/0010193            bare identifier: 301 to the slugged form
//   /individuals/0010193/T065A9     stale slug: 301 (crawlers) or fixed client-side
//   /individuals/T065A, /T046A      designation: one lookup, then 301
//
// The path helpers below mirror src/catalog.ts, which composes the same URLs
// in the browser. The edge bundle cannot import from src/, so the two are kept
// in step by hand — change one, change the other.

// The local part of a register identifier (SSA:0010193 → 0010193): animals
// ADR-0021's registered pattern.
const ENTITY_LOCAL_PART_RE = /^\d{7}$/;
const registerKey = (segment: string) => ENTITY_LOCAL_PART_RE.test(segment) ? `SSA:${segment}` : null;

// A haul-out site's own id. Bounded so a designation-looking run of digits
// cannot be mistaken for one, and no seven-digit register id can either.
const HAULOUT_ID_RE = /^\d{1,6}$/;
const hauloutKey = (segment: string) => HAULOUT_ID_RE.test(segment) ? segment : null;

// The designation as a URL segment: apostrophes dropped (Bigg's → Biggs), any
// other run of non-alphanumerics collapsed to a hyphen.
function slugify(designation: string): string {
  return designation.replace(/['’]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// TS port of public.normalize_designation: an un-padded, lower-cased code as a
// person types it ('t65a') to the padded catalogue key ('T065A').
function normalizeDesignation(code: string): string {
  const u = code.trim().toUpperCase();
  const m = u.match(/^T(\d+)(.*)$/);
  if (!m) return u;
  return 'T' + m[1]!.padStart(3, '0').slice(0, 3) + m[2]!;
}

// A LIKE pattern matching exactly `value`, so `ilike` gives case-insensitive
// equality and nothing more. Postgres's wildcards are % and _, PostgREST adds *
// as an alias for %, and the default escape character is the backslash.
function ilikeLiteral(value: string): string {
  return value.replace(/[\\%_*]/g, '\\$&');
}

// The canonical address of a subject. A row with no register identifier yet
// (matrilines, until salish-ox2.6) is addressed by its designation, as before.
function canonicalProfilePath(prefix: string, entityId: string | null, designation: string): string {
  if (!entityId) return `/${prefix}/${encodeURIComponent(designation)}`;
  const slug = slugify(designation);
  return `/${prefix}/${entityId.replace(/^SSA:/, '')}${slug ? `/${slug}` : ''}`;
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
    'og:url': `https://salishsea.io${canonicalProfilePath('individuals', individual.entity_id, designation)}`,
    'og:title': title,
    'og:description': description,
    ...BRAND_CARD_TAGS,
    'fb:app_id': FB_APP_ID,
  };
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
// Note the paths end in .jpg, which STATIC_ASSET_RE above deliberately passes
// through: a crawler fetching the image it was just told about must get bytes,
// not another OG document.
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

// What a profile path names: the register identifier (with whatever slug came
// along, unread), or a designation on a legacy or hand-typed path.
type ProfileKey =
  | { kind: 'entity'; entityId: string; slug: string | null }
  | { kind: 'designation'; code: string };

// A subject the edge has looked up: where it canonically lives, and its card.
interface Resolved {
  canonical: string;
  tags: OgTags;
}

interface ProfileFamily {
  prefix: 'individuals' | 'matrilines' | 'ecotypes' | 'haulouts';
  shell: string;
  kind: 'individual' | 'matriline' | 'ecotype' | 'haulout';
  // The identifier a first path segment names, or null when the segment is
  // not one — then it is read as a designation. Absent for a family whose
  // rows carry no identifier yet: matrilines (73 of 132 have no register
  // entity — animals Q22, salish-ox2.6), whose designation paths stay
  // canonical and never redirect; 034 says they follow once the identifiers
  // are settled. Animals key on the register's seven digits; a haul-out site
  // is our own row and keys on its own integer (decision 040).
  entityKey?: (segment: string) => string | null;
  // null when nothing in the catalogue answers to the key.
  resolve(key: ProfileKey): Promise<Resolved | null>;
}

// One Supabase read, or null on a non-2xx. The `kind` names the lookup in the
// og-fetch log line.
async function readRows<T>(kind: string, path: string): Promise<T[] | null> {
  const { url, key } = getCredentials();
  const res = await timedFetch(kind, `${url}/rest/v1/${path}`, key);
  if (!res.ok) return null;
  return await res.json() as T[];
}

const INDIVIDUAL_COLUMNS = 'entity_id,primary_designation,sex,born_earliest,born_latest,life_status,nicknames(name,status)';

// An individual by register identifier, or by ANY designation it has ever
// carried — public.designations holds the superseded and alternate codes the
// register does not publish (034, consequences), which is what lets
// /individuals/T046A find T122 when primary_designation alone never did.
async function resolveIndividual(key: ProfileKey): Promise<Resolved | null> {
  let individual: Individual | undefined;
  if (key.kind === 'entity') {
    const rows = await readRows<Individual>('individual',
      `individuals?entity_id=eq.${encodeURIComponent(key.entityId)}&select=${INDIVIDUAL_COLUMNS}&limit=1`);
    individual = rows?.[0];
  } else {
    const pattern = ilikeLiteral(normalizeDesignation(key.code));
    const rows = await readRows<{ individual: Individual | null }>('individual',
      `designations?code=ilike.${encodeURIComponent(pattern)}&select=individual:individuals(${INDIVIDUAL_COLUMNS})&limit=1`);
    individual = rows?.[0]?.individual ?? undefined;
  }
  if (!individual) return null;
  return {
    canonical: canonicalProfilePath('individuals', individual.entity_id, individual.primary_designation),
    tags: individualPreviewTags(individual),
  };
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
    ...BRAND_CARD_TAGS,
    'fb:app_id': FB_APP_ID,
  };
}

const GROUP_COLUMNS = 'entity_id,designation,nicknames(name,status)';

// Matrilines are not keyed yet (see ProfileFamily.keyed), so the only key that
// reaches here is a designation, matched exactly as before.
async function resolveMatriline(key: ProfileKey): Promise<Resolved | null> {
  if (key.kind !== 'designation') return null;
  const rows = await readRows<SocialGroup>('matriline',
    `social_groups?designation=eq.${encodeURIComponent(key.code)}&kind=eq.matriline&select=${GROUP_COLUMNS}&limit=1`);
  const group = rows?.[0];
  if (!group) return null;
  // Canonical is the designation path regardless of entity_id: a matriline
  // that gains an identifier ahead of the rest must not start redirecting
  // before the family switches over together.
  return { canonical: canonicalProfilePath('matrilines', null, group.designation), tags: matrilinePreviewTags(group) };
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
    'og:url': `https://salishsea.io${canonicalProfilePath('ecotypes', group.entity_id, designation)}`,
    'og:title': label,
    'og:description': description,
    ...BRAND_CARD_TAGS,
    'fb:app_id': FB_APP_ID,
  };
}

async function resolveEcotype(key: ProfileKey): Promise<Resolved | null> {
  const filter = key.kind === 'entity'
    ? `entity_id=eq.${encodeURIComponent(key.entityId)}`
    : `designation=ilike.${encodeURIComponent(ilikeLiteral(key.code))}`;
  const rows = await readRows<SocialGroup>('ecotype',
    `social_groups?${filter}&kind=eq.ecotype&select=${GROUP_COLUMNS}&limit=1`);
  const group = rows?.[0];
  if (!group) return null;
  return { canonical: canonicalProfilePath('ecotypes', group.entity_id, group.designation), tags: ecotypePreviewTags(group) };
}

// Profile pages rendered client-side from a static shell (decision 015/016/017):
// humans get the shell rewrite, bots get synthesized OG meta. S3 has no object
// at these paths, so even the fail-open branch must rewrite to the shell.
interface Haulout {
  id: number;
  name: string;
  region: string | null;
  atlas_species: string[] | null;
}

const ATLAS_SPECIES: Record<string, string> = {
  PV: 'harbor seal',
  ZC: 'California sea lion',
  EJ: 'Steller sea lion',
  MA: 'northern elephant seal',
};

function hauloutPreviewTags(site: Haulout): OgTags {
  const species = (site.atlas_species ?? []).map(c => ATLAS_SPECIES[c] ?? c);
  const title = `${site.name} haul-out`;
  const description = `${species.length ? `${species.join(', ').replace(/^./, c => c.toUpperCase())} haul-out site` : 'Pinniped haul-out site'}${site.region ? ` in the ${site.region}` : ''}: what the 1999 WDFW atlas recorded, and what people report there now.`;
  return {
    'og:site_name': 'SalishSea.io',
    'og:type': 'place',
    'og:url': `https://salishsea.io${canonicalProfilePath('haulouts', String(site.id), site.name)}`,
    'og:title': title,
    'og:description': description,
    ...BRAND_CARD_TAGS,
    'fb:app_id': FB_APP_ID,
  };
}

// A site by its own id; there is no designation to fall back on.
async function resolveHaulout(key: ProfileKey): Promise<Resolved | null> {
  if (key.kind !== 'entity') return null;
  const rows = await readRows<Haulout>('haulout',
    `haulouts?id=eq.${encodeURIComponent(key.entityId)}&select=id,name,region,atlas_species&limit=1`);
  const site = rows?.[0];
  if (!site) return null;
  return { canonical: canonicalProfilePath('haulouts', String(site.id), site.name), tags: hauloutPreviewTags(site) };
}

const PROFILE_FAMILIES: ProfileFamily[] = [
  { prefix: 'individuals', shell: '/individual.html', kind: 'individual', entityKey: registerKey, resolve: resolveIndividual },
  { prefix: 'matrilines', shell: '/matriline.html', kind: 'matriline', resolve: resolveMatriline },
  { prefix: 'ecotypes', shell: '/ecotype.html', kind: 'ecotype', entityKey: registerKey, resolve: resolveEcotype },
  { prefix: 'haulouts', shell: '/haulout.html', kind: 'haulout', entityKey: hauloutKey, resolve: resolveHaulout },
];

interface ProfileRoute {
  family: ProfileFamily;
  key: ProfileKey;
}

// A percent-encoded path segment as text; a malformed escape is taken as typed.
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

// /<family>/<segment>[/<segment>][/]. Two segments name an identifier and its
// slug; a designation stands alone, so /individuals/T065A/photos is not a
// profile path and passes through untouched, as it always has.
function matchProfileRoute(uri: string): ProfileRoute | null {
  for (const family of PROFILE_FAMILIES) {
    const match = uri.match(new RegExp(`^/${family.prefix}/([^/]+)(?:/([^/]*))?/?$`));
    if (!match) continue;
    const first = decodeSegment(match[1]!);
    // A trailing slash leaves an empty second segment; it means nothing.
    const second = match[2] ? decodeSegment(match[2]) : null;
    const entityId = family.entityKey?.(first) ?? null;
    if (entityId) {
      return { family, key: { kind: 'entity', entityId, slug: second } };
    }
    if (!second) {
      return { family, key: { kind: 'designation', code: first } };
    }
    return null;
  }
  return null;
}

// The browser caches a 301 for as long as we say; a day bounds how long a
// mistaken mapping would survive a fix. (CloudFront does not cache responses a
// viewer-request function generates, so this header is for the client alone.)
function redirectResponse(location: string) {
  return {
    status: '301',
    statusDescription: 'Moved Permanently',
    headers: {
      location: [{ key: 'Location', value: location }],
      'cache-control': [{ key: 'Cache-Control', value: 'public, max-age=86400' }],
    },
  };
}

// Everything a profile path can get back.
//
//   human, canonical shape     → the page shell, no lookup (034: "costs no lookup")
//   human, designation or bare → one lookup, 301 to the canonical address
//   crawler, any shape         → one lookup; 301 unless already canonical, else OG meta
//   unknown subject            → shell for a human (the page says "not in our
//                                catalog"), the site card for a crawler
//   lookup failed or timed out → the shell, always (decision 015's fail-open):
//                                the page canonicalises client-side instead
//
// A human on a canonical-looking path with a stale slug also gets the shell:
// telling a stale slug from a current one costs the lookup this branch exists
// to avoid, and the page fixes the address with replaceState.
async function profileResponse(request: any, route: ProfileRoute, bot: boolean): Promise<any> {
  const { family, key } = route;
  const nonCanonical = !!family.entityKey && (key.kind === 'designation' || key.slug === null);
  if (!bot && !nonCanonical) {
    request.uri = family.shell;
    return request;
  }
  try {
    const resolved = await family.resolve(key);
    if (!resolved) {
      console.log(JSON.stringify({ msg: 'og-unknown', kind: family.kind, key }));
      if (bot) return htmlResponse(genericPreviewTags());
      request.uri = family.shell;
      return request;
    }
    if (resolved.canonical !== request.uri) {
      return redirectResponse(resolved.canonical);
    }
    if (!bot) {
      request.uri = family.shell;
      return request;
    }
    return htmlResponse(resolved.tags);
  } catch (err) {
    console.error(JSON.stringify({ msg: 'og-fail-open', uri: request.uri, error: String(err) }));
    request.uri = family.shell;
    return request;
  }
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
  // Same rationale for static image assets: whenever a card points at an image on
  // our own origin, the very same crawlers (facebookexternalhit, twitterbot, …)
  // fetch that URL with their bot UA to render it. Without this carve-out the
  // handler answers the image request with OG-meta HTML — an HTML body served as
  // the image — and the preview breaks (it did, with the old /preview.jpg fallback).
  // Any path with an image extension must pass through to origin as raw bytes.
  if (
    request.uri.startsWith('/dwca/') ||
    request.uri === '/sitemap.xml' ||
    request.uri === '/robots.txt' ||
    STATIC_ASSET_RE.test(request.uri)
  ) {
    return request;
  }

  const ua = request.headers['user-agent']?.[0]?.value ?? '';
  const bot = isBot(ua);

  // Profile paths have their own contract (shell rewrite, redirect, OG meta,
  // fail-open to the shell) — see profileResponse.
  const route = matchProfileRoute(request.uri);
  if (route) {
    return profileResponse(request, route, bot);
  }

  if (!bot) {
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
    const apiUrl = `${url}/rest/v1/occurrences?id=eq.${encodeURIComponent(occurrenceId)}&select=id,taxon,observed_at,count,photos,location&limit=1`;
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
    const title = `${species} · ${date}`;

    // Description: "{count} {species}s · {time}" — e.g. "3 Orcas · 2:32 PM"
    const time = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: PACIFIC,
    }).format(observedAt);
    const count = occ.count ?? 1;
    const description = `${count} ${species}s · ${time}`;

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
