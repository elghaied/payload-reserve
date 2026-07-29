import { MongoMemoryReplSet } from 'mongodb-memory-server'

/**
 * Connection string for a test suite's own database inside the run-wide replica
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
 * Falls back to a private cluster when the shared one is absent, which keeps every
 * helper runnable on its own.
 */
export async function testDbUri(dbName: string): Promise<string> {
  if (process.env.MEMORY_DB_URI) {
    const url = new URL(process.env.MEMORY_DB_URI)
    url.pathname = `/${dbName}`
    url.searchParams.set('retryWrites', 'true')
    return url.toString()
  }

  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, dbName } })
  return replSet.getUri()
}
