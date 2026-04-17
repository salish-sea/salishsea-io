---
phase: 02-rich-previews
reviewed: 2026-04-17T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - infra/lib/edge-handler/index.ts
  - infra/lib/edge-handler/index.test.ts
  - infra/lib/infra-stack.ts
  - infra/bin/infra.ts
  - infra/test/infra.test.ts
  - infra/package.json
  - .github/workflows/deploy.yml
  - e2e/og-previews.spec.ts
findings:
  critical: 2
  warning: 4
  info: 3
  total: 9
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-04-17
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

This phase introduces a Lambda@Edge function that injects Open Graph meta tags for bot user-agents before CloudFront serves a response. The implementation is generally well-structured: credential caching, HTML escaping, and license filtering are all present and tested. The unit test suite is thorough. However, there are two critical issues — a secret exposed in the CI pipeline's command-line arguments and a non-functional SSM parameter type — plus four warnings around correctness and reliability.

## Critical Issues

### CR-01: Supabase anon key passed as plaintext shell argument in CI

**File:** `.github/workflows/deploy.yml:86`
**Issue:** The `supabaseAnonKey` CDK context value is interpolated directly into the shell command line:
```
npx cdk deploy --all --require-approval never --context supabaseAnonKey=${{ secrets.VITE_SUPABASE_KEY }}
```
GitHub Actions secrets are masked in log output, but passing a secret as a positional shell argument exposes it in the process argument list (`/proc/<pid>/cmdline`), which is readable by other processes on the runner and may appear in CDK's own debug output or CloudFormation change-set descriptions. Additionally, the value is unquoted, so a key containing shell metacharacters would break the command.

**Fix:** Pass via an environment variable and read it in the CDK entrypoint, or write it to a temporary file. Minimum safe fix — quote the value and prefer env-var injection:
```yaml
- name: Deploy CDK infra (CloudFront + Lambda@Edge)
  working-directory: infra
  env:
    SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_KEY }}
  run: |
    npm ci
    npm run build
    npx cdk deploy --all --require-approval never \
      --context "supabaseAnonKey=${SUPABASE_ANON_KEY}"
```
Even better, read `process.env.SUPABASE_ANON_KEY` directly in `infra/bin/infra.ts` instead of using CDK context, so the value never touches the command line.

---

### CR-02: SSM parameter for anon key created as `StringParameter`, not `SecureString`

**File:** `infra/lib/infra-stack.ts:31-34`
**Issue:** The Supabase anon key is stored using `ssm.StringParameter`, which stores the value in plaintext in AWS SSM Parameter Store. The CDK `StringParameter` construct maps to the SSM `String` type. A key that grants database-level read access to production data should be stored as `SecureString` (KMS-encrypted). At-rest encryption is absent with the current construct.

Additionally, the placeholder value `'placeholder-set-in-aws-console'` will be written on every CDK deploy unless a context value is supplied, potentially overwriting a manually-set SecureString with a plaintext placeholder.

**Fix:** Use `ssm.StringParameter` with `type: ssm.ParameterType.SECURE_STRING` (requires a KMS key), or manage the SecureString outside CDK (import by name) so CDK never writes the value:
```typescript
// Option A: import existing SecureString, never write it from CDK
const anonKeyParam = ssm.StringParameter.fromSecureStringParameterAttributes(
  this, 'SupabaseAnonKey',
  { parameterName: '/salishsea/supabase-anon-key' }
);

// Option B: only write if a real value was provided
const anonKeyValue = this.node.tryGetContext('supabaseAnonKey');
if (anonKeyValue && anonKeyValue !== 'placeholder-set-in-aws-console') {
  new ssm.StringParameter(this, 'SupabaseAnonKey', {
    parameterName: '/salishsea/supabase-anon-key',
    stringValue: anonKeyValue,
    // type defaults to String — migrate to SecureString
  });
}
```

---

## Warnings

### WR-01: Non-bot requests with a missing `user-agent` header are treated as bots

**File:** `infra/lib/edge-handler/index.ts:96-99`
**Issue:** When the `user-agent` header is absent, `ua` is the empty string `''`. `isBot('')` returns `false` (no bot substring matches an empty string), so the pass-through path is correctly taken. This is fine. However, there is a subtler problem: the `isBot` list includes `'bsky'` and `'bluesky'` as separate substrings. The substring `'bsky'` is also present in the string `'bluesky'`, so `'bluesky'` would match on either entry — that is harmless. But `'bsky'` is a very short, generic substring (4 characters) that could match legitimate browser extensions, custom clients, or future user-agents unrelated to Bluesky. Consider anchoring it or using a longer string.

**Fix:**
```typescript
'bsky.social',   // or 'bluesky' alone covers both
```

---

### WR-02: `res.json()` called without checking HTTP status — errors from Supabase silently return an empty array

**File:** `infra/lib/edge-handler/index.ts:119-120`
**Issue:** If the Supabase API returns a 4xx or 5xx response (e.g., 401 Unauthorized due to a bad key, 503 during maintenance), `res.json()` will still resolve (to an error object, not an array). Casting that to `Occurrence[]` and indexing `[0]` will return `undefined` or a non-Occurrence object. The `if (!occ)` guard on line 122 catches the `undefined` case and falls back to the generic preview, but a Supabase error body that is a non-empty object or array would pass through and may cause unexpected behavior or log noise downstream.

**Fix:** Check `res.ok` before parsing:
```typescript
if (!res.ok) {
  // treat as not-found: return generic preview
  return {
    status: '200',
    headers: { 'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }] },
    body: buildOgHtml(genericPreviewTags()),
  };
}
const occurrences = await res.json() as Occurrence[];
```

---

### WR-03: `observed_at` parsed with `new Date()` — timezone handling produces wrong dates for UTC-offset timestamps

**File:** `infra/lib/edge-handler/index.ts:133-135`
**Issue:** `new Date('2025-06-03T14:32:00Z')` is correctly parsed as UTC. However, if `observed_at` is stored without a timezone suffix (e.g., `'2025-06-03T14:32:00'`), `new Date()` treats it as **local time** in Node.js (unlike browsers, which vary). Lambda@Edge runs in us-east-1 whose system timezone may differ from the observer's local time, producing a date one day off. The test fixture uses a `Z`-suffixed value (`'2025-06-03T14:32:00Z'`), so the tests pass regardless of this issue.

**Fix:** Ensure `observed_at` always includes a timezone indicator, or explicitly append `'Z'` when it is absent:
```typescript
const observed = occ.observed_at.endsWith('Z') || occ.observed_at.includes('+')
  ? occ.observed_at
  : occ.observed_at + 'Z';
const date = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  .format(new Date(observed));
```

---

### WR-04: CDK stack deployed as environment-agnostic but uses hard-coded account ID and certificate ARN

**File:** `infra/lib/infra-stack.ts:39,54-56` / `infra/bin/infra.ts:24`
**Issue:** The IAM policy resource ARN on line 39 embeds `this.account` (which resolves to `{ "Ref": "AWS::AccountId" }` at synth time), and the ACM certificate ARN on line 55 hard-codes account `648183724555`. If the stack were ever deployed to a different account (e.g., a staging account), the certificate ARN would be invalid and the IAM policy would scope incorrectly. The account is also hard-coded in `infra/bin/infra.ts` line 24.

This is not immediately broken for the single-account production case, but mixing `this.account` (dynamic) with a literal account ID in the certificate ARN is inconsistent and will cause confusion.

**Fix:** Either fully commit to the known account (replace `this.account` with the literal `'648183724555'` in the IAM ARN, consistent with the certificate), or extract the account to a constant and reference it from both places:
```typescript
const ACCOUNT_ID = '648183724555';
// use ACCOUNT_ID in both the IAM ARN and the certificate ARN
```

---

## Info

### IN-01: `actions/checkout@v6` and `actions/setup-node@v6` — versions ahead of published releases

**File:** `.github/workflows/deploy.yml:16,21,57,79`
**Issue:** As of early 2026, `actions/checkout` is at v4 and `actions/setup-node` is at v4. Using `@v6` may resolve to a non-existent or future tag, causing the workflow to fail or use an unexpected pre-release version. This should be verified against actual published releases.

**Fix:** Pin to the latest known stable version with a full SHA for security:
```yaml
uses: actions/checkout@v4
uses: actions/setup-node@v4
```

---

### IN-02: `lambda.Code.fromAsset` bundles the entire `edge-handler` directory, including test files

**File:** `infra/lib/infra-stack.ts:20`
**Issue:** `lambda.Code.fromAsset(path.join(__dirname, 'edge-handler'))` will include `index.test.ts` (and any other files) alongside `index.ts` in the Lambda deployment package. After `tsc` compilation, compiled `.js` versions of test files will also be included. This increases bundle size and deploys test code to production.

**Fix:** Bundle only the compiled output, or use `esbuild` bundling via CDK's `NodejsFunction` construct:
```typescript
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';

const ogFunction = new cloudfront.experimental.EdgeFunction(this, 'OgMetaFunction', {
  runtime: lambda.Runtime.NODEJS_22_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset(path.join(__dirname, '../../dist/edge-handler')),
  // or use NodejsFunction with entry point for auto-bundling
});
```

---

### IN-03: No `og:url` uses canonical form without query string for generic preview

**File:** `infra/lib/edge-handler/index.ts:69-75`
**Issue:** The `genericPreviewTags()` function sets `'og:url': 'https://salishsea.io/'`. When a bot visits a URL with an unrecognized `?o=` parameter (occurrence not found), the handler returns the generic preview but the `og:url` still points to the root URL rather than the actual requested URL. This is minor but means the shared URL in a social card for `/?o=nonexistent-id` will point browsers to `https://salishsea.io/` rather than to the occurrence URL. The current behavior is probably preferable (no dead links), but it is worth being intentional about.

**Fix:** This is a design note rather than a code change. The current behavior (canonical URL for not-found occurrences) is reasonable. No action required unless the product wants to reflect the actual URL.

---

_Reviewed: 2026-04-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
