/* eslint-disable no-console, ts/no-top-level-await */
import { dts } from 'bun-plugin-dtsx'
import { readdirSync } from 'node:fs'
import path from 'node:path'

console.log('Building...')

// Collect all src/*.ts files as entrypoints for subpath exports
const srcDir = path.resolve(import.meta.dir, 'src')
const srcFiles = readdirSync(srcDir)
  .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  .map(f => path.join('./src', f))

// Build library modules (root=src so outputs go directly to dist/)
await Bun.build({
  entrypoints: srcFiles,
  root: './src',
  outdir: './dist',
  format: 'esm',
  target: 'node',
  minify: true,
  splitting: true,
  external: ['ts-audio', 'ts-gif', 'bunfig'],
  plugins: [dts()],
})

// Build CLI separately
await Bun.build({
  entrypoints: ['./bin/cli.ts'],
  outdir: './dist/bin',
  format: 'esm',
  target: 'node',
  minify: true,
  external: ['ts-audio', 'ts-gif', 'bunfig'],
})

// Add shebang to CLI
const cliPath = path.resolve(import.meta.dir, 'dist/bin/cli.js')
const cliContent = await Bun.file(cliPath).text()
if (!cliContent.startsWith('#!')) {
  await Bun.write(cliPath, `#!/usr/bin/env bun\n${cliContent}`)
}

console.log('Built')
