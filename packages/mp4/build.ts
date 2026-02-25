/* eslint-disable no-console, ts/no-top-level-await */
import { build } from 'bun'
import dts from 'bun-plugin-dtsx'
import { readdirSync } from 'node:fs'
import path from 'node:path'

// Collect all src/*.ts files as entrypoints for subpath exports
const srcDir = path.resolve(import.meta.dir, 'src')
const srcFiles = readdirSync(srcDir)
  .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  .map(f => path.join('./src', f))

await build({
  entrypoints: srcFiles,
  outdir: './dist',
  format: 'esm',
  target: 'node',
  minify: true,
  splitting: true,
  external: ['ts-videos'],
  plugins: [dts()],
})

console.log('Build completed: @ts-videos/mp4')
