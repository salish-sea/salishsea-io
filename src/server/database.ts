import {DuckDBConnection, DuckDBInstance} from '@duckdb/node-api';

const dbinst = await DuckDBInstance.create('salishsea.duckdb');
export async function withConnection<T>(f: (arg0: DuckDBConnection) => T) {
  const dbconn = await dbinst.connect();
  try {
    return await f(dbconn);
  } finally {
    dbconn.close();
  }
}
