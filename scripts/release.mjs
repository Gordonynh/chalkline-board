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
const optionNames = new Set(['profile', 'variant', 'format', 'out', 'version'])
const importOpenWithExtensions = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.avif',
  '.svg',
  '.pdf',
  '.ppt',
  '.pps',
  '.pot',
  '.pptx',
  '.pptm',
  '.ppsx',
  '.ppsm',
  '.potx',
  '.potm',
  '.odp',
  '.doc',
  '.dot',
  '.rtf',
  '.docx',
  '.docm',
  '.dotx',
  '.dotm',
  '.odt',
  '.xls',
  '.xlsx',
  '.xlsm',
  '.xltx',
  '.xltm',
  '.ods',
  '.txt',
  '.md',
  '.csv',
  '.tsv',
  '.json',
  '.html',
  '.htm',
  '.xml',
  '.log',
]

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

  try {
    await assertDesktopShellResourceGuard()
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
  } catch (error) {
    await fs.rm(outDir, { recursive: true, force: true })
    throw error
  }
}

async function publishMultifile(dotnet, app, outDir) {
  await buildDesktopAssets(app)
  await cleanDesktopProjectState(app)
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
    `-p:AppAssemblyName=${app.assemblyName ?? path.basename(app.exeName, '.exe')}`,
    `-p:AppIcon=${app.appIconName ?? 'assets\\whiteboard.ico'}`,
    `-p:AppDistDir=${app.desktopDist}`,
    '-o',
    outDir,
  ])
  await copyTextbookResources(app, path.join(outDir, 'app'))
  await assertPublishedResourcePolicy(app, outDir)
  await assertVariantBundle(app, path.join(outDir, 'app'))
  return describeArtifact(app, 'multifile', outDir, path.join(outDir, app.exeName))
}

async function publishSingleFile(dotnet, app, outDir) {
  await buildDesktopAssets(app)
  await cleanDesktopProjectState(app)
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
    `-p:AppAssemblyName=${app.assemblyName ?? path.basename(app.exeName, '.exe')}`,
    `-p:AppIcon=${app.appIconName ?? 'assets\\whiteboard.ico'}`,
    `-p:AppDistDir=${app.desktopDist}`,
    '-o',
    outDir,
  ])
  await copyTextbookResources(app, outDir)
  await writeVariantMarker(app, outDir)
  await assertSinglefileSidecarPolicy(app, outDir)
  return describeArtifact(app, 'singlefile', outDir, path.join(outDir, app.exeName))
}

async function cleanDesktopProjectState(app) {
  const projectDir = path.dirname(path.join(root, app.desktopProject))
  for (const childName of ['bin', 'obj']) {
    const target = path.join(projectDir, childName)
    assertPathInsideRoot(target)
    await fs.rm(target, { recursive: true, force: true })
  }
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
  const appIconName = app.appIconName ?? 'owbn.ico'
  const noteIconName = app.noteIconName ?? 'owbn.ico'
  const setupIconPath = path.join(sourceDir, appIconName)
  const noteProgId = `${appDirName}.owbn`
  const importProgId = `${appDirName}.import`
  const openWithRegistry = importOpenWithRegistryLines(importProgId)
  return `#define AppName "${iss(app.displayName)}"
#define AppExe "${iss(app.exeName)}"
#define NoteProgId "${iss(noteProgId)}"
#define ImportProgId "${iss(importProgId)}"

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
SetupIconFile=${iss(setupIconPath)}

[Files]
Source: "${iss(path.join(sourceDir, '*'))}"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\\{#AppName}"; Filename: "{app}\\{#AppExe}"; IconFilename: "{app}\\${iss(appIconName)}"
Name: "{autodesktop}\\{#AppName}"; Filename: "{app}\\{#AppExe}"; IconFilename: "{app}\\${iss(appIconName)}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\\Classes\\.owbn"; ValueType: string; ValueName: ""; ValueData: "{#NoteProgId}"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\\Classes\\{#NoteProgId}"; ValueType: string; ValueName: ""; ValueData: "Chalkline Board Note"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\\Classes\\{#NoteProgId}\\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\\${iss(noteIconName)},0"
Root: HKCU; Subkey: "Software\\Classes\\{#NoteProgId}\\shell\\open\\command"; ValueType: string; ValueName: ""; ValueData: """{app}\\{#AppExe}"" ""%1"""
Root: HKCU; Subkey: "Software\\Classes\\{#ImportProgId}"; ValueType: string; ValueName: ""; ValueData: "{#AppName} Import"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\\Classes\\{#ImportProgId}\\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\\${iss(appIconName)},0"
Root: HKCU; Subkey: "Software\\Classes\\{#ImportProgId}\\shell\\open\\command"; ValueType: string; ValueName: ""; ValueData: """{app}\\{#AppExe}"" ""%1"""
Root: HKCU; Subkey: "Software\\Classes\\Applications\\{#AppExe}"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "{#AppName}"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\\Classes\\Applications\\{#AppExe}\\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\\${iss(appIconName)},0"
Root: HKCU; Subkey: "Software\\Classes\\Applications\\{#AppExe}\\shell\\open\\command"; ValueType: string; ValueName: ""; ValueData: """{app}\\{#AppExe}"" ""%1"""
${openWithRegistry}

[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; Flags: unchecked

[Run]
Filename: "{app}\\{#AppExe}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent
`
}

function importOpenWithRegistryLines(importProgId) {
  return importOpenWithExtensions
    .map(
      (extension) =>
        `Root: HKCU; Subkey: "Software\\Classes\\${iss(extension)}\\OpenWithProgids"; ValueType: string; ValueName: "${iss(importProgId)}"; ValueData: ""; Flags: uninsdeletevalue`,
    )
    .join('\n')
}

function iss(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '""')
}

async function buildDesktopAssets(app) {
  await run(node, [viteBin, 'build', '--mode', app.mode, '--configLoader', 'runner', '--outDir', app.desktopDist])
  await copyTextbookResources(app, path.join(root, app.desktopDist))
  await writeVariantMarker(app, path.join(root, app.desktopDist))
  await assertPublishedResourcePolicy(app, path.join(root, app.desktopDist))
  await assertVariantBundle(app, path.join(root, app.desktopDist))
}

async function copyTextbookResources(app, appDir) {
  if (!app.includesTextbookResources) return
  for (const name of ['book', 'book-110']) {
    const source = path.join(root, 'public-textbook', name)
    const destination = path.join(appDir, name)
    if (!existsSync(source)) throw new Error(`Textbook resource directory is missing: ${path.relative(root, source)}`)
    await fs.rm(destination, { recursive: true, force: true })
    await fs.cp(source, destination, { recursive: true, verbatimSymlinks: false })
  }
}

async function writeVariantMarker(app, appDir) {
  const marker = {
    appId: app.id,
    kind: app.mode,
    packageDir: app.packageDir,
    includesTextbookResources: app.includesTextbookResources,
  }
  await fs.writeFile(path.join(appDir, 'variant.json'), `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
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

async function assertSinglefileSidecarPolicy(app, outDir) {
  await assertVariantMarker(app, outDir)

  if (app.includesTextbookResources) {
    const required = [
      path.join(outDir, 'book', '001.jpg'),
      path.join(outDir, 'book', '260.jpg'),
      path.join(outDir, 'book-110', '001.jpg'),
      path.join(outDir, 'book-110', '212.jpg'),
    ]
    const missing = required.filter((item) => !existsSync(item))
    if (missing.length) {
      throw new Error(
        `Single-file textbook sidecar is missing required resources: ${missing
          .map((item) => path.relative(root, item).replaceAll(path.sep, '/'))
          .join(', ')}`,
      )
    }
    return
  }

  const forbidden = await findForbiddenTextbookDirs(outDir)
  if (forbidden.length) {
    throw new Error(
      `Single-file public variant "${app.id}" must not include textbook resources. Forbidden directories found: ${forbidden
        .map((item) => path.relative(root, item).replaceAll(path.sep, '/'))
        .join(', ')}`,
    )
  }
}

async function assertVariantBundle(app, outDir) {
  const assetDir = path.join(outDir, 'assets')
  const jsFiles = existsSync(assetDir)
    ? (await fs.readdir(assetDir)).filter((name) => name.endsWith('.js'))
    : []
  const bundleText = (
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

  await assertVariantMarker(app, outDir)
}

async function assertVariantMarker(app, outDir) {
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

function visualizerForbiddenChunks(jsFiles) {
  const forbidden = /^(App|mammoth\.browser|jspdf|pdf-|html2canvas|src-|jszip|importers-|exporters-|noteFormat-|smartart-|render-|animation-|browser-|dist-).*\.m?js$/
  return jsFiles.filter((name) => forbidden.test(name))
}

function visualizerForbiddenMarkers(bundleText) {
  return ['whiteboard-app', 'book-picker', 'open-whiteboard-selected-book', 'presentationRuntimeRef', 'textbook-main'].filter((marker) =>
    bundleText.includes(marker),
  )
}

async function assertDesktopShellResourceGuard() {
  const projectPath = path.join(root, 'desktop-shell', 'OpenWhiteboard.BlankDesktop.csproj')
  const windowPath = path.join(root, 'desktop-shell', 'MainWindow.xaml.cs')
  const [projectSource, windowSource] = await Promise.all([
    fs.readFile(projectPath, 'utf8'),
    fs.readFile(windowPath, 'utf8'),
  ])

  if (!projectSource.includes('SINGLE_FILE_PUBLISH')) {
    throw new Error('Desktop shell must define SINGLE_FILE_PUBLISH for single-file releases.')
  }

  if (!windowSource.includes('#if SINGLE_FILE_PUBLISH') || !windowSource.includes('return ExtractEmbeddedAppAssets();')) {
    throw new Error('Desktop shell single-file releases must load embedded app assets before external app folders.')
  }

  if (
    !windowSource.includes('Assembly.GetExecutingAssembly().GetName().Name') ||
    !windowSource.includes('ExpectedAppKind') ||
    !windowSource.includes('ExpectedAppId') ||
    !windowSource.includes('ExpectedPackageDir') ||
    !windowSource.includes('ExpectedTextbookResources') ||
    !windowSource.includes('IsExpectedAppFolder') ||
    !windowSource.includes('includesTextbookResources') ||
    !windowSource.includes("Replace('\\\\', Path.DirectorySeparatorChar)") ||
    !windowSource.includes('{AppAssemblyName}_Data') ||
    !windowSource.includes('chalkline-textbook.local') ||
    !windowSource.includes('chalkline-visualizer.local')
  ) {
    throw new Error('Desktop shell variants must use app-specific data directories and WebView host names.')
  }

  if (
    !markerPriorityLooksCorrect(windowSource) ||
    !windowSource.includes('return IdentityFromKind(kind);') ||
    windowSource.includes('IncludesTextbookResources = marker.IncludesTextbookResources')
  ) {
    throw new Error('Desktop shell must use format-specific variant marker priority.')
  }

  if (
    !windowSource.includes('FolderResourcePolicyMatches(folder)') ||
    !windowSource.includes('FolderBundlePolicyMatches(folder)') ||
    !windowSource.includes('BundleContains(folder, "whiteboard-app")') ||
    !windowSource.includes('BundleContains(folder, "textbook-main")') ||
    !windowSource.includes('BundleContains(folder, "visualizer-shell")') ||
    !windowSource.includes('BundleContains(folder, "open-whiteboard-selected-book")')
  ) {
    throw new Error('Desktop shell variants must reject cross-loaded textbook and visualizer app bundles.')
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
    if (!optionNames.has(key)) {
      throw new Error(`Unknown release option "--${key}". Use --profile, --variant, --format, --out, or --version.`)
    }
    if (inlineValue !== undefined) {
      if (!inlineValue) throw new Error(`Missing value for --${key}.`)
      options[key] = inlineValue
      continue
    }

    const nextValue = args[index + 1]
    if (!nextValue || nextValue.startsWith('--')) {
      throw new Error(`Missing value for --${key}.`)
    }
    options[key] = nextValue
    index += 1
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

function releaseDirectoryName(profile, releaseVersion, date = new Date()) {
  const timestamp = localTimestampForReleaseVersion(date, releaseVersion)
  return `${String(profile).toLowerCase()}-v${releaseVersion}-${timestamp}`
}

function localTimestamp(date) {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}-${hour}${minute}${second}`
}

function localTimestampForReleaseVersion(date, releaseVersion) {
  const releaseDate = dateFromReleaseVersion(date, releaseVersion)
  if (!releaseDate) return localTimestamp(date)
  return `${localDateStamp(releaseDate)}-${localTimeStamp(date)}`
}

function localTimeStamp(date) {
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${hour}${minute}${second}`
}

function dateFromReleaseVersion(referenceDate, releaseVersion) {
  const match = String(releaseVersion).match(/^0\.(\d{2,4})\.\d+$/)
  if (!match) return null
  const code = match[1]
  const candidates = []
  for (let split = 1; split < code.length; split += 1) {
    const month = Number(code.slice(0, split))
    const day = Number(code.slice(split))
    const candidate = new Date(referenceDate)
    candidate.setFullYear(referenceDate.getFullYear(), month - 1, day)
    if (candidate.getMonth() === month - 1 && candidate.getDate() === day) {
      candidates.push(candidate)
    }
  }
  if (!candidates.length) return null

  return candidates.sort((left, right) => {
    const leftDistance = Math.abs(startOfDay(left).getTime() - startOfDay(referenceDate).getTime())
    const rightDistance = Math.abs(startOfDay(right).getTime() - startOfDay(referenceDate).getTime())
    return leftDistance - rightDistance
  })[0]
}

function startOfDay(date) {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  return value
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
  const defaultReleaseRoot = path.join(root, 'release-unified')
  if (
    path.resolve(outDir) === parsed.root ||
    path.resolve(outDir).toLowerCase() === root.toLowerCase() ||
    path.resolve(outDir).toLowerCase() === defaultReleaseRoot.toLowerCase() ||
    path.dirname(outDir) === outDir
  ) {
    throw new Error(`Refusing to clean unsafe output directory: ${outDir}`)
  }
}

function markerPriorityLooksCorrect(source) {
  const pattern =
    /var externalMarker = ReadVariantMarker\(Path\.Combine\(AppContext\.BaseDirectory, "app", "variant\.json"\)\);[\s\S]*?var embeddedMarker = ReadEmbeddedVariantMarker\(\);[\s\S]*?#if SINGLE_FILE_PUBLISH[\s\S]*?var marker = embeddedMarker \?\? externalMarker;[\s\S]*?#else[\s\S]*?var marker = externalMarker \?\? embeddedMarker;[\s\S]*?#endif/
  return pattern.test(source)
}

function assertPathInsideRoot(targetPath) {
  const resolved = path.resolve(targetPath)
  const relative = path.relative(root, resolved)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean path outside repository: ${resolved}`)
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  releaseFromCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}

export { dateFromReleaseVersion, localDateStamp, localTimestamp, releaseDirectoryName, releaseFromCli, resolveReleaseVersion }
