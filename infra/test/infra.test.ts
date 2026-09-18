import * as cdk from 'aws-cdk-lib';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { InfraStack, cardRendererSource, stubAllowedFromContext } from '../lib/infra-stack';

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
describe('the edge-handler asset carries only the runtime', () => {
  let files: string[];
  let bytes: number;

  beforeAll(() => {
    // A real synth into a scratch outdir: asset staging is what we are asserting
    // on, and Template.fromStack alone does not stage.
    const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-asset-'));
    const app = new cdk.App({ outdir, context: { allowStubCardRenderer: true } });
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
    const edge = staged.find((f) => f.includes('index.js') && f.includes('config.js'));
    if (!edge) throw new Error(`no edge-handler asset staged; saw ${JSON.stringify(staged.map(f => f.slice(0, 3)))}`);
    files = edge;

    const dir = fs.readdirSync(outdir).filter((n) => n.startsWith('asset.'))
      .map((n) => path.join(outdir, n))
      .find((d) => fs.existsSync(path.join(d, 'index.js')) && fs.existsSync(path.join(d, 'config.js')))!;
    bytes = files.reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
  });

  it('is exactly the handler and its baked config', () => {
    expect(files.sort()).toEqual(['config.js', 'index.js']);
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

describe('InfraStack', () => {
  let template: Template;
  beforeAll(() => {
    // Tests synthesize without building the card-renderer bundle; a deploy may
    // not (see the guard in infra-stack.ts).
    const app = new cdk.App({ context: { allowStubCardRenderer: true } });
    const stack = new InfraStack(app, 'TestStack', {
      env: { account: '648183724555', region: 'us-east-1' },
    });
    template = Template.fromStack(stack);
  });

  it('creates the OG meta and card renderer functions', () => {
    template.resourceCountIs('AWS::Lambda::Function', 2);
  });

  it('creates a CloudFront Distribution', () => {
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
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
      const behaviors = template.toJSON()
        .Resources[Object.keys(template.toJSON().Resources)
          .find(k => template.toJSON().Resources[k].Type === 'AWS::CloudFront::Distribution')!]
        .Properties.DistributionConfig.CacheBehaviors;
      const cards = behaviors.find((b: { PathPattern: string }) => b.PathPattern === '/cards/*');
      expect(cards.LambdaFunctionAssociations).toBeUndefined();
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

    it('gives the renderer the Supabase config it reads at runtime', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'handler.handler',
        Environment: { Variables: Match.objectLike({ SUPABASE_URL: Match.anyValue() }) },
      });
    });
  });
});
