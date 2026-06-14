import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath
const viteBin = path.join('node_modules', 'vite', 'bin', 'vite.js')
const probe = path.join('scripts', 'navigation-probe.mjs')
const host = process.env.WHITEBOARD_NAV_HOST ?? '127.0.0.1'
const blankPort = process.env.WHITEBOARD_NAV_PORT ?? '5179'
const textbookPort = process.env.WHITEBOARD_NAV_TEXTBOOK_PORT ?? String(Number(blankPort) + 1)

await runNavigationScenario({
  mode: 'blank',
  port: blankPort,
  env: {
    WHITEBOARD_NAV_SWITCHES: process.env.WHITEBOARD_NAV_SWITCHES ?? '80',
    WHITEBOARD_NAV_PAGES: process.env.WHITEBOARD_NAV_PAGES ?? '120',
    WHITEBOARD_NAV_STROKES_PER_PAGE: process.env.WHITEBOARD_NAV_STROKES_PER_PAGE ?? '6',
    WHITEBOARD_NAV_MAX_AVG_SWITCH_MS: process.env.WHITEBOARD_NAV_MAX_AVG_SWITCH_MS ?? '120',
  },
})

await runNavigationScenario({
  mode: 'textbook',
  port: textbookPort,
  env: {
    WHITEBOARD_NAV_INSTALL_PROJECT: '0',
    WHITEBOARD_NAV_TEXTBOOK_SWITCH: '1',
    WHITEBOARD_NAV_MAX_AVG_SWITCH_MS: process.env.WHITEBOARD_NAV_MAX_AVG_SWITCH_MS ?? '120',
  },
})

async function runNavigationScenario({ mode, port, env }) {
  const url = `http://${host}:${port}/?perf=1`
  await assertPortIsFree(url)

  const server = spawnInRoot(node, [viteBin, '--mode', mode, '--host', host, '--port', port, '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  server.stdout.on('data', (chunk) => process.stdout.write(chunk))
  server.stderr.on('data', (chunk) => process.stderr.write(chunk))

  try {
    await waitForServer(server, url)
    await run(node, [probe, url], env)
  } finally {
    stopProcessTree(server)
  }
}

async function assertPortIsFree(targetUrl) {
  try {
    await fetch(targetUrl, { signal: AbortSignal.timeout(1000) })
    throw new Error(`Navigation gate target is already serving before Vite starts: ${targetUrl}`)
  } catch (error) {
    if (error instanceof Error && error.message.includes('already serving')) throw error
  }
}

async function waitForServer(server, targetUrl) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite exited early with ${server.exitCode}`)
    try {
      const response = await fetch(targetUrl)
      if (response.ok) return
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
