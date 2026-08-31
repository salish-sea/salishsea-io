import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf-8');

describe('the backup bucket is named once', () => {
  // CDK creates the bucket; the workflow writes to it. Neither can read the
  // other, and a mismatch does not fail loudly — `aws s3 cp` to a bucket that
  // does not exist fails the run, but `aws s3 ls` on the media prefix is
  // tolerated, so a renamed bucket could produce a run that looks partly fine
  // while backing nothing up. Pin them together instead.
  it('agrees between infra/lib/infra-stack.ts and the nightly workflow', () => {
    const cdk = /export const BACKUP_BUCKET_NAME = '([^']+)'/.exec(read('infra/lib/infra-stack.ts'));
    const workflow = /^ +BACKUP_BUCKET: (\S+)$/m.exec(read('.github/workflows/db-backup-nightly.yml'));

    expect(cdk, 'BACKUP_BUCKET_NAME not found in infra/lib/infra-stack.ts').not.toBeNull();
    expect(workflow, 'BACKUP_BUCKET not found in db-backup-nightly.yml').not.toBeNull();
    expect(workflow![1]).toBe(cdk![1]);
  });

  it('is not the public site bucket', () => {
    // salishsea-io carries a bucket policy granting s3:GetObject to
    // Principal "*" on /*. A dump of this database contains auth.users.
    const cdk = /export const BACKUP_BUCKET_NAME = '([^']+)'/.exec(read('infra/lib/infra-stack.ts'))!;
    expect(cdk[1]).not.toBe('salishsea-io');
  });
});
