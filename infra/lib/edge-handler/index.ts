import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const BOT_UA_PATTERNS = [
  'facebookexternalhit',
  'twitterbot',
  'discordbot',
  'bsky',
  'linkedinbot',
  'slackbot',
  'whatsapp',
  'telegrambot',
];

function isBot(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return BOT_UA_PATTERNS.some(p => ua.includes(p));
}

interface Credentials {
  supabaseUrl: string;
  supabaseKey: string;
}

let cachedCredentials: Credentials | null = null;

export function _clearCredentialCache(): void {
  cachedCredentials = null;
}

async function getCredentials(): Promise<Credentials> {
  if (cachedCredentials) return cachedCredentials;
  const ssm = new SSMClient({ region: 'us-east-1' });
  const urlResult = await ssm.send(new GetParameterCommand({ Name: '/salishsea/supabase-url' }));
  const keyResult = await ssm.send(new GetParameterCommand({ Name: '/salishsea/supabase-key' }));
  cachedCredentials = {
    supabaseUrl: urlResult.Parameter!.Value!,
    supabaseKey: keyResult.Parameter!.Value!,
  };
  return cachedCredentials;
}

const OPEN_LICENSES = new Set(['cc0', 'cc-by', 'cc-by-sa']);
const FALLBACK_IMAGE = 'https://salishsea.io/preview.jpg';

interface Photo {
  src: string;
  license: string | null;
}

interface Occurrence {
  id: string;
  taxon: { vernacular_name: string };
  observed_at: string;
  count: number;
  photos: Photo[];
}

function getOpenPhoto(photos: Photo[]): string | null {
  const photo = photos.find(p => p.license && OPEN_LICENSES.has(p.license.toLowerCase()));
  return photo?.src ?? null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function genericOgHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta property="og:title" content="SalishSea.io" /></head>
<body></body>
</html>`;
}

function occurrenceOgHtml(occurrence: Occurrence): string {
  const taxon = occurrence.taxon.vernacular_name;
  const title = `${taxon} · ${formatDate(occurrence.observed_at)}`;
  const description = `${occurrence.count} ${taxon}`;
  const imageUrl = getOpenPhoto(occurrence.photos) ?? FALLBACK_IMAGE;
  return `<!DOCTYPE html>
<html><head>
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:image" content="${imageUrl}" />
</head><body></body>
</html>`;
}

export async function handler(event: any): Promise<any> {
  const record = event.Records[0].cf;
  const request = record.request;
  const userAgent = request.headers['user-agent']?.[0]?.value ?? '';

  if (!isBot(userAgent)) {
    return request;
  }

  try {
    const { supabaseUrl, supabaseKey } = await getCredentials();
    const qs: string = request.querystring ?? '';
    const occurrenceId = new URLSearchParams(qs).get('o');

    let html: string;

    if (occurrenceId) {
      const url = `${supabaseUrl}/rest/v1/occurrences?id=eq.${occurrenceId}&select=id,taxon(vernacular_name),observed_at,count,photos(src,license)`;
      const response = await fetch(url, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      });
      const occurrences: Occurrence[] = await response.json();
      html = occurrences.length > 0 ? occurrenceOgHtml(occurrences[0]) : genericOgHtml();
    } else {
      html = genericOgHtml();
    }

    return {
      status: '200',
      statusDescription: 'OK',
      headers: {
        'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }],
      },
      body: html,
    };
  } catch {
    return request;
  }
}
