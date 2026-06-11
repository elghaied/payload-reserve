import path from 'path'
import { loadEnv } from 'payload/node'
import { fileURLToPath } from 'url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default defineConfig(() => {
  loadEnv(path.resolve(dirname, './dev'))

  return {
    plugins: [
      tsconfigPaths({
        ignoreConfigErrors: true,
      }),
    ],
    test: {
      environment: 'node',
      // Run spec files sequentially. Several integration specs each boot their
      // own MongoMemoryReplSet; running files in parallel made multiple replsets
      // elect/tear down concurrently, intermittently throwing
      // `InterruptedDueToReplStateChange` ("operation was interrupted") and
      // failing the release pipeline. Serial execution keeps one Mongo instance
      // alive at a time.
      fileParallelism: false,
      hookTimeout: 30_000,
      testTimeout: 30_000,
      exclude: ['dev/e2e.spec.ts', 'node_modules/**'],
    },
  }
})
