import type { VideosConfig } from './types'

export const defaultConfig: VideosConfig = {
  verbose: true,
}

/**
 * A `videos.config.ts`, read with bunfig where there is a filesystem to read
 * it from, the defaults anywhere else.
 *
 * bunfig is asked for by a name the bundler cannot follow, and only outside a
 * browser. Imported at the top it put `node:fs` and `stream/promises` into
 * every bundle that touched a muxer, so nothing here could be built for a
 * page: the WebCodecs transcoder, which only runs in one, least of all.
 */
async function loadVideosConfig(): Promise<VideosConfig> {
  const runtime = globalThis as { document?: unknown, process?: { versions?: { node?: string } } }
  if (runtime.document !== undefined || !runtime.process?.versions?.node) return { ...defaultConfig }
  try {
    const modules = ['bunfig', 'node:path', 'node:url']
    const [{ loadConfig }, { dirname, resolve }, { fileURLToPath }] = await Promise.all(modules.map(name => import(name)))
    return await loadConfig({
      name: 'videos',
      cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
      defaultConfig,
    })
  }
  catch {
    return { ...defaultConfig }
  }
}

// eslint-disable-next-line ts/no-top-level-await
export const config: VideosConfig = await loadVideosConfig()
