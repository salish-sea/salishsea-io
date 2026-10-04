# CDK infrastructure

CloudFront, the Lambda@Edge OG/preview handler, and the card renderer. CloudFront's default origin is the `salishsea-io` Fly app, which serves the site, the read-path build's files and the Darwin Core archive ([decision 061](../docs/decisions/061-ingest-and-derivation-move-into-the-build.md)); the S3 bucket serves nothing any more. The Fly app deploys by hand (`fly/deploy.sh`) and rolls back by image; the S3 site is a degraded fallback, not a rollback — see the [deploys runbook](../docs/runbook/deploys.md#since-2026-10-03-the-site-people-see-is-the-fly-app-and-main-does-not-deploy-it).
The `cdk.json` file tells the CDK Toolkit how to execute this app.

This is a **separate pnpm project** from the repo root, not a workspace member:
it has its own `pnpm-lock.yaml` and its own `pnpm-workspace.yaml`, and needs its
own `pnpm install` run from this directory. See
[decision 025](../docs/decisions/025-pnpm-over-npm.md) for why.

## Useful commands

* `pnpm install`      install this project's dependencies (run from `infra/`)
* `pnpm build`        compile typescript and stage the card-renderer bundle
* `pnpm watch`        watch for changes and compile
* `pnpm test`         run the jest unit tests
* `pnpm exec cdk deploy`  deploy this stack to your default AWS account/region
* `pnpm exec cdk diff`    compare deployed stack with current state
* `pnpm exec cdk synth`   emit the synthesized CloudFormation template
