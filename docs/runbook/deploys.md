# Runbook: Deploys & CloudFront/Lambda@Edge gotchas

How production deploys work, and the recurring surprises they produce. Audience: anyone (human or agent) running or debugging a deploy.

## How it deploys

Push to `main` → GitHub Actions [`deploy.yml`](../../.github/workflows/deploy.yml) → CDK (`infra/`, synthed via `ts-node`) updates the stack. The rich-preview handler is a Lambda@Edge **viewer-request** function on the CloudFront distribution, defined in [`infra/lib/infra-stack.ts`](../../infra/lib/infra-stack.ts). Its code and behaviour live in [`infra/lib/edge-handler/index.ts`](../../infra/lib/edge-handler/index.ts) — see [decision 002](../decisions/002-static-spa-edge-architecture.md).

### The site people see is the Fly app, and the same workflow deploys it

CloudFront's default origin is the `salishsea-io` Fly app ([decision 061](../decisions/061-ingest-and-derivation-move-into-the-build.md), `salish-xv35.16`). It serves the site, runs the read-path build and holds the write API. The workflow's **Fly app** job deploys it on every push to `main`, after the deploy job has migrated the database and updated AWS (`salish-t3g.5`). It runs [`fly/deploy.sh`](../../fly/deploy.sh), and the same script redeploys by hand from a clean checkout:

```sh
fly/deploy.sh      # build, then switch; `build` or `switch` alone. See its header.
```

The job authenticates with `FLY_API_TOKEN`, a secret in the `production` environment holding an app-scoped deploy token. That token can also `fly ssh` to the machine, which is how the build lock is taken. The deploy job refuses to start without it, before it changes anything. To rotate it:

```sh
fly tokens create deploy -a salishsea-io --name "GitHub Actions deploy" \
  | gh secret set FLY_API_TOKEN --env production -R salish-sea/salishsea-io
fly tokens list -a salishsea-io       # then revoke the old one: fly tokens revoke <id>
```

The Stelis commit the image runs is [`fly/stelis-commit`](../../fly/stelis-commit). To move Stelis, push the Stelis commit first, then change that file to the full commit (`git -C ~/dev/stelis rev-parse <ref>`) in a PR here. That PR deploys the graph change and whatever here depends on it together. Because the pin is committed, the commit `salishsea.io/release.json` names also says which Stelis production runs.

The script builds and pushes the image first, tagged with the commit and the Stelis pin, while the machine goes on serving and building. It then takes the machine's build lock, waiting out a running build so the switch doesn't kill one, and deploys that image ([decision 066](../decisions/066-a-deploy-takes-the-build-lock-and-the-machine-stops-its-writers.md)). On the stop signal the old machine stops the write API and lets Litestream make its final sync before it goes. If the lock can't be had within five minutes, a build is probably stuck. The deploy then fails with production untouched, and the image is already pushed for a rerun.

A green Deploy run therefore means the merged commit is what salishsea.io serves, and its smoke job tested that image. Check with `curl -s https://salishsea.io/release.json`.

**Rollback is a Fly image.** Every Fly deploy is a release with a retained image:

```sh
fly releases -a salishsea-io --image                      # pick the last good one
fly deploy -a salishsea-io --image <the image reference from that list>
```

Images deployed since decision 066 are tagged with their commit and Stelis's. Earlier ones carry `deployment-<id>`. `fly deploy --image` by hand skips `fly/deploy.sh`'s build lock, so a running build may be killed. The next build repairs that.

The image carries the site bundle, the read-path scripts and the pinned Stelis together, so rolling it back rolls all three back; the data on the volume (`/data`: the snapshot, the mirrors, the build history) stays as it is, and the next build at the old pin runs over it. Two things a release does not carry: `fly deploy --image` applies the `fly.toml` of the checkout you run it from, so check out the release's commit first (the `GITHUB_SHA` build arg in `fly/deploy.sh` is how an image names its commit); and Fly secrets, which are set on the app, not in a release. The one thing an image rollback cannot undo is a migration `deploy.yml` applied to Postgres in the meantime — forward-only, as above.

The run is these jobs ([decision 024](../decisions/024-deploy-gating-and-alerting.md)):

| Job | What it does |
|---|---|
| **Test** | Calls [`build.yml`](../../.github/workflows/build.yml) — the same suite PRs run (type drift, build, unit tests, infra tests) against the commit being deployed. Nothing reaches production without it. |
| **Fly image** | `fly/deploy.sh build`: builds the image on Fly's remote builder and pushes it, tagged with the commit and the Stelis pin, alongside Test (`salish-t3g.10`). Nothing in production changes. The build uploads the bundle's source maps to Sentry. An image that won't build, or a `FLY_API_TOKEN` that can't, stops the run here, before any migration. |
| **Deploy** | `supabase db push` → `cdk deploy`. Waits for both Test and Fly image. Not atomic; see below. |
| **Fly app** | `fly/deploy.sh switch` after the deploy job: takes the machine's build lock, then deploys the pushed image (decision 066). A failure here leaves the previous image serving, with the database already migrated; `fly/deploy.sh switch` from that commit retries it. |
| **Smoke** | Calls [`smoke.yml`](../../.github/workflows/smoke.yml) against `https://salishsea.io`, after the Fly app job, or after the deploy job alone if the Fly job failed: a migrated database under the previous image is what most needs checking. A production that doesn't answer correctly fails the deploy run. The OG specs first wait up to five minutes for the edge handler to replicate; a new Lambda@Edge version is not at every edge location the moment `cdk deploy` returns. |
| **Register** | Calls [`register-refresh.yml`](../../.github/workflows/register-refresh.yml) after the deploy job: reloads the register into the database just migrated and checks it arrived. Runs alongside the Fly app job; a failure here is a register load failing, not the site. |
| **Watch** | Watches the jobs that bind the `production` environment (Deploy, Fly app, Register). When one waits fifteen minutes with no runner, GitHub has lost it: see [gotcha 4](#gotcha-4--a-deploy-stuck-waiting-holds-every-later-one). |
| **Alert / Resolve** | On failure, opens or updates the single `deploy-failed` issue; on a fully green run, closes it. |

Two things to know when reading a red run:

- **A red Deploy does not imply production changed.** If *Test* or *Fly image* failed, the deploy job never ran and production was untouched — that is the gate working. The failure issue says which case it is.
- **There is no automatic rollback, on purpose.** `supabase db push` is forward-only, so reverting the frontend alone would point old code at a migrated schema. If the deploy job failed partway, everything before the failing step already landed; read the log to see how far it got, and fix forward.

An open `deploy-failed` issue means a run failed and has not been followed by a green one. **Read its first bold line before assuming production is broken** — the issue states whether the run got past the deploy job's point of no return (`Production may be partially updated`) or failed before it (`Production was not touched`). Either way the next green deploy closes it, so it should not need manual triage-and-close.

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

## Gotcha 2 — "Cannot update bucket policy of an imported bucket" (retired)

This was about the `salishsea-io` site bucket as a CloudFront origin. Since 2026-10-03 the default origin is the Fly app and the bucket is no origin at all, and since `salish-t3g.10` the deploy no longer syncs a site into it. Its `site/` prefix holds the last Supabase-mode build, frozen on 2026-10-06. The heading stays so later gotchas keep their numbers.

## Gotcha 3 — re-running an old deploy rolls production back

**Symptom.** A Deploy run fails on something transient (`Configure AWS Credentials` is the one we've seen). You hit *Re-run jobs*. Production silently reverts to whatever the tree looked like at that run's commit.

**Why.** A re-run checks out its **original** `head_sha`, not the current tip. Deploys are also serialized (`concurrency: deploy-production`, `cancel-in-progress: false`), so the re-run waits its turn and can land *after* a newer commit has already deployed — overwriting it. This happened on 2026-07-27: a re-run of `007b738` finished ten minutes after `7a66891` and reverted it (bd `salish-i74`).

**What now happens.** The Deploy job compares `github.sha` against the current tip of `main` and fails with `Refusing to deploy <sha> …: main is now <sha>` if they differ ([`require-current-tip`](../../.github/actions/require-current-tip/action.yml)). It runs twice: after checkout, and again immediately before the first remote change.

**Is it fatal?** No — it means *this* run shipped nothing. If a newer Deploy is green, production is already correct and the red run is safe to ignore.

**If production really is behind**, re-running the run that just failed the check won't help: it holds the same commit and will stop at the same place. Either re-run the Deploy **whose commit is the current tip of `main`** (this is the recovery that worked on 2026-07-27, when the tip's own deploy had been overwritten), or push a commit to trigger a fresh run.

**What it does not cover.** It is a check, not a lease, and it has two known holes:

- **`main` can advance during the deploy itself.** The second check narrows this to the window between it and `cdk deploy`, but a merge landing inside that window still ships stale content. The serialized queue means the newer run deploys right after and corrects it — *provided that run succeeds*. Watch it if you merge twice in quick succession.
- **Runs created before this guard existed are not protected.** A re-run replays the workflow file *as of its own commit*, so re-running any Deploy from before this merged skips the check entirely. Don't re-run old deploys; push instead. (Deliberately not fixed by deleting run history — that history is the audit trail.)

The smoke job is a partial backstop for both. It now runs inside the deploy run and checks out **the commit being deployed**, so it verifies that what this run shipped works — it will not notice that what this run shipped was already stale. What covers that is the queued newer run deploying right behind it, plus the daily scheduled smoke run, which checks out `main` and so does compare production against the current tree.

## Gotcha 4 — a deploy stuck "waiting" holds every later one

**Symptom.** A Deploy run's Deploy, Fly app or Register job shows *Waiting* on the `production` environment for hours. The environment has no reviewers and no wait timer, and `gh api repos/salish-sea/salishsea-io/actions/runs/<id>/pending_deployments` lists no reviewers, so there is nothing to approve. GitHub has lost the deployment. Because deploys queue rather than cancel (`cancel-in-progress: false`), every later run waits behind it, and GitHub keeps only the newest of those. This happened twice on 2026-10-06, about three hours each time (`salish-t3g.11`).

**What now happens.** The **Watch** job notices a job that has waited fifteen minutes without a runner. It waits for anything else in the run to finish, so the cancel interrupts nothing. Then:

- it opens or updates the `deploy-failed` issue, unless the run's commit is superseded and the lost job was Deploy, which means nothing changed and the queued run deploys the tip;
- if the run holds the tip of `main` and was started by a push, it dispatches one fresh Deploy of `main`, so the commit still ships;
- it cancels the run, and whatever was queued behind it starts.

A dispatched run doesn't dispatch another if it is lost too. That case, and a cancel that doesn't take, need a person. Cancel the stuck run (`gh run cancel <id>`), then `gh workflow run deploy.yml --ref main`. A dispatch checks out the current tip, which a re-run does not ([gotcha 3](#gotcha-3--re-running-an-old-deploy-rolls-production-back)).

**Why not a timeout or `cancel-in-progress`.** `timeout-minutes` counts from when a runner takes the job, and a lost job never gets one. `cancel-in-progress: true` would also cancel a healthy deploy mid `supabase db push` whenever a newer commit merged.

**What it does not cover.** The scheduled workflows that bind `production` (the ingest heartbeat, the daily register refresh) have no watcher. A lost heartbeat run holds later heartbeats behind it, and nothing alerts while it does.

## `/cards/*` is not S3

Preview card images come from a **regional Lambda behind a Function URL**, not from the site bucket ([decision 020](../decisions/020-map-preview-cards.md)). A 5xx there is a Lambda problem: logs are in `/salishsea/card-renderer` in **us-west-2**, not in the edge log group, and not in S3 access logs. The function is reachable only through CloudFront (IAM auth + OAC), so it cannot be curled directly to test — go through `https://salishsea.io/cards/...`.

To render a card locally without deploying: `cd infra && pnpm install && pnpm build && node lib/card-renderer/cli.js point <lon> <lat> out.jpg` (no credentials needed), or `occurrence <id>` / `day <YYYY-MM-DD>` with `SUPABASE_URL` and `SUPABASE_ANON_KEY` set.

**After changing the renderer, look at a card — do not just check the response.** A card whose text is entirely missing-glyph boxes is still a valid JPEG of normal size, so status, `content-type` and byte-count assertions all pass. That is how a fontless build reached production on 2026-07-27. A local render proves nothing here either: macOS supplies system fonts the Lambda does not have. To reproduce the Lambda's environment, render from the built bundle in a bare Linux container:

```sh
docker run --rm --platform linux/amd64 \
  -v "$PWD/lib/card-renderer/bundle:/bundle:ro" -v /tmp:/out \
  -e FONTCONFIG_PATH=/bundle/fonts -w /bundle node:24-slim \
  node -e 'import("/bundle/cards.js").then(async m => require("fs").writeFileSync("/out/card.jpg",
    await m.renderOccurrenceCard({id:"t",location:{lon:-123.09,lat:48.61},observedAt:"2026-07-26T18:00:00Z",species:"Orca",count:3})))'
```

Dropping `-e FONTCONFIG_PATH` reproduces the boxes, which is the check that the check works.

### Cached cards after a rendering change

Cards are cached by how recent their subject is ([decision 020](../decisions/020-map-preview-cards.md)): a sighting or day within four days revalidates every five minutes, anything older is cached for 30 days. So a change to how cards *look* reaches recent cards within minutes and older ones over a month.

**A deploy does not clear them** — the deploy step invalidates only `/` and `/index.html`. If a rendering change needs to take effect everywhere at once (or a bad card shipped), invalidate explicitly:

```sh
aws cloudfront create-invalidation --profile <profile> \
  --distribution-id "$(aws cloudfront list-distributions --profile <profile> \
    --query "DistributionList.Items[?contains(Aliases.Items,'salishsea.io')].Id" --output text)" \
  --paths '/cards/*'
```

This is not in the deploy workflow on purpose: most deploys don't touch the renderer, and invalidating every card on every deploy would discard the cache for no reason. The first 1,000 invalidation paths a month are free.

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

Deploy hit both gotchas. `edge-lambda-stack` logged `DELETE_FAILED` on version 8 but still reached `UPDATE_COMPLETE`; the imported-bucket warning printed as usual. The fix (crawlers now get `image/jpeg` for `/preview.jpg`) was live once the distribution showed `Deployed`. A CloudFront invalidation was run but was a no-op for the HTML path (viewer-request → nothing cached); the residual broken Facebook preview was FB's own image cache. See closed bd `salish-i5u` and follow-up `salish-gnh`.
