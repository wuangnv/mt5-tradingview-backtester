import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Authorized vendor distribution stays outside Git and the application bundle.
function localAdvancedCharts() {
  const vendorRoot = path.resolve(process.env.TW_V2_CHARTING_LIBRARY_DIR || fileURLToPath(new URL('../../static/charting_library', import.meta.url)))
  const middleware = async (req, res, next) => {
    if (!req.url?.startsWith('/charting_library/')) return next()
    if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; res.end(); return }
    try {
      const requestPath = decodeURIComponent(req.url.split('?')[0].slice('/charting_library/'.length))
      const root = await realpath(vendorRoot)
      const file = await realpath(path.resolve(root, requestPath))
      const relative = path.relative(root, file)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !(await stat(file)).isFile()) throw new Error('Invalid asset path')
      const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
      res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      if (req.method === 'HEAD') res.end()
      else createReadStream(file).on('error', () => res.destroy()).pipe(res)
    } catch { res.statusCode = 404; res.end('Advanced Charts asset unavailable') }
  }
  return { name: 'local-advanced-charts', configureServer(server) { server.middlewares.use(middleware) }, configurePreviewServer(server) { server.middlewares.use(middleware) } }
}

export default defineConfig(() => ({
  plugins: [react(), localAdvancedCharts()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: process.env.TW_V2_API_TARGET || 'http://127.0.0.1:8010',
        changeOrigin: false,
      },
    },
  },
}))
