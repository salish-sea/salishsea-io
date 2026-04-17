# Phase 2: Rich Previews - Research

**Researched:** 2026-03-04
**Domain:** AWS Lambda@Edge, Open Graph / Twitter Card meta tags, CDK infrastructure, Supabase REST API
**Confidence:** HIGH

## Summary

This phase adds dynamic Open Graph meta tag injection so that links shared in RCS (Android Messages), Facebook, and Bluesky show rich preview cards. Because the app is a JavaScript SPA, social media crawlers never execute JavaScript — they see only the bare `index.html` shell. The solution is a Lambda@Edge function on the existing CloudFront distribution that intercepts requests from known crawler user-agents, fetches occurrence data from Supabase via direct REST API call, and returns a minimal HTML document with OG tags injected. Regular users pass through unmodified.

CloudFront Functions cannot make network calls (they are synchronous ES5.1 only with no network access), so Lambda@Edge is the only viable option when you need to fetch occurrence data from Supabase. Lambda@Edge does not support environment variables; the Supabase URL and anon key must be stored in AWS Secrets Manager or SSM Parameter Store and fetched at cold-start time (cached in the Lambda module scope for subsequent invocations). The Supabase `anon` key is safe to use from Lambda@Edge because it only exposes what RLS permits.

The CDK stack at `infra/lib/infra-stack.ts` is currently an empty skeleton. Phase 2 fills it in by importing or reconstructing the existing CloudFront distribution and attaching a `cloudfront.experimental.EdgeFunction` as a `VIEWER_REQUEST` trigger. Lambda@Edge functions must be deployed to `us-east-1` regardless of the stack's home region (the infra stack is currently configured for `us-west-2`), which requires the `us-east-1` region to be CDK-bootstrapped.

**Primary recommendation:** Use Lambda@Edge (`VIEWER_REQUEST`) with bot-detection to inject OG tags only for crawler requests. Fetch occurrence data from Supabase REST API directly (no client library) using credentials retrieved from SSM Parameter Store on cold start.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Preview title (occurrence-specific)**
- Format: `{vernacular_name} · {date}` — e.g. "Orca · June 3, 2025"
- No location in the title
- If a place name becomes available in future (reverse geocode), title can be extended to `{species} · {date} · {place}`

**Preview description (occurrence-specific)**
- Format: `{count} {vernacular_name}s · {time}` — e.g. "3 Biggs orcas · 2:32 PM"
- Include time of sighting when available
- No location text anywhere in the preview

**Preview image (occurrence-specific)**
- Use first photo from the occurrence **only if `license` is non-null** (cc0 or cc-by)
- Fall back to a static branded image stored in S3 if no licensed photo exists
- Dynamic map rendering (Mapbox Static API) deferred to a later phase

**Generic preview (homepage and non-occurrence URLs)**
- Title: `SalishSea.io`
- Description: none
- Image: none (omit og:image)

**Branding**
- Use `og:site_name` = `SalishSea.io` — some platforms show this alongside the title

### Claude's Discretion
- Choice of Lambda@Edge vs CloudFront Functions (research resolves this: Lambda@Edge is required for async Supabase fetch)
- Exact CDK construct definitions for the edge function
- How to handle occurrence lookup failures (graceful fallback to generic preview)
- Twitter Card type (`summary` vs `summary_large_image`)
- Exact static image asset design/naming

### Deferred Ideas (OUT OF SCOPE)
- Dynamic map image as fallback — render Mapbox Static Maps API tile centered on occurrence location; deferred to a later phase
- Reverse geocode place name for title — would need geocoding API; deferred
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PREV-01 | A link to the app shared in RCS, Facebook, or Bluesky shows a rich preview (title, description, image) | Open Graph tags + Lambda@Edge injection covers all three platforms. RCS uses og:title/og:image. Facebook uses og:*. Bluesky uses og:* tags. |
| PREV-02 | Rich preview for an occurrence-specific link includes species, date, and location context | Occurrence query returns taxon.vernacular_name, observed_at, photos[0].src + license from Supabase `occurrences` view. Bot-specific HTML includes these in og:title and og:description. Per locked decisions, no location text — "location context" satisfied by species/date per CONTEXT.md decisions. |
| PREV-03 | Rich preview infrastructure works with the existing static S3/CloudFront deployment | Lambda@Edge attaches to the existing CloudFront distribution as a VIEWER_REQUEST trigger. No separate server required. S3 hosts the static branded fallback image. |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| aws-cdk-lib | 2.215.0 (already in infra/package.json) | CDK constructs for EdgeFunction, Distribution | Already in project; EdgeFunction construct is the official CDK way to create Lambda@Edge |
| constructs | ^10.0.0 (already in infra/package.json) | CDK construct tree | Peer dep of aws-cdk-lib |
| Node.js Lambda runtime | NODEJS_22_X | Lambda@Edge execution environment | Latest supported Node.js LTS on Lambda@Edge as of 2026 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @aws-sdk/client-ssm | v3 (install in edge function bundle) | Fetch Supabase credentials from SSM at cold start | Required because Lambda@Edge has no env var support; SSM is standard AWS secrets approach |
| native fetch | Node.js 18+ built-in | Query Supabase REST API from edge function | No client library needed; direct REST fetch is lightweight and avoids large bundle |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Lambda@Edge | CloudFront Functions | CloudFront Functions cannot make network calls — confirmed by AWS docs. Not viable for Supabase fetch. |
| Lambda@Edge | Prerender.io / third-party prerender service | Adds external dependency and cost; Lambda@Edge keeps everything in-stack per PREV-03 |
| SSM Parameter Store | Secrets Manager | Both work; SSM Parameter Store is simpler and cheaper for non-rotated values like a Supabase anon key |
| SSM Parameter Store | Hardcoded in CDK (as CloudFront custom header) | Custom origin headers work only for origin-request events, not viewer-request. Viewer-request is required here to avoid fetching index.html from S3 on every bot hit. |

**Installation (inside infra/ for CDK):**
```bash
cd infra && npm install @aws-sdk/client-ssm
```

**Lambda@Edge function bundle dependencies (bundled via esbuild through NodejsFunction or manually):**
```bash
# The edge function itself needs @aws-sdk/client-ssm bundled
# native fetch is built-in to Node.js 18+, no install needed
```

---

## Architecture Patterns

### Recommended Project Structure
```
infra/
├── lib/
│   ├── infra-stack.ts          # CDK stack — CloudFront + Lambda@Edge constructs
│   └── edge-handler/
│       └── index.ts            # Lambda@Edge handler (viewer-request)
├── bin/infra.ts                # CDK app entrypoint (already exists)
└── test/infra.test.ts          # CDK snapshot/assertion tests

src/assets/
└── preview.jpg                 # Static branded fallback OG image (1200x630px)
```

### Pattern 1: Lambda@Edge Viewer-Request with Bot Detection

**What:** Lambda@Edge intercepts every CloudFront request. For non-bot requests, it passes through unmodified. For bot user-agents, it fetches occurrence data and returns a custom HTML response with OG tags.

**When to use:** Required for any SPA that must serve dynamic meta tags to crawlers without SSR.

**Example (CDK construct):**
```typescript
// Source: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront.experimental.EdgeFunction.html
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

// CRITICAL: EdgeFunction is deployed to us-east-1 regardless of stack region
const ogFunction = new cloudfront.experimental.EdgeFunction(this, 'OgMetaFunction', {
  runtime: lambda.Runtime.NODEJS_22_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset(path.join(__dirname, 'edge-handler')),
  // NOTE: environment property is NOT supported on EdgeFunction — omit it
});

// Attach to existing CloudFront distribution default behavior
// If reconstructing the distribution in CDK:
const distribution = new cloudfront.Distribution(this, 'SalishSeaDist', {
  defaultBehavior: {
    origin: s3Origin,
    edgeLambdas: [
      {
        functionVersion: ogFunction.currentVersion,  // Must use .currentVersion, not $LATEST
        eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
      },
    ],
  },
});
```

**Example (Lambda@Edge handler skeleton):**
```typescript
// infra/lib/edge-handler/index.ts
// Source: pattern from https://makimo.com/blog/open-graph-tags-with-aws-cloudfront-lambdaedge/

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

// Cache credentials across warm invocations
let supabaseUrl: string | undefined;
let supabaseKey: string | undefined;

const BOT_AGENTS = [
  'facebookexternalhit',
  'twitterbot',
  'linkedinbot',
  'slackbot',
  'discordbot',
  'whatsapp',
  'telegrambot',
  'baiduspider',
  'bsky',               // Bluesky crawler
  'google-snippet',
];

function isBot(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return BOT_AGENTS.some(bot => ua.includes(bot));
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildOgHtml(tags: Record<string, string>): string {
  const metaTags = Object.entries(tags)
    .map(([prop, content]) => `  <meta property="${prop}" content="${escapeHtml(content)}">`)
    .join('\n');
  return `<!DOCTYPE html><html><head>\n${metaTags}\n</head><body></body></html>`;
}

export const handler = async (event: any) => {
  const request = event.Records[0].cf.request;
  const ua = request.headers['user-agent']?.[0]?.value ?? '';

  if (!isBot(ua)) {
    return request; // Pass through for regular users
  }

  try {
    // Parse ?o=<id> from query string
    const qs = new URLSearchParams(request.querystring ?? '');
    const occurrenceId = qs.get('o');

    if (!occurrenceId) {
      // Generic preview for non-occurrence URLs
      return { status: '200', body: buildOgHtml({
        'og:site_name': 'SalishSea.io',
        'og:title': 'SalishSea.io',
        'og:type': 'website',
        'og:url': `https://salishsea.io/`,
      })};
    }

    const { url, key } = await getCredentials();
    const apiUrl = `${url}/rest/v1/occurrences?id=eq.${encodeURIComponent(occurrenceId)}&select=id,taxon,observed_at,count,photos&limit=1`;
    const res = await fetch(apiUrl, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
    });

    const [occ] = await res.json() as any[];

    if (!occ) {
      // Occurrence not found — graceful fallback to generic
      return { status: '200', body: buildOgHtml({ 'og:title': 'SalishSea.io', 'og:type': 'website' })};
    }

    // Build title: "{vernacular_name} · {date}"
    const species = occ.taxon?.vernacular_name ?? 'Whale sighting';
    const date = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      .format(new Date(occ.observed_at));
    const title = `${species} · ${date}`;

    // Build description: "{count} {vernacular_name}s · {time}"
    const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
      .format(new Date(occ.observed_at));
    const count = occ.count ?? 1;
    const description = `${count} ${species}s · ${time}`;

    // Image: first photo with cc0 or cc-by license only
    const OPEN_LICENSES = ['cc0', 'cc-by'];
    const photo = (occ.photos ?? []).find((p: any) => OPEN_LICENSES.includes(p.license));
    const imageUrl = photo?.src ?? 'https://salishsea.io/preview.jpg'; // S3 CDN URL for branded fallback

    const tags: Record<string, string> = {
      'og:site_name': 'SalishSea.io',
      'og:type': 'website',
      'og:url': `https://salishsea.io/?o=${occurrenceId}`,
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
    return request; // Fail open — let CloudFront serve index.html normally
  }
};
```

### Pattern 2: Supabase REST API Query (No Client Library)

**What:** Direct fetch to PostgREST endpoint. Lightweight, no bundle overhead from `@supabase/supabase-js`.

**When to use:** Lambda@Edge functions have a 1MB compressed code size limit for viewer-request functions. The Supabase JS client and its transitive deps would be large; direct fetch avoids the overhead.

**Example:**
```typescript
// Source: https://supabase.com/docs/guides/api
const url = `${supabaseUrl}/rest/v1/occurrences?id=eq.${occurrenceId}&select=id,taxon,observed_at,count,photos&limit=1`;
const res = await fetch(url, {
  headers: {
    'apikey': supabaseAnonKey,
    'Authorization': `Bearer ${supabaseAnonKey}`,
  },
});
const [row] = await res.json();
```

Supabase REST URL pattern: `{project_url}/rest/v1/{view_or_table}?{filter}&select={columns}`

### Pattern 3: SSM Parameter Store for Credentials

**What:** Store Supabase URL and anon key in SSM Parameter Store. Lambda@Edge fetches them at cold start and caches in module scope.

**Why:** Lambda@Edge does not support environment variables at all. SSM is the standard pattern.

**CDK to provision parameters:**
```typescript
import * as ssm from 'aws-cdk-lib/aws-ssm';

new ssm.StringParameter(this, 'SupabaseUrl', {
  parameterName: '/salishsea/supabase-url',
  stringValue: 'https://grztmjpzamcxlzecmqca.supabase.co',
});

new ssm.StringParameter(this, 'SupabaseAnonKey', {
  parameterName: '/salishsea/supabase-anon-key',
  // NOTE: Use SecretValue / SecureString for the actual key
  stringValue: process.env.SUPABASE_ANON_KEY!,
  tier: ssm.ParameterTier.STANDARD,
});
```

**IAM grant to edge function:**
```typescript
const ssmPolicy = new iam.PolicyStatement({
  actions: ['ssm:GetParameter'],
  resources: [`arn:aws:ssm:us-east-1:*:parameter/salishsea/*`],
});
ogFunction.addToRolePolicy(ssmPolicy);
```

### Anti-Patterns to Avoid

- **Using CloudFront Functions instead of Lambda@Edge:** CloudFront Functions are ECMAScript 5.1 synchronous-only with no network access. Cannot call Supabase. Confirmed by AWS official docs.
- **Using `$LATEST` Lambda version:** CloudFront requires a numbered version. Always use `fn.currentVersion`. Using `$LATEST` causes deployment failure.
- **Putting secrets in CloudFront custom headers for viewer-request:** Custom headers appear on origin requests, not viewer requests. Viewer-request sees only the raw CloudFront request from the client.
- **Using the Supabase JS client library in the edge bundle:** The full `@supabase/supabase-js` package is large. Lambda@Edge viewer-request functions have a 1MB compressed code size limit. Use native fetch instead.
- **Returning the OG HTML to all users:** Bot detection is critical. Regular users must receive the normal SPA `index.html` — otherwise the app breaks for everyone.
- **Not HTML-escaping dynamic content in meta tags:** Species names or descriptions containing `"` or `<` will break the generated HTML. Always escape before interpolating into attribute values.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSM credential retrieval | Manual HTTPS calls to SSM endpoint | `@aws-sdk/client-ssm` | SDK handles signing, retry, regional endpoints |
| Bot user-agent list | Custom regex from scratch | Known list (facebookexternalhit, twitterbot, bsky, etc.) | Bots have stable, documented UA strings |
| HTML escaping | Custom regex replace | Simple 4-char escape function (see Pattern 1) | Only need to escape `& " < >` in attribute values |
| Date/time formatting | Manual string manipulation | `Intl.DateTimeFormat` (built into Node.js) | Handles localization, no extra package needed |

**Key insight:** Lambda@Edge at the viewer-request level is fundamentally simple: detect, fetch, inject, return. Don't over-engineer it with caching layers, complex routing, or full framework — this is a targeted HTML generator for 4-5 meta tags.

---

## Common Pitfalls

### Pitfall 1: Lambda@Edge us-east-1 Requirement

**What goes wrong:** `EdgeFunction` construct automatically creates the Lambda in `us-east-1` even if your CDK stack targets `us-west-2`. This requires `us-east-1` to be CDK-bootstrapped separately.

**Why it happens:** CloudFront is a global service; Lambda@Edge functions must be in `us-east-1` (AWS requirement, not CDK quirk).

**How to avoid:** Run `cdk bootstrap aws://648183724555/us-east-1` before first deployment. The CDK docs confirm this requirement.

**Warning signs:** CDK synth error mentioning cross-region or bootstrap.

### Pitfall 2: No Environment Variables on Lambda@Edge

**What goes wrong:** You attempt to set `environment: { SUPABASE_URL: '...' }` on the EdgeFunction — CDK silently ignores or errors on this.

**Why it happens:** Lambda@Edge is a service-linked Lambda; environment variables are blocked by AWS (Lambda@Edge limitations page confirms this).

**How to avoid:** Use SSM Parameter Store (fetched at cold start, cached in module scope). Grant the function SSM read permission via IAM.

**Warning signs:** Runtime errors if credentials are undefined; TypeScript error if you try to pass `environment` to `EdgeFunction` props.

### Pitfall 3: Viewer-Request 1MB Code Size Limit

**What goes wrong:** Bundling `@supabase/supabase-js` or other large libraries causes the deployment to fail with a code size error.

**Why it happens:** Lambda@Edge viewer-request functions have a 1MB compressed code size limit (vs 50MB for origin-request). The Supabase JS client with dependencies exceeds this.

**How to avoid:** Use native `fetch` (Node.js 18+ built-in) for the Supabase REST call. Only bundle `@aws-sdk/client-ssm` which is small. Use esbuild minification via `NodejsFunction` bundling options.

**Warning signs:** Deployment error: "Lambda function ARN ... exceeds the maximum allowed size."

### Pitfall 4: Missing Bluesky Crawler User-Agent

**What goes wrong:** Bluesky previews don't work because the Bluesky crawler has an unfamiliar user-agent not in the bot list.

**Why it happens:** Bluesky uses a crawler called "Bluesky Link Preview Service" and also appears as `bsky` in user-agent strings.

**How to avoid:** Include `bsky` in the bot detection list. Bluesky's crawler UA is documented and includes `Bluesky` substring.

**Warning signs:** Facebook and Twitter previews work but Bluesky does not.

### Pitfall 5: Not Failing Open on Errors

**What goes wrong:** An unhandled error in the edge function causes CloudFront to return a 500, breaking the page for everyone (including real users if bot detection fails to catch an edge case).

**Why it happens:** Edge function throws on Supabase timeout, SSM failure, or JSON parse error.

**How to avoid:** Wrap the entire handler body in try/catch. On any error, return `request` (pass-through) rather than an error response. CloudFront will then serve `index.html` normally.

### Pitfall 6: Deploying to Existing CloudFront Without CDK Ownership

**What goes wrong:** The existing CloudFront distribution was created outside CDK (via AWS console + IaC generator). Importing it into CDK as a mutable resource is not straightforward — CDK L2 constructs don't support adding Lambda@Edge to an imported distribution.

**Why it happens:** CDK's `Distribution.fromDistributionAttributes()` creates a read-only `IDistribution` reference that cannot have behaviors modified.

**How to avoid:** Two options:
1. **Preferred:** Reconstruct the distribution fully in CDK (`new cloudfront.Distribution(...)`) with the same S3 origin, same aliases, same ACM certificate ARN. CDK will adopt/replace it. This is the cleaner long-term approach.
2. **Alternative:** Use CloudFormation directly with a custom resource or manage the LambdaFunctionAssociation via raw CFN escape hatch (`cfnDistribution.addPropertyOverride`).

**Warning signs:** TypeScript error "Property 'addBehavior' does not exist on type 'IDistribution'".

### Pitfall 7: License Check for Photos

**What goes wrong:** Using a photo with `license = 'cc-by-nc'`, `'cc-by-nd'`, `'none'`, or `null` in the OG image violates the locked decision and potentially copyright.

**Why it happens:** The `occurrence_photo` type has 7 license enum values (`cc0`, `cc-by`, `cc-by-nc`, `cc-by-sa`, `cc-by-nd`, `cc-by-nc-sa`, `cc-by-nc-nd`, `none`). Only `cc0` and `cc-by` are unambiguously open for re-use.

**How to avoid:** The allowed list is exactly `['cc0', 'cc-by']`. Explicitly check with `.includes()` — do not check for non-null alone.

---

## Code Examples

### Open Graph Tag Set (occurrence-specific)
```html
<!-- Source: https://ogp.me/ and https://developer.twitter.com/en/docs/twitter-for-websites/cards -->
<meta property="og:site_name" content="SalishSea.io">
<meta property="og:type" content="website">
<meta property="og:url" content="https://salishsea.io/?o=abc123">
<meta property="og:title" content="Orca · June 3, 2025">
<meta property="og:description" content="3 Biggs orcas · 2:32 PM">
<meta property="og:image" content="https://salishsea.io/photo.jpg">
<meta name="twitter:card" content="summary_large_image">
```

### Open Graph Tag Set (generic / no occurrence)
```html
<meta property="og:site_name" content="SalishSea.io">
<meta property="og:type" content="website">
<meta property="og:url" content="https://salishsea.io/">
<meta property="og:title" content="SalishSea.io">
<!-- No og:description, no og:image per locked decision -->
```

### Supabase REST Query for Occurrence
```
GET {SUPABASE_URL}/rest/v1/occurrences?id=eq.{id}&select=id,taxon,observed_at,count,photos&limit=1
Headers:
  apikey: {SUPABASE_ANON_KEY}
  Authorization: Bearer {SUPABASE_ANON_KEY}
```

Returns array; take `[0]`. Fields used:
- `taxon.vernacular_name` — species display name
- `observed_at` — ISO timestamp for date + time formatting
- `count` — number of animals
- `photos[].src` — photo URL
- `photos[].license` — check for `cc0` or `cc-by`

### Static Fallback Image Specs
- Dimensions: 1200x630px (optimal for Facebook, Bluesky, RCS, Twitter/X)
- Format: JPEG or PNG
- Aspect ratio: 1.91:1
- Upload path in S3: `s3://salishsea-io/site/preview.jpg` (so CloudFront serves it at `https://salishsea.io/preview.jpg`)

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CloudFront Functions for dynamic content | Lambda@Edge (remains required for network access) | CloudFront Functions introduced 2021 | No change for this use case — CF Functions lack network |
| `node-fetch` npm package | Native `fetch` built into Node.js | Node.js 18 (2022) | Eliminates one dependency from edge bundle |
| `@supabase/supabase-js` client for REST queries | Direct `fetch` to PostgREST endpoint | Always an option | Preferred for Lambda@Edge to keep bundle under 1MB limit |

**Deprecated/outdated:**
- `node-fetch` npm package: Not needed in Node.js 18+ — use native global `fetch`
- `lambda-edge-nice-grpc` and similar heavy adapters: Unnecessary for this simple use case

---

## Open Questions

1. **CDK ownership of existing CloudFront distribution**
   - What we know: The distribution `E...` exists and was created via console/IaC generator. The infra CDK stack is an empty skeleton.
   - What's unclear: Whether it's cleanest to reconstruct the distribution in CDK (replacing the existing one) or use a raw CFN override to add the Lambda@Edge association to the existing distribution.
   - Recommendation: Reconstruct in CDK as `new cloudfront.Distribution(...)` with the known ARNs for S3 origin, ACM cert, and aliases. This is the durable approach. The planner should create a task that verifies the CloudFront distribution ID and ACM cert ARN from the existing YAML (`salishsea-io-prod-1761191089385.yaml`) before writing the CDK stack.

2. **Twitter Card type choice**
   - What we know: `summary_large_image` shows a prominent wide image (1.91:1); `summary` shows a small square thumbnail. Bluesky currently behaves like `summary_large_image` for all cards with images.
   - What's unclear: Whether the branded fallback image will be designed as a wide banner or a square logo.
   - Recommendation: Use `summary_large_image` with a 1200x630px image — consistent with Facebook and Bluesky's preferred format.

3. **CDN URL for the branded fallback image**
   - What we know: S3 bucket path is `/site/...` under the CloudFront origin. CloudFront aliases to `salishsea.io`.
   - What's unclear: Final filename chosen for the branded image.
   - Recommendation: Use `https://salishsea.io/preview.jpg` and upload the asset to `s3://salishsea-io/site/preview.jpg` as part of the deploy workflow.

4. **Bluesky crawler user-agent exact string**
   - What we know: Bluesky uses a link preview service; its UA includes `bsky` per web sources.
   - What's unclear: Exact UA string as of 2026.
   - Recommendation: Include both `bsky` and `bluesky` (lowercase) as substrings in the detection list; log user-agents in CloudWatch during initial rollout and refine if needed.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (root project: `npm test`) |
| Config file | `/Users/rainhead/dev/salishsea-io/vitest.config.ts` |
| Quick run command | `npm test -- --run` (from project root) |
| Full suite command | `npm test -- --run` |
| Infra CDK tests | `cd infra && npm test` (jest + ts-jest) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PREV-01 | Bot user-agent detection returns OG HTML | unit | `npm test -- --run edge-handler` | ❌ Wave 0 |
| PREV-01 | Non-bot user-agent passes through unmodified | unit | `npm test -- --run edge-handler` | ❌ Wave 0 |
| PREV-02 | Occurrence-specific OG tags include species, date, count | unit | `npm test -- --run edge-handler` | ❌ Wave 0 |
| PREV-02 | Licensed photo URL appears in og:image | unit | `npm test -- --run edge-handler` | ❌ Wave 0 |
| PREV-02 | Unlicensed photo falls back to branded image | unit | `npm test -- --run edge-handler` | ❌ Wave 0 |
| PREV-02 | Missing occurrence falls back to generic preview | unit | `npm test -- --run edge-handler` | ❌ Wave 0 |
| PREV-03 | CDK stack synthesizes with EdgeFunction and Distribution | smoke | `cd infra && npm test` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- --run` (edge handler unit tests)
- **Per wave merge:** `npm test -- --run && cd infra && npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `infra/lib/edge-handler/index.test.ts` — covers PREV-01, PREV-02 (mock fetch + SSM; test pure handler logic)
- [ ] `infra/test/infra.test.ts` — expand existing placeholder to assert EdgeFunction and Distribution constructs exist in the synthesized template (CDK assertions API)

Note: Edge function tests should live in `infra/` (alongside the function code) and run with the `infra` jest setup, not vitest.

---

## Sources

### Primary (HIGH confidence)
- [AWS CloudFront Docs: Edge Functions Choosing](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions-choosing.html) — confirmed CloudFront Functions have no network access; Lambda@Edge has network access, 30s timeout, Node.js/Python
- [AWS CDK API: EdgeFunction construct](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront.experimental.EdgeFunction.html) — confirmed us-east-1 requirement, `currentVersion` usage, `edgeLambdas` configuration
- [Supabase REST API Docs](https://supabase.com/docs/guides/api) — confirmed PostgREST URL pattern, required headers (`apikey`, `Authorization`), query parameter syntax
- [Open Graph Protocol](https://ogp.me/) — authoritative OG tag specification

### Secondary (MEDIUM confidence)
- [Makimo Blog: OG Tags with Lambda@Edge](https://makimo.com/blog/open-graph-tags-with-aws-cloudfront-lambdaedge/) — verified practical pattern with bot detection, HTML generation, fail-open error handling
- [GitHub Gist: Lambda@Edge OG injection](https://gist.github.com/furkan3ayraktar/2ba5e34985addc4107dc417399be2b9d) — confirmed origin-request pattern with gzip handling (note: our implementation uses viewer-request to avoid S3 re-fetch)
- [Kudosity: Android Messages Link Previews](https://kudosity.com/resources/articles/how-to-take-advantage-of-android-messages-link-previews) — confirmed RCS/Android Messages uses `og:image` and `og:title`
- [Bluesky metadata guide](https://www.amsive.com/insights/seo/mastering-metadata-for-bluesky-social/) — confirmed Bluesky uses og:* tags; behaves like summary_large_image

### Tertiary (LOW confidence — flag for validation)
- Bluesky crawler user-agent string `bsky` — sourced from DataDome bot documentation; should be verified by checking CloudWatch logs after first rollout
- Twitter/X Card docs — X developer docs redirected to new URL; used web search findings; verify `twitter:card` tag still supported

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — AWS official docs confirm Lambda@Edge is required; CDK EdgeFunction construct is official
- Architecture: HIGH — Pattern well-documented with multiple real-world examples; Supabase REST API is stable
- Pitfalls: HIGH — Most pitfalls confirmed directly from AWS official docs (env var limitation, us-east-1 requirement, 1MB limit, $LATEST restriction)
- Bluesky UA string: LOW — Needs runtime verification

**Research date:** 2026-03-04
**Valid until:** 2026-06-04 (90 days; AWS Lambda@Edge API is stable; re-check CDK version if major version bump)
