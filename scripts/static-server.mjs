import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? 'dist')
const port = Number(process.argv[3] ?? 5173)
const host = '127.0.0.1'

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`)
  let file = path.join(root, decodeURIComponent(url.pathname))

  if (!file.startsWith(root)) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }

  if (url.pathname === '/' || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(root, 'index.html')
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404)
      response.end('Not found')
      return
    }

    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': contentTypes[path.extname(file)] ?? 'application/octet-stream',
    })
    response.end(data)
  })
})

server.listen(port, host, () => {
  console.log(`static server http://${host}:${port}/`)
})
