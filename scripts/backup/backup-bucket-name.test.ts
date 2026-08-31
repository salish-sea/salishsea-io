import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf-8');

describe('the backup bucket is named once', () => {
  // CDK creates the bucket; the workflow writes to it. Neither can read the
  // other, and a mismatch does not fail loudly — `aws s3 cp` to a bucket that
  // does not exist fails the run, but `aws s3 ls` on the media prefix is
  // tolerated, so a renamed bucket could produce a run that looks partly fine
  // while backing nothing up. Pin them together instead.
  const WORKFLOWS = [
    '.github/workflows/db-backup-nightly.yml',
    '.github/workflows/db-restore-verify.yml',
  ];

  it('agrees between infra/lib/infra-stack.ts and every workflow that names it', () => {
    const cdk = /export const BACKUP_BUCKET_NAME = '([^']+)'/.exec(read('infra/lib/infra-stack.ts'));
    expect(cdk, 'BACKUP_BUCKET_NAME not found in infra/lib/infra-stack.ts').not.toBeNull();

    for (const path of WORKFLOWS) {
      const workflow = /^ +BACKUP_BUCKET: (\S+)$/m.exec(read(path));
      expect(workflow, `BACKUP_BUCKET not found in ${path}`).not.toBeNull();
      expect(workflow![1], `${path} names a different bucket`).toBe(cdk![1]);
    }
  });

  it('names every workflow that mentions the bucket', () => {
    // The test above is only as good as its list. A third workflow writing to
    // the backup bucket without being listed here would drift unnoticed, which
    // is the failure this whole pair of tests exists to prevent.
    const all = readdirSync(join(process.cwd(), '.github/workflows'))
      .map(file => join('.github/workflows', file))
      .filter(path => read(path).includes('BACKUP_BUCKET'));
    expect(all.sort()).toEqual(WORKFLOWS.sort());
  });

  it('is not the public site bucket', () => {
    // salishsea-io carries a bucket policy granting s3:GetObject to
    // Principal "*" on /*. A dump of this database contains auth.users.
    const cdk = /export const BACKUP_BUCKET_NAME = '([^']+)'/.exec(read('infra/lib/infra-stack.ts'))!;
    expect(cdk[1]).not.toBe('salishsea-io');
  });
});
