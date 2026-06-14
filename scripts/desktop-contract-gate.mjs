import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apps, profiles } from './release.config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requiredDesktopScripts = {
  'desktop:contract': 'node scripts/desktop-contract-gate.mjs',
  'deploy:classroom': 'node scripts/deploy-desktop.mjs',
  'deploy:desktop': 'node scripts/deploy-desktop.mjs',
  'desktop:deploy': 'node scripts/deploy-desktop.mjs',
  'release:logic': 'node scripts/release-logic-gate.mjs',
  'verify:desktop': 'node scripts/verify-desktop-deployment.mjs',
}

const checks = []

check('all profile publishes blank, textbook, and visualizer', sameArray(profiles.all, ['chalkline', 'textbook', 'visualizer']))
check('blank app is a non-textbook package', apps.chalkline.packageDir === 'chalkline-board' && apps.chalkline.includesTextbookResources === false)
check('textbook app is configured as textbook single-source app', apps.textbook.packageDir === 'chalkline-textbook' && apps.textbook.includesTextbookResources === true)
check('visualizer app is a non-textbook package', apps.visualizer.packageDir === 'chalkline-visualizer' && apps.visualizer.includesTextbookResources === false)
check('blank app has whiteboard executable', apps.chalkline.exeName === 'ChalklineBoard.exe')
check('textbook app has textbook executable', apps.textbook.exeName === 'ChalklineTextbook.exe')
check('visualizer app has visualizer executable', apps.visualizer.exeName === 'ChalklineVisualizer.exe')

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
for (const [name, command] of Object.entries(requiredDesktopScripts)) {
  check(`package script ${name} exists`, packageJson.scripts?.[name] === command)
}
check(
  'classroom deployment aliases all use the guarded desktop deployer',
  packageJson.scripts?.['deploy:classroom'] === packageJson.scripts?.['deploy:desktop'] &&
    packageJson.scripts?.['desktop:deploy'] === packageJson.scripts?.['deploy:desktop'] &&
    packageJson.scripts?.['deploy:desktop'] === 'node scripts/deploy-desktop.mjs',
)
check('singlefile helper script uses explicit positional variant', packageJson.scripts?.['desktop:publish:singlefile'] === 'node scripts/whiteboard.mjs publish-singlefile chalkline')

const deploySource = readSource('scripts/deploy-desktop.mjs')
const preflightSource = readSource('scripts/preflight.mjs')
const perfGateSource = readSource('scripts/perf-gate.mjs')
const visualizerGateSource = readSource('scripts/visualizer-gate.mjs')
const stressGateSource = readSource('scripts/stress-gate.mjs')
const presentationGateSource = readSource('scripts/presentation-gate.mjs')
const navigationGateSource = readSource('scripts/navigation-gate.mjs')
const navigationProbeSource = readSource('scripts/navigation-probe.mjs')
const importSmokeSource = readSource('scripts/import-smoke.mjs')
const releaseSource = readSource('scripts/release.mjs')
const verifySource = readSource('scripts/verify-desktop-deployment.mjs')
const whiteboardSource = readSource('scripts/whiteboard.mjs')
const mainSource = readSource('src/main.tsx')
const whiteboardCoreSource = readSource('src/whiteboard/core.tsx')
const textbookBooksSource = readSource('src/books.textbook.ts')
const desktopAppSource = readSource('desktop-shell/App.xaml.cs')
const desktopWindowSource = readSource('desktop-shell/MainWindow.xaml.cs')

check('preflight runs desktop contract gate', preflightSource.includes("['desktop-contract', ['run', 'desktop:contract']]"))
check('preflight runs release logic gate', preflightSource.includes("['release-logic', ['run', 'release:logic']]"))
check('preflight runs navigation gate', preflightSource.includes("['page-navigation', ['run', 'navigation:gate']]"))
check(
  'preflight default covers import, presentation, performance, navigation, visualizer, and desktop builds',
  preflightSource.includes("['import-ppt-playback', ['run', 'test:import']]") &&
    preflightSource.includes("['presentation-playback-gate', ['run', 'presentation:gate']]") &&
    preflightSource.includes("['pen-performance', ['run', 'perf:gate']]") &&
    preflightSource.includes("['page-navigation', ['run', 'navigation:gate']]") &&
    preflightSource.includes("['visualizer-runtime-gate', ['run', 'visualizer:gate']]") &&
    preflightSource.includes("['build-textbook', ['run', 'build:textbook']]") &&
    preflightSource.includes("['build-visualizer', ['run', 'build:visualizer']]") &&
    preflightSource.includes("['desktop-build', ['run', 'build:desktop']]") &&
    preflightSource.includes("['desktop-build-textbook', ['run', 'build:desktop:textbook']]") &&
    preflightSource.includes("['desktop-build-visualizer', ['run', 'build:desktop:visualizer']]"),
)
check(
  'preflight stress mode covers full stroke pressure scenarios',
  preflightSource.includes("['full-stress', ['run', 'stress:gate', '--', 'all']]"),
)
check(
  'runtime gates refuse occupied ports before starting servers',
  [
    perfGateSource,
    visualizerGateSource,
    stressGateSource,
    presentationGateSource,
    navigationGateSource,
    importSmokeSource,
  ].every((source) => source.includes('assertPortIsFree') && source.includes('already serving before')),
)
check(
  'perf gate verifies interrupted tool switch commits active ink',
  readSource('scripts/perf-probe.mjs').includes('verifyToolSwitchCommitsActiveStroke') &&
    readSource('scripts/perf-probe.mjs').includes('stats.committedRenders > 0') &&
    readSource('scripts/perf-probe.mjs').includes('eraserActive'),
)
check(
  'navigation gate verifies textbook book switching',
  navigationGateSource.includes("mode: 'textbook'") &&
    navigationGateSource.includes("WHITEBOARD_NAV_INSTALL_PROJECT: '0'") &&
    navigationGateSource.includes("WHITEBOARD_NAV_TEXTBOOK_SWITCH: '1'") &&
    navigationProbeSource.includes('verifyTextbookBookSwitch') &&
    navigationProbeSource.includes("selectedBookId === 'textbook-110'") &&
    navigationProbeSource.includes("pageCountText.includes('/212')"),
)
check(
  'deploy always runs preflight before publishing',
  deploySource.includes("scripts', 'preflight.mjs") &&
    deploySource.includes("WHITEBOARD_PREFLIGHT_DESKTOP: '1'") &&
    deploySource.includes("WHITEBOARD_PREFLIGHT_VARIANTS: '1'") &&
    deploySource.includes("preflight: 'passed'") &&
    !deploySource.includes('WHITEBOARD_DEPLOY_SKIP_PREFLIGHT') &&
    !deploySource.includes("preflight: 'skipped'"),
)
check('deploy publishes all apps as multifile', deploySource.includes("'--profile', 'all', '--format', 'multifile'"))
check('deploy publishes textbook as singlefile', deploySource.includes("'--profile', 'textbook', '--format', 'singlefile'"))
check('deploy copies textbook singlefile to desktop with versioned prefix', deploySource.includes('textbookDesktopPrefix') && deploySource.includes('releaseVersion'))
check(
  'deploy verifies release artifacts before touching desktop',
  deploySource.includes('verifyReleaseArtifacts({') &&
    deploySource.indexOf('verifyReleaseArtifacts({') < deploySource.indexOf('await ensureDesktopDirectories()') &&
    deploySource.indexOf('verifyReleaseArtifacts({') < deploySource.indexOf('await copyExecutable(') &&
    deploySource.includes('Release artifact verification failed before desktop changes') &&
    deploySource.includes('variantMarkerMatches(appDir, app)') &&
    deploySource.includes('bundlePolicyMatches(appDir, app)') &&
    deploySource.includes('visualizerForbiddenMarkers(bundleText)') &&
    deploySource.includes('textbook singlefile main resource') &&
    deploySource.includes('visualizer variant marker'),
)
check(
  'deploy updates desktop and start-menu classroom shortcuts',
  deploySource.includes('managedWhiteboardShortcutLinks().map((link) => shortcutItem(link, whiteboardMultifile))') &&
    deploySource.includes('managedVisualizerShortcutLinks().map((link) => shortcutItem(link, visualizerMultifile))') &&
    deploySource.includes('hiClassStartMenu') &&
    deploySource.includes('ensureShortcutDirectories(shortcutItems)'),
)
check('deploy points whiteboard shortcuts to blank artifact', deploySource.includes('whiteboardMultifile') && !deploySource.includes('whiteboardShortcutName), textbookMultifile'))
check('deploy points visualizer shortcuts to visualizer artifact', deploySource.includes('managedVisualizerShortcutLinks().map((link) => shortcutItem(link, visualizerMultifile))'))
check('deploy shortcut forces app variant arguments', deploySource.includes('arguments: `--app=${app.mode}`') && deploySource.includes('$shortcut.Arguments = $item.arguments'))
check('deploy rejects unsupported shortcut app modes', deploySource.includes("const shortcutAppModes = new Set(['blank', 'textbook', 'visualizer'])") && deploySource.includes('Unsupported shortcut app mode'))
check(
  'deploy quarantines stale textbook and legacy desktop executables',
  deploySource.includes('quarantineOldDesktopTextbookExecutables') &&
    deploySource.includes('safeRemoveOrQuarantine') &&
    deploySource.includes('isManagedLegacyDesktopExecutableName') &&
    deploySource.includes("lowerName.startsWith('openwhiteboard')") &&
    !deploySource.includes('await fs.rm(fullPath'),
)
check(
  'deploy stops running desktop apps before replacing release artifacts',
  deploySource.includes('stopManagedDesktopProcesses') &&
    deploySource.includes('stoppedDesktopProcesses') &&
    deploySource.includes('$textbookDesktopPrefix') &&
    deploySource.includes("StartsWith('OpenWhiteboard'") &&
    deploySource.includes(".Name.StartsWith($textbookDesktopPrefix") &&
    deploySource.includes('$managedDataMarkers') &&
    deploySource.indexOf('const stoppedDesktopProcesses = await stopManagedDesktopProcesses()') >
      deploySource.indexOf('const releaseArtifactVerification = verifyReleaseArtifacts'),
)
check(
  'deploy quarantines duplicate classroom shortcuts',
  deploySource.includes('quarantineDuplicateClassroomShortcuts') &&
    deploySource.includes('safeRemoveOrQuarantine') &&
    deploySource.includes('managedClassroomShortcutSearchDirectories') &&
    deploySource.includes('for (const directory of managedClassroomShortcutSearchDirectories())') &&
    !deploySource.includes('removedDuplicateShortcuts'),
)
check(
  'deploy reports runtime caches by default and quarantines only with explicit clear-cache',
  deploySource.includes('handleRuntimeCaches') &&
    deploySource.includes('clearCache: args.includes') &&
    deploySource.includes("action: 'reported'") &&
    deploySource.includes("'app-cache'") &&
    deploySource.includes("'WebView2'") &&
    !deploySource.includes('clearRuntimeCaches') &&
    !deploySource.includes('await fs.rm(target'),
)
check(
  'deploy writes desktop audit and restore script',
  deploySource.includes('desktop-audit.json') &&
    deploySource.includes('restore-desktop-state.mjs') &&
    deploySource.includes('writeDesktopAuditAndRestore') &&
    deploySource.includes('restoreScriptSource') &&
    deploySource.includes('restoreActions') &&
    deploySource.includes('quarantineDirectory'),
)
check(
  'deploy backs up managed shortcuts before overwrite',
  deploySource.includes('backupExistingShortcuts') &&
    deploySource.includes('managed shortcut before deployment update') &&
    deploySource.includes("type: 'backup-copy'"),
)
check(
  'deploy never directly removes desktop exe shortcut or cache paths',
  !deploySource.includes('await fs.rm(fullPath') &&
    !deploySource.includes('await fs.rm(target') &&
    !deploySource.includes('Remove-Item') &&
    !deploySource.includes('Directory.Delete'),
)
check(
  'deploy still recognizes runtime cache directories',
  deploySource.includes('listRuntimeCacheTargets') &&
    deploySource.includes("'app-cache'") &&
    deploySource.includes("'WebView2'"),
)
check(
  'deploy clears legacy OpenWhiteboard runtime caches',
  deploySource.includes('legacyRuntimeDataDirectories') &&
    deploySource.includes('OpenWhiteboardBlankDesktop') &&
    deploySource.includes('OpenWhiteboardTextbook') &&
    deploySource.includes('OpenWhiteboardVisualizerDesktop') &&
    deploySource.includes('...legacyRuntimeDataDirectories()'),
)
check('deploy uses configured app icons', deploySource.includes("import { apps } from './release.config.mjs'") && deploySource.includes('app.appIconName'))
check('deploy checks variant markers before desktop copy completes', deploySource.includes('whiteboard variant marker') && deploySource.includes('textbook variant marker') && deploySource.includes('visualizer variant marker'))
check('deploy runs strict desktop verification', deploySource.includes('runStrictDesktopVerification(releaseVersion)'))
check('deploy summarizes strict shortcut targets', deploySource.includes('shortcutTargets') && deploySource.includes('classroomShortcutCount'))

check('verify imports release config', verifySource.includes("import { apps } from './release.config.mjs'"))
check(
  'verify checks release manifest artifact sha256 values',
  verifySource.includes('artifactShaChecks(latestAllManifest)') &&
    verifySource.includes('latest all release artifact sha256 values match files') &&
    verifySource.includes('latest textbook release artifact sha256 values match files') &&
    verifySource.includes('actualSha === expectedSha'),
)
check('verify checks desktop textbook sha256', verifySource.includes('sha256File(desktopExe.path) === sha256File(textbookSinglefileExe)'))
check(
  'verify checks desktop textbook singlefile embedded resource markers',
  verifySource.includes('readDesktopSinglefileMarkers') &&
    verifySource.includes('desktopSinglefileMarkers.exists') &&
    verifySource.includes('desktop textbook singlefile embeds textbook app resources') &&
    verifySource.includes('desktop textbook singlefile embeds textbook variant marker content') &&
    verifySource.includes('desktop textbook singlefile does not embed other app assemblies') &&
    verifySource.includes('"appId": "textbook"') &&
    verifySource.includes('"packageDir": "chalkline-textbook"') &&
    verifySource.includes('"includesTextbookResources": true') &&
    verifySource.includes('app/book-110\\\\001.jpg'),
)
check('verify checks no stale textbook desktop executables', verifySource.includes('desktop has no stale textbook executables'))
check(
  'verify checks running desktop processes are not stale releases',
  verifySource.includes('findRunningDesktopProcessChecks') &&
    verifySource.includes('running desktop app processes are current release only') &&
    verifySource.includes('desktopExe.path') &&
    verifySource.includes('$textbookDesktopPrefix') &&
    verifySource.includes("StartsWith('OpenWhiteboard'") &&
    verifySource.includes(".Name.StartsWith($textbookDesktopPrefix") &&
    verifySource.includes('$managedDataMarkers') &&
    verifySource.includes('`${apps.textbook.assemblyName}_Data`'),
)
check(
  'verify checks exact textbook desktop exe name and all textbook-prefixed executables',
  verifySource.includes('desktop textbook exe name is exact versioned name') &&
    verifySource.includes('findAllTextbookExecutableFilesOnManagedDesktops') &&
    verifySource.includes('desktopExe.name === `${textbookDesktopPrefix}${latestAll.version}.exe`'),
)
check(
  'verify checks no stale OpenWhiteboard desktop executables',
  verifySource.includes('desktop has no stale OpenWhiteboard executables') &&
    verifySource.includes('findAllLegacyExecutableFilesOnManagedDesktops') &&
    verifySource.includes("entry.name.toLowerCase().startsWith('openwhiteboard')"),
)
check('verify checks no duplicate classroom shortcuts', verifySource.includes('desktop has no duplicate classroom shortcuts'))
check(
  'verify checks desktop runtime app caches match variants',
  verifySource.includes('desktop runtime app caches match their app variants') &&
    verifySource.includes('findDesktopRuntimeCacheChecks') &&
    verifySource.includes('runtimeCacheResourcePolicyMatches') &&
    verifySource.includes('runtimeCacheBundlePolicyMatches'),
)
check(
  'verify reports legacy OpenWhiteboard runtime caches without requiring deletion',
  verifySource.includes('legacy runtime app caches are reported without destructive cleanup') &&
    verifySource.includes('findLegacyRuntimeCacheChecks') &&
    verifySource.includes('OpenWhiteboardBlankDesktop') &&
    verifySource.includes('OpenWhiteboardTextbook') &&
    verifySource.includes('OpenWhiteboardVisualizerDesktop'),
)
check(
  'verify checks desktop audit and restore artifacts',
  verifySource.includes('readDesktopAudit') &&
    verifySource.includes('desktop audit report exists') &&
    verifySource.includes('desktop restore script exists') &&
    verifySource.includes('desktop audit records quarantine and restore policy'),
)
check(
  'verify checks configured release manifests with normalized exact artifact paths',
  verifySource.includes('manifestContainsArtifacts') &&
    verifySource.includes('latest all release manifest contains configured multifile artifacts') &&
    verifySource.includes('normalizeManifestPath') &&
    verifySource.includes('directory.endsWith(`/${packageDir}`)') &&
    verifySource.includes('executable.endsWith(`/${packageDir}/${exeName}`)') &&
    !verifySource.includes("String(artifact.directory || '').includes"),
)
check('verify checks app variant markers', verifySource.includes('variantMarkerMatches') && verifySource.includes('visualizer variant marker matches'))
check('verify checks shortcut app variant arguments', verifySource.includes('shortcut forces exact app variant') && verifySource.includes('const expectedArguments = `--app=${expectedApp.mode}`'))
check(
  'verify checks desktop shell full variant guard',
  verifySource.includes('ExpectedAppId') &&
    verifySource.includes('ExpectedPackageDir') &&
    verifySource.includes('ExpectedTextbookResources') &&
    verifySource.includes('FolderResourcePolicyMatches') &&
    verifySource.includes('FolderBundlePolicyMatches'),
)
check(
  'verify checks desktop shell dynamic startup title',
  verifySource.includes('desktop shell startup title follows app variant') &&
    verifySource.includes('windowUsesVariantStartupTitle') &&
    verifySource.includes('x:Name="StartupTitle"'),
)
check(
  'desktop shell refuses cross-loaded textbook and visualizer bundles',
  desktopWindowSource.includes('FolderResourcePolicyMatches(folder)') &&
    desktopWindowSource.includes('FolderBundlePolicyMatches(folder)') &&
    desktopWindowSource.includes('hasWhiteboardMarker && !hasTextbookMarker && !hasVisualizerMarker') &&
    desktopWindowSource.includes('BundleContains(folder, "textbook-main")') &&
    desktopWindowSource.includes('BundleContains(folder, "visualizer-shell")') &&
    desktopWindowSource.includes('BundleContains(folder, "open-whiteboard-selected-book")'),
)
check(
  'desktop shell supports explicit shortcut app kind',
  desktopWindowSource.includes('ReadRequestedAppKind(Environment.GetCommandLineArgs())') &&
    desktopWindowSource.includes('return IdentityFromKind(RequestedAppKind)') &&
    desktopWindowSource.includes('arg.StartsWith("--app="') &&
    desktopWindowSource.includes('IsAppKindOption(arg)') &&
    desktopWindowSource.includes('value = args[++index];') &&
    desktopWindowSource.includes('string.Equals(arg, "--app", StringComparison.OrdinalIgnoreCase)') &&
    desktopWindowSource.includes('"visualizer" or "projection" or "projector" => "visualizer"'),
)
check(
  'desktop shell startup title follows resolved app variant',
  readSource('desktop-shell/MainWindow.xaml').includes('x:Name="StartupTitle"') &&
    desktopWindowSource.includes('StartupTitle.Text = $"{AppTitle}'),
)
check(
  'desktop shell prevents duplicate windows per app variant',
  desktopAppSource.includes('using System.Threading;') &&
    desktopAppSource.includes('private Mutex? singleInstanceMutex;') &&
    desktopAppSource.includes('private bool ownsSingleInstanceMutex;') &&
    desktopAppSource.includes('Assembly.GetExecutingAssembly().GetName().Name') &&
    desktopAppSource.includes('.SingleInstance') &&
    desktopAppSource.includes('ownsSingleInstanceMutex = createdNew;') &&
    desktopAppSource.includes('if (!createdNew)') &&
    desktopAppSource.includes('singleInstanceMutex.Dispose();') &&
    desktopAppSource.includes('Shutdown();') &&
    desktopAppSource.includes('if (ownsSingleInstanceMutex)') &&
    desktopAppSource.includes('singleInstanceMutex?.ReleaseMutex();'),
)
check(
  'desktop shell resolves app kind with format-specific marker priority',
  markerPriorityLooksCorrect(desktopWindowSource) &&
    desktopWindowSource.includes('return IdentityFromKind(kind);') &&
    !desktopWindowSource.includes('IncludesTextbookResources = marker.IncludesTextbookResources'),
)
check(
  'release cleans desktop project state before each variant publish',
  releaseSource.includes('cleanDesktopProjectState(app)') &&
    releaseSource.includes("for (const childName of ['bin', 'obj'])") &&
    releaseSource.includes('assertPathInsideRoot(target)'),
)
check(
  'release refuses to clean repository or release root directories',
  releaseSource.includes("const defaultReleaseRoot = path.join(root, 'release-unified')") &&
    releaseSource.includes('path.resolve(outDir).toLowerCase() === root.toLowerCase()') &&
    releaseSource.includes('path.resolve(outDir).toLowerCase() === defaultReleaseRoot.toLowerCase()'),
)
check(
  'release removes incomplete output directories on publish failure',
  releaseSource.includes('try {') &&
    releaseSource.includes("await fs.writeFile(path.join(outDir, 'release-manifest.json')") &&
    releaseSource.includes('} catch (error) {') &&
    releaseSource.includes('await fs.rm(outDir, { recursive: true, force: true })') &&
    releaseSource.includes('throw error'),
)
check(
  'release directory timestamp uses local time to match version date',
  releaseSource.includes('const timestamp = localTimestampForReleaseVersion(date, releaseVersion)') &&
    releaseSource.includes('function dateFromReleaseVersion(referenceDate, releaseVersion)') &&
    releaseSource.includes('function localTimestamp(date)') &&
    releaseSource.includes('export { dateFromReleaseVersion, localDateStamp, localTimestamp, releaseDirectoryName, releaseFromCli, resolveReleaseVersion }') &&
    readSource('scripts/release-logic-gate.mjs').includes('crossedMidnightDirectoryName') &&
    !releaseSource.includes('new Date().toISOString().replace'),
)
check(
  'release module can be imported without argv script side effects',
  releaseSource.includes('process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href') &&
    readSource('scripts/release-logic-gate.mjs').includes('process.argv.splice(1, 1); await import'),
)
check(
  'release rejects missing and unknown option values before publishing',
  releaseSource.includes("const optionNames = new Set(['profile', 'variant', 'format', 'out', 'version'])") &&
    releaseSource.includes('throw new Error(`Missing value for --${key}.`)') &&
    releaseSource.includes('throw new Error(`Unknown release option "--${key}"') &&
    readSource('scripts/release-logic-gate.mjs').includes("rejectsReleaseArgs(['--out', '--version', '0.614.99']") &&
    readSource('scripts/release-logic-gate.mjs').includes("rejectsReleaseArgs(['--unknown', 'value']"),
)
check('verify checks embedded app resources', verifySource.includes('readEmbeddedAppResources') && verifySource.includes('textbook embedded resources include textbook books'))
check(
  'desktop shell cache-busts app asset URL by extracted resource version',
    desktopWindowSource.includes('ClearWebViewAssetCacheAsync') &&
    desktopWindowSource.includes('Network.clearBrowserCache') &&
    desktopWindowSource.includes('BuildAppUri(appFolder)') &&
    desktopWindowSource.includes('BuildAssetVersionToken(version)') &&
    desktopWindowSource.includes('SHA256.HashData') &&
    desktopWindowSource.includes('.asset-version') &&
    !desktopWindowSource.includes('Uri.EscapeDataString(version)'),
)
check('verify checks blank bundle marker exists', verifySource.includes('blank bundle marker exists') && verifySource.includes('whiteboard-app'))
check('verify checks blank bundle excludes textbook marker', verifySource.includes('blank bundle has no textbook marker'))
check('verify checks blank bundle excludes visualizer marker', verifySource.includes('blank bundle has no visualizer marker'))
check('verify checks textbook bundle excludes blank book id', verifySource.includes('textbook bundle has no blank book id'))
check('verify checks visualizer bundle marker', verifySource.includes('visualizer bundle marker exists'))
check(
  'verify checks visualizer bundle excludes whiteboard-only chunks and markers',
  verifySource.includes('visualizer bundle is split from whiteboard-only chunks') &&
    verifySource.includes('visualizerForbiddenMarkers') &&
    verifySource.includes('open-whiteboard-selected-book'),
)
check('release rejects textbook bundles that include blank canvas books', releaseSource.includes('Textbook bundle unexpectedly contains a blank-canvas book'))
check(
  'release validates blank bundles contain whiteboard UI only',
  releaseSource.includes('Blank bundle does not contain whiteboard UI') &&
    releaseSource.includes('Blank bundle unexpectedly contains another app marker') &&
    releaseSource.includes("bundleText.includes('whiteboard-app')") &&
    releaseSource.includes("bundleText.includes('visualizer-shell')"),
)
check(
  'release validates singlefile sidecar resources before reporting success',
  releaseSource.includes('assertSinglefileSidecarPolicy(app, outDir)') &&
    releaseSource.includes('Single-file textbook sidecar is missing required resources') &&
    releaseSource.includes("path.join(outDir, 'book', '260.jpg')") &&
    releaseSource.includes("path.join(outDir, 'book-110', '212.jpg')") &&
    releaseSource.includes('Single-file public variant') &&
    releaseSource.includes('assertVariantMarker(app, outDir)'),
)
check(
  'release validates desktop shell rejects cross-loaded app bundles',
  releaseSource.includes('Desktop shell variants must reject cross-loaded textbook and visualizer app bundles') &&
    releaseSource.includes('FolderResourcePolicyMatches(folder)') &&
    releaseSource.includes('FolderBundlePolicyMatches(folder)') &&
    releaseSource.includes('BundleContains(folder, "whiteboard-app")') &&
    releaseSource.includes('BundleContains(folder, "textbook-main")') &&
    releaseSource.includes('BundleContains(folder, "visualizer-shell")') &&
    releaseSource.includes('BundleContains(folder, "open-whiteboard-selected-book")'),
)
check(
  'release rejects visualizer bundles with whiteboard-only chunks and markers',
  releaseSource.includes('Visualizer bundle unexpectedly includes whiteboard-only chunks') &&
    releaseSource.includes('Visualizer bundle unexpectedly includes whiteboard-only markers') &&
    releaseSource.includes('presentationRuntimeRef'),
)
check(
  'main entry dynamically loads only the selected app variant',
  mainSource.includes("await import('./ProjectionApp')") &&
    mainSource.includes("await import('./App')") &&
    !mainSource.includes("import RootApp from './App'") &&
    !mainSource.includes("import ProjectionApp from './ProjectionApp'"),
)
check(
  'textbook build defaults to textbook resources instead of blank canvas',
  textbookBooksSource.includes("export const DEFAULT_BOOK_ID = 'textbook-main'") &&
    !textbookBooksSource.includes("id: 'blank'"),
)
check(
  'whiteboard storage is scoped per app variant with legacy migration',
  whiteboardCoreSource.includes('APP_STORAGE_SCOPE') &&
    whiteboardCoreSource.includes('open-whiteboard-db-${APP_STORAGE_SCOPE}') &&
    whiteboardCoreSource.includes('open-whiteboard-selected-book-${APP_STORAGE_SCOPE}') &&
    whiteboardCoreSource.includes('LEGACY_DB_NAME') &&
    whiteboardCoreSource.includes('readProjectFromDatabase(LEGACY_DB_NAME, bookId)') &&
    whiteboardCoreSource.includes('await saveProject(legacyProject)'),
)
check(
  'whiteboard helper strips and validates variant options before release handoff',
  whiteboardSource.includes('variantOptionNames') &&
    whiteboardSource.includes('resolveVariant') &&
    whiteboardSource.includes('Conflicting app variants') &&
    whiteboardSource.includes('withoutVariant(args)'),
)
check(
  'whiteboard helper validates variant bundles after direct builds',
  whiteboardSource.includes('assertResourcePolicy(app, fullOutDir)') &&
    whiteboardSource.includes('assertVariantBundle(app, fullOutDir)') &&
    whiteboardSource.includes('Textbook build is missing local resource directories') &&
    whiteboardSource.includes('Blank bundle does not contain whiteboard UI') &&
    whiteboardSource.includes('Visualizer bundle does not contain projection UI') &&
    whiteboardSource.includes('Visualizer bundle unexpectedly includes whiteboard-only chunks') &&
    whiteboardSource.includes('Visualizer bundle unexpectedly includes whiteboard-only markers'),
)

const failed = checks.filter((item) => !item.pass)
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2))
if (failed.length) process.exit(1)

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function markerPriorityLooksCorrect(source) {
  const pattern =
    /var externalMarker = ReadVariantMarker\(Path\.Combine\(AppContext\.BaseDirectory, "app", "variant\.json"\)\);[\s\S]*?var embeddedMarker = ReadEmbeddedVariantMarker\(\);[\s\S]*?#if SINGLE_FILE_PUBLISH[\s\S]*?var marker = embeddedMarker \?\? externalMarker;[\s\S]*?#else[\s\S]*?var marker = externalMarker \?\? embeddedMarker;[\s\S]*?#endif/
  return pattern.test(source)
}

function check(name, pass) {
  checks.push({ name, pass: Boolean(pass) })
}

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((item, index) => item === right[index])
}

function countOccurrences(source, needle) {
  let count = 0
  let offset = 0
  while (true) {
    const index = source.indexOf(needle, offset)
    if (index === -1) return count
    count += 1
    offset = index + needle.length
  }
}
