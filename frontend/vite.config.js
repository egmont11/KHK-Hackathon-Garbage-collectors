import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
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

// HTTPS=1 (npm run dev:https): self-signed cert, aby na telefonech v síti fungovala GPS.
export default defineConfig({
  plugins: [react(), repoData(), ...(process.env.HTTPS ? [basicSsl()] : [])],
  server: { proxy },
  preview: { proxy },
})
