import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
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

  it('creates a Lambda function for OG meta injection', () => {
    template.resourceCountIs('AWS::Lambda::Function', 1);
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
});
