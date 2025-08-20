import { fileURLToPath, URL } from 'node:url'

import { defineConfig, type ViteDevServer } from 'vite'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
type NextFunction = (err?: any) => void
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
const badBrainsApi = () => ({
  name: 'bad-brains-api',
  configureServer(server: ViteDevServer) {
    server.middlewares.use(
      '/api/bad-brains',
      async (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
        try {
          const publicPath = path.join(
            server.config.root || process.cwd(),
            'public',
            'bad-brains.json',
          )
          const keep = (s: unknown) => typeof s === 'string' && !s.startsWith('cascade-test-hash-')
          if (req.method === 'GET') {
            try {
              const txt = await readFile(publicPath, 'utf-8')
              // Filter on read to avoid exposing any accidental test hashes
              let data: unknown
              try {
                data = JSON.parse(txt)
              } catch {
                data = []
              }
              const arr = Array.isArray(data) ? data.filter(keep) : []
              res.setHeader('content-type', 'application/json')
              res.end(JSON.stringify(arr))
            } catch {
              res.setHeader('content-type', 'application/json')
              res.end('[]')
            }
            return
          }
          if (req.method === 'POST') {
            const chunks: Buffer[] = []
            req.on('data', (c: Buffer | string) =>
              chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)),
            )
            req.on('end', async () => {
              try {
                const bodyStr = Buffer.concat(chunks).toString('utf-8')
                const payload = bodyStr ? JSON.parse(bodyStr) : []
                const incoming: string[] = Array.isArray(payload) ? payload : []
                // load existing
                let existing: string[] = []
                try {
                  existing = JSON.parse(await readFile(publicPath, 'utf-8'))
                  if (!Array.isArray(existing)) existing = []
                } catch {}
                // Filter out any test hashes from existing and incoming
                const set = new Set<string>(existing.filter(keep))
                let added = 0
                for (const h of incoming)
                  if (keep(h) && !set.has(h)) {
                    set.add(h)
                    added++
                  }
                const out = JSON.stringify(Array.from(set), null, 2)
                await writeFile(publicPath, out, 'utf-8')
                res.setHeader('content-type', 'application/json')
                res.end(JSON.stringify({ ok: true, added, size: set.size }))
              } catch (e: any) {
                res.statusCode = 400
                res.setHeader('content-type', 'application/json')
                res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }))
              }
            })
            return
          }
          next()
        } catch (e) {
          next()
        }
      },
    )
  },
})

export default defineConfig({
  plugins: [vue(), vueJsx(), vueDevTools(), badBrainsApi()],
  assetsInclude: ['**/*.wasm'],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
