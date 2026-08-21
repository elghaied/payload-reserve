import path from 'path'
import { loadEnv } from 'payload/node'
import { fileURLToPath } from 'url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// Never scan a git worktree. The harness creates them at `.claude/worktrees/`
// and the superpowers skills at `.worktrees/`, both INSIDE the repo — so
// without this, a run from the main checkout discovers every spec twice and
// executes both copies against the one shared replica set from
// dev/globalSetup.ts. Suites that assert on collection-wide counts then fail.
// Observed: 1208 tests / 64 failures where the true figure was 604 / 0.
const WORKTREE_GLOBS = ['**/.claude/**', '**/.worktrees/**']

export default defineConfig(() => {
  loadEnv(path.resolve(dirname, './dev'))

  return {
    test: {
      projects: [
        {
          plugins: [
            tsconfigPaths({
              ignoreConfigErrors: true,
            }),
          ],
          test: {
            name: 'integration',
            environment: 'node',
            exclude: [
              'dev/e2e.spec.ts',
              'node_modules/**',
              ...WORKTREE_GLOBS,
              // Component specs belong to the jsdom project below. Without this
              // they would also match this project's default include glob and
              // run under `environment: 'node'`, where rendering is impossible.
              'dev/components/**',
            ],
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
        },
        {
          // tsconfig.json sets "jsx": "preserve" for Next/SWC, so esbuild has to
          // be told to emit the automatic runtime for these test files.
          esbuild: {
            jsx: 'automatic',
          },
          plugins: [
            tsconfigPaths({
              ignoreConfigErrors: true,
            }),
          ],
          test: {
            name: 'components',
            // No database: these render components, they do not boot Payload.
            // Deliberately no globalSetup — starting a replica set here would
            // add ~10s to every run for nothing.
            css: false,
            environment: 'jsdom',
            exclude: ['node_modules/**', ...WORKTREE_GLOBS],
            // Not just *.spec.tsx: a non-JSX .spec.ts file under dev/components/
            // still belongs to this project (it's excluded wholesale from the
            // integration project above) and must still be picked up here, or it
            // silently never runs in either project.
            include: ['dev/components/**/*.spec.{ts,tsx}'],
            server: {
              deps: {
                // @payloadcms/ui's client entry transitively imports
                // react-image-crop's .css. Left external, Node's ESM loader
                // reaches it and throws "Unknown file extension .css" — which is
                // why the node project cannot import anything from that package.
                // Inlining routes it through Vite, which stubs CSS under
                // `css: false`.
                inline: ['@payloadcms/ui'],
              },
            },
            setupFiles: ['./dev/components/setup.ts'],
          },
        },
      ],
    },
  }
})
