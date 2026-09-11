import { test, expect } from '@playwright/test';

// Wait for the edge handler this deploy shipped before asserting on what it says.
//
// Smoke runs the moment `cdk deploy` returns, but a new Lambda@Edge version takes
// minutes to replicate, and the first request a cold container answers can blow
// its 3s Supabase deadline and take decision 015's fail-open path (the bare shell,
// no per-thing OG tags). Neither is a regression; both read as one to an
// assertion that fires too early. On 2026-08-31 that failed the smoke of a deploy
// that had not touched the handler at all and filed a spurious deploy-failed issue
// (bd salish-eia).
//
// So the wait is separate from the assertions: probe one OG route until it
// answers with profile tags, then run every test exactly as strict as before. A
// genuine regression still fails — after the bounded wait, with the assertion's
// own message rather than a timeout. On the scheduled run, the probe passes on
// its first request and costs nothing.
const READY_TIMEOUT_MS = 5 * 60_000;
const READY_INTERVAL_MS = 10_000;
const BOT_UA = { 'User-Agent': 'facebookexternalhit/1.1' };

const PROBE_TIMEOUT_MS = 15_000;

// Decision 034: a profile URL keys on the register identifier's seven-digit
// local part, with the designation as a slug that is never read. T065A is
// SSA:0010193; the Bigg's ecotype is SSA:0000002; T046A was renamed T122
// (SSA:0010368) and is the code that died under the old scheme.
const CANONICAL_T065A = '/individuals/0010193/T065A';
const CANONICAL_BIGGS = '/ecotypes/0000002/Biggs';
const HUMAN_UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };

test.beforeAll(async ({ playwright }) => {
  // The hook's own budget: every probe plus the sleep after it fits inside
  // READY_TIMEOUT_MS by construction below, and this is the margin on top.
  test.setTimeout(READY_TIMEOUT_MS + 60_000);
  const api = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  const started = Date.now();
  try {
    for (let attempt = 1; ; attempt++) {
      // A probe that fails in transport is a probe that didn't answer, not a
      // verdict — a replicating edge can drop a connection. Keep going; the
      // tests below say what they think of production once the wait is over.
      let ready = false;
      try {
        // The canonical, two-segment path: a handler from before decision 034
        // does not recognise it and answers with the site card, so profile tags
        // here mean the deploy under test is the one answering.
        const response = await api.get(CANONICAL_T065A, { headers: BOT_UA, timeout: PROBE_TIMEOUT_MS });
        ready = response.status() === 200 && (await response.text()).includes('content="profile"');
      } catch (err) {
        console.warn(`probe ${attempt} failed: ${String(err)}`);
      }
      if (ready) {
        if (attempt > 1) console.log(`edge handler ready after ${attempt} probes, ${Date.now() - started}ms`);
        return;
      }
      // Stop while there is still room for one more sleep and one more probe;
      // a probe started at the deadline would overrun the hook instead.
      const remaining = READY_TIMEOUT_MS - (Date.now() - started);
      if (remaining < READY_INTERVAL_MS + PROBE_TIMEOUT_MS) {
        console.warn(`edge handler still serving the shell after ${attempt} probes, ${Date.now() - started}ms; asserting anyway`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, READY_INTERVAL_MS));
    }
  } finally {
    await api.dispose();
  }
});

test('bot UA on homepage receives OG meta tags', async ({ request }) => {
  const response = await request.get('/', {
    headers: { 'User-Agent': 'facebookexternalhit/1.1' },
  });

  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('og:title');
  expect(body).toContain('SalishSea.io');
  expect(body).toContain('og:type');
  // The homepage has no image of a thing shared, so it carries the brand card
  // (decision 026, superseding 019) — identity-shaped, true of every link.
  expect(body).toContain('og:description');
  expect(body).toContain('<meta property="og:image" content="https://salishsea.io/social-card.jpg">');
  expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
});

// The card only counts if the crawler that follows og:image gets bytes back.
// A brand card intercepted into OG HTML is the 019-era broken-preview bug.
test('the brand card serves image bytes to the crawler that reads og:image', async ({ request }) => {
  const response = await request.get('/social-card.jpg', {
    headers: { 'User-Agent': 'facebookexternalhit/1.1' },
  });

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('image/jpeg');
  // Above Facebook's 200x200 floor in every sense — the real 1200x630 card.
  expect((await response.body()).byteLength).toBeGreaterThan(20_000);
});

test('bot UA on a dated link receives a day card', async ({ request }) => {
  const response = await request.get('/?d=2026-07-26', {
    headers: { 'User-Agent': 'facebookexternalhit/1.1' },
  });

  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('https://salishsea.io/cards/day/2026-07-26.jpg');
  expect(body).toContain('July 26, 2026');
});

// A fixed past date rather than an occurrence id: the card must exist forever,
// and a day card renders whether or not anything was seen that day.
test('card images serve bytes, not OG HTML, to the crawler that reads og:image', async ({ request }) => {
  const response = await request.get('/cards/day/2026-07-26.jpg', {
    headers: { 'User-Agent': 'facebookexternalhit/1.1' },
  });

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('image/jpeg');
  // Above Facebook's 200x200 floor in every sense — a real rendered map.
  expect((await response.body()).byteLength).toBeGreaterThan(20_000);
});

test('regular browser UA on homepage receives SPA', async ({ request }) => {
  const response = await request.get('/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });

  expect(response.status()).toBe(200);
  const body = await response.text();
  // Regular browsers get the real SPA shell (with the <salish-sea> root element),
  // not the synthesized, empty-body bot preview page.
  expect(body).toContain('<salish-sea>');
});

test('bot UA on an individual page receives profile OG meta tags with the canonical og:url', async ({ request }) => {
  const response = await request.get(CANONICAL_T065A, { headers: BOT_UA });

  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('T065A');
  expect(body).toContain('og:title');
  expect(body).toContain('content="profile"');
  expect(body).toContain(`content="https://salishsea.io${CANONICAL_T065A}"`);
  // A profile has no image of its own, so it carries the brand card. Asserted
  // per route: the shared fallback is easy to restore to text-only for one
  // path without noticing (decision 026).
  expect(body).toContain('<meta property="og:image" content="https://salishsea.io/social-card.jpg">');
  expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
});

test('regular browser UA on an individual page receives the page shell', async ({ request }) => {
  const response = await request.get(CANONICAL_T065A, { headers: HUMAN_UA });

  expect(response.status()).toBe(200);
  const body = await response.text();
  // The viewer-request function rewrites /individuals/* to the individual.html
  // shell (there is no S3 object at the path itself).
  expect(body).toContain('<individual-page>');
});

// Every link ever shared has this shape, and so does every URL a person types.
// The 301 is asserted for both audiences: a scheme that redirected crawlers but
// served humans the old path would pass the tests above while half-migrated.
for (const [who, headers] of [['a crawler', BOT_UA], ['a browser', HUMAN_UA]] as const) {
  test(`a designation path 301s ${who} to the identifier-keyed address`, async ({ request }) => {
    const response = await request.get('/individuals/T065A', { headers, maxRedirects: 0 });
    expect(response.status()).toBe(301);
    expect(response.headers()['location']).toBe(CANONICAL_T065A);
  });
}

// The headline of decision 034: T046A was renamed T122 and had been dead as a
// URL, because the old handler matched on primary_designation alone.
test('a superseded code 301s to the individual that now carries it', async ({ request }) => {
  const response = await request.get('/individuals/T046A', { headers: HUMAN_UA, maxRedirects: 0 });
  expect(response.status()).toBe(301);
  expect(response.headers()['location']).toBe('/individuals/0010368/T122');
});

test('a bare identifier 301s to the slugged canonical address', async ({ request }) => {
  const response = await request.get('/individuals/0010193', { headers: HUMAN_UA, maxRedirects: 0 });
  expect(response.status()).toBe(301);
  expect(response.headers()['location']).toBe(CANONICAL_T065A);
});

test('bot UA on a matriline page receives profile OG meta tags', async ({ request }) => {
  const response = await request.get('/matrilines/T065A', {
    headers: { 'User-Agent': 'facebookexternalhit/1.1' },
  });

  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('T065A');
  expect(body).toContain('og:title');
  expect(body).toContain('content="profile"');
  expect(body).toContain('https://salishsea.io/matrilines/T065A');
  // A profile has no image of its own, so it carries the brand card. Asserted
  // per route: the shared fallback is easy to restore to text-only for one
  // path without noticing (decision 026).
  expect(body).toContain('<meta property="og:image" content="https://salishsea.io/social-card.jpg">');
  expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
});

test('regular browser UA on a matriline page receives the page shell', async ({ request }) => {
  const response = await request.get('/matrilines/T065A', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });

  expect(response.status()).toBe(200);
  const body = await response.text();
  // The viewer-request function rewrites /matrilines/* to the matriline.html
  // shell (there is no S3 object at the path itself).
  expect(body).toContain('<matriline-page>');
});

test('bot UA on an ecotype page receives profile OG meta tags with the canonical og:url', async ({ request }) => {
  const response = await request.get(CANONICAL_BIGGS, { headers: BOT_UA });

  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('og:title');
  expect(body).toContain('content="profile"');
  expect(body).toContain(`content="https://salishsea.io${CANONICAL_BIGGS}"`);
  // A profile has no image of its own, so it carries the brand card. Asserted
  // per route: the shared fallback is easy to restore to text-only for one
  // path without noticing (decision 026).
  expect(body).toContain('<meta property="og:image" content="https://salishsea.io/social-card.jpg">');
  expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
});

test('regular browser UA on an ecotype page receives the page shell', async ({ request }) => {
  const response = await request.get(CANONICAL_BIGGS, { headers: HUMAN_UA });

  expect(response.status()).toBe(200);
  const body = await response.text();
  // The viewer-request function rewrites /ecotypes/* to the ecotype.html
  // shell (there is no S3 object at the path itself).
  expect(body).toContain('<ecotype-page>');
});

test('the ecotype designation path 301s to the identifier-keyed address', async ({ request }) => {
  const response = await request.get('/ecotypes/Biggs', { headers: HUMAN_UA, maxRedirects: 0 });
  expect(response.status()).toBe(301);
  expect(response.headers()['location']).toBe(CANONICAL_BIGGS);
});

// Matrilines are not keyed yet (034, "Sequencing"; salish-ox2.6): the
// designation path is canonical and must keep answering directly, not redirect.
test('a matriline designation path still answers directly', async ({ request }) => {
  const response = await request.get('/matrilines/T065A', { headers: HUMAN_UA, maxRedirects: 0 });
  expect(response.status()).toBe(200);
});
