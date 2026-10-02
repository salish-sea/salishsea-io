/**
 * For tests against the local Supabase: run `body` inside one transaction that is always
 * rolled back, so a test that writes rows never shows them to another test file running
 * beside it (vitest runs files in parallel, and the grants and snapshot tests count rows).
 *
 * `body` gets a Sql whose `begin` opens a savepoint inside that transaction, for code
 * like the persist functions that open their own transaction, and the transaction itself
 * for reading what was written. Whatever `body` returns is returned.
 */

import type { Sql, TransactionSql } from 'postgres';

class RolledBack extends Error {}

export async function rolledBack<T>(sql: Sql, body: (nested: Sql, tx: TransactionSql) => Promise<T>): Promise<T> {
    let result: T | undefined;
    await sql.begin(async tx => {
        const nested = new Proxy(tx, {
            get: (target, key) => key === 'begin'
                ? (fn: (sql: TransactionSql) => unknown) => target.savepoint(fn)
                : Reflect.get(target, key),
        }) as unknown as Sql;
        result = await body(nested, tx);
        throw new RolledBack();
    }).catch(e => { if (!(e instanceof RolledBack)) throw e; });
    return result as T;
}
