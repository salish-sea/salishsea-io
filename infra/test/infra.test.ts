import * as cdk from 'aws-cdk-lib';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Match, Template } from 'aws-cdk-lib/assertions';
import {
  DEV_SITE_BUCKET_NAME, InfraStack, MEDIA_BUCKET_NAME, STORE_REPLICA_BUCKET_NAME, assertEdgeHandlerBuilt, cardRendererSource,
  edgeSecretFromContext, stubAllowedFromContext,
} from '../lib/infra-stack';

const EDGE_SECRET = 'test-edge-secret-0123456789abcdef0123';

describe('stubAllowedFromContext', () => {
  it('accepts the string a CLI --context flag actually produces', () => {
    // `cdk synth --context allowStubCardRenderer=true` yields "true", not true.
    expect(stubAllowedFromContext('true')).toBe(true);
  });

  it('accepts the boolean a test App passes directly', () => {
    expect(stubAllowedFromContext(true)).toBe(true);
  });

  it.each([undefined, false, 'false', 'yes', '1', null, ''])('rejects %p', (value) => {
    expect(stubAllowedFromContext(value)).toBe(false);
  });
});

describe('cardRendererSource', () => {
  it('uses the built bundle when there is one', () => {
    expect(cardRendererSource(true, false)).toBe('bundle');
    expect(cardRendererSource(true, true)).toBe('bundle');
  });

  it('lets a test opt into the stub', () => {
    expect(cardRendererSource(false, true)).toBe('stub');
  });

  it('refuses to deploy a stub behind a live /cards/* behavior', () => {
    // `cdk deploy` from a clean checkout would otherwise ship a function that
    // 503s at every crawler, and the only symptom would be imageless previews.
    expect(() => cardRendererSource(false, false)).toThrow(/npm run build/);
  });
});

/**
 * What actually reaches Lambda@Edge (salish-7iu).
 *
 * `Code.fromAsset` is pointed at the edge-handler SOURCE directory, which holds
 * `index.ts`, `index.test.ts` and everything `tsc` emits beside them — so the
 * asset is defined by its `exclude` and by nothing else. Two reasons that
 * matters, and neither of them announces itself:
 *
 *   - A viewer-request function has a hard 1 MB code limit, and `index.test.js`
 *     alone is 152 KB against the handler's 81 KB.
 *   - Every publish of an edge function is a CloudFront distribution update, so
 *     shipping test files means editing a test republishes the distribution.
 *
 * Drop the `exclude` and nothing fails: the deploy succeeds, the handler works,
 * and the asset quietly carries the whole source tree. This is the only place
 * that would notice.
 */
describe('assertEdgeHandlerBuilt', () => {
  it('passes once tsc has emitted the handler', () => {
    expect(() => assertEdgeHandlerBuilt(true)).not.toThrow();
  });

  it('refuses a synth that would ship an edge function with no handler', () => {
    // Found while writing the asset test below: on an unbuilt tree the asset
    // stages cleanly with nothing in it, and nothing —
    // CDK, CloudFormation, CloudFront — objects until a viewer request arrives.
    expect(() => assertEdgeHandlerBuilt(false)).toThrow(/pnpm run build/);
  });
});

describe('the edge-handler asset carries only the runtime', () => {
  let files: string[];
  let bytes: number;

  beforeAll(() => {
    // A real synth into a scratch outdir: asset staging is what we are asserting
    // on, and Template.fromStack alone does not stage.
    const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-asset-'));
    const app = new cdk.App({ outdir, context: { allowStubCardRenderer: true, edgeSecret: EDGE_SECRET } });
    new InfraStack(app, 'AssetStack', { env: { account: '648183724555', region: 'us-east-1' } });
    app.synth();

    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

    // Identified by content, not by hash: the hash changes with every handler
    // edit, and the card renderer is the only other asset (it has handler.js,
    // fonts and node_modules, so index.js tells them apart).
    const staged = fs.readdirSync(outdir)
      .filter((n) => n.startsWith('asset.'))
      .map((n) => path.join(outdir, n))
      .map((dir) => walk(dir).map((f) => path.relative(dir, f)));
    const edge = staged.find((f) => f.includes('index.js') && !f.includes('handler.js'));
    if (!edge) throw new Error(`no edge-handler asset staged; saw ${JSON.stringify(staged.map(f => f.slice(0, 3)))}`);
    files = edge;

    const dir = fs.readdirSync(outdir).filter((n) => n.startsWith('asset.'))
      .map((n) => path.join(outdir, n))
      .find((d) => fs.existsSync(path.join(d, 'index.js')) && !fs.existsSync(path.join(d, 'handler.js')))!;
    bytes = files.reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
  });

  it('is exactly the handler', () => {
    expect(files).toEqual(['index.js']);
  });

  it('carries no test file and no TypeScript source', () => {
    // Asserted separately from the list above so a failure says which rule broke.
    expect(files.filter((f) => f.includes('.test.'))).toEqual([]);
    expect(files.filter((f) => f.endsWith('.ts'))).toEqual([]);
  });

  it('stays well under the 1 MB Lambda@Edge viewer-request limit', () => {
    expect(bytes).toBeGreaterThan(1024); // a stub or an empty stage would also "pass" the checks above
    expect(bytes).toBeLessThan(500 * 1024);
  });
});

describe('edgeSecretFromContext', () => {
  it('passes a secret long enough to be one', () => {
    expect(edgeSecretFromContext(EDGE_SECRET)).toBe(EDGE_SECRET);
  });

  it.each([undefined, '', 'short', 42])('refuses %p: a deploy without it would key every feedback sender by its edge', (value) => {
    expect(() => edgeSecretFromContext(value)).toThrow(/edgeSecret/);
  });
});

describe('InfraStack', () => {
  let template: Template;
  const distFor = (alias: string) => (Object.values(template.findResources('AWS::CloudFront::Distribution'))
    .find((d: any) => d.Properties.DistributionConfig.Aliases?.includes(alias)) as any).Properties.DistributionConfig;
  const distConfig = () => distFor('salishsea.io');
  const behavior = (pattern: string) => distConfig().CacheBehaviors.find((b: any) => b.PathPattern === pattern);
  beforeAll(() => {
    // Tests synthesize without building the card-renderer bundle; a deploy may
    // not (see the guard in infra-stack.ts).
    const app = new cdk.App({ context: { allowStubCardRenderer: true, edgeSecret: EDGE_SECRET } });
    const stack = new InfraStack(app, 'TestStack', {
      env: { account: '648183724555', region: 'us-east-1' },
    });
    template = Template.fromStack(stack);
  });

  it('creates the OG meta and card renderer functions', () => {
    template.resourceCountIs('AWS::Lambda::Function', 2);
  });

  it("creates salishsea.io's distribution and dev.salishsea.io's", () => {
    template.resourceCountIs('AWS::CloudFront::Distribution', 2);
  });

  it('attaches Lambda@Edge on VIEWER_REQUEST to the default behavior', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        DefaultCacheBehavior: {
          LambdaFunctionAssociations: [
            { EventType: 'viewer-request' },
          ],
        },
      },
    });
  });

  // salish-xv35.16: salishsea.io reads the Fly app; only the nightly archive stays on S3.
  it('serves the site from the Fly app', () => {
    const config = distConfig();
    const origin = config.Origins.find((o: any) => o.Id === config.DefaultCacheBehavior.TargetOriginId);
    expect(origin.DomainName).toBe('salishsea-io.fly.dev');
    expect(origin.CustomOriginConfig.OriginProtocolPolicy).toBe('https-only');
  });

  it('has no /dwca/* behavior and no origin in the site bucket: the Fly app serves the archive under the default', () => {
    const config = distConfig();
    expect((config.CacheBehaviors ?? []).find((b: any) => b.PathPattern === '/dwca/*')).toBeUndefined();
    // the only S3 origin is the photo bucket's, reached through /media/*
    const s3Origins = config.Origins.filter((o: any) => o.S3OriginConfig !== undefined);
    expect(s3Origins).toHaveLength(1);
    expect(behavior('/media/*').TargetOriginId).toBe(s3Origins[0].Id);
  });

  describe('the write API (decision 065)', () => {
    it('allows every method, caches nothing, and has no edge function', () => {
      const api = behavior('/api/*');
      expect(api.AllowedMethods).toEqual(expect.arrayContaining(['POST', 'PUT', 'DELETE']));
      // Managed-CachingDisabled
      expect(api.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
      expect(api.LambdaFunctionAssociations).toBeUndefined();
      expect(api.ViewerProtocolPolicy).toBe('https-only');
    });

    it('forwards the session cookie, the Origin the API checks, and the viewer address, but not Host', () => {
      template.hasResourceProperties('AWS::CloudFront::OriginRequestPolicy', {
        OriginRequestPolicyConfig: Match.objectLike({
          Name: 'salishsea-api',
          CookiesConfig: { CookieBehavior: 'all' },
          HeadersConfig: {
            HeaderBehavior: 'whitelist',
            Headers: ['Origin', 'Content-Type', 'CloudFront-Viewer-Address'],
          },
        }),
      });
    });

    it('reaches the Fly app with the secret that marks a request as having come through CloudFront', () => {
      const config = distConfig();
      const origin = config.Origins.find((o: any) => o.Id === behavior('/api/*').TargetOriginId);
      expect(origin.DomainName).toBe('salishsea-io.fly.dev');
      expect(origin.OriginCustomHeaders).toEqual([{ HeaderName: 'x-origin-verify', HeaderValue: EDGE_SECRET }]);
      // and only there: the default behavior's requests do not carry it
      const site = config.Origins.find((o: any) => o.Id === config.DefaultCacheBehavior.TargetOriginId);
      expect(site.OriginCustomHeaders).toBeUndefined();
    });
  });

  describe("users' photos and the store's replica (decision 065)", () => {
    it('serves /media/* from the photo bucket through origin access control, GET and HEAD only', () => {
      const media = behavior('/media/*');
      expect(media.AllowedMethods).toEqual(['GET', 'HEAD']);
      expect(media.LambdaFunctionAssociations).toBeUndefined();
      template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
        OriginAccessControlConfig: Match.objectLike({ OriginAccessControlOriginType: 's3' }),
      });
    });

    it.each([MEDIA_BUCKET_NAME, STORE_REPLICA_BUCKET_NAME])('keeps %s private, versioned, and past a teardown', (name) => {
      const [id, bucket] = Object.entries(template.findResources('AWS::S3::Bucket'))
        .find(([, b]: [string, any]) => b.Properties.BucketName === name) as [string, any];
      expect(bucket.DeletionPolicy).toBe('Retain');
      expect(bucket.Properties.VersioningConfiguration).toEqual({ Status: 'Enabled' });
      expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true,
      });
      expect(id).toBeDefined();
    });

    it("lets the Fly machine add photos and keep the replica, and nothing else", () => {
      const policies = Object.values(template.findResources('AWS::IAM::Policy'))
        .filter((p: any) => JSON.stringify(p.Properties.Users ?? []).includes('StoreWriter'));
      expect(policies).toHaveLength(1);
      const statements = (policies[0] as any).Properties.PolicyDocument.Statement;
      const actions = statements.flatMap((s: any) => [s.Action].flat()).sort();
      expect(actions).toEqual(['s3:DeleteObject', 's3:GetObject', 's3:ListBucket', 's3:PutObject', 's3:PutObject']);
      // no wildcard resource, and no delete on photos
      expect(JSON.stringify(statements)).not.toMatch(/"Resource":"\*"/);
      const addPhotos = statements.find((s: any) => s.Sid === 'AddPhotos');
      expect(addPhotos.Action).toBe('s3:PutObject');
    });

    it('creates no access key: the secret is made by hand and never passes through CloudFormation', () => {
      template.resourceCountIs('AWS::IAM::AccessKey', 0);
    });
  });

  describe('dev.salishsea.io (decision 072)', () => {
    const dev = () => distFor('dev.salishsea.io');
    const devBehavior = (pattern: string) => dev().CacheBehaviors.find((b: any) => b.PathPattern === pattern);
    const originOf = (b: any) => dev().Origins.find((o: any) => o.Id === b.TargetOriginId);

    it('serves the app from its own private bucket', () => {
      const origin = originOf(dev().DefaultCacheBehavior);
      expect(origin.S3OriginConfig).toBeDefined();
      const [, bucket] = Object.entries(template.findResources('AWS::S3::Bucket'))
        .find(([, b]: [string, any]) => b.Properties.BucketName === DEV_SITE_BUCKET_NAME) as [string, any];
      expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true,
      });
    });

    it.each(['/read-path/*', '/status/*', '/dwca/*', '/api/*'])('passes %s through to the Fly app', (pattern) => {
      expect(originOf(devBehavior(pattern)).DomainName).toBe('salishsea-io.fly.dev');
    });

    it('cannot write: /api/* is GET and HEAD, with no cookies and no CloudFront secret', () => {
      const api = devBehavior('/api/*');
      expect(api.AllowedMethods).toEqual(['GET', 'HEAD']);
      expect(api.OriginRequestPolicyId).toBeUndefined();
      // Managed-CachingDisabled: no session to leak, but no stale "nobody" either
      expect(api.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
      for (const origin of dev().Origins) expect(origin.OriginCustomHeaders).toBeUndefined();
    });

    it('has no edge function, so a crawler gets no preview from the copy', () => {
      expect(dev().DefaultCacheBehavior.LambdaFunctionAssociations).toBeUndefined();
    });

    it('asks search engines not to index the copy', () => {
      template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
        ResponseHeadersPolicyConfig: Match.objectLike({
          CustomHeadersConfig: { Items: [Match.objectLike({ Header: 'X-Robots-Tag', Override: true })] },
        }),
      });
      for (const b of [dev().DefaultCacheBehavior, ...dev().CacheBehaviors]) {
        expect(b.ResponseHeadersPolicyId).toBeDefined();
      }
    });

    it('names itself in DNS', () => {
      for (const type of ['A', 'AAAA']) {
        template.hasResourceProperties('AWS::Route53::RecordSet', {
          Name: 'dev.salishsea.io.', Type: type, HostedZoneId: 'Z0267557TOKCHC5IUMVH',
        });
      }
    });
  });

  describe('card renderer', () => {
    it('serves /cards/* from its own behavior', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          CacheBehaviors: Match.arrayWith([
            Match.objectLike({ PathPattern: '/cards/*' }),
          ]),
        },
      });
    });

    it('keeps the OG edge function off the card behavior', () => {
      // The OG handler's job is to NAME card URLs. Letting it intercept them is
      // how preview images broke before (an HTML body served as an image).
      expect(behavior('/cards/*').LambdaFunctionAssociations).toBeUndefined();
    });

    it('reaches the renderer only through CloudFront, via IAM auth + OAC', () => {
      template.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'AWS_IAM' });
      // There is also an OAC for the S3 origin; this asserts the Lambda one.
      template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
        OriginAccessControlConfig: Match.objectLike({
          OriginAccessControlOriginType: 'lambda',
          SigningBehavior: 'always',
        }),
      });
    });

    it('caps how long a card can be cached, whatever the origin asks for', () => {
      // A year-long cache over cards that turned out to be broken is what made
      // the fontless deploy need a manual invalidation to undo.
      template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
        CachePolicyConfig: Match.objectLike({
          Name: 'salishsea-cards',
          MaxTTL: 30 * 24 * 3600,
          // Applies only if the renderer sends no Cache-Control at all.
          DefaultTTL: 300,
          MinTTL: 0,
        }),
      });
    });

    it('caches cards on the path alone', () => {
      template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
        CachePolicyConfig: Match.objectLike({
          Name: 'salishsea-cards',
          ParametersInCacheKeyAndForwardedToOrigin: Match.objectLike({
            QueryStringsConfig: { QueryStringBehavior: 'none' },
            CookiesConfig: { CookieBehavior: 'none' },
            HeadersConfig: { HeaderBehavior: 'none' },
          }),
        }),
      });
    });

    it('points fontconfig at the bundled fonts', () => {
      // The Lambda image has no fonts. Without this, librsvg draws every glyph
      // as a .notdef box and still returns a valid JPEG of plausible size — so
      // status, content-type and byte-count checks all pass while the card is
      // unreadable. That reached production on 2026-07-27.
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'handler.handler',
        Environment: { Variables: Match.objectLike({ FONTCONFIG_PATH: '/var/task/fonts' }) },
      });
    });

  });
});
