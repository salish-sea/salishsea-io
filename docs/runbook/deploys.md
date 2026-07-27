# Runbook: Deploys & CloudFront/Lambda@Edge gotchas

How production deploys work, and the recurring surprises they produce. Audience: anyone (human or agent) running or debugging a deploy.

## How it deploys

Push to `main` → GitHub Actions Build + Deploy → CDK (`infra/`, synthed via `ts-node`) updates the stack. The rich-preview handler is a Lambda@Edge **viewer-request** function on the CloudFront distribution, defined in [`infra/lib/infra-stack.ts`](../../infra/lib/infra-stack.ts). Its code and behaviour live in [`infra/lib/edge-handler/index.ts`](../../infra/lib/edge-handler/index.ts) — see [decision 002](../decisions/002-static-spa-edge-architecture.md).

## Gotcha 1 — `DELETE_FAILED` on an old Lambda@Edge version

**Symptom.** During deploy, the `edge-lambda-stack-*` support stack logs:

> `DELETE_FAILED … AWS::Lambda::Version … Lambda was unable to delete … because it is a replicated function.`

**Why.** Every edge-code change mints a new function version; CloudFront replicates it to edge locations. Lambda refuses to delete the *old* version until its replicas drain, which takes a few hours after nothing references it. CloudFormation tries to delete it immediately during the update's cleanup phase.

**Is it fatal?** Usually no. The delete fails during the post-update *cleanup* phase, after the new version is already live, so the stack still reaches `UPDATE_COMPLETE` — the old version just lingers, orphaned and harmless. Confirm with:

```sh
aws cloudformation describe-stacks --stack-name <edge-lambda-stack-…> \
  --query 'Stacks[0].StackStatus' --profile <profile> --region us-east-1
```

**If it *did* wedge a rollback** (`UPDATE_ROLLBACK_FAILED`, because the rollback also can't delete the replica): continue the rollback while skipping the stuck version, then re-deploy a few hours later once replicas have drained:

```sh
aws cloudformation continue-update-rollback --stack-name <edge-lambda-stack-…> \
  --resources-to-skip <OgMetaFunctionCurrentVersion…> --region us-east-1
```

The churn is inherent to `cloudfront.experimental.EdgeFunction` (a new version per deploy); there is no clean CDK knob to retain old versions.

## Gotcha 2 — "Cannot update bucket policy of an imported bucket"

**Symptom.** On synth/deploy:

> `[/InfraStack/SalishSeaDist/Origin1] Cannot update bucket policy of an imported bucket. You will need to update the policy manually instead.`

**Why.** The site bucket is imported by name and attached as an Origin Access Control origin ([`infra-stack.ts`](../../infra/lib/infra-stack.ts), `Bucket.fromBucketName` + `S3BucketOrigin.withOriginAccessControl`). CDK won't write the bucket policy of a bucket it doesn't own, so the OAC `s3:GetObject` grant is maintained **by hand** on the `salishsea-io` bucket.

**Is it a problem?** Benign as long as the existing bucket policy already grants the serving distribution's OAC — which it does whenever the site is serving assets. It only bites if a deploy creates a **new** distribution (new OAC `SourceArn`): S3 origin fetches then 403 until you add the grant manually (`originPath` is `/site`, so the resource is `/site/*`):

```json
{
  "Effect": "Allow",
  "Principal": { "Service": "cloudfront.amazonaws.com" },
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::salishsea-io/site/*",
  "Condition": { "StringEquals": { "AWS:SourceArn": "arn:aws:cloudfront::<acct-id>:distribution/<dist-id>" } }
}
```

## Gotcha 3 — re-running an old deploy rolls production back

**Symptom.** A Deploy run fails on something transient (`Configure AWS Credentials` is the one we've seen). You hit *Re-run jobs*. Production silently reverts to whatever the tree looked like at that run's commit.

**Why.** A re-run checks out its **original** `head_sha`, not the current tip. Deploys are also serialized (`concurrency: deploy-production`, `cancel-in-progress: false`), so the re-run waits its turn and can land *after* a newer commit has already deployed — overwriting it. This happened on 2026-07-27: a re-run of `007b738` finished ten minutes after `7a66891` and reverted it (bd `salishsea-io-i74`).

**What now happens.** The Deploy job's first step compares `github.sha` against the current tip of `main` and fails with `Refusing to deploy <sha>: main is now <sha>` if they differ. A superseded run can't reach S3 or CDK.

**Is it fatal?** No — it means *this* run shipped nothing. If a newer Deploy is green, production is already correct and the red run is safe to ignore. To actually re-deploy, re-run the Deploy for the current tip of `main` (or push).

## Caching notes

- **Viewer-request Lambda responses are never cached by CloudFront** — each request re-runs the current function version, so once the distribution shows `Deployed`, the new behaviour is live everywhere. (Contrast: static assets passed through to S3 *are* cached per-POP; `aws cloudfront create-invalidation --paths '/some-asset.jpg'` clears them.)
- **Facebook caches `og:image` verdicts separately and stickily.** After changing a card's image, "Scrape Again" in the [Sharing Debugger](https://developers.facebook.com/tools/debug/) refreshes the page scrape but may keep an old image verdict for hours — including a since-removed image on cards that no longer declare one (see [decision 019](../decisions/019-no-fallback-preview-image.md)). If it won't clear, cache-bust the image URL (e.g. `photo.jpg?v=2`).

## Post-deploy verification

```sh
# distribution finished propagating
aws cloudfront list-distributions --profile <profile> \
  --query "DistributionList.Items[?contains(Aliases.Items,'salishsea.io')].[Id,Status]" --output text
# on-origin image assets serve bytes to crawlers, not OG HTML
# (hashed path — read the current one out of the deployed index.html)
curl -sS -A "facebookexternalhit/1.1" -o /dev/null -w "%{content_type}\n" \
  "https://salishsea.io$(curl -sS https://salishsea.io/ | grep -o '/assets/favicon-[^"]*\.ico')"
# occurrence page still gets OG tags
curl -sS -A "facebookexternalhit/1.1" "https://salishsea.io/?o=<id>" | grep -o '<title>[^<]*</title>'
```

## Worked example — 2026-07-02 preview-image fix (PR #299)

Deploy hit both gotchas. `edge-lambda-stack` logged `DELETE_FAILED` on version 8 but still reached `UPDATE_COMPLETE`; the imported-bucket warning printed as usual. The fix (crawlers now get `image/jpeg` for `/preview.jpg`) was live once the distribution showed `Deployed`. A CloudFront invalidation was run but was a no-op for the HTML path (viewer-request → nothing cached); the residual broken Facebook preview was FB's own image cache. See closed bd `salishsea-io-i5u` and follow-up `salishsea-io-gnh`.
