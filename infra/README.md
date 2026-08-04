# CDK infrastructure

CloudFront, the Lambda@Edge OG/preview handler, and the card renderer.
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
