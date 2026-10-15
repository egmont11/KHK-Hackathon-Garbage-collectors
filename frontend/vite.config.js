import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import path from 'node:path'

// Servíruje ../data/poi.geojson a stops.geojson na /data/* (dev) a přibalí je do buildu.
const DATA_DIR = path.resolve(__dirname, '../data')
const DATA_FILES = ['poi.geojson', 'stops.geojson']

function repoData() {
  return {
    name: 'repo-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.match(/^\/data\/([\w.-]+)$/)?.[1]
        if (!DATA_FILES.includes(name)) return next()
        res.setHeader('Content-Type', 'application/geo+json; charset=utf-8')
        fs.createReadStream(path.join(DATA_DIR, name)).pipe(res)
      })
    },
    generateBundle() {
      for (const name of DATA_FILES) {
        this.emitFile({ type: 'asset', fileName: `data/${name}`, source: fs.readFileSync(path.join(DATA_DIR, name)) })
      }
    },
  }
}

// /api a dashboard kraje jdou přes proxy na backend (výchozí port 3001), takže frontend
// volá relativní URL a funguje i z telefonu v síti (a přes HTTPS bez mixed content).
const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001'
const proxy = Object.fromEntries(['/api', '/dashboard', '/vendor', '/health'].map((p) => [p, { target: BACKEND, changeOrigin: true }]))

// PWA: manifest (instalace na plochu) + service worker (appka se načte i bez signálu).
// Herní API jde vždy po síti, cachuje se jen kostra appky, fonty a dlaždice mapy.
// Service worker běží jen v buildu (npm run start), v dev režimu by rušil HMR.
const pwa = VitePWA({
  registerType: 'autoUpdate',
  includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
  manifest: {
    name: 'Krajánek',
    short_name: 'Krajánek',
    description: 'Objevuj, dobývej, poznávej kraj.',
    lang: 'cs',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: '#F3ECDA',
    background_color: '#F3ECDA',
    icons: [
      { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // font s ikonami má ~3,3 MB
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/api/, /^\/dashboard/, /^\/vendor/, /^\/health/],
    runtimeCaching: [
      { urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' },
      {
        urlPattern: ({ url }) => url.pathname.startsWith('/data/'),
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'krajanek-data' },
      },
      {
        urlPattern: ({ url }) => url.hostname.endsWith('tile.openstreetmap.org'),
        handler: 'CacheFirst',
        options: { cacheName: 'krajanek-tiles', expiration: { maxEntries: 800, maxAgeSeconds: 14 * 86400 } },
      },
      {
        urlPattern: ({ url }) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com',
        handler: 'CacheFirst',
        options: { cacheName: 'krajanek-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 365 * 86400 } },
      },
    ],
  },
})

// HTTPS=1 (npm run dev:https): self-signed cert, aby na telefonech v síti fungovala GPS.
export default defineConfig({
  plugins: [react(), repoData(), pwa, ...(process.env.HTTPS ? [basicSsl()] : [])],
  server: { proxy, host: '127.0.0.1', cors: false },
  preview: { proxy, host: '127.0.0.1', cors: false },
})
