import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// Relative base so the build works on GitHub Pages project sites (/repo-name/)
// and on any other static host without configuration.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Labelsmith',
        short_name: 'Labelsmith',
        description: 'Design and print labels on Brother P-touch compatible label printers from the browser. Not affiliated with Brother.',
        theme_color: '#111827',
        background_color: '#111827',
        display: 'standalone',
        start_url: '.',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,json,txt}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: 'node',
  },
});
