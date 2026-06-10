import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath
const viteBin = path.join('node_modules', 'vite', 'bin', 'vite.js')
const probe = path.join('scripts', 'visualizer-probe.mjs')
const host = process.env.VISUALIZER_HOST ?? '127.0.0.1'
const port = process.env.VISUALIZER_PORT ?? '5176'
const url = `http://${host}:${port}/?perf=1`

const server = spawnInRoot(node, [viteBin, '--mode', 'blank', '--host', host, '--port', port, '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
})

server.stdout.on('data', (chunk) => process.stdout.write(chunk))
server.stderr.on('data', (chunk) => process.stderr.write(chunk))

try {
  await waitForServer(url)
  await run(node, [probe, url], {
    VISUALIZER_MAX_AVG_FIRST_DRAW_MS: process.env.VISUALIZER_MAX_AVG_FIRST_DRAW_MS ?? '16',
    VISUALIZER_MAX_AVG_LIVE_DRAW_MS: process.env.VISUALIZER_MAX_AVG_LIVE_DRAW_MS ?? '8',
    VISUALIZER_MAX_AVG_CAPTURE_MS: process.env.VISUALIZER_MAX_AVG_CAPTURE_MS ?? '350',
    VISUALIZER_MAX_AVG_COMPOSITION_MS: process.env.VISUALIZER_MAX_AVG_COMPOSITION_MS ?? '500',
  })
} finally {
  stopProcessTree(server)
}

async function waitForServer(targetUrl) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite exited early with ${server.exitCode}`)
    try {
      const response = await fetch(targetUrl)
      if (response.ok) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        if (server.exitCode !== null) throw new Error(`Vite exited early with ${server.exitCode}`)
        return
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(`Timed out waiting for ${targetUrl}`)
}

function run(command, args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawnInRoot(command, args, {
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    })
  })
}

function spawnInRoot(command, args, options) {
  if (process.platform !== 'win32') {
    return spawn(command, args, { cwd: root, ...options })
  }
  if (!root.startsWith('\\\\')) {
    return spawn(command, args, { cwd: root, ...options })
  }
  return spawn('cmd.exe', ['/d', '/c', `pushd ${quotePushdPath(root)} && ${quoteCmd(command)} ${args.map(quoteCmd).join(' ')}`], {
    cwd: process.env.SystemRoot ?? 'C:\\Windows',
    ...options,
  })
}

function stopProcessTree(child) {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
    return
  }
  child.kill()
}

function quoteCmd(value) {
  const raw = String(value)
  return /\s|"/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw.replace(/[&|<>^]/g, '^$&')
}

function quotePushdPath(value) {
  const pathValue = String(value)
  return pathValue.startsWith('\\\\') && !pathValue.includes(' ') ? pathValue : quoteCmd(pathValue)
}
