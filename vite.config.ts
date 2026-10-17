import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

// base './' + HashRouter means the built app works from any sub-path
// (GitHub Pages, Netlify, an S3 bucket) with no server rewrite rules.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    // `npm run dev:https` serves a self-signed certificate so a phone on your Wi-Fi
    // can open the dev server with the camera allowed (browsers need HTTPS for the camera).
    ...(process.env.HTTPS ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        name: 'Privacy Preferences',
        short_name: 'Privacy',
        description: 'See what a connected-home device says it does with your data, and compare it with your household rules.',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F4F5F7',
        theme_color: '#F4F5F7',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell is precached. The /mock JSON stands in for the backend, so it is
        // fetched network-first and cached for offline use instead of being baked into the build.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /\/mock\/.*\.json$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'ppd-api', networkTimeoutSeconds: 3 },
          },
        ],
      },
    }),
  ],
})
