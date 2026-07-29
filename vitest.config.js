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
      exclude: ['dev/e2e.spec.ts', 'node_modules/**'],
      // One replica set for the whole run — see dev/globalSetup.ts. Before this,
      // nine files each created their own cluster and the start/stop churn
      // intermittently failed a beforeAll with a connect error.
      globalSetup: ['./dev/globalSetup.ts'],
      hookTimeout: 30_000,
      // Kept even with a shared cluster: several suites seed overlapping fixture
      // data and assert on collection-wide counts.
      fileParallelism: false,
      testTimeout: 30_000,
    },
  }
})
