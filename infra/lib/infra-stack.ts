import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
import * as path from 'path';
import * as fs from 'fs';

const ACCOUNT_ID = '648183724555';
// Baked into the edge bundle at synth (not read at runtime from anywhere)
const SUPABASE_URL = 'https://grztmjpzamcxlzecmqca.supabase.co';

/**
 * Read the stub opt-in from CDK context.
 *
 * `--context allowStubCardRenderer=true` arrives as the STRING "true", while a
 * test constructing `new cdk.App({ context: { ... } })` passes a real boolean.
 * Accepting only one of those makes the documented escape hatch a lie.
 */
export function stubAllowedFromContext(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * Whether to deploy the real card-renderer bundle or a stub.
 *
 * Extracted so the rule is testable without filesystem games: deploying the stub
 * would leave `/cards/*` live in front of a function that answers 503 to every
 * crawler, and the only symptom would be silently imageless previews. Unit tests
 * synthesize without building and opt into the stub explicitly; a deploy may not.
 */
export function cardRendererSource(bundleExists: boolean, stubAllowed: boolean): 'bundle' | 'stub' {
  if (bundleExists) return 'bundle';
  if (stubAllowed) return 'stub';
  throw new Error(
    'card renderer bundle missing. Run `npm run build` in infra/ before deploying ' +
    '(the CDK deploy step in .github/workflows/deploy.yml does this). Only unit tests ' +
    'may synthesize without it, via --context allowStubCardRenderer=true.',
  );
}

/**
 * Whether the edge handler has been compiled, or the synth should refuse.
 *
 * The same shape as {@link cardRendererSource} and for the same reason, found
 * while writing the asset test (salish-7iu). `Code.fromAsset` points at the
 * handler's SOURCE directory and excludes `*.ts`, so on a tree where `tsc` has
 * not run there is no `index.js` to ship — and the asset still stages happily,
 * carrying only the `config.js` that this file generates at synth time. CDK does
 * not mind. CloudFront does not mind. Every viewer request then hits a
 * Lambda@Edge function with no handler.
 *
 * Unlike the card renderer there is no stub worth deploying: a viewer-request
 * function that fails is not a degraded preview, it is the site. So this only
 * refuses.
 */
export function assertEdgeHandlerBuilt(handlerExists: boolean): void {
  if (handlerExists) return;
  throw new Error(
    'edge handler not compiled: lib/edge-handler/index.js is missing. Run `pnpm run build` ' +
    'in infra/ first (the CDK deploy step in .github/workflows/deploy.yml does this, and ' +
    "infra's `pnpm test` does the `tsc` half so the asset test sees what a deploy would ship).",
  );
}

/** Kept in step with `.github/workflows/db-restore-verify.yml` by a test. */
export const BACKUP_BUCKET_NAME = 'salishsea-io-backups';

/**
 * Where users' photos live (decision 065), served at salishsea.io/media/. Named so the
 * Fly app's configuration can say it without a lookup after the first deploy.
 */
export const MEDIA_BUCKET_NAME = 'salishsea-io-media';
/** Where Litestream replicates the store (decision 065), under STORE_REPLICA_PREFIX. */
export const STORE_REPLICA_BUCKET_NAME = 'salishsea-io-store-replica';
export const STORE_REPLICA_PREFIX = 'store';
/** Where `scripts/deploy-dev.sh` puts the site dev.salishsea.io serves (decision 072). */
export const DEV_SITE_BUCKET_NAME = 'salishsea-io-dev-site';

/**
 * The secret CloudFront sends the Fly app on /api/* requests as `x-origin-verify`, the
 * same value as the Fly app's EDGE_SECRET.
 *
 * The API believes CloudFront-Viewer-Address, the feedback rate limit's key, only on a
 * request carrying it, because the Fly app is also reachable directly and anyone could
 * send that header there. So a deploy without the secret would not fail anything
 * visible: the API would quietly key every sender by the CloudFront edge that carried
 * them, and one busy edge would hold back everyone behind it. Refused here instead.
 */
export function edgeSecretFromContext(value: unknown): string {
  if (typeof value !== 'string' || value.length < 32) {
    throw new Error(
      'edgeSecret missing or shorter than 32 characters. The deploy workflow passes the ' +
      "EDGE_SECRET repository secret as --context edgeSecret=...; it must equal the Fly app's EDGE_SECRET.",
    );
  }
  return value;
}

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Log group for the Lambda@Edge function. The named group below is the
    // CFN-managed one, but Lambda@Edge REPLICAS auto-create a group with this
    // same NAME in whichever region executed the request (us-east-2 for an ORD
    // hit, etc.) — to read edge logs, search for this name in the region
    // nearest the POP, not (only) here. Auto-created twins default to
    // never-expire retention; the setting below governs only this group.
    const ogLogGroup = new logs.LogGroup(this, 'OgMetaFunctionLogGroup', {
      logGroupName: '/salishsea/edge-og-meta',
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Bake Supabase config into the edge bundle at synth time. Lambda@Edge
    // forbids environment variables, and neither value is secret — the anon key
    // ships in every browser bundle. Overwrites the tsc-compiled config.js
    // placeholder; a synth without --context supabaseAnonKey (unit tests) bakes
    // an empty key, which the handler treats as fail-open.
    const supabaseAnonKey = this.node.tryGetContext('supabaseAnonKey') ?? '';
    fs.writeFileSync(
      path.join(__dirname, 'edge-handler', 'config.js'),
      '// Generated at synth by infra-stack.ts — do not edit.\n' +
      `module.exports = { SUPABASE_URL: ${JSON.stringify(SUPABASE_URL)}, ` +
      `SUPABASE_ANON_KEY: ${JSON.stringify(supabaseAnonKey)} };\n`,
    );

    // Lambda@Edge function — automatically provisioned in us-east-1 regardless of stack region
    assertEdgeHandlerBuilt(fs.existsSync(path.join(__dirname, 'edge-handler', 'index.js')));
    const ogFunction = new cloudfront.experimental.EdgeFunction(this, 'OgMetaFunction', {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      // Ship only the runtime .js — a test-file edit must not republish the
      // edge function (each publish is a CloudFront distribution update).
      code: lambda.Code.fromAsset(path.join(__dirname, 'edge-handler'), {
        exclude: ['*.ts', '*.test.*'],
      }),
      // DO NOT set environment — Lambda@Edge does not support environment variables
      // 5s is the maximum for viewer-request; the handler's own fetch deadline
      // (FETCH_TIMEOUT_MS) must stay comfortably below it (salish-g9e)
      timeout: cdk.Duration.seconds(5),
      logGroup: ogLogGroup,
    });

    // --- Card renderer: map images for link previews (decision 020) ---
    // A regional Lambda, not another edge function: it needs sharp, ~18 tile
    // fetches and a second of CPU, none of which fit the 128MB/5s viewer-request
    // budget. The edge handler only names the URL; this renders it.
    // Built by `npm run build` (scripts/bundle-card-renderer.mjs), which pins
    // sharp's native binary to linux/x64/glibc to match `architecture` below.
    // The bundle is gitignored, so a clean checkout has none until that runs.
    const cardBundle = path.join(__dirname, 'card-renderer', 'bundle');

    const cardRendererCode =
      cardRendererSource(
        fs.existsSync(cardBundle),
        stubAllowedFromContext(this.node.tryGetContext('allowStubCardRenderer')),
      ) === 'bundle'
        ? lambda.Code.fromAsset(cardBundle)
        : lambda.Code.fromInline('exports.handler = async () => ({ statusCode: 503 });');

    const cardRenderer = new lambda.Function(this, 'CardRenderer', {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.X86_64,
      handler: 'handler.handler',
      code: cardRendererCode,
      // Lambda scales CPU with memory; sharp is CPU-bound, and 1 GB is where
      // compositing a 1200x630 card stops being the slow part.
      memorySize: 1024,
      // Generous next to the ~1s observed locally: a cold start plus a slow tile
      // host should still produce a card rather than a 500.
      timeout: cdk.Duration.seconds(15),
      environment: {
        SUPABASE_URL,
        // Same value the browser bundle ships; not a secret.
        SUPABASE_ANON_KEY: supabaseAnonKey,
        // The Lambda image ships no fonts, so librsvg draws every glyph as a
        // .notdef box while still returning a valid JPEG — invisible to any
        // check that doesn't look at the picture. Point fontconfig at the fonts
        // bundled beside the handler (/var/task is the deployment root).
        FONTCONFIG_PATH: '/var/task/fonts',
      },
      logGroup: new logs.LogGroup(this, 'CardRendererLogGroup', {
        logGroupName: '/salishsea/card-renderer',
        retention: logs.RetentionDays.THREE_MONTHS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // AWS_IAM + OAC so the function is reachable only through CloudFront —
    // otherwise the raw URL is an uncached, unthrottled render endpoint.
    const cardRendererUrl = cardRenderer.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });
    const cardOrigin = origins.FunctionUrlOrigin.withOriginAccessControl(cardRendererUrl);

    // S3 bucket for CloudFront access logs
    const logBucket = new s3.Bucket(this, 'LogBucket', {
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      lifecycleRules: [{ expiration: cdk.Duration.days(90) }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Where the nightly database dump and the media mirror land (decision 038).
    //
    // Its own bucket, and not a prefix in the site bucket, for one reason that
    // is not a matter of taste: `salishsea-io` carries a bucket policy granting
    // `s3:GetObject` to `Principal: "*"` on `/*`, with public access block off.
    // Every object in it is world-readable to anyone who knows the key, and a
    // dump of this database contains `auth.users`. A prefix would not have
    // helped — the policy has no prefix condition.
    //
    // Versioned because a backup that can be overwritten can be destroyed by
    // the same accident it exists to survive; RETAIN because a stack teardown
    // must not take the backups with it.
    const backupBucket = new s3.Bucket(this, 'BackupBucket', {
      // Named explicitly, and not left to CloudFormation, so the workflow that
      // writes here does not need a generated name plumbed through a repository
      // variable — which would have to be set by hand after the first deploy,
      // i.e. exactly when nobody is watching. `backup-bucket-name.test.ts`
      // fails if this and the workflow's literal drift apart.
      bucketName: BACKUP_BUCKET_NAME,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      lifecycleRules: [
        {
          // Dated dumps: a quarter of daily history, then gone. At ~35 MB
          // compressed that is under 4 GB standing.
          id: 'expire-dumps',
          prefix: 'db/',
          expiration: cdk.Duration.days(90),
          noncurrentVersionExpiration: cdk.Duration.days(30),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
        {
          // Nothing deletes from the mirror, so this rule only ages out versions
          // superseded by a re-upload under the same name. Current objects stay
          // for good, which for a photo backup is the point.
          id: 'retire-media-versions',
          prefix: 'media/',
          noncurrentVersionExpiration: cdk.Duration.days(365),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    new cdk.CfnOutput(this, 'BackupBucketName', {
      value: backupBucket.bucketName,
      description: 'Nightly database dump and media mirror (decision 038)',
    });

    // --- The store's infrastructure (decision 065) ---
    // Users' photos. Private to everyone but CloudFront, which reads it through origin
    // access control and serves it at salishsea.io/media/<key>: a photo's URL belongs to
    // the site, not to a bucket, so the bucket can change without rewriting a sighting.
    // "Public" in 065's sense means readable at that URL, not a public bucket policy (see
    // BackupBucket above on what a public policy has cost before). Keys keep the path:
    // salishsea.io/media/a/b.jpg is the object media/a/b.jpg.
    //
    // Versioned so an overwrite or a delete can be undone; a superseded version is kept
    // a year, as the backup mirror keeps its own.
    const mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      bucketName: MEDIA_BUCKET_NAME,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      lifecycleRules: [{
        id: 'retire-superseded-photos',
        noncurrentVersionExpiration: cdk.Duration.days(365),
        abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
      }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Litestream's replica of the store, beside the nightly backups and private like
    // them. Litestream writes a snapshot and a stream of WAL segments and deletes the
    // ones its retention no longer needs; versioning keeps a deleted segment for 30
    // days, so a mistaken retention setting or a bad credential is recoverable.
    const replicaBucket = new s3.Bucket(this, 'StoreReplicaBucket', {
      bucketName: STORE_REPLICA_BUCKET_NAME,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      lifecycleRules: [{
        id: 'retire-deleted-segments',
        noncurrentVersionExpiration: cdk.Duration.days(30),
        abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
      }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // The Fly machine's identity for both: it may add photos and keep the replica, and
    // nothing else. A user, not a role, because Fly has no AWS identity to assume one
    // from. Its access key is made by hand and set as Fly secrets, so the secret never
    // passes through CloudFormation (docs/runbook/read-path-build.md).
    //
    // Photos are add-only: deleting a sighting leaves its photos, as Supabase's storage
    // did, and the API cannot destroy one. Litestream needs to list, read (a restore),
    // write and delete under its prefix.
    const storeWriter = new iam.User(this, 'StoreWriter', { userName: 'salishsea-io-store-writer' });
    storeWriter.addToPolicy(new iam.PolicyStatement({
      sid: 'AddPhotos',
      actions: ['s3:PutObject'],
      resources: [mediaBucket.arnForObjects('media/*')],
    }));
    storeWriter.addToPolicy(new iam.PolicyStatement({
      sid: 'ListReplica',
      actions: ['s3:ListBucket'],
      resources: [replicaBucket.bucketArn],
      conditions: { StringLike: { 's3:prefix': [`${STORE_REPLICA_PREFIX}/*`, STORE_REPLICA_PREFIX] } },
    }));
    storeWriter.addToPolicy(new iam.PolicyStatement({
      sid: 'KeepReplica',
      actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      resources: [replicaBucket.arnForObjects(`${STORE_REPLICA_PREFIX}/*`)],
    }));
    new cdk.CfnOutput(this, 'StoreWriterName', {
      value: storeWriter.userName,
      description: "The Fly machine's AWS identity: photos and the store's replica (decision 065)",
    });

    // No origin in the site bucket any more (decision 061, salish-xv35.9): since
    // 2026-10-03 the Fly app serves the site, and since 2026-10-04 the Darwin Core
    // archive too, so nothing CloudFront answers comes from the salishsea-io bucket.
    // (Users' photos are a different bucket, above.) The deploy workflow still
    // syncs the Supabase-mode site into it, and the last nightly archive is still there,
    // but a behavior pointed back at the bucket would be a DEGRADED fallback, not a
    // rollback: that site reads a Postgres that stopped following two of the three
    // sources on 2026-10-04. The rollback is a Fly image — docs/runbook/deploys.md.
    // The origin's code is in git (#555, and the change that removed /dwca/*).

    // The Fly app (decision 056): the site built to read static files, the files the
    // read-path build writes every five minutes, the prerendered profile pages and their
    // redirects. Its redirects are relative and its pages are no-cache, so CloudFront
    // passes both through as they are.
    const flyOrigin = new origins.HttpOrigin('salishsea-io.fly.dev', {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    // The same app as the API's origin (decision 065), carrying the secret that tells the
    // API a request came through CloudFront (see edgeSecretFromContext). On its own origin
    // so the secret goes only where it is read. It is in the synthesized template, so
    // anyone who can read this stack's template or the distribution's config in the
    // account can read it; what it protects is only the feedback rate limit's key.
    const apiOrigin = new origins.HttpOrigin('salishsea-io.fly.dev', {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      customHeaders: { 'x-origin-verify': edgeSecretFromContext(this.node.tryGetContext('edgeSecret')) },
    });

    // CloudFront Distribution — reconstructed to match production config
    new cloudfront.Distribution(this, 'SalishSeaDist', {
      logBucket,
      logFilePrefix: 'cloudfront/',
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      domainNames: ['salishsea.io'],
      certificate: acm.Certificate.fromCertificateArn(
        this, 'Cert',
        `arn:aws:acm:us-east-1:${ACCOUNT_ID}:certificate/8cfdef8d-648b-42ba-a525-045f7b1a7762`,
      ),
      defaultBehavior: {
        origin: flyOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.fromCachePolicyId(
          this, 'CachePolicy', '658327ea-f89d-4fab-a63d-7e88639e58f6',
        ),
        edgeLambdas: [
          {
            functionVersion: ogFunction.currentVersion,
            eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        // The Darwin Core archive (/dwca/*) has no behavior of its own since
        // 2026-10-04: the read-path build writes it and the Fly app serves it under
        // the default behavior, whose edge function passes every path but / through
        // untouched, so a crawler still gets the bytes.
        // Preview card images. No edge function here: the OG handler's whole job
        // is to name these URLs, and letting it intercept its own images is the
        // bug that broke previews once already.
        '/cards/*': {
          origin: cardOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          // JPEG is already compressed; re-compressing costs CPU for nothing.
          compress: false,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          // The path is the entire cache key — no query strings, cookies or
          // headers vary a card. TTLs come from the renderer's Cache-Control,
          // which distinguishes an immutable past card from today's.
          cachePolicy: new cloudfront.CachePolicy(this, 'CardCachePolicy', {
            cachePolicyName: 'salishsea-cards',
            comment: 'Preview card images; keyed on path alone, TTL from origin',
            // These bound whatever the renderer asks for, and exist as a
            // backstop rather than a policy: the renderer sets Cache-Control
            // per card (see card-renderer/cache-control.ts).
            //
            // defaultTtl applies only if the renderer ever sends no header at
            // all — five minutes, so a header regression costs minutes rather
            // than the month it would otherwise inherit.
            defaultTtl: cdk.Duration.minutes(5),
            minTtl: cdk.Duration.seconds(0),
            // maxTtl caps the origin's own max-age. A year of caching over a
            // card that turned out to be broken is exactly what happened on
            // 2026-07-27 (fontless cards, cached immutable); this makes the
            // worst case a month even if a future change asks for longer.
            maxTtl: cdk.Duration.days(30),
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
            cookieBehavior: cloudfront.CacheCookieBehavior.none(),
            headerBehavior: cloudfront.CacheHeaderBehavior.none(),
            enableAcceptEncodingGzip: false,
            enableAcceptEncodingBrotli: false,
          }),
        },
        // After /cards/*, because CloudFront origins are numbered in order of use: a new
        // origin ahead of the renderer's would renumber it, and replace its access control.
        // The write API (decision 065). The default behavior is set up for a static site
        // and would break it three ways: it allows only GET and HEAD, so a save or a
        // sign-in is refused at the edge; it forwards no cookies and no Origin, so the
        // API sees no session and refuses every write as cross-site; and it caches, so
        // one person's /api/me could be served to the next. Nothing here is cached.
        // Host is not forwarded: Fly routes by it, and it must name the Fly app.
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          // CachingDisabled turns CloudFront's compression off anyway; Caddy compresses.
          compress: false,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: new cloudfront.OriginRequestPolicy(this, 'ApiOriginRequestPolicy', {
            originRequestPolicyName: 'salishsea-api',
            comment: 'The write API: its session cookie, the Origin it checks, the viewer address it rate-limits by',
            cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
            headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
              'Origin', 'Content-Type', 'CloudFront-Viewer-Address',
            ),
            queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
          }),
        },
        // Users' photos, from their bucket (decision 065). No edge function: the OG
        // handler names pages, not images. JPEG is already compressed.
        '/media/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(mediaBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          compress: false,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
      },
    });

    // --- dev.salishsea.io (decision 072) ---
    // A frontend built from any branch, in front of production's data: the app comes from
    // its own bucket, put there by scripts/deploy-dev.sh, and everything a signed-out
    // visitor reads besides the app is passed through to the Fly app. So it shows what a
    // change to the map looks like on today's sightings, without a second read-path build.
    //
    // Read-only by construction. /api/* is GET and HEAD only, with no cookies forwarded,
    // so /api/me answers "nobody" and nothing can be written; the API would refuse a
    // write from this origin anyway (DEFAULT_ORIGINS in api/server.ts). No edge function,
    // so no preview cards, and no profile pages: Fly prerenders them around its own
    // build's hashed assets, which this bucket doesn't have.
    const devSiteBucket = new s3.Bucket(this, 'DevSiteBucket', {
      bucketName: DEV_SITE_BUCKET_NAME,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const devFlyOrigin = new origins.HttpOrigin('salishsea-io.fly.dev', {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });
    // A copy of the site under another name is not something a search engine should list.
    const devNoIndex = new cloudfront.ResponseHeadersPolicy(this, 'DevNoIndex', {
      responseHeadersPolicyName: 'salishsea-dev-noindex',
      comment: 'dev.salishsea.io: keep the copy out of search results',
      customHeadersBehavior: {
        customHeaders: [{ header: 'X-Robots-Tag', value: 'noindex, nofollow', override: true }],
      },
    });
    const devPassThrough: cloudfront.BehaviorOptions = {
      origin: devFlyOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      compress: true,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      // As production's default behavior: the Fly app sends these files no-cache.
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      responseHeadersPolicy: devNoIndex,
    };
    const devDist = new cloudfront.Distribution(this, 'DevDist', {
      comment: 'dev.salishsea.io: a branch build over production data (decision 072)',
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      domainNames: ['dev.salishsea.io'],
      certificate: acm.Certificate.fromCertificateArn(
        this, 'DevCert',
        `arn:aws:acm:us-east-1:${ACCOUNT_ID}:certificate/325c4a00-c72c-4820-8514-943d688f3c82`,
      ),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(devSiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        // The deploy script invalidates everything, so a day's caching of index.html
        // never outlives a deploy.
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: devNoIndex,
      },
      additionalBehaviors: {
        '/read-path/*': devPassThrough,
        '/status/*': devPassThrough,
        '/dwca/*': devPassThrough,
        '/api/*': {
          ...devPassThrough,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          compress: false,
        },
      },
    });
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: 'Z0267557TOKCHC5IUMVH',
      zoneName: 'salishsea.io',
    });
    const devTarget = route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(devDist));
    new route53.ARecord(this, 'DevARecord', { zone, recordName: 'dev', target: devTarget });
    new route53.AaaaRecord(this, 'DevAaaaRecord', { zone, recordName: 'dev', target: devTarget });
    new cdk.CfnOutput(this, 'DevDistributionId', {
      value: devDist.distributionId,
      description: 'dev.salishsea.io, which scripts/deploy-dev.sh invalidates (decision 072)',
    });

    // --- Site-monitoring analytics over the CloudFront access logs (Glue + Athena) ---
    // Ad-hoc analysis layer: a Glue catalog table over the access logs in `logBucket`, plus
    // saved Athena queries. Query source of truth is infra/athena/*.sql; usage in infra/athena/README.md.

    const athenaResultsBucket = new s3.Bucket(this, 'AthenaResults', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const LOGS_DB = 'salishsea_logs';

    const logsDatabase = new glue.CfnDatabase(this, 'LogsDatabase', {
      catalogId: ACCOUNT_ID,
      databaseInput: {
        name: LOGS_DB,
        description: 'CloudFront access-log analytics for salishsea.io',
      },
    });

    // External table over the CloudFront standard (legacy) access logs. Field order is fixed
    // by the CloudFront log format — see the #Fields header line in any log file.
    const cloudfrontLogColumns: glue.CfnTable.ColumnProperty[] = [
      { name: 'date', type: 'date' }, { name: 'time', type: 'string' },
      { name: 'location', type: 'string' }, { name: 'sc_bytes', type: 'bigint' },
      { name: 'request_ip', type: 'string' }, { name: 'method', type: 'string' },
      { name: 'host', type: 'string' }, { name: 'uri', type: 'string' },
      { name: 'status', type: 'int' }, { name: 'referrer', type: 'string' },
      { name: 'user_agent', type: 'string' }, { name: 'query_string', type: 'string' },
      { name: 'cookie', type: 'string' }, { name: 'result_type', type: 'string' },
      { name: 'request_id', type: 'string' }, { name: 'host_header', type: 'string' },
      { name: 'request_protocol', type: 'string' }, { name: 'cs_bytes', type: 'bigint' },
      { name: 'time_taken', type: 'float' }, { name: 'xforwarded_for', type: 'string' },
      { name: 'ssl_protocol', type: 'string' }, { name: 'ssl_cipher', type: 'string' },
      { name: 'response_result_type', type: 'string' }, { name: 'http_version', type: 'string' },
      { name: 'fle_status', type: 'string' }, { name: 'fle_encrypted_fields', type: 'int' },
      { name: 'c_port', type: 'int' }, { name: 'time_to_first_byte', type: 'float' },
      { name: 'x_edge_detailed_result_type', type: 'string' }, { name: 'sc_content_type', type: 'string' },
      { name: 'sc_content_len', type: 'bigint' }, { name: 'sc_range_start', type: 'bigint' },
      { name: 'sc_range_end', type: 'bigint' },
    ];

    const cloudfrontLogsTable = new glue.CfnTable(this, 'CloudFrontLogsTable', {
      catalogId: ACCOUNT_ID,
      databaseName: LOGS_DB,
      tableInput: {
        name: 'cloudfront_logs',
        description: 'CloudFront standard (legacy) access logs for salishsea.io',
        tableType: 'EXTERNAL_TABLE',
        parameters: { EXTERNAL: 'TRUE', 'skip.header.line.count': '2' },
        storageDescriptor: {
          columns: cloudfrontLogColumns,
          location: `s3://${logBucket.bucketName}/cloudfront/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe',
            parameters: { 'field.delim': '\t' },
          },
        },
      },
    });
    cloudfrontLogsTable.addDependency(logsDatabase);

    // Dedicated workgroup so monitoring queries write results to the bucket above by default.
    const workgroup = new athena.CfnWorkGroup(this, 'MonitoringWorkGroup', {
      name: 'salishsea-monitoring',
      recursiveDeleteOption: true,
      workGroupConfiguration: {
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: false,
        resultConfiguration: {
          outputLocation: `s3://${athenaResultsBucket.bucketName}/`,
        },
      },
    });

    // Save every infra/athena/*.sql file as a named query (source of truth = the .sql files).
    // human_pageviews_view.sql is one of these — run it once after deploy to (re)create the view.
    const athenaDir = path.join(__dirname, '..', 'athena');
    for (const file of fs.readdirSync(athenaDir).filter((f) => f.endsWith('.sql')).sort()) {
      const slug = file.replace(/\.sql$/, '');
      const namedQuery = new athena.CfnNamedQuery(this, 'NamedQuery' + slug.replace(/[^a-zA-Z0-9]/g, ''), {
        name: slug,
        database: LOGS_DB,
        queryString: fs.readFileSync(path.join(athenaDir, file), 'utf8'),
        workGroup: workgroup.name,
      });
      namedQuery.addDependency(workgroup);
    }
  }
}
