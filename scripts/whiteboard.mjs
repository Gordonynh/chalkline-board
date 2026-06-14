import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { appAliases, getAppConfig } from './release.config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath
const viteBin = path.join('node_modules', 'vite', 'bin', 'vite.js')
const tscBin = path.join('node_modules', 'typescript', 'bin', 'tsc')
const variantOptionNames = new Set(['--app', '--profile', '--variant'])

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
  const variant = resolveVariant(values)
  return getAppConfig(variant ?? 'chalkline')
}

function resolveVariant(values) {
  const selectedVariants = []
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    const [optionName, inlineValue] = value.split('=', 2)
    if (value.includes('=') && variantOptionNames.has(optionName)) {
      selectedVariants.push(assertVariantValue(inlineValue, value))
      continue
    }
    if (variantOptionNames.has(value)) {
      selectedVariants.push(assertVariantValue(values[index + 1], value))
      index += 1
      continue
    }
    if (!value.startsWith('-') && appAliases[value.toLowerCase()]) {
      selectedVariants.push(appAliases[value.toLowerCase()])
    }
  }

  const uniqueVariants = Array.from(new Set(selectedVariants))
  if (uniqueVariants.length > 1) {
    fail(`Conflicting app variants: ${uniqueVariants.join(', ')}`)
  }

  return uniqueVariants[0] ?? null
}

function assertVariantValue(value, optionName) {
  if (!value || value.startsWith('-')) {
    fail(`Missing app variant after ${optionName}. Use one of: ${Object.keys(appAliases).sort().join(', ')}`)
  }

  const normalized = appAliases[value.toLowerCase()]
  if (!normalized) {
    fail(`Unknown app variant "${value}". Use one of: ${Object.keys(appAliases).sort().join(', ')}`)
  }

  return normalized
}

function withoutVariant(values) {
  const filtered = []
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    const [optionName, inlineValue] = value.split('=', 2)
    if (variantOptionNames.has(optionName) && inlineValue) {
      continue
    }
    if (variantOptionNames.has(value)) {
      index += 1
      continue
    }
    if (!value.startsWith('-') && appAliases[value.toLowerCase()]) {
      continue
    }
    filtered.push(value)
  }

  return filtered
}

async function buildWeb(app, outDir) {
  await run(node, [viteBin, 'build', '--mode', app.mode, '--configLoader', 'runner', '--outDir', outDir])
  const fullOutDir = path.join(root, outDir)
  await writeVariantMarker(app, fullOutDir)
  await assertResourcePolicy(app, fullOutDir)
  await assertVariantBundle(app, fullOutDir)
}

async function writeVariantMarker(app, outDir) {
  const marker = {
    appId: app.id,
    kind: app.mode,
    packageDir: app.packageDir,
    includesTextbookResources: app.includesTextbookResources,
  }
  await fs.writeFile(path.join(outDir, 'variant.json'), `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
}

async function assertResourcePolicy(app, outDir) {
  if (app.includesTextbookResources) {
    const missing = ['book', 'book-110'].filter((name) => !existsSync(path.join(outDir, name)))
    if (missing.length) {
      throw new Error(`Textbook build is missing local resource directories: ${missing.join(', ')}`)
    }
    return
  }

  const forbidden = await findForbiddenTextbookDirs(outDir)
  if (forbidden.length) {
    throw new Error(
      `Public variant "${app.id}" must not include textbook resources. Forbidden directories found: ${forbidden
        .map((item) => path.relative(root, item).replaceAll(path.sep, '/'))
        .join(', ')}`,
    )
  }
}

async function assertVariantBundle(app, outDir) {
  const bundleText = await readBundleText(outDir)

  if (app.id === 'chalkline' && !bundleText.includes('whiteboard-app')) {
    throw new Error(`Blank bundle does not contain whiteboard UI: ${path.relative(root, outDir)}`)
  }

  if (app.id === 'chalkline' && (bundleText.includes('textbook-main') || bundleText.includes('visualizer-shell'))) {
    throw new Error(`Blank bundle unexpectedly contains another app marker: ${path.relative(root, outDir)}`)
  }

  if (app.id === 'textbook' && !bundleText.includes('textbook-main')) {
    throw new Error(`Textbook bundle does not contain textbook metadata: ${path.relative(root, outDir)}`)
  }

  if (app.id === 'textbook' && /id:\s*[`'"]blank[`'"]/.test(bundleText)) {
    throw new Error(`Textbook bundle unexpectedly contains a blank-canvas book: ${path.relative(root, outDir)}`)
  }

  if (app.id === 'visualizer' && !bundleText.includes('visualizer-shell')) {
    throw new Error(`Visualizer bundle does not contain projection UI: ${path.relative(root, outDir)}`)
  }

  if (app.id === 'visualizer') {
    const jsFiles = await readBundleJsFiles(outDir)
    if (!jsFiles.some((name) => /^ProjectionApp-.*\.js$/.test(name))) {
      throw new Error(`Visualizer bundle does not contain a projection entry chunk: ${path.relative(root, outDir)}`)
    }
    const forbiddenChunks = visualizerForbiddenChunks(jsFiles)
    if (forbiddenChunks.length) {
      throw new Error(
        `Visualizer bundle unexpectedly includes whiteboard-only chunks: ${forbiddenChunks
          .map((name) => path.posix.basename(name))
          .join(', ')}`,
      )
    }
    const forbiddenMarkers = visualizerForbiddenMarkers(bundleText)
    if (forbiddenMarkers.length) {
      throw new Error(`Visualizer bundle unexpectedly includes whiteboard-only markers: ${forbiddenMarkers.join(', ')}`)
    }
  }

  const markerPath = path.join(outDir, 'variant.json')
  if (!existsSync(markerPath)) {
    throw new Error(`Variant marker is missing: ${path.relative(root, markerPath)}`)
  }
  const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'))
  if (
    marker.appId !== app.id ||
    marker.kind !== app.mode ||
    marker.packageDir !== app.packageDir ||
    marker.includesTextbookResources !== app.includesTextbookResources
  ) {
    throw new Error(`Variant marker does not match ${app.id}: ${path.relative(root, markerPath)}`)
  }
}

async function readBundleText(outDir) {
  const jsFiles = await readBundleJsFiles(outDir)
  const assetDir = path.join(outDir, 'assets')
  return (
    await Promise.all(
      jsFiles.map(async (name) => {
        try {
          return await fs.readFile(path.join(assetDir, name), 'utf8')
        } catch {
          return ''
        }
      }),
    )
  ).join('\n')
}

async function readBundleJsFiles(outDir) {
  const assetDir = path.join(outDir, 'assets')
  if (!existsSync(assetDir)) return []
  return (await fs.readdir(assetDir)).filter((name) => name.endsWith('.js'))
}

function visualizerForbiddenChunks(jsFiles) {
  const forbidden = /^(App|mammoth\.browser|jspdf|pdf-|html2canvas|src-|jszip|importers-|exporters-|noteFormat-|smartart-|render-|animation-|browser-|dist-).*\.m?js$/
  return jsFiles.filter((name) => forbidden.test(name))
}

function visualizerForbiddenMarkers(bundleText) {
  return ['whiteboard-app', 'book-picker', 'open-whiteboard-selected-book', 'presentationRuntimeRef', 'textbook-main'].filter((marker) =>
    bundleText.includes(marker),
  )
}

async function findForbiddenTextbookDirs(startDir) {
  if (!existsSync(startDir)) return []
  const forbiddenNames = new Set(['book', 'book-110'])
  const found = []
  const pending = [startDir]
  while (pending.length) {
    const current = pending.pop()
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const fullPath = path.join(current, entry.name)
      if (forbiddenNames.has(entry.name.toLowerCase())) {
        found.push(fullPath)
      } else {
        pending.push(fullPath)
      }
    }
  }
  return found
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
    `-p:AppAssemblyName=${app.assemblyName ?? path.basename(app.exeName, '.exe')}`,
    `-p:AppIcon=${app.appIconName ?? 'assets\\whiteboard.ico'}`,
    `-p:AppDistDir=${app.desktopDist}`,
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
  console.log(`Usage: node scripts/whiteboard.mjs <command> [${Object.keys(appAliases).sort().join('|')}]

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
