import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apps } from './release.config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseRoot = path.join(root, 'release-unified')
const administratorDesktop = path.join(os.homedir(), 'Desktop')
const publicDesktop = 'C:\\Users\\Public\\Desktop'
const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
const programData = process.env.PROGRAMDATA || 'C:\\ProgramData'
const hiClassStartMenu = path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'HiClass')
const textbookDesktopPrefix = '\u6b65\u6b65\u9ad8v'
const whiteboardShortcutName = '\u9e3f\u5408\u767d\u677f\u8f6f\u4ef6.lnk'
const visualizerShortcutName = '\u9e3f\u5408\u89c6\u9891\u5c55\u53f0.lnk'

async function main() {
  const expectedVersion = parseExpectedVersion(process.argv.slice(2))
  const latestAll = findRelease('all', expectedVersion)
  const latestTextbook = findRelease('textbook', expectedVersion)
  const latestAllManifest = readReleaseManifest(latestAll.directory)
  const latestTextbookManifest = readReleaseManifest(latestTextbook.directory)
  const desktopAudit = readDesktopAudit(latestAll.version)
  const allManifestShaChecks = artifactShaChecks(latestAllManifest)
  const textbookManifestShaChecks = artifactShaChecks(latestTextbookManifest)
  const allDesktopTextbookExecutableFiles = findAllTextbookExecutableFilesOnManagedDesktops()
  const allLegacyDesktopExecutableFiles = findAllLegacyExecutableFilesOnManagedDesktops()
  const desktopExecutables = findDesktopTextbookExecutables()
  const desktopExe = desktopExecutables[0]
  if (!desktopExe) throw new Error(`No desktop textbook executable found in ${administratorDesktop}`)
  const textbookSinglefileBase = path.join(latestTextbook.directory, 'singlefile', apps.textbook.packageDir)
  const textbookSinglefileExe = path.join(textbookSinglefileBase, apps.textbook.exeName)
  const desktopSinglefileMarkers = readDesktopSinglefileMarkers(desktopExe.path)
  const desktopShellGuard = readDesktopShellGuard()
  const expectedShortcutLinks = managedClassroomShortcutLinks()
  const allClassroomShortcuts = findAllClassroomShortcutsOnManagedLocations()
  const desktopRuntimeCacheChecks = findDesktopRuntimeCacheChecks()
  const legacyRuntimeCacheChecks = findLegacyRuntimeCacheChecks()
  const runningDesktopProcessChecks = await findRunningDesktopProcessChecks([
    latestAll.directory,
    latestTextbook.directory,
    desktopExe.path,
    path.join(path.dirname(desktopExe.path), `${apps.textbook.assemblyName}_Data`),
  ])
  const shortcuts = await readShortcuts([
    ...expectedShortcutLinks,
  ])

  const base = path.join(latestAll.directory, 'multifile')
  const embeddedResources = await readEmbeddedAppResources([
    [apps.chalkline.id, path.join(base, apps.chalkline.packageDir, `${path.basename(apps.chalkline.exeName, '.exe')}.dll`)],
    [apps.textbook.id, path.join(base, apps.textbook.packageDir, `${path.basename(apps.textbook.exeName, '.exe')}.dll`)],
    [apps.visualizer.id, path.join(base, apps.visualizer.packageDir, `${path.basename(apps.visualizer.exeName, '.exe')}.dll`)],
  ])
  const embeddedResourceMap = new Map(embeddedResources.map((item) => [item.app, item]))
  const checks = [
    check('latest all release exists', fs.existsSync(latestAll.directory), latestAll.directory),
    check('latest textbook singlefile release exists', fs.existsSync(latestTextbook.directory), latestTextbook.directory),
    check('latest textbook version matches latest all release', latestTextbook.version === latestAll.version, latestTextbook.directory),
    check('latest all release manifest version matches directory', latestAllManifest.version === latestAll.version, latestAll.directory),
    check(
      'latest textbook release manifest version matches directory',
      latestTextbookManifest.version === latestTextbook.version,
      latestTextbook.directory,
    ),
    check(
      'latest all release artifact sha256 values match files',
      allManifestShaChecks.length > 0 && allManifestShaChecks.every((item) => item.pass),
      allManifestShaChecks.filter((item) => !item.pass).map((item) => item.executable).join('; ') || latestAll.directory,
    ),
    check(
      'latest textbook release artifact sha256 values match files',
      textbookManifestShaChecks.length > 0 && textbookManifestShaChecks.every((item) => item.pass),
      textbookManifestShaChecks.filter((item) => !item.pass).map((item) => item.executable).join('; ') || latestTextbook.directory,
    ),
    check('latest all release manifest contains configured apps', manifestContainsApps(latestAllManifest, ['chalkline', 'textbook', 'visualizer']), latestAll.directory),
    check(
      'latest all release manifest contains configured multifile artifacts',
      manifestContainsArtifacts(latestAllManifest, [
        [apps.chalkline.id, 'multifile', apps.chalkline.packageDir, apps.chalkline.exeName],
        [apps.textbook.id, 'multifile', apps.textbook.packageDir, apps.textbook.exeName],
        [apps.visualizer.id, 'multifile', apps.visualizer.packageDir, apps.visualizer.exeName],
      ]),
      latestAll.directory,
    ),
    check(
      'latest textbook release manifest contains only textbook singlefile artifact',
      latestTextbookManifest.apps?.length === 1 &&
        latestTextbookManifest.apps[0]?.id === apps.textbook.id &&
        manifestContainsArtifacts(latestTextbookManifest, [[apps.textbook.id, 'singlefile', apps.textbook.packageDir, apps.textbook.exeName]]),
      latestTextbook.directory,
    ),
    check('latest textbook singlefile exe exists', fs.existsSync(textbookSinglefileExe), textbookSinglefileExe),
    check('desktop textbook exe version matches latest release', desktopExe.version === latestAll.version, desktopExe.path),
    check(
      'desktop has no stale textbook executables',
      allDesktopTextbookExecutableFiles.length === 1 && pathEquals(allDesktopTextbookExecutableFiles[0], desktopExe.path),
      `${administratorDesktop}; ${publicDesktop}`,
    ),
    check('desktop has no stale OpenWhiteboard executables', allLegacyDesktopExecutableFiles.length === 0, allLegacyDesktopExecutableFiles.join('; ')),
    check('desktop textbook exe is singlefile-sized', desktopExe.bytes > 200 * 1024 * 1024, desktopExe.path),
    check(
      'desktop textbook exe name is exact versioned name',
      desktopExe.name === `${textbookDesktopPrefix}${latestAll.version}.exe`,
      desktopExe.path,
    ),
    check('desktop shell defines singlefile resource guard', desktopShellGuard.projectDefinesGuard, desktopShellGuard.projectPath),
    check('desktop shell singlefile uses embedded resources first', desktopShellGuard.windowUsesEmbeddedFirst, desktopShellGuard.windowPath),
    check('desktop shell uses app-specific data directory', desktopShellGuard.windowUsesAppSpecificDataDirectory, desktopShellGuard.windowPath),
    check('desktop shell uses app-specific webview host', desktopShellGuard.windowUsesAppSpecificHost, desktopShellGuard.windowPath),
    check('desktop shell validates app variant marker', desktopShellGuard.windowValidatesAppVariantMarker, desktopShellGuard.windowPath),
    check('desktop shell resolves identity with format-specific marker priority', desktopShellGuard.windowUsesFormatSpecificMarkerPriority, desktopShellGuard.windowPath),
    check('desktop shell validates textbook resource folders', desktopShellGuard.windowValidatesTextbookResourceFolders, desktopShellGuard.windowPath),
    check('desktop shell validates visualizer bundle markers', desktopShellGuard.windowValidatesVisualizerBundleMarkers, desktopShellGuard.windowPath),
    check('desktop shell cache-busts app assets', desktopShellGuard.windowCacheBustsAppAssets, desktopShellGuard.windowPath),
    check('desktop shell startup title follows app variant', desktopShellGuard.windowUsesVariantStartupTitle, desktopShellGuard.windowPath),
    check(
      'desktop has no duplicate classroom shortcuts',
      samePathSet(allClassroomShortcuts, expectedShortcutLinks),
      allClassroomShortcuts.join('; '),
    ),
    check(
      'desktop runtime app caches match their app variants',
      desktopRuntimeCacheChecks.every((item) => item.pass),
      desktopRuntimeCacheChecks.filter((item) => !item.pass).map((item) => item.cacheDirectory).join('; '),
    ),
    check(
      'legacy runtime app caches are reported without destructive cleanup',
      legacyRuntimeCacheChecks.every((item) => item.pass),
      legacyRuntimeCacheChecks.filter((item) => !item.pass).map((item) => item.dataDirectory).join('; '),
    ),
    check('desktop audit report exists', desktopAudit.exists, desktopAudit.auditPath),
    check('desktop restore script exists', desktopAudit.restoreScriptExists, desktopAudit.restoreScriptPath),
    check(
      'desktop audit records quarantine and restore policy',
      desktopAudit.policyRecorded && desktopAudit.restoreActionsRecorded,
      desktopAudit.auditPath,
    ),
    check(
      'running desktop app processes are current release only',
      runningDesktopProcessChecks.every((item) => item.pass),
      runningDesktopProcessChecks.filter((item) => !item.pass).map((item) => `${item.name}:${item.processId}:${item.detail}`).join('; '),
    ),
    check(
      'desktop textbook exe matches latest singlefile artifact',
      fs.existsSync(textbookSinglefileExe) && sha256File(desktopExe.path) === sha256File(textbookSinglefileExe),
      desktopExe.path,
    ),
    check(
      'desktop textbook singlefile embeds textbook app resources',
      desktopSinglefileMarkers.exists && desktopSinglefileMarkers.required.every((item) => item.found),
      desktopExe.path,
    ),
    check(
      'desktop textbook singlefile embeds textbook variant marker content',
      desktopSinglefileMarkers.exists && desktopSinglefileMarkers.variant.every((item) => item.found),
      desktopExe.path,
    ),
    check(
      'desktop textbook singlefile does not embed other app assemblies',
      desktopSinglefileMarkers.exists && desktopSinglefileMarkers.forbidden.every((item) => !item.found),
      desktopExe.path,
    ),
    check('whiteboard multifile exe exists', fs.existsSync(path.join(base, apps.chalkline.packageDir, apps.chalkline.exeName)), base),
    check('textbook multifile exe exists', fs.existsSync(path.join(base, apps.textbook.packageDir, apps.textbook.exeName)), base),
    check('visualizer multifile exe exists', fs.existsSync(path.join(base, apps.visualizer.packageDir, apps.visualizer.exeName)), base),
    check(
      'textbook singlefile main resource exists',
      fs.existsSync(path.join(textbookSinglefileBase, 'book', '260.jpg')),
      textbookSinglefileBase,
    ),
    check(
      'textbook singlefile 110 resource exists',
      fs.existsSync(path.join(textbookSinglefileBase, 'book-110', '212.jpg')),
      textbookSinglefileBase,
    ),
    check('textbook main resource exists', fs.existsSync(path.join(base, apps.textbook.packageDir, 'app', 'book', '260.jpg')), base),
    check('textbook 110 resource exists', fs.existsSync(path.join(base, apps.textbook.packageDir, 'app', 'book-110', '212.jpg')), base),
    check('blank variant marker matches', variantMarkerMatches(path.join(base, apps.chalkline.packageDir, 'app'), apps.chalkline), base),
    check('textbook variant marker matches', variantMarkerMatches(path.join(base, apps.textbook.packageDir, 'app'), apps.textbook), base),
    check('visualizer variant marker matches', variantMarkerMatches(path.join(base, apps.visualizer.packageDir, 'app'), apps.visualizer), base),
    check('textbook singlefile marker matches', variantMarkerMatches(textbookSinglefileBase, apps.textbook), textbookSinglefileBase),
    check('textbook bundle marker exists', bundleContains(path.join(base, apps.textbook.packageDir, 'app'), 'textbook-main'), base),
    check('textbook bundle has no blank book id', !bundleMatches(path.join(base, apps.textbook.packageDir, 'app'), /id:\s*[`'"]blank[`'"]/), base),
    check('visualizer bundle marker exists', bundleContains(path.join(base, apps.visualizer.packageDir, 'app'), 'visualizer-shell'), base),
    check(
      'visualizer bundle is split from whiteboard-only chunks',
      visualizerChunkPolicyPass(path.join(base, apps.visualizer.packageDir, 'app')),
      base,
    ),
    check('blank bundle marker exists', bundleContains(path.join(base, apps.chalkline.packageDir, 'app'), 'whiteboard-app'), base),
    check('blank bundle has no textbook marker', !bundleContains(path.join(base, apps.chalkline.packageDir, 'app'), 'textbook-main'), base),
    check('blank bundle has no visualizer marker', !bundleContains(path.join(base, apps.chalkline.packageDir, 'app'), 'visualizer-shell'), base),
    check('visualizer has no textbook directory', !fs.existsSync(path.join(base, apps.visualizer.packageDir, 'app', 'book')), base),
    check('blank embedded resources match blank app', embeddedResourceMatches(embeddedResourceMap.get(apps.chalkline.id), apps.chalkline), base),
    check('textbook embedded resources include textbook books', embeddedResourceMatches(embeddedResourceMap.get(apps.textbook.id), apps.textbook), base),
    check('visualizer embedded resources match visualizer app', embeddedResourceMatches(embeddedResourceMap.get(apps.visualizer.id), apps.visualizer), base),
  ]

  for (const shortcut of shortcuts) {
    const isWhiteboardShortcut = shortcut.link.endsWith(whiteboardShortcutName)
    const expectedApp = isWhiteboardShortcut ? apps.chalkline : apps.visualizer
    const expectedDirectory = path.join(base, expectedApp.packageDir)
    const expectedTarget = path.join(expectedDirectory, expectedApp.exeName)
    const expectedIconPath = path.join(expectedDirectory, expectedApp.appIconName)
    const expectedArguments = `--app=${expectedApp.mode}`
    checks.push(check(`shortcut target exists: ${path.basename(shortcut.link)}`, shortcut.targetExists, shortcut.target))
    checks.push(
      check(
        `shortcut target is exact latest ${expectedApp.packageDir}: ${path.basename(shortcut.link)}`,
        pathEquals(shortcut.target, expectedTarget),
        shortcut.target,
      ),
    )
    checks.push(
      check(
        `shortcut working directory is exact latest ${expectedApp.packageDir}: ${path.basename(shortcut.link)}`,
        pathEquals(shortcut.workingDirectory, expectedDirectory),
        shortcut.workingDirectory,
      ),
    )
    checks.push(
      check(
        `shortcut forces exact app variant: ${path.basename(shortcut.link)}`,
        String(shortcut.arguments || '') === expectedArguments,
        shortcut.arguments,
      ),
    )
    checks.push(
      check(
        `shortcut icon is exact latest ${expectedApp.packageDir}: ${path.basename(shortcut.link)}`,
        iconEquals(shortcut.iconLocation, expectedIconPath),
        shortcut.iconLocation,
      ),
    )
  }

  const failed = checks.filter((item) => !item.pass)
  console.log(
    JSON.stringify(
      {
        ok: failed.length === 0,
        latestAll,
        latestTextbook,
        desktopExe,
        shortcuts,
        allClassroomShortcuts,
        desktopRuntimeCacheChecks,
        legacyRuntimeCacheChecks,
        desktopAudit,
        runningDesktopProcessChecks,
        embeddedResources,
        checks,
      },
      null,
      2,
    ),
  )
  if (failed.length) process.exit(1)
}

function parseExpectedVersion(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--version') return assertExpectedVersion(args[index + 1])
    if (arg.startsWith('--version=')) return assertExpectedVersion(arg.slice('--version='.length))
  }

  return null
}

function assertExpectedVersion(version) {
  if (!/^0\.\d{2,4}\.\d+$/.test(version || '')) {
    throw new Error(`Unsupported expected version "${version}". Expected format like 0.613.18.`)
  }

  return version
}

function findRelease(profile, expectedVersion = null) {
  const entries = fs.existsSync(releaseRoot) ? fs.readdirSync(releaseRoot, { withFileTypes: true }) : []
  const releases = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const match = entry.name.match(new RegExp(`^${profile}-v(0\\.\\d{2,4}\\.\\d+)-(\\d{8}-\\d{6})$`))
      if (!match) return null
      return {
        name: entry.name,
        version: match[1],
        timestamp: match[2],
        directory: path.join(releaseRoot, entry.name),
      }
    })
    .filter(Boolean)
    .filter((release) => !expectedVersion || release.version === expectedVersion)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.name.localeCompare(a.name))
  if (!releases[0]) {
    const suffix = expectedVersion ? ` for version ${expectedVersion}` : ''
    throw new Error(`No ${profile} release${suffix} found in ${releaseRoot}`)
  }

  return releases[0]
}

function readReleaseManifest(releaseDirectory) {
  const manifestPath = path.join(releaseDirectory, 'release-manifest.json')
  if (!fs.existsSync(manifestPath)) return {}
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
}

function manifestContainsApps(manifest, appIds) {
  const actual = new Set((manifest.apps ?? []).map((app) => app.id))
  return appIds.every((id) => actual.has(id))
}

function manifestContainsArtifacts(manifest, expectedArtifacts) {
  const artifacts = manifest.artifacts ?? []
  return expectedArtifacts.every(([appId, format, packageDir, exeName]) =>
    artifacts.some(
      (artifact) => {
        const directory = normalizeManifestPath(artifact.directory)
        const executable = normalizeManifestPath(artifact.executable)
        return (
          artifact.app === appId &&
          artifact.format === format &&
          directory.endsWith(`/${packageDir}`) &&
          executable.endsWith(`/${packageDir}/${exeName}`)
        )
      },
    ),
  )
}

function artifactShaChecks(manifest) {
  return (manifest.artifacts ?? []).map((artifact) => {
    const executable = path.join(root, artifact.executable ?? '')
    const expectedSha = String(artifact.sha256 ?? '')
    const exists = fs.existsSync(executable)
    const actualSha = exists ? sha256File(executable) : ''
    return {
      app: artifact.app,
      format: artifact.format,
      executable,
      pass: Boolean(exists && expectedSha && actualSha === expectedSha),
    }
  })
}

function normalizeManifestPath(value) {
  return String(value || '').replaceAll('\\', '/')
}

function findDesktopTextbookExecutables() {
  return findTextbookExecutablesOnDesktop(administratorDesktop)
    .map((fullPath) => {
      const name = path.basename(fullPath)
      const match = name.match(new RegExp(`^${textbookDesktopPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(0\\.\\d{2,4}\\.\\d+)\\.exe$`))
      if (!match) return null
      const stat = fs.statSync(fullPath)
      return { name, path: fullPath, version: match[1], bytes: stat.size, mtimeMs: stat.mtimeMs }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
}

function findAllTextbookExecutableFilesOnManagedDesktops() {
  return [administratorDesktop, publicDesktop].flatMap((desktop) => findTextbookExecutablesOnDesktop(desktop)).sort((a, b) => a.localeCompare(b))
}

function findAllLegacyExecutableFilesOnManagedDesktops() {
  return [administratorDesktop, publicDesktop].flatMap((desktop) => findLegacyExecutablesOnDesktop(desktop)).sort((a, b) => a.localeCompare(b))
}

function findAllClassroomShortcutsOnManagedDesktops() {
  return [administratorDesktop, publicDesktop].flatMap((desktop) => findClassroomShortcutsOnDesktop(desktop)).sort((a, b) => a.localeCompare(b))
}

function findAllClassroomShortcutsOnManagedLocations() {
  return [
    ...findAllClassroomShortcutsOnManagedDesktops(),
    ...findClassroomShortcutsInDirectory(path.join(hiClassStartMenu, '\u9e3f\u5408\u767d\u677f\u8f6f\u4ef6')),
    ...findClassroomShortcutsInDirectory(path.join(hiClassStartMenu, '\u9e3f\u5408\u89c6\u9891\u5c55\u53f0')),
  ].sort((a, b) => a.localeCompare(b))
}

function managedWhiteboardShortcutLinks() {
  return [
    path.join(administratorDesktop, whiteboardShortcutName),
    path.join(publicDesktop, whiteboardShortcutName),
    path.join(hiClassStartMenu, '\u9e3f\u5408\u767d\u677f\u8f6f\u4ef6', whiteboardShortcutName),
  ]
}

function managedVisualizerShortcutLinks() {
  return [
    path.join(administratorDesktop, visualizerShortcutName),
    path.join(publicDesktop, visualizerShortcutName),
    path.join(hiClassStartMenu, '\u9e3f\u5408\u89c6\u9891\u5c55\u53f0', visualizerShortcutName),
  ]
}

function managedClassroomShortcutLinks() {
  return [...managedWhiteboardShortcutLinks(), ...managedVisualizerShortcutLinks()]
}

function findDesktopRuntimeCacheChecks() {
  return [administratorDesktop, publicDesktop].flatMap((desktop) =>
    Object.values(apps).map((app) => {
      const dataDirectory = path.join(desktop, `${app.assemblyName}_Data`)
      const cacheDirectory = path.join(dataDirectory, 'app-cache')
      const exists = fs.existsSync(cacheDirectory)
      const markerMatches = !exists || variantMarkerMatches(cacheDirectory, app)
      const resourcePolicyMatches = !exists || runtimeCacheResourcePolicyMatches(cacheDirectory, app)
      const bundleMatches = !exists || runtimeCacheBundlePolicyMatches(cacheDirectory, app)
      return {
        desktop,
        app: app.id,
        dataDirectory,
        cacheDirectory,
        exists,
        markerMatches,
        resourcePolicyMatches,
        bundleMatches,
        pass: markerMatches && resourcePolicyMatches && bundleMatches,
      }
    }),
  )
}

function findLegacyRuntimeCacheChecks() {
  return legacyRuntimeDataDirectories().map((dataDirectory) => {
    const appCacheDirectory = path.join(dataDirectory, 'app-cache')
    const webViewDirectory = path.join(dataDirectory, 'WebView2')
    const appCacheExists = fs.existsSync(appCacheDirectory)
    const webViewExists = fs.existsSync(webViewDirectory)
    return {
      dataDirectory,
      appCacheDirectory,
      webViewDirectory,
      appCacheExists,
      webViewExists,
      pass: true,
    }
  })
}

function readDesktopAudit(version) {
  const auditPath = path.join(releaseRoot, version, 'desktop-audit.json')
  const restoreScriptPath = path.join(releaseRoot, version, 'restore-desktop-state.mjs')
  const exists = fs.existsSync(auditPath)
  let parsed = null
  if (exists) {
    try {
      parsed = JSON.parse(fs.readFileSync(auditPath, 'utf8'))
    } catch {
      parsed = null
    }
  }
  return {
    auditPath,
    restoreScriptPath,
    exists,
    restoreScriptExists: fs.existsSync(restoreScriptPath),
    policyRecorded: Boolean(parsed?.policy?.desktopExecutables && parsed?.policy?.shortcuts && parsed?.policy?.runtimeCaches),
    restoreActionsRecorded: Array.isArray(parsed?.restoreActions),
    quarantineDirectory: parsed?.quarantineDirectory,
  }
}

async function findRunningDesktopProcessChecks(allowedRoots) {
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$allowedRoots = ConvertFrom-Json @'
${JSON.stringify(allowedRoots, null, 2)}
'@
$textbookDesktopPrefix = ${JSON.stringify(textbookDesktopPrefix)}
$processNames = @('ChalklineBoard.exe', 'ChalklineTextbook.exe', 'ChalklineVisualizer.exe', 'OpenWhiteboard.exe')
$managedDataMarkers = @(
  'ChalklineBoard_Data',
  'ChalklineTextbook_Data',
  'ChalklineVisualizer_Data',
  'OpenWhiteboardBlankDesktop',
  'OpenWhiteboardDesktop',
  'OpenWhiteboardTextbook',
  'OpenWhiteboardTextbookRelease',
  'OpenWhiteboardVisualizerDesktop'
)
$rows = @()
$processes = Get-CimInstance Win32_Process | Where-Object {
  $commandLine = $_.CommandLine
  ($processNames -contains $_.Name) -or
  ($_.Name -and $_.Name.StartsWith('OpenWhiteboard', [StringComparison]::OrdinalIgnoreCase) -and $_.Name.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) -or
  ($_.Name -and $_.Name.StartsWith($textbookDesktopPrefix, [StringComparison]::OrdinalIgnoreCase) -and $_.Name.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) -or
  ($_.Name -eq 'msedgewebview2.exe' -and $commandLine -and (
    $commandLine.IndexOf('chalkline-board', [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
    [bool]($managedDataMarkers | Where-Object { $commandLine.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1)
  ))
}
foreach ($process in $processes) {
  $pathText = if ([string]::IsNullOrWhiteSpace($process.ExecutablePath)) { '' } else { $process.ExecutablePath }
  $commandText = if ([string]::IsNullOrWhiteSpace($process.CommandLine)) { '' } else { $process.CommandLine }
  $combined = "$pathText $commandText"
  $allowed = $false
  foreach ($rootPath in $allowedRoots) {
    if (![string]::IsNullOrWhiteSpace($rootPath) -and $combined.IndexOf($rootPath, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      $allowed = $true
    }
  }
  $rows += [pscustomobject]@{
    processId = $process.ProcessId
    name = $process.Name
    executablePath = $process.ExecutablePath
    pass = $allowed
    detail = $combined
  }
}
$rows | ConvertTo-Json -Depth 4
`
  const output = await capture('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ])
  if (!output.trim()) return []
  const parsed = JSON.parse(output)
  return Array.isArray(parsed) ? parsed : [parsed]
}

function legacyRuntimeDataDirectories() {
  const legacyNames = [
    'OpenWhiteboardBlankDesktop',
    'OpenWhiteboardDesktop',
    'OpenWhiteboardTextbook',
    'OpenWhiteboardTextbookRelease',
    'OpenWhiteboardVisualizerDesktop',
  ]
  return legacyNames.map((name) => path.join(localAppData, name))
}

function runtimeCacheResourcePolicyMatches(cacheDirectory, app) {
  const hasTextbookResources =
    fs.existsSync(path.join(cacheDirectory, 'book', '001.jpg')) &&
    fs.existsSync(path.join(cacheDirectory, 'book-110', '001.jpg'))

  if (app.includesTextbookResources) return hasTextbookResources
  return !fs.existsSync(path.join(cacheDirectory, 'book')) && !fs.existsSync(path.join(cacheDirectory, 'book-110'))
}

function runtimeCacheBundlePolicyMatches(cacheDirectory, app) {
  if (app.id === apps.textbook.id) {
    return bundleContains(cacheDirectory, 'textbook-main') && !bundleContains(cacheDirectory, 'visualizer-shell')
  }
  if (app.id === apps.visualizer.id) {
    return bundleContains(cacheDirectory, 'visualizer-shell') && visualizerForbiddenMarkers(readBundleText(cacheDirectory)).length === 0
  }
  return bundleContains(cacheDirectory, 'whiteboard-app') && !bundleContains(cacheDirectory, 'textbook-main') && !bundleContains(cacheDirectory, 'visualizer-shell')
}

function findTextbookExecutablesOnDesktop(desktop) {
  const files = fs.existsSync(desktop) ? fs.readdirSync(desktop, { withFileTypes: true }) : []
  return files
    .filter((entry) => entry.isFile())
    .filter((entry) => entry.name.toLowerCase().startsWith(textbookDesktopPrefix.toLowerCase()) && entry.name.toLowerCase().endsWith('.exe'))
    .map((entry) => path.join(desktop, entry.name))
    .sort((a, b) => a.localeCompare(b))
}

function findLegacyExecutablesOnDesktop(desktop) {
  const files = fs.existsSync(desktop) ? fs.readdirSync(desktop, { withFileTypes: true }) : []
  return files
    .filter((entry) => entry.isFile())
    .filter((entry) => entry.name.toLowerCase().startsWith('openwhiteboard') && entry.name.toLowerCase().endsWith('.exe'))
    .map((entry) => path.join(desktop, entry.name))
    .sort((a, b) => a.localeCompare(b))
}

function findClassroomShortcutsOnDesktop(desktop) {
  return findClassroomShortcutsInDirectory(desktop)
}

function findClassroomShortcutsInDirectory(directory) {
  const files = fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }) : []
  return files
    .filter((entry) => entry.isFile())
    .filter((entry) => isClassroomShortcutName(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort((a, b) => a.localeCompare(b))
}

function isClassroomShortcutName(fileName) {
  const lowerName = fileName.toLowerCase()
  const whiteboardStem = whiteboardShortcutName.slice(0, -'.lnk'.length).toLowerCase()
  const visualizerStem = visualizerShortcutName.slice(0, -'.lnk'.length).toLowerCase()
  return lowerName.endsWith('.lnk') && (lowerName.startsWith(whiteboardStem) || lowerName.startsWith(visualizerStem))
}

function bundleContains(appDir, needle) {
  return bundleMatches(appDir, (source) => source.includes(needle))
}

function bundleMatches(appDir, matcher) {
  const assetDir = path.join(appDir, 'assets')
  if (!fs.existsSync(assetDir)) return false
  return fs
    .readdirSync(assetDir)
    .filter((name) => name.endsWith('.js'))
    .some((name) => {
      const source = fs.readFileSync(path.join(assetDir, name), 'utf8')
      return typeof matcher === 'function' ? matcher(source) : matcher.test(source)
    })
}

function bundleJsFiles(appDir) {
  const assetDir = path.join(appDir, 'assets')
  if (!fs.existsSync(assetDir)) return []
  return fs.readdirSync(assetDir).filter((name) => name.endsWith('.js'))
}

function visualizerChunkPolicyPass(appDir) {
  const jsFiles = bundleJsFiles(appDir)
  return (
    jsFiles.some((name) => /^ProjectionApp-.*\.js$/.test(name)) &&
    visualizerForbiddenChunks(jsFiles).length === 0 &&
    visualizerForbiddenMarkers(readBundleText(appDir)).length === 0
  )
}

function visualizerForbiddenChunks(jsFiles) {
  const forbidden = /^(App|mammoth\.browser|jspdf|pdf-|html2canvas|src-|jszip|importers-|exporters-|noteFormat-|smartart-|render-|animation-|browser-|dist-).*\.m?js$/
  return jsFiles.filter((name) => forbidden.test(name))
}

function readBundleText(appDir) {
  const assetDir = path.join(appDir, 'assets')
  if (!fs.existsSync(assetDir)) return ''
  return fs
    .readdirSync(assetDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => fs.readFileSync(path.join(assetDir, name), 'utf8'))
    .join('\n')
}

function visualizerForbiddenMarkers(bundleText) {
  return ['whiteboard-app', 'book-picker', 'open-whiteboard-selected-book', 'presentationRuntimeRef', 'textbook-main'].filter((marker) =>
    bundleText.includes(marker),
  )
}

function variantMarkerMatches(appDir, app) {
  const markerPath = path.join(appDir, 'variant.json')
  if (!fs.existsSync(markerPath)) return false
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
    return (
      marker.appId === app.id &&
      marker.kind === app.mode &&
      marker.packageDir === app.packageDir &&
      marker.includesTextbookResources === app.includesTextbookResources
    )
  } catch {
    return false
  }
}

function embeddedResourceMatches(resourceInfo, app) {
  if (!resourceInfo || resourceInfo.error) return false
  const hasBooks = Boolean(resourceInfo.hasBook && resourceInfo.hasBook110)
  return (
    resourceInfo.assembly === (app.assemblyName ?? path.basename(app.exeName, '.exe')) &&
    resourceInfo.hasVariant === true &&
    resourceInfo.hasIndex === true &&
    hasBooks === app.includesTextbookResources
  )
}

function readDesktopSinglefileMarkers(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, required: [], forbidden: [] }
  const buffer = fs.readFileSync(filePath)
  const includesUtf8 = (marker) => buffer.includes(Buffer.from(marker, 'utf8'))
  const includesAnyEncoding = (marker) => includesUtf8(marker) || buffer.includes(Buffer.from(marker, 'utf16le'))
  const requiredMarkers = [
    'ChalklineTextbook.dll',
    'app/index.html',
    'app/variant.json',
    'textbook-main',
    'app/book\\001.jpg',
    'app/book-110\\001.jpg',
  ]
  const forbiddenMarkers = ['ChalklineBoard.dll', 'ChalklineVisualizer.dll']
  const variantMarkers = [
    '"appId": "textbook"',
    '"kind": "textbook"',
    '"packageDir": "chalkline-textbook"',
    '"includesTextbookResources": true',
  ]
  return {
    exists: true,
    required: requiredMarkers.map((marker) => ({ marker, found: includesAnyEncoding(marker) })),
    variant: variantMarkers.map((marker) => ({ marker, found: includesAnyEncoding(marker) })),
    forbidden: forbiddenMarkers.map((marker) => ({ marker, found: includesAnyEncoding(marker) })),
  }
}

function markerPriorityLooksCorrect(source) {
  const pattern =
    /var externalMarker = ReadVariantMarker\(Path\.Combine\(AppContext\.BaseDirectory, "app", "variant\.json"\)\);[\s\S]*?var embeddedMarker = ReadEmbeddedVariantMarker\(\);[\s\S]*?#if SINGLE_FILE_PUBLISH[\s\S]*?var marker = embeddedMarker \?\? externalMarker;[\s\S]*?#else[\s\S]*?var marker = externalMarker \?\? embeddedMarker;[\s\S]*?#endif/
  return pattern.test(source)
}

function check(name, pass, detail) {
  return { name, pass: Boolean(pass), detail }
}

function pathEquals(left, right) {
  return path.resolve(left || '').toLowerCase() === path.resolve(right || '').toLowerCase()
}

function samePathSet(left, right) {
  const normalize = (items) => items.map((item) => path.resolve(item).toLowerCase()).sort((a, b) => a.localeCompare(b))
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((item, index) => item === normalizedRight[index])
}

function iconEquals(actual, expected) {
  const iconPath = String(actual || '').replace(/,\d+$/, '')
  return pathEquals(iconPath, expected)
}

function readDesktopShellGuard() {
  const projectPath = path.join(root, 'desktop-shell', 'OpenWhiteboard.BlankDesktop.csproj')
  const windowPath = path.join(root, 'desktop-shell', 'MainWindow.xaml.cs')
  const projectSource = fs.existsSync(projectPath) ? fs.readFileSync(projectPath, 'utf8') : ''
  const windowSource = fs.existsSync(windowPath) ? fs.readFileSync(windowPath, 'utf8') : ''
  return {
    projectPath,
    windowPath,
    projectDefinesGuard: projectSource.includes('SINGLE_FILE_PUBLISH'),
    windowUsesEmbeddedFirst: windowSource.includes('#if SINGLE_FILE_PUBLISH') && windowSource.includes('return ExtractEmbeddedAppAssets();'),
    windowUsesAppSpecificDataDirectory:
      windowSource.includes('Assembly.GetExecutingAssembly().GetName().Name') &&
      windowSource.includes('DataDirectoryName') &&
      windowSource.includes('{AppAssemblyName}_Data'),
    windowUsesAppSpecificHost:
      windowSource.includes('ChalklineTextbook') &&
      windowSource.includes('chalkline-textbook.local') &&
      windowSource.includes('ChalklineVisualizer') &&
      windowSource.includes('chalkline-visualizer.local'),
    windowValidatesAppVariantMarker:
      windowSource.includes('ExpectedAppKind') &&
      windowSource.includes('ExpectedAppId') &&
      windowSource.includes('ExpectedPackageDir') &&
      windowSource.includes('ExpectedTextbookResources') &&
      windowSource.includes('variant.json') &&
      windowSource.includes('IsExpectedAppFolder') &&
      windowSource.includes('includesTextbookResources') &&
      windowSource.includes("Replace('\\\\', Path.DirectorySeparatorChar)") &&
      windowSource.includes('Packaged app assets do not match'),
    windowUsesFormatSpecificMarkerPriority:
      markerPriorityLooksCorrect(windowSource) &&
      windowSource.includes('return IdentityFromKind(kind);') &&
      !windowSource.includes('IncludesTextbookResources = marker.IncludesTextbookResources'),
    windowValidatesTextbookResourceFolders:
      windowSource.includes('FolderResourcePolicyMatches') &&
      windowSource.includes('Path.Combine(folder, "book", "001.jpg")') &&
      windowSource.includes('Path.Combine(folder, "book-110", "001.jpg")') &&
      windowSource.includes('!Directory.Exists(Path.Combine(folder, "book"))') &&
      windowSource.includes('!Directory.Exists(Path.Combine(folder, "book-110"))'),
    windowValidatesVisualizerBundleMarkers:
      windowSource.includes('FolderBundlePolicyMatches') &&
      windowSource.includes('BundleContains(folder, "textbook-main")') &&
      windowSource.includes('BundleContains(folder, "visualizer-shell")') &&
      windowSource.includes('BundleContains(folder, "whiteboard-app")') &&
      windowSource.includes('BundleContains(folder, "open-whiteboard-selected-book")'),
    windowCacheBustsAppAssets:
      windowSource.includes('ClearWebViewAssetCacheAsync') &&
      windowSource.includes('Network.clearBrowserCache') &&
      windowSource.includes('BuildAppUri(appFolder)') &&
      windowSource.includes('BuildAssetVersionToken(version)') &&
      windowSource.includes('SHA256.HashData') &&
      windowSource.includes('.asset-version') &&
      !windowSource.includes('Uri.EscapeDataString(version)'),
    windowUsesVariantStartupTitle:
      projectSource.includes('SINGLE_FILE_PUBLISH') &&
      fs.existsSync(path.join(root, 'desktop-shell', 'MainWindow.xaml')) &&
      fs.readFileSync(path.join(root, 'desktop-shell', 'MainWindow.xaml'), 'utf8').includes('x:Name="StartupTitle"') &&
      windowSource.includes('StartupTitle.Text = $"{AppTitle}'),
  }
}

function sha256File(filePath) {
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

async function readShortcuts(links) {
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$links = ConvertFrom-Json @'
${JSON.stringify(links, null, 2)}
'@
function Test-ExistingLiteralPath($path) {
  if ([string]::IsNullOrWhiteSpace($path)) { return $false }
  return Test-Path -LiteralPath $path
}
$shell = New-Object -ComObject WScript.Shell
$rows = @()
foreach ($link in $links) {
  if (Test-Path -LiteralPath $link) {
    $shortcut = $shell.CreateShortcut($link)
    $rows += [pscustomobject]@{
      link = $link
      target = $shortcut.TargetPath
      workingDirectory = $shortcut.WorkingDirectory
      arguments = $shortcut.Arguments
      iconLocation = $shortcut.IconLocation
      targetExists = Test-ExistingLiteralPath $shortcut.TargetPath
    }
  } else {
    $rows += [pscustomobject]@{
      link = $link
      target = ''
      workingDirectory = ''
      iconLocation = ''
      targetExists = $false
    }
  }
}
$rows | ConvertTo-Json -Depth 4
`
  const output = await capture('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ])
  const parsed = JSON.parse(output)
  return Array.isArray(parsed) ? parsed : [parsed]
}

async function readEmbeddedAppResources(items) {
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$items = ConvertFrom-Json @'
${JSON.stringify(
  items.map(([app, assemblyPath]) => ({ app, assemblyPath })),
  null,
  2,
)}
'@
$rows = @()
foreach ($item in $items) {
  if (!(Test-Path -LiteralPath $item.assemblyPath)) {
    $rows += [pscustomobject]@{
      app = $item.app
      assemblyPath = $item.assemblyPath
      assembly = ''
      resourceCount = 0
      hasVariant = $false
      hasIndex = $false
      hasBook = $false
      hasBook110 = $false
      error = 'missing assembly'
    }
    continue
  }
  try {
    $assembly = [Reflection.Assembly]::LoadFile($item.assemblyPath)
    $names = @($assembly.GetManifestResourceNames() | ForEach-Object { $_.Replace('\\', '/') })
    $rows += [pscustomobject]@{
      app = $item.app
      assemblyPath = $item.assemblyPath
      assembly = $assembly.GetName().Name
      resourceCount = $names.Count
      hasVariant = $names -contains 'app/variant.json'
      hasIndex = $names -contains 'app/index.html'
      hasBook = [bool]($names | Where-Object { $_ -like 'app/book/*' } | Select-Object -First 1)
      hasBook110 = [bool]($names | Where-Object { $_ -like 'app/book-110/*' } | Select-Object -First 1)
      error = ''
    }
  } catch {
    $rows += [pscustomobject]@{
      app = $item.app
      assemblyPath = $item.assemblyPath
      assembly = ''
      resourceCount = 0
      hasVariant = $false
      hasIndex = $false
      hasBook = $false
      hasBook110 = $false
      error = $_.Exception.Message
    }
  }
}
$rows | ConvertTo-Json -Depth 4
`
  const output = await capture('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ])
  const parsed = JSON.parse(output)
  return Array.isArray(parsed) ? parsed : [parsed]
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    let output = ''
    let error = ''
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      error += chunk
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve(output)
      else reject(new Error(`${command} exited with ${code}: ${error.trim()}`))
    })
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
