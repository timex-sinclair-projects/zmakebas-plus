import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const version = process.env.ZMAKEBAS_VERSION ?? '0.0.0-dev'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 1000,
    outDir: 'dist-web',
  },
  define: {
    'import.meta.env.VITE_ZMAKEBAS_VERSION': JSON.stringify(version),
  },
  plugins: [react()],
})
