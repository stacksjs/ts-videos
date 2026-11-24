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
  const runtime = globalThis as { document?: unknown, process?: { versions?: { node?: string }, cwd?: () => string } }
  if (runtime.document !== undefined || !runtime.process?.versions?.node) return { ...defaultConfig }
  try {
    // Joined at run time: a minifier folds a constant name back into `import('bunfig')`, and a page bundler follows that.
    const loader = ['bun', 'fig'].join('')
    const { loadConfig } = await import(loader)
    // From the project being run, where its videos.config.ts is. No
    // `import.meta` here: a bundler that sees it makes the whole page bundle a
    // module script.
    return await loadConfig({
      name: 'videos',
      cwd: runtime.process.cwd?.(),
      defaultConfig,
    })
  }
  catch {
    return { ...defaultConfig }
  }
}

/**
 * The defaults at once, a `videos.config.ts` a moment later.
 *
 * Not awaited at the top of the module: a top-level await cannot be bundled
 * into a classic script, so every page bundle that reached a muxer failed to
 * build. The only setting is `verbose`, read each time something is logged,
 * so a file's value takes effect as soon as it has loaded.
 */
export const config: VideosConfig = { ...defaultConfig }
void loadVideosConfig().then(loaded => Object.assign(config, loaded))
