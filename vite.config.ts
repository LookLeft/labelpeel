import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Relative base so the build works on GitHub Pages project sites (/repo-name/)
// and on any other static host without configuration.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'P-touch Studio',
        short_name: 'P-touch Studio',
        description: 'Design and print labels on Brother P-touch printers from the browser.',
        theme_color: '#111827',
        background_color: '#111827',
        display: 'standalone',
        start_url: '.',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,json}'],
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
