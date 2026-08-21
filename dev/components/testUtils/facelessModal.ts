import { createRequire } from 'node:module'

/**
 * The real `@faceless-ui/modal` — resolved via the exact directory
 * `@payloadcms/ui`'s own (unbundled) `elements/Drawer` subpath resolves it
 * from, so `Drawer`/`useDrawerSlug` (imported normally from
 * `@payloadcms/ui/elements/Drawer`) and this `ModalProvider`/`useModal` end
 * up reading and writing the exact same React context.
 *
 * `@payloadcms/ui`'s main entry point (`import ... from '@payloadcms/ui'`) is
 * a single pre-bundled file that inlines its own private copy of
 * `@faceless-ui/modal` — a *different* module instance with a *different*
 * `ModalContext`, so `useModal`/`Drawer` imported from there can never be
 * driven by an externally-supplied `ModalProvider`. The unbundled
 * `elements/Drawer` subpath export does not have this problem: it is plain,
 * un-inlined ESM that imports `@faceless-ui/modal` as an ordinary external
 * dependency, the same way this file does.
 *
 * `@faceless-ui/modal` itself is not hoisted to the project's own
 * `node_modules` (it is a transitive dependency of `@payloadcms/ui`, not a
 * direct one) so a plain `import '@faceless-ui/modal'` from a test file
 * cannot resolve it. This resolves it relative to `@payloadcms/ui`'s own
 * install location instead, the same way Node/Vite would from inside that
 * package.
 */
const require = createRequire(import.meta.url)
const drawerEntry = require.resolve('@payloadcms/ui/elements/Drawer')
const modalPath = require.resolve('@faceless-ui/modal', { paths: [drawerEntry] })

export const facelessModal: Promise<{
  ModalContainer: React.ComponentType
  ModalProvider: React.ComponentType<{ children?: React.ReactNode }>
  useModal: () => {
    closeModal: (slug: string) => void
    isModalOpen: (slug: string) => boolean
    openModal: (slug: string) => void
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}> = import(/* @vite-ignore */ modalPath) as any
