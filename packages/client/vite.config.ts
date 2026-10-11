import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { pages } from './src/pages.ts'

const clientRoot = fileURLToPath(new URL('.', import.meta.url))
const entries = Object.entries(pages)
const pageRoutes = new Map<string, string>()

for (const [, page] of entries) {
  pageRoutes.set(page.path, `/${page.html}`)
  if (page.path !== '/') pageRoutes.set(`${page.path}/`, `/${page.html}`)
}

function rewritePageRequest(request: IncomingMessage, _response: ServerResponse, next: () => void) {
  if (request.url) {
    const queryIndex = request.url.indexOf('?')
    const pathname = queryIndex === -1 ? request.url : request.url.slice(0, queryIndex)
    const destination = pageRoutes.get(pathname)
    if (destination) {
      request.url = destination + (queryIndex === -1 ? '' : request.url.slice(queryIndex))
    }
  }
  next()
}

function pageRouting(): Plugin {
  return {
    name: 'manifest-page-routing',
    configureServer(server) {
      server.middlewares.use(rewritePageRequest)
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewritePageRequest)
    },
    transformIndexHtml(html, context) {
      const entry = entries.find(([, page]) => resolve(clientRoot, page.html) === context.filename)
      if (!entry) return html
      const title = entry[1].title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return html.replace(/<title>[^]*?<\/title>/, `<title>${title}</title>`)
    },
  }
}

export default defineConfig({
  root: clientRoot,
  appType: 'mpa',
  plugins: [pageRouting(), react()],
  build: {
    rollupOptions: {
      input: Object.fromEntries(entries.map(([name, page]) => [name, resolve(clientRoot, page.html)])),
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
