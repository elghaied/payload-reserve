import { withPayload } from '@payloadcms/next/withPayload'
import { fileURLToPath } from 'url'
import path from 'path'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
  serverExternalPackages: ['mongodb-memory-server'],
  // This app compiles the plugin's `src` against its own generated
  // payload-types, which narrows `CollectionSlug` and rejects the plugin's
  // slug-agnostic code. The plugin is type-checked by the root `tsc` instead.
  typescript: { ignoreBuildErrors: true },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
