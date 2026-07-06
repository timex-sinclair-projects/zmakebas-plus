import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'

const version = process.env.ZMAKEBAS_VERSION ?? '0.0.0-dev'

export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/cli/zmakebas.ts'),
      fileName: () => 'zmakebas.js',
      formats: ['es'],
    },
    minify: false,
    outDir: 'dist-cli',
    sourcemap: true,
    target: 'node22',
    rolldownOptions: {
      external: (id) => id.startsWith('node:'),
      platform: 'node',
    },
  },
  define: {
    'import.meta.env.VITE_ZMAKEBAS_VERSION': JSON.stringify(version),
  },
  plugins: [cliShebangPlugin()],
})

function cliShebangPlugin(): Plugin {
  return {
    name: 'cli-shebang',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.isEntry) {
          chunk.code = `#!/usr/bin/env node\n${chunk.code.replace(/^(#![^\n]*\r?\n)+/, '')}`
        }
      }
    },
  }
}
