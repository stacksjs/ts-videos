interface ProxyOptions {
  https: boolean
  cleanup: {
    hosts: boolean
    certs: boolean
  }
  proxies: Array<{
    from: string
    to: string
    cleanUrls?: boolean
    start?: {
      command: string
      lazy?: boolean
    }
  }>
  vitePluginUsage: boolean
  verbose: boolean
}

const config: ProxyOptions = {
  https: true,

  cleanup: {
    hosts: true,
    certs: false,
  },

  proxies: [
    {
      from: 'localhost:5173',
      to: 'stacks.localhost',
      cleanUrls: true,
      start: {
        command: 'bun run dev:docs',
        // lazy: true,
      },
    },
  ],

  vitePluginUsage: false,
  verbose: false,
}

export default config
