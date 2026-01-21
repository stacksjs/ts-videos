<p align="center"><img src="https://github.com/stacksjs/ts-videos/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

# vidx

> A better save for web developers.

## Features

- Image Optimizations & Manipulations
- Web Optimized by default
- Simple, lightweight
- CLI and Library Support

## Install

```bash
bun install -d @stacksjs/ts-videos
```

<!-- _Alternatively, you can install:_

```bash
brew install vidx # wip
pkgx install vidx # wip
``` -->

## Get Started

There are two ways of using this tool: _as a library or as a CLI._

### Library

Given the npm package is installed:

```ts
// wip
```

### CLI

```bash
vidx wip
vidx --help
vidx --version
```

## Configuration

The Reverse Proxy can be configured using a `vidx.config.ts` _(or `vidx.config.js`)_ file and it will be automatically loaded when running the `reverse-proxy` command.

```ts
// vidx.config.{ts,js}
import type { vidxOptions } from '@stacksjs/ts-videos'

const config: vidxOptions = {
  verbose: true,
}

export default config
```

_Then run:_

```bash
./vidx start
```

To learn more, head over to the [documentation](https://reverse-proxy.sh/).

## Testing

```bash
bun test
```

## Changelog

Please see our [releases](https://github.com/stacksjs/stacks/releases) page for more information on what has changed recently.

## Contributing

Please review the [Contributing Guide](https://github.com/stacksjs/contributing) for details.

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub](https://github.com/stacksjs/stacks/discussions)

For casual chit-chat with others using this package:

[Join the Stacks Discord Server](https://discord.gg/stacksjs)

## Postcardware

“Software that is free, but hopes for a postcard.” We love receiving postcards from around the world showing where `vidx` is being used! We showcase them on our website too.

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094, United States 🌎

## Sponsors

We would like to extend our thanks to the following sponsors for funding Stacks development. If you are interested in becoming a sponsor, please reach out to us.

- [JetBrains](https://www.jetbrains.com/)
- [The Solana Foundation](https://solana.com/)

## Credits

- [Chris Breuer](https://github.com/chrisbbreuer)
- [All Contributors](../../contributors)

## License

The MIT License (MIT). Please see [LICENSE](https://github.com/stacksjs/stacks/tree/main/LICENSE.md) for more information.

Made with 💙

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/@stacksjs/ts-videos?style=flat-square
[npm-version-href]: https://npmjs.com/package/@stacksjs/ts-videos
[github-actions-src]: https://img.shields.io/github/actions/workflow/status/stacksjs/ts-videos/ci.yml?style=flat-square&branch=main
[github-actions-href]: https://github.com/stacksjs/ts-videos/actions?query=workflow%3Aci

<!-- [codecov-src]: https://img.shields.io/codecov/c/gh/stacksjs/ts-videos/main?style=flat-square
[codecov-href]: https://codecov.io/gh/stacksjs/ts-videos -->
