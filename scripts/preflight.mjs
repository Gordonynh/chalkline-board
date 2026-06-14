import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'),
)
const includeStress = process.env.WHITEBOARD_PREFLIGHT_STRESS === '1'
const includeDesktop = process.env.WHITEBOARD_PREFLIGHT_DESKTOP !== '0'
const includeVariants = process.env.WHITEBOARD_PREFLIGHT_VARIANTS !== '0'

const steps = [
  ['build', ['run', 'build']],
  ['lint', ['run', 'lint']],
  ['encoding', ['run', 'check:encoding']],
  ['desktop-contract', ['run', 'desktop:contract']],
  ['release-logic', ['run', 'release:logic']],
  ['import-ppt-playback', ['run', 'test:import']],
  ['presentation-playback-gate', ['run', 'presentation:gate']],
  ['pen-performance', ['run', 'perf:gate']],
  ['page-navigation', ['run', 'navigation:gate']],
]

if (includeVariants) {
  steps.splice(1, 0, ['build-textbook', ['run', 'build:textbook']])
  steps.splice(2, 0, ['build-visualizer', ['run', 'build:visualizer']])
  steps.push(['visualizer-runtime-gate', ['run', 'visualizer:gate']])
}

if (includeStress) {
  steps.push(['full-stress', ['run', 'stress:gate', '--', 'all']])
}

if (includeDesktop) {
  steps.push(['desktop-build', ['run', 'build:desktop']])
  if (includeVariants) {
    steps.push(['desktop-build-textbook', ['run', 'build:desktop:textbook']])
    steps.push(['desktop-build-visualizer', ['run', 'build:desktop:visualizer']])
  }
}

const startedAt = Date.now()
const results = []

for (const [name, args] of steps) {
  const stepStartedAt = Date.now()
  console.log(`\n[preflight] ${name}`)
  await run(npm, args)
  results.push({
    name,
    elapsedMs: Date.now() - stepStartedAt,
  })
}

console.log(JSON.stringify({
  ok: true,
  elapsedMs: Date.now() - startedAt,
  includeStress,
  includeDesktop,
  includeVariants,
  results,
}, null, 2))

function run(command, args) {
  return new Promise((resolve, reject) => {
    const tail = []
    const remember = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue
        tail.push(line)
        if (tail.length > 100) tail.shift()
      }
    }
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/c', [command, ...args].map(quoteCmd).join(' ')], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv,
      })
      : spawn(command, args, {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv,
      })
    child.stdout?.on('data', remember)
    child.stderr?.on('data', remember)
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}\n${tail.join('\n')}`))
    })
  })
}

function quoteCmd(value) {
  const raw = String(value)
  return /\s|"/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw.replace(/[&|<>^]/g, '^$&')
}
