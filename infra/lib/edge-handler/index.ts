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
  const [urlParam, keyParam] = await Promise.all([
    ssm.send(new GetParameterCommand({ Name: '/salishsea/supabase-url' })),
    ssm.send(new GetParameterCommand({ Name: '/salishsea/supabase-anon-key', WithDecryption: true })),
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
  return `<!DOCTYPE html><html><head>\n${metaTags}\n</head><body></body></html>`;
}

function genericPreviewTags(): OgTags {
  return {
    'og:site_name': 'SalishSea.io',
    'og:type': 'website',
    'og:url': 'https://salishsea.io/',
    'og:title': 'SalishSea.io',
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

// Only cc0 and cc-by are unambiguously open for re-use
const OPEN_LICENSES = ['cc0', 'cc-by'];
const FALLBACK_IMAGE = 'https://salishsea.io/preview.jpg';

export const handler = async (event: any): Promise<any> => {
  const request = event.Records[0].cf.request;
  const ua = request.headers['user-agent']?.[0]?.value ?? '';

  if (!isBot(ua)) {
    return request;
  }

  try {
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
    const date = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      .format(new Date(occ.observed_at));
    const title = `${species} · ${date}`;

    // Description: "{count} {species}s · {time}" — e.g. "3 Orcas · 2:32 PM"
    const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
      .format(new Date(occ.observed_at));
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
    };

    return {
      status: '200',
      headers: { 'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }] },
      body: buildOgHtml(tags),
    };
  } catch {
    // Fail-open: return the original request so CloudFront serves index.html normally
    return request;
  }
};
