import { MongoMemoryReplSet } from 'mongodb-memory-server'

/**
 * Connection details for a test suite's own database inside the run-wide replica
 * set started by dev/globalSetup.ts. Each caller passes a distinct `dbName`, so
 * suites stay isolated by database rather than by process.
 *
 * `MEMORY_DB_URI` is `MongoMemoryReplSet#getUri()` with no db argument, which comes
 * back as `mongodb://host/?replicaSet=name` — an empty path segment followed by the
 * query string. Naively appending `dbName` to that string lands it inside the
 * `replicaSet` query value instead of the path (`?replicaSet=nameavailreasonmemory`),
 * which is a different, nonexistent replica set name and fails server selection.
 * The URL API inserts it in the right place regardless of what query params exist.
 *
 * Falls back to a private cluster when the shared one is absent — e.g. under
 * `PG_URL`, which stops dev/globalSetup.ts from starting Mongo at all — which keeps
 * every helper runnable on its own. That fallback cluster is only ever known here,
 * so its `stop` is returned alongside the `uri` rather than swallowed: nothing else
 * can tear it down, and mongodb-memory-server has no auto-cleanup of its own. A
 * caller that drops the returned `stop` leaks exactly the orphaned-mongod /
 * CPU-pinning failure this task exists to eliminate. `stop` is a no-op when the
 * shared cluster was used, since dev/globalSetup.ts owns that one's lifecycle.
 */
export async function testDbUri(dbName: string): Promise<{ stop: () => Promise<void>; uri: string }> {
  if (process.env.MEMORY_DB_URI) {
    const url = new URL(process.env.MEMORY_DB_URI)
    url.pathname = `/${dbName}`
    url.searchParams.set('retryWrites', 'true')
    return { stop: async () => {}, uri: url.toString() }
  }

  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, dbName } })
  return { stop: async () => { await replSet.stop() }, uri: replSet.getUri() }
}
