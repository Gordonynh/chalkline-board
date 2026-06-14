import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseFromCli, resolveReleaseVersion } from './release.mjs'
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
const shortcutAppModes = new Set(['blank', 'textbook', 'visualizer'])

async function main() {
  const deployOptions = parseDeployOptions(process.argv.slice(2))
  await run(process.execPath, [path.join(root, 'scripts', 'preflight.mjs')], {
    WHITEBOARD_PREFLIGHT_DESKTOP: '1',
    WHITEBOARD_PREFLIGHT_VARIANTS: '1',
  })

  const releaseVersion = await resolveReleaseVersion(null, releaseRoot)
  const desktopStateDirectory = path.join(releaseRoot, releaseVersion)
  const quarantineDirectory = path.join(desktopStateDirectory, 'quarantine', 'desktop-backup')
  const desktopAuditPath = path.join(desktopStateDirectory, 'desktop-audit.json')
  const desktopRestoreScriptPath = path.join(desktopStateDirectory, 'restore-desktop-state.mjs')
  const allManifest = await releaseFromCli(['--profile', 'all', '--format', 'multifile', '--version', releaseVersion])
  const textbookManifest = await releaseFromCli(['--profile', 'textbook', '--format', 'singlefile', '--version', releaseVersion])

  const whiteboardMultifile = artifactPath(allManifest, 'chalkline', 'multifile')
  const textbookMultifile = artifactPath(allManifest, 'textbook', 'multifile')
  const visualizerMultifile = artifactPath(allManifest, 'visualizer', 'multifile')
  const textbookSinglefile = artifactPath(textbookManifest, 'textbook', 'singlefile')
  const textbookDesktopExe = path.join(administratorDesktop, `${textbookDesktopPrefix}${releaseVersion}.exe`)
  const expectedShortcutLinks = managedClassroomShortcutLinks()
  const shortcutItems = [
    ...managedWhiteboardShortcutLinks().map((link) => shortcutItem(link, whiteboardMultifile)),
    ...managedVisualizerShortcutLinks().map((link) => shortcutItem(link, visualizerMultifile)),
  ]
  const runtimeCacheRoots = [
    runtimeDataDirectoryForArtifact(whiteboardMultifile),
    runtimeDataDirectoryForArtifact(textbookMultifile),
    runtimeDataDirectoryForArtifact(visualizerMultifile),
    path.join(path.dirname(textbookDesktopExe), `${apps.textbook.assemblyName}_Data`),
    ...desktopRuntimeDataDirectories(),
    ...legacyRuntimeDataDirectories(),
  ]

  const releaseArtifactVerification = verifyReleaseArtifacts({
    whiteboardMultifile,
    textbookMultifile,
    textbookSinglefile,
    visualizerMultifile,
  })
  const desktopAudit = await collectDesktopAudit({
    releaseVersion,
    textbookDesktopExe,
    shortcutItems,
    expectedShortcutLinks,
    runtimeCacheRoots,
    clearCacheRequested: deployOptions.clearCache,
  })
  const restoreActions = []

  const stoppedDesktopProcesses = await stopManagedDesktopProcesses()
  await fs.mkdir(quarantineDirectory, { recursive: true })
  await ensureDesktopDirectories()
  const existingTextbookDesktopBackup = await backupExistingFile(
    textbookDesktopExe,
    quarantineDirectory,
    restoreActions,
    'desktop textbook executable target existed before deployment',
  )
  await copyExecutable(textbookSinglefile.executablePath, textbookDesktopExe)
  const quarantinedOldDesktopExecutables = await quarantineOldDesktopTextbookExecutables(textbookDesktopExe, quarantineDirectory, restoreActions)
  const quarantinedDuplicateShortcuts = await quarantineDuplicateClassroomShortcuts(expectedShortcutLinks, quarantineDirectory, restoreActions)
  const shortcutBackups = await backupExistingShortcuts(shortcutItems, quarantineDirectory, restoreActions)
  await ensureShortcutDirectories(shortcutItems)
  await updateShortcuts(shortcutItems)
  const runtimeCacheActions = await handleRuntimeCaches(runtimeCacheRoots, {
    clearCache: deployOptions.clearCache,
    quarantineDirectory,
    restoreActions,
  })
  await writeDesktopAuditAndRestore({
    audit: {
      ...desktopAudit,
      completedAt: new Date().toISOString(),
      quarantineDirectory,
      restoreScriptPath: desktopRestoreScriptPath,
      existingTextbookDesktopBackup,
      quarantinedOldDesktopExecutables,
      quarantinedDuplicateShortcuts,
      shortcutBackups,
      runtimeCacheActions,
      restoreActions,
    },
    auditPath: desktopAuditPath,
    restoreScriptPath: desktopRestoreScriptPath,
  })

  const verification = await verifyDesktopDeployment({
    textbookDesktopExe,
    whiteboardMultifile,
    textbookMultifile,
    textbookSinglefile,
    visualizerMultifile,
    shortcutItems,
  })
  const strictVerification = await runStrictDesktopVerification(releaseVersion)

  console.log(
    JSON.stringify(
      {
        textbookDesktopExe,
        allReleaseVersion: allManifest.version,
        textbookReleaseVersion: textbookManifest.version,
        preflight: 'passed',
        stoppedDesktopProcesses,
        desktopAuditPath,
        desktopRestoreScriptPath,
        existingTextbookDesktopBackup,
        quarantinedOldDesktopExecutables,
        quarantinedDuplicateShortcuts,
        shortcutBackups,
        runtimeCacheActions,
        releaseArtifactVerification,
        verification,
        strictVerification,
      },
      null,
      2,
    ),
  )
}

function parseDeployOptions(args) {
  return {
    clearCache: args.includes('--clear-cache'),
  }
}

function artifactPath(manifest, app, format) {
  const artifact = manifest.artifacts.find((item) => item.app === app && item.format === format)
  if (!artifact) throw new Error(`Missing ${app} ${format} artifact in release manifest`)
  const directoryPath = path.join(root, artifact.directory)
  const executablePath = path.join(root, artifact.executable)
  if (!existsSync(executablePath)) throw new Error(`Missing released executable: ${executablePath}`)
  return { ...artifact, directoryPath, executablePath }
}

async function ensureDesktopDirectories() {
  await Promise.all([fs.mkdir(administratorDesktop, { recursive: true }), fs.mkdir(publicDesktop, { recursive: true })])
}

async function ensureShortcutDirectories(items) {
  await Promise.all(items.map((item) => fs.mkdir(path.dirname(item.link), { recursive: true })))
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

async function copyExecutable(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.copyFile(source, destination)
  if (!existsSync(destination)) throw new Error(`Desktop textbook executable was not copied: ${destination}`)
  const [sourceHash, destinationHash] = await Promise.all([sha256File(source), sha256File(destination)])
  if (sourceHash !== destinationHash) {
    throw new Error(`Desktop textbook executable hash mismatch: ${destination}`)
  }
}

async function collectDesktopAudit({
  releaseVersion,
  textbookDesktopExe,
  shortcutItems,
  expectedShortcutLinks,
  runtimeCacheRoots,
  clearCacheRequested,
}) {
  return {
    generatedAt: new Date().toISOString(),
    releaseVersion,
    policy: {
      desktopExecutables: 'quarantine old managed desktop executables instead of deleting them',
      shortcuts: 'backup existing managed shortcuts and quarantine duplicate managed shortcuts',
      runtimeCaches: clearCacheRequested ? 'quarantine app-cache and WebView2 directories because --clear-cache was provided' : 'report cache directories only',
    },
    textbookDesktopExe,
    shortcutUpdates: shortcutItems.map((item) => ({
      link: item.link,
      target: item.target,
      workingDirectory: item.workingDirectory,
      arguments: item.arguments,
      icon: item.icon,
      existsBeforeDeploy: existsSync(item.link),
    })),
    oldDesktopExecutables: await listOldDesktopTextbookExecutables(textbookDesktopExe),
    duplicateShortcuts: await listDuplicateClassroomShortcuts(expectedShortcutLinks),
    runtimeCaches: listRuntimeCacheTargets(runtimeCacheRoots).map((item) => ({
      ...item,
      plannedAction: clearCacheRequested ? 'quarantine' : 'report-only',
    })),
  }
}

async function listOldDesktopTextbookExecutables(currentExecutable) {
  const candidates = []
  const currentPath = path.resolve(currentExecutable).toLowerCase()
  for (const desktop of [administratorDesktop, publicDesktop]) {
    if (!existsSync(desktop)) continue
    const entries = await fs.readdir(desktop, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isFile() || !isManagedLegacyDesktopExecutableName(entry.name)) continue
      const fullPath = path.join(desktop, entry.name)
      if (path.resolve(fullPath).toLowerCase() === currentPath) continue
      candidates.push(fullPath)
    }
  }

  return candidates
}

async function quarantineOldDesktopTextbookExecutables(currentExecutable, quarantineDirectory, restoreActions) {
  const quarantined = []
  for (const fullPath of await listOldDesktopTextbookExecutables(currentExecutable)) {
    const action = await safeRemoveOrQuarantine(fullPath, quarantineDirectory, restoreActions, 'old managed desktop executable')
    if (action) quarantined.push(action)
  }
  return quarantined
}

function isTextbookDesktopExecutableName(fileName) {
  return fileName.toLowerCase().startsWith(textbookDesktopPrefix.toLowerCase()) && fileName.toLowerCase().endsWith('.exe')
}

function isManagedLegacyDesktopExecutableName(fileName) {
  const lowerName = fileName.toLowerCase()
  return isTextbookDesktopExecutableName(fileName) || (lowerName.startsWith('openwhiteboard') && lowerName.endsWith('.exe'))
}

async function listDuplicateClassroomShortcuts(expectedLinks) {
  const duplicates = []
  const expected = new Set(expectedLinks.map((item) => path.resolve(item).toLowerCase()))
  for (const directory of managedClassroomShortcutSearchDirectories()) {
    if (!existsSync(directory)) continue
    const entries = await fs.readdir(directory, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isFile() || !isClassroomShortcutName(entry.name)) continue
      const fullPath = path.join(directory, entry.name)
      if (expected.has(path.resolve(fullPath).toLowerCase())) continue
      duplicates.push(fullPath)
    }
  }

  return duplicates
}

async function quarantineDuplicateClassroomShortcuts(expectedLinks, quarantineDirectory, restoreActions) {
  const quarantined = []
  for (const fullPath of await listDuplicateClassroomShortcuts(expectedLinks)) {
    const action = await safeRemoveOrQuarantine(fullPath, quarantineDirectory, restoreActions, 'duplicate managed classroom shortcut')
    if (action) quarantined.push(action)
  }
  return quarantined
}

function managedClassroomShortcutSearchDirectories() {
  return [
    administratorDesktop,
    publicDesktop,
    path.join(hiClassStartMenu, '\u9e3f\u5408\u767d\u677f\u8f6f\u4ef6'),
    path.join(hiClassStartMenu, '\u9e3f\u5408\u89c6\u9891\u5c55\u53f0'),
  ]
}

function isClassroomShortcutName(fileName) {
  const lowerName = fileName.toLowerCase()
  const whiteboardStem = whiteboardShortcutName.slice(0, -'.lnk'.length).toLowerCase()
  const visualizerStem = visualizerShortcutName.slice(0, -'.lnk'.length).toLowerCase()
  return lowerName.endsWith('.lnk') && (lowerName.startsWith(whiteboardStem) || lowerName.startsWith(visualizerStem))
}

async function stopManagedDesktopProcesses() {
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = ${JSON.stringify(root)}
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
    $commandLine.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
    [bool]($managedDataMarkers | Where-Object { $commandLine.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1)
  ))
}
foreach ($process in $processes) {
  $rows += [pscustomobject]@{
    processId = $process.ProcessId
    name = $process.Name
    executablePath = $process.ExecutablePath
  }
  try {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  } catch {}
}
$rows | ConvertTo-Json -Depth 3
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

function pathEquals(left, right) {
  return path.resolve(left || '').toLowerCase() === path.resolve(right || '').toLowerCase()
}

function iconEquals(actual, expected) {
  const iconPath = String(actual || '').replace(/,\d+$/, '')
  return pathEquals(iconPath, expected)
}

function shortcutItem(link, artifact) {
  const app = apps[artifact.app]
  if (!app) throw new Error(`Unknown artifact app: ${artifact.app}`)
  if (!shortcutAppModes.has(app.mode)) throw new Error(`Unsupported shortcut app mode: ${app.mode}`)
  return {
    link,
    target: artifact.executablePath,
    workingDirectory: artifact.directoryPath,
    arguments: `--app=${app.mode}`,
    icon: path.join(artifact.directoryPath, app.appIconName),
  }
}

function runtimeDataDirectoryForArtifact(artifact) {
  const app = apps[artifact.app]
  if (!app) throw new Error(`Unknown artifact app: ${artifact.app}`)
  return path.join(artifact.directoryPath, `${app.assemblyName}_Data`)
}

function desktopRuntimeDataDirectories() {
  return [administratorDesktop, publicDesktop].flatMap((desktop) =>
    Object.values(apps).map((app) => path.join(desktop, `${app.assemblyName}_Data`)),
  )
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

function listRuntimeCacheTargets(dataDirectories) {
  const targets = []
  const seen = new Set()
  for (const dataDirectory of dataDirectories) {
    const normalized = path.resolve(dataDirectory).toLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)

    for (const childName of ['app-cache', 'WebView2']) {
      const target = path.join(dataDirectory, childName)
      if (!existsSync(target)) continue
      targets.push({ dataDirectory, cacheDirectory: target, childName, exists: true })
    }
  }
  return targets
}

async function handleRuntimeCaches(dataDirectories, { clearCache, quarantineDirectory, restoreActions }) {
  const targets = listRuntimeCacheTargets(dataDirectories)
  if (!clearCache) {
    return targets.map((target) => ({ ...target, action: 'reported' }))
  }

  const quarantined = []
  for (const target of targets) {
    const action = await safeRemoveOrQuarantine(target.cacheDirectory, quarantineDirectory, restoreActions, 'runtime cache requested with --clear-cache')
    quarantined.push({ ...target, action: 'quarantined', quarantinePath: action?.quarantinePath })
  }
  return quarantined
}

async function backupExistingShortcuts(items, quarantineDirectory, restoreActions) {
  const backups = []
  for (const item of items) {
    const backup = await backupExistingFile(item.link, quarantineDirectory, restoreActions, 'managed shortcut before deployment update')
    if (backup) backups.push(backup)
  }
  return backups
}

async function backupExistingFile(source, quarantineDirectory, restoreActions, reason) {
  if (!existsSync(source)) return null
  const stat = await fs.stat(source)
  if (!stat.isFile()) return null
  await fs.mkdir(quarantineDirectory, { recursive: true })
  const quarantinePath = await uniqueQuarantinePath(source, quarantineDirectory, 'backup')
  assertInside(quarantinePath, quarantineDirectory)
  await fs.copyFile(source, quarantinePath)
  const action = {
    type: 'backup-copy',
    source,
    quarantinePath,
    reason,
  }
  restoreActions.push(action)
  return action
}

async function safeRemoveOrQuarantine(source, quarantineDirectory, restoreActions, reason) {
  if (!existsSync(source)) return null
  await fs.mkdir(quarantineDirectory, { recursive: true })
  const quarantinePath = await uniqueQuarantinePath(source, quarantineDirectory, 'quarantine')
  assertInside(quarantinePath, quarantineDirectory)
  await fs.rename(source, quarantinePath)
  const action = {
    type: 'move-to-quarantine',
    source,
    quarantinePath,
    reason,
  }
  restoreActions.push(action)
  return action
}

async function uniqueQuarantinePath(source, quarantineDirectory, action) {
  const hash = createHash('sha256').update(path.resolve(source).toLowerCase()).digest('hex').slice(0, 10)
  const parsed = path.parse(source)
  const baseName = parsed.ext ? `${parsed.name}.${action}.${hash}${parsed.ext}` : `${parsed.base}.${action}.${hash}`
  let candidate = path.join(quarantineDirectory, baseName)
  let suffix = 1
  while (existsSync(candidate)) {
    const retryName = parsed.ext ? `${parsed.name}.${action}.${hash}.${suffix}${parsed.ext}` : `${parsed.base}.${action}.${hash}.${suffix}`
    candidate = path.join(quarantineDirectory, retryName)
    suffix += 1
  }
  return candidate
}

function assertInside(target, directory) {
  const relative = path.relative(path.resolve(directory), path.resolve(target))
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe quarantine path: ${target}`)
  }
}

async function writeDesktopAuditAndRestore({ audit, auditPath, restoreScriptPath }) {
  await fs.mkdir(path.dirname(auditPath), { recursive: true })
  await fs.writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  await fs.writeFile(restoreScriptPath, restoreScriptSource(), 'utf8')
}

function restoreScriptSource() {
  return `import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const auditPath = path.join(here, 'desktop-audit.json')
const audit = JSON.parse(await fs.readFile(auditPath, 'utf8'))
const results = []

for (const action of audit.restoreActions || []) {
  if (!action.source || !action.quarantinePath) continue
  if (!existsSync(action.quarantinePath)) {
    results.push({ ...action, restored: false, reason: 'backup missing' })
    continue
  }
  await fs.mkdir(path.dirname(action.source), { recursive: true })
  if (action.type === 'move-to-quarantine') {
    if (existsSync(action.source)) {
      results.push({ ...action, restored: false, reason: 'target already exists' })
      continue
    }
    await fs.rename(action.quarantinePath, action.source)
    results.push({ ...action, restored: true })
    continue
  }
  if (action.type === 'backup-copy') {
    await fs.copyFile(action.quarantinePath, action.source)
    results.push({ ...action, restored: true })
  }
}

console.log(JSON.stringify({ ok: true, auditPath, results }, null, 2))
`
}

async function updateShortcuts(items) {
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$items = ConvertFrom-Json @'
${JSON.stringify(items, null, 2)}
'@
function Test-ExistingLiteralPath($path) {
  if ([string]::IsNullOrWhiteSpace($path)) { return $false }
  return Test-Path -LiteralPath $path
}
$shell = New-Object -ComObject WScript.Shell
$rows = @()
foreach ($item in $items) {
  if (!(Test-Path -LiteralPath $item.target)) { throw "Missing target: $($item.target)" }
  if (!(Test-Path -LiteralPath $item.workingDirectory)) { throw "Missing working directory: $($item.workingDirectory)" }
  if (!(Test-Path -LiteralPath $item.icon)) { throw "Missing icon: $($item.icon)" }
}
foreach ($item in $items) {
  $shortcut = $shell.CreateShortcut($item.link)
  $shortcut.TargetPath = $item.target
  $shortcut.WorkingDirectory = $item.workingDirectory
  $shortcut.Arguments = $item.arguments
  if (Test-Path -LiteralPath $item.icon) { $shortcut.IconLocation = $item.icon }
  $shortcut.Save()
  $saved = $shell.CreateShortcut($item.link)
  $rows += [pscustomobject]@{
    link = $item.link
    expectedTarget = $item.target
    actualTarget = $saved.TargetPath
    expectedWorkingDirectory = $item.workingDirectory
    actualWorkingDirectory = $saved.WorkingDirectory
    expectedArguments = $item.arguments
    actualArguments = $saved.Arguments
    expectedIcon = $item.icon
    actualIcon = $saved.IconLocation
    targetExists = Test-ExistingLiteralPath $saved.TargetPath
    workingDirectoryExists = Test-ExistingLiteralPath $saved.WorkingDirectory
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
  const rows = JSON.parse(output)
  const shortcuts = Array.isArray(rows) ? rows : [rows]
  const failed = shortcuts.filter(
    (shortcut) =>
      !shortcut.targetExists ||
      !shortcut.workingDirectoryExists ||
      !pathEquals(shortcut.actualTarget, shortcut.expectedTarget) ||
      !pathEquals(shortcut.actualWorkingDirectory, shortcut.expectedWorkingDirectory) ||
      String(shortcut.actualArguments || '') !== String(shortcut.expectedArguments || '') ||
      !iconEquals(shortcut.actualIcon, shortcut.expectedIcon),
  )
  if (failed.length) {
    throw new Error(`Shortcut verification failed: ${failed.map((shortcut) => shortcut.link).join(', ')}`)
  }
}

async function verifyDesktopDeployment({
  textbookDesktopExe,
  whiteboardMultifile,
  textbookMultifile,
  textbookSinglefile,
  visualizerMultifile,
  shortcutItems,
}) {
  const checks = [
    ['desktop textbook singlefile', textbookDesktopExe],
    ['whiteboard multifile exe', whiteboardMultifile.executablePath],
    ['textbook multifile exe', textbookMultifile.executablePath],
    ['visualizer multifile exe', visualizerMultifile.executablePath],
    ['whiteboard icon', path.join(whiteboardMultifile.directoryPath, apps.chalkline.appIconName)],
    ['whiteboard variant marker', path.join(whiteboardMultifile.directoryPath, 'app', 'variant.json')],
    ['textbook main resource', path.join(textbookMultifile.directoryPath, 'app', 'book', '260.jpg')],
    ['textbook 110 resource', path.join(textbookMultifile.directoryPath, 'app', 'book-110', '212.jpg')],
    ['textbook variant marker', path.join(textbookMultifile.directoryPath, 'app', 'variant.json')],
    ['textbook singlefile variant marker', path.join(textbookSinglefile.directoryPath, 'variant.json')],
    ['visualizer icon', path.join(visualizerMultifile.directoryPath, apps.visualizer.appIconName)],
    ['visualizer variant marker', path.join(visualizerMultifile.directoryPath, 'app', 'variant.json')],
  ]

  for (const item of shortcutItems) {
    checks.push([`shortcut ${path.basename(item.link)}`, item.link])
  }

  const result = []
  for (const [name, target] of checks) {
    result.push({ name, target, exists: existsSync(target) })
  }

  const failed = result.filter((item) => !item.exists)
  if (failed.length) {
    throw new Error(`Desktop deployment verification failed: ${failed.map((item) => item.name).join(', ')}`)
  }
  return result
}

function verifyReleaseArtifacts({
  whiteboardMultifile,
  textbookMultifile,
  textbookSinglefile,
  visualizerMultifile,
}) {
  const checks = [
    fileCheck('whiteboard multifile exe', whiteboardMultifile.executablePath),
    fileCheck('whiteboard icon', path.join(whiteboardMultifile.directoryPath, apps.chalkline.appIconName)),
    markerCheck('whiteboard variant marker matches', path.join(whiteboardMultifile.directoryPath, 'app'), apps.chalkline),
    bundleCheck('whiteboard bundle excludes textbook and visualizer markers', path.join(whiteboardMultifile.directoryPath, 'app'), apps.chalkline),
    fileCheck('textbook multifile exe', textbookMultifile.executablePath),
    fileCheck('textbook main resource', path.join(textbookMultifile.directoryPath, 'app', 'book', '260.jpg')),
    fileCheck('textbook 110 resource', path.join(textbookMultifile.directoryPath, 'app', 'book-110', '212.jpg')),
    markerCheck('textbook variant marker matches', path.join(textbookMultifile.directoryPath, 'app'), apps.textbook),
    bundleCheck('textbook bundle contains textbook marker', path.join(textbookMultifile.directoryPath, 'app'), apps.textbook),
    fileCheck('textbook singlefile exe', textbookSinglefile.executablePath),
    markerCheck('textbook singlefile variant marker matches', textbookSinglefile.directoryPath, apps.textbook),
    fileCheck('textbook singlefile main resource', path.join(textbookSinglefile.directoryPath, 'book', '260.jpg')),
    fileCheck('textbook singlefile 110 resource', path.join(textbookSinglefile.directoryPath, 'book-110', '212.jpg')),
    fileCheck('visualizer multifile exe', visualizerMultifile.executablePath),
    fileCheck('visualizer icon', path.join(visualizerMultifile.directoryPath, apps.visualizer.appIconName)),
    markerCheck('visualizer variant marker matches', path.join(visualizerMultifile.directoryPath, 'app'), apps.visualizer),
    bundleCheck('visualizer bundle contains only projection markers', path.join(visualizerMultifile.directoryPath, 'app'), apps.visualizer),
  ]

  const result = checks.map((check) => ({ name: check.name, target: check.target, exists: check.pass }))
  const failed = result.filter((item) => !item.exists)
  if (failed.length) {
    throw new Error(`Release artifact verification failed before desktop changes: ${failed.map((item) => item.name).join(', ')}`)
  }
  return result
}

function fileCheck(name, target) {
  return { name, target, pass: existsSync(target) }
}

function markerCheck(name, appDir, app) {
  return { name, target: path.join(appDir, 'variant.json'), pass: variantMarkerMatches(appDir, app) }
}

function bundleCheck(name, appDir, app) {
  return { name, target: path.join(appDir, 'assets'), pass: bundlePolicyMatches(appDir, app) }
}

function variantMarkerMatches(appDir, app) {
  const markerPath = path.join(appDir, 'variant.json')
  if (!existsSync(markerPath)) return false
  try {
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
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

function bundlePolicyMatches(appDir, app) {
  const bundleText = readBundleText(appDir)
  if (app.id === apps.textbook.id) {
    return bundleText.includes('textbook-main') && !bundleText.includes('visualizer-shell')
  }
  if (app.id === apps.visualizer.id) {
    return bundleText.includes('visualizer-shell') && visualizerForbiddenMarkers(bundleText).length === 0
  }
  return bundleText.includes('whiteboard-app') && !bundleText.includes('textbook-main') && !bundleText.includes('visualizer-shell')
}

function readBundleText(appDir) {
  const assetDir = path.join(appDir, 'assets')
  if (!existsSync(assetDir)) return ''
  return readdirSync(assetDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => {
      try {
        return readFileSync(path.join(assetDir, name), 'utf8')
      } catch {
        return ''
      }
    })
    .join('\n')
}

function visualizerForbiddenMarkers(bundleText) {
  return ['whiteboard-app', 'book-picker', 'open-whiteboard-selected-book', 'presentationRuntimeRef', 'textbook-main'].filter((marker) =>
    bundleText.includes(marker),
  )
}

async function runStrictDesktopVerification(releaseVersion) {
  const output = await capture(process.execPath, [path.join(root, 'scripts', 'verify-desktop-deployment.mjs'), '--version', releaseVersion])
  const parsed = JSON.parse(output)
  if (!parsed.ok) {
    throw new Error('Strict desktop verification failed after deployment.')
  }

  return {
    ok: parsed.ok,
    latestAll: parsed.latestAll?.name,
    latestTextbook: parsed.latestTextbook?.name,
    desktopExe: parsed.desktopExe?.name,
    shortcutCount: Array.isArray(parsed.shortcuts) ? parsed.shortcuts.length : 0,
    classroomShortcutCount: Array.isArray(parsed.allClassroomShortcuts) ? parsed.allClassroomShortcuts.length : 0,
    shortcutTargets: Array.isArray(parsed.shortcuts)
      ? parsed.shortcuts.map((shortcut) => ({
          link: shortcut.link,
          target: shortcut.target,
        }))
      : [],
    checkCount: Array.isArray(parsed.checks) ? parsed.checks.length : 0,
  }
}

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...extraEnv } })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code}`))
    })
  })
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
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
      else {
        const detail = error.trim() || output.trim()
        reject(new Error(`${command} exited with ${code}: ${detail}`))
      }
    })
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
