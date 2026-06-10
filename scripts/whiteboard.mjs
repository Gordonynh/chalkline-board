import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { normalizeAppId } from './release.config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath
const viteBin = path.join('node_modules', 'vite', 'bin', 'vite.js')
const tscBin = path.join('node_modules', 'typescript', 'bin', 'tsc')

const [, , command = 'help', ...args] = process.argv
const selected = selectApp(args)

switch (command) {
  case 'dev':
    await run(node, [viteBin, '--mode', selected.mode, '--configLoader', 'runner', ...withoutVariant(args)])
    break
  case 'preview':
    await run(node, [viteBin, 'preview', '--outDir', selected.webDist, ...withoutVariant(args)])
    break
  case 'build':
    await typecheck()
    await buildWeb(selected, selected.webDist)
    break
  case 'build-desktop':
    await typecheck()
    await buildWeb(selected, selected.desktopDist)
    break
  case 'publish-desktop':
    await publishMultifile(selected)
    break
  case 'publish-singlefile':
    await import('./release.mjs').then((module) =>
      module.releaseFromCli(['--profile', selected.id, '--format', 'singlefile', ...withoutVariant(args)]),
    )
    break
  case 'restore-desktop':
    await run(await requireDotnetSdk(), ['restore', selected.desktopProject])
    break
  case 'run-desktop':
    await run(path.join('desktop-shell', outputBinPath(), selected.exeName), [])
    break
  case 'help':
    printHelp()
    break
  default:
    fail(`Unknown command "${command}". Run "node scripts/whiteboard.mjs help".`)
}

function selectApp(values) {
  const variant = values.find((value) => !value.startsWith('-'))
  return {
    id: normalizeAppId(variant ?? 'chalkline'),
    mode: 'blank',
    webDist: 'dist',
    desktopDist: 'dist-desktop',
    desktopProject: 'desktop-shell/OpenWhiteboard.BlankDesktop.csproj',
    exeName: 'ChalklineBoard.exe',
  }
}

function withoutVariant(values) {
  let skipped = false
  return values.filter((value) => {
    if (!skipped && !value.startsWith('-')) {
      skipped = true
      return false
    }
    return true
  })
}

async function buildWeb(app, outDir) {
  await run(node, [viteBin, 'build', '--mode', app.mode, '--configLoader', 'runner', '--outDir', outDir])
}

async function publishMultifile(app) {
  await typecheck()
  await buildWeb(app, app.desktopDist)
  await run(await requireDotnetSdk(), [
    'publish',
    app.desktopProject,
    '-c',
    'Release',
    '-r',
    'win-x64',
    '--self-contained',
    'false',
    '-p:PublishSingleFile=false',
  ])
}

function outputBinPath() {
  return path.join('bin', 'Release', 'net8.0-windows', 'win-x64')
}

async function typecheck() {
  await run(node, [tscBin, '-b'])
}

async function requireDotnetSdk() {
  const dotnet = resolveDotnet()
  const sdks = await capture(dotnet, ['--list-sdks'])
  if (!sdks.trim()) fail(`.NET SDK not found. Install .NET SDK 8.x, then rerun this command. Found dotnet at: ${dotnet}`)
  return dotnet
}

function resolveDotnet() {
  const candidates =
    process.platform === 'win32'
      ? [
          process.env.DOTNET_ROOT && path.join(process.env.DOTNET_ROOT, 'dotnet.exe'),
          'dotnet',
          'C:\\Program Files\\dotnet\\dotnet.exe',
          'C:\\Program Files\\dotnet\\x64\\dotnet.exe',
          'C:\\Program Files (x86)\\dotnet\\dotnet.exe',
        ]
      : [process.env.DOTNET_ROOT && path.join(process.env.DOTNET_ROOT, 'dotnet'), 'dotnet']
  return candidates.filter(Boolean).find((candidate) => canRun(candidate, ['--version'])) ?? 'dotnet'
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: root, stdio: 'inherit', ...options })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${commandArgs.join(' ')} exited with ${code}`))
    })
  })
}

function capture(command, commandArgs) {
  return new Promise((resolve, reject) => {
    let output = ''
    let errorOutput = ''
    const child = spawn(command, commandArgs, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      errorOutput += chunk
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve(output)
      else reject(new Error(`${command} ${commandArgs.join(' ')} exited with ${code}: ${errorOutput.trim()}`))
    })
  })
}

function canRun(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'ignore' })
  return result.status === 0
}

function printHelp() {
  console.log(`Usage: node scripts/whiteboard.mjs <command> [chalkline]

Commands:
  dev                 Start Vite
  build               Typecheck and build web assets
  build-desktop       Typecheck and build desktop web assets
  publish-desktop     Build and publish the multi-file desktop app
  publish-singlefile  Delegate to scripts/release.mjs single-file publishing
  restore-desktop     Restore the desktop project
  preview             Preview built web assets
  run-desktop         Run a previously published executable`)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
