import type { VideosConfig } from './types'
import { resolve } from 'node:path'
import { loadConfig } from 'bunfig'

export const defaultConfig: VideosConfig = {
  verbose: true,
}

// eslint-disable-next-line antfu/no-top-level-await
export const config: VideosConfig = await loadConfig({
  name: 'videos',
  cwd: resolve(__dirname, '..'),
  defaultConfig,
})
