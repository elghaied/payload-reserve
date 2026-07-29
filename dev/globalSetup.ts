import { MongoMemoryReplSet } from 'mongodb-memory-server'

/**
 * One replica set for the entire test run.
 *
 * Previously nine separate files each created their own cluster, so a full run
 * started and stopped nine of them. The churn intermittently failed a `beforeAll`
 * with a connect or write-concern error — never an assertion — and which file lost
 * varied run to run. Vitest starts this once, before any worker, and tears it down
 * after the last one. Callers append their own `dbName`, so isolation between suites
 * is preserved at the database level rather than the process level.
 */
let replSet: MongoMemoryReplSet | undefined

export async function setup(): Promise<() => Promise<void>> {
  // The Postgres harness supplies its own database; do not start Mongo at all.
  if (process.env.PG_URL) {
    return async () => {}
  }

  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: 'shared' },
  })

  process.env.MEMORY_DB_URI = replSet.getUri()

  return async () => {
    await replSet?.stop()
    replSet = undefined
  }
}

export default setup
