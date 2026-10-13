import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Tauri allows font-src 'self'. Keep small font subsets as local files too.
  build: { assetsInlineLimit: 0 },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  worker: { format: 'es' },
});
