import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { resolveAppSelection } from './release.config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath
const viteBin = path.join('node_modules', 'vite', 'bin', 'vite.js')
const tscBin = path.join('node_modules', 'typescript', 'bin', 'tsc')
const formats = new Set(['multifile', 'singlefile', 'installer'])

async function releaseFromCli(rawArgs = process.argv.slice(2)) {
  const options = parseOptions(rawArgs)
  const profile = options.profile ?? options.variant ?? 'github'
  const selectedApps = resolveAppSelection(profile)
  const selectedFormats = resolveFormats(options.format ?? 'multifile')
  const defaultReleaseRoot = path.join(root, 'release-unified')
  const explicitOutDir = options.out ? path.resolve(root, options.out) : null
  const releaseVersion = await resolveReleaseVersion(
    options.version,
    explicitOutDir ? path.dirname(explicitOutDir) : defaultReleaseRoot,
  )
  const outDir = explicitOutDir ?? path.join(defaultReleaseRoot, releaseDirectoryName(profile, releaseVersion))

  assertSafeOutputDir(outDir)
  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })

  await typecheck()

  const source = getSourceInfo()
  const dotnet = await requireDotnetSdk()
  const artifacts = []
  for (const app of selectedApps) {
    assertResourcePolicy(app)

    for (const format of selectedFormats) {
      if (format === 'multifile') {
        artifacts.push(await publishMultifile(dotnet, app, path.join(outDir, 'multifile', app.packageDir)))
      } else if (format === 'singlefile') {
        artifacts.push(await publishSingleFile(dotnet, app, path.join(outDir, 'singlefile', app.packageDir)))
      } else if (format === 'installer') {
        artifacts.push(await publishInstaller(dotnet, app, path.join(outDir, 'installer'), releaseVersion))
      }
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    version: releaseVersion,
    profile,
    formats: selectedFormats,
    source,
    apps: selectedApps.map(({ id, mode, packageDir, includesTextbookResources }) => ({
      id,
      mode,
      packageDir,
      includesTextbookResources,
    })),
    artifacts,
  }
  await fs.writeFile(path.join(outDir, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`Published release to ${outDir}`)
  return manifest
}

async function publishMultifile(dotnet, app, outDir) {
  await buildDesktopAssets(app)
  await fs.mkdir(outDir, { recursive: true })
  await run(dotnet, [
    'publish',
    app.desktopProject,
    '-c',
    'Release',
    '-r',
    'win-x64',
    '--self-contained',
    'false',
    '-p:PublishSingleFile=false',
    '-o',
    outDir,
  ])
  await assertPublishedResourcePolicy(app, outDir)
  return describeArtifact(app, 'multifile', outDir, path.join(outDir, app.exeName))
}

async function publishSingleFile(dotnet, app, outDir) {
  await buildDesktopAssets(app)
  await fs.mkdir(outDir, { recursive: true })
  await run(dotnet, [
    'publish',
    app.desktopProject,
    '-c',
    'Release',
    '-r',
    'win-x64',
    '--self-contained',
    'true',
    '-p:PublishSingleFile=true',
    '-p:IncludeNativeLibrariesForSelfExtract=true',
    '-p:EnableCompressionInSingleFile=true',
    '-p:DebugType=none',
    '-p:DebugSymbols=false',
    '-p:CopyDocumentationFilesFromPackages=false',
    '-o',
    outDir,
  ])
  return describeArtifact(app, 'singlefile', outDir, path.join(outDir, app.exeName))
}

async function publishInstaller(dotnet, app, installerDir, releaseVersion) {
  const stagingDir = path.join(installerDir, 'staging', app.packageDir)
  const scriptDir = path.join(installerDir, 'scripts')
  const outputDir = path.join(installerDir, 'output')
  const iscc = findInnoCompiler()
  if (!iscc) {
    throw new Error('Inno Setup Compiler (ISCC.exe) is required for installer releases. Install Inno Setup 6 and rerun the release.')
  }

  await fs.mkdir(scriptDir, { recursive: true })
  await fs.mkdir(outputDir, { recursive: true })
  await publishMultifile(dotnet, app, stagingDir)

  const issPath = path.join(scriptDir, `${app.id}.iss`)
  await fs.writeFile(issPath, innoSetupScript(app, stagingDir, outputDir, releaseVersion), 'utf8')

  const setupPath = path.join(outputDir, app.installerName)
  await fs.rm(setupPath, { force: true })
  await run(iscc, [issPath])
  return describeArtifact(app, 'installer', outputDir, setupPath)
}

function innoSetupScript(app, sourceDir, outputDir, releaseVersion) {
  const appDirName = app.installDirName ?? (app.id === 'textbook' ? 'ClearBoardStudioTextbook' : app.id === 'visualizer' ? 'ClearBoardVisualizer' : 'ClearBoardStudio')
  return `#define AppName "${iss(app.displayName)}"
#define AppExe "${iss(app.exeName)}"

[Setup]
AppId={{${iss(appDirName)}}}
AppName={#AppName}
AppVersion=${iss(releaseVersion)}
DefaultDirName={localappdata}\\${iss(appDirName)}
DefaultGroupName={#AppName}
OutputDir=${iss(outputDir)}
OutputBaseFilename=${iss(path.basename(app.installerName, '.exe'))}
PrivilegesRequired=lowest
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Files]
Source: "${iss(path.join(sourceDir, '*'))}"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\\{#AppName}"; Filename: "{app}\\{#AppExe}"
Name: "{autodesktop}\\{#AppName}"; Filename: "{app}\\{#AppExe}"; Tasks: desktopicon

[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; Flags: unchecked

[Run]
Filename: "{app}\\{#AppExe}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent
`
}

function iss(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '""')
}

async function buildDesktopAssets(app) {
  await run(node, [viteBin, 'build', '--mode', app.mode, '--configLoader', 'runner', '--outDir', app.desktopDist])
  await assertPublishedResourcePolicy(app, path.join(root, app.desktopDist))
}

function assertResourcePolicy(app) {
  if (!app.includesTextbookResources) return
  const missing = ['public-textbook/book', 'public-textbook/book-110'].filter((relativePath) => !existsSync(path.join(root, relativePath)))
  if (missing.length) {
    throw new Error(`Textbook variant is missing local resource directories: ${missing.join(', ')}`)
  }
}

async function assertPublishedResourcePolicy(app, outDir) {
  if (app.includesTextbookResources) return
  const forbidden = await findForbiddenTextbookDirs(outDir)
  if (forbidden.length) {
    throw new Error(
      `Public variant "${app.id}" must not include textbook resources. Forbidden directories found: ${forbidden
        .map((item) => path.relative(root, item).replaceAll(path.sep, '/'))
        .join(', ')}`,
    )
  }
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

async function describeArtifact(app, format, outDir, exePath) {
  if (!existsSync(exePath)) {
    throw new Error(`Expected executable was not published: ${exePath}`)
  }

  const stat = await fs.stat(exePath)
  return {
    app: app.id,
    format,
    directory: path.relative(root, outDir).replaceAll(path.sep, '/'),
    executable: path.relative(root, exePath).replaceAll(path.sep, '/'),
    bytes: stat.size,
    sha256: await sha256File(exePath),
  }
}

function parseOptions(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith('--')) continue
    const [key, inlineValue] = arg.slice(2).split('=', 2)
    options[key] = inlineValue ?? args[index + 1]
    if (inlineValue === undefined) index += 1
  }
  return options
}

async function resolveReleaseVersion(value, releaseRoot) {
  if (value) return assertReleaseVersion(value)

  const now = new Date()
  const base = `0.${now.getMonth() + 1}${now.getDate()}.`
  const dateStamp = localDateStamp(now)
  const versionPattern = new RegExp(`(?:^|[^0-9])${escapeRegex(base)}(\\d+)(?:[^0-9]|$)`)
  let maxOrdinal = 0
  let datedReleaseCount = 0

  if (existsSync(releaseRoot)) {
    const entries = await fs.readdir(releaseRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const match = entry.name.match(versionPattern)
      if (match) maxOrdinal = Math.max(maxOrdinal, Number(match[1]))
      else if (entry.name.includes(dateStamp)) datedReleaseCount += 1
    }
  }

  return assertReleaseVersion(`${base}${Math.max(maxOrdinal, datedReleaseCount) + 1}`)
}

function assertReleaseVersion(version) {
  if (!/^0\.\d{2,4}\.\d+$/.test(version)) {
    throw new Error(`Unsupported release version "${version}". Expected format like 0.66.1.`)
  }
  return version
}

function localDateStamp(date) {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function resolveFormats(value) {
  if (value === 'all') return Array.from(formats)
  const selected = String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (!selected.length || selected.some((item) => !formats.has(item))) {
    throw new Error(`Unsupported release format "${value}". Use multifile, singlefile, installer, all, or a comma-separated list.`)
  }
  return selected
}

function releaseDirectoryName(profile, releaseVersion) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
  return `${String(profile).toLowerCase()}-v${releaseVersion}-${timestamp}`
}

function getSourceInfo() {
  return {
    branch: captureSync('git', ['branch', '--show-current']) || null,
    commit: captureSync('git', ['rev-parse', 'HEAD']) || null,
    shortCommit: captureSync('git', ['rev-parse', '--short', 'HEAD']) || null,
    dirty: Boolean(captureSync('git', ['status', '--porcelain'])),
  }
}

function captureSync(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0) return ''
  return result.stdout.trim()
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function assertSafeOutputDir(outDir) {
  const parsed = path.parse(outDir)
  if (outDir === parsed.root || outDir === root || path.dirname(outDir) === outDir) {
    throw new Error(`Refusing to clean unsafe output directory: ${outDir}`)
  }
}

async function typecheck() {
  await run(node, [tscBin, '-b'])
}

async function requireDotnetSdk() {
  const dotnet = resolveDotnet()
  const sdks = await capture(dotnet, ['--list-sdks'])
  if (!sdks.trim()) {
    throw new Error(`.NET SDK not found. Install .NET SDK 8.x, then rerun this command. Found dotnet at: ${dotnet}`)
  }
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

function findInnoCompiler() {
  const candidates =
    process.platform === 'win32'
      ? [
          captureSync('where.exe', ['iscc']).split(/\r?\n/).find(Boolean),
          'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
          'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
        ]
      : ['iscc']
  return candidates.filter(Boolean).find((candidate) => existsSync(candidate) || canRun(candidate, ['/?'])) ?? null
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: root,
      stdio: 'inherit',
      ...options,
    })
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
    const child = spawn(command, commandArgs, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
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
  if (!command) return false
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'ignore',
  })
  return result.status === 0
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  releaseFromCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}

export { releaseFromCli }
