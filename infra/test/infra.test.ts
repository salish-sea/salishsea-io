import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { InfraStack } from '../lib/infra-stack';

describe('InfraStack', () => {
  let template: Template;
  beforeAll(() => {
    const app = new cdk.App();
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

    it('gives the renderer the Supabase config it reads at runtime', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'handler.handler',
        Environment: { Variables: Match.objectLike({ SUPABASE_URL: Match.anyValue() }) },
      });
    });
  });
});
