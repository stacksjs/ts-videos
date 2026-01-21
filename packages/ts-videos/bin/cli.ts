import type { vidxOptions } from '../src/types'
import { CLI } from '@stacksjs/clapp'
import { version } from '../../../package.json'

const cli = new CLI('vidx')

cli
  .command('[path]', 'Start the Reverse Proxy Server')
  .option('--verbose', 'Enable verbose logging')
  .example('vidx input.jpg output.webp --quality 75 --resize 50% --format webp')
  .action(async (options?: vidxOptions) => {
    return ''
  })

cli
  .command('completion', 'Generate shell completion script')
  .action(() => {
    // TODO: Implement shell completion generation
    console.log('Shell completion not implemented yet')
  })

cli.command('version', 'Show the version of the Reverse Proxy CLI').action(() => {
  console.log(version)
})

cli.version(version)
cli.help()
cli.parse()
