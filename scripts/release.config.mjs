const apps = {
  chalkline: {
    id: 'chalkline',
    mode: 'blank',
    displayName: 'Chalkline Board',
    assemblyName: 'ChalklineBoard',
    webDist: 'dist',
    desktopDist: 'dist-desktop',
    desktopProject: 'desktop-shell/OpenWhiteboard.BlankDesktop.csproj',
    exeName: 'ChalklineBoard.exe',
    packageDir: 'chalkline-board',
    installerName: 'ChalklineBoard-Setup.exe',
    installDirName: 'ChalklineBoard',
    appIconName: 'assets\\whiteboard.ico',
    noteIconName: 'assets\\owbn.ico',
    includesTextbookResources: false,
  },
  textbook: {
    id: 'textbook',
    mode: 'textbook',
    displayName: 'Chalkline Board Textbook',
    assemblyName: 'ChalklineTextbook',
    webDist: 'dist-textbook',
    desktopDist: 'dist-desktop-textbook',
    desktopProject: 'desktop-shell/OpenWhiteboard.BlankDesktop.csproj',
    exeName: 'ChalklineTextbook.exe',
    packageDir: 'chalkline-textbook',
    installerName: 'ChalklineTextbook-Setup.exe',
    installDirName: 'ChalklineBoardTextbook',
    appIconName: 'assets\\textbook-book.ico',
    noteIconName: 'assets\\owbn.ico',
    includesTextbookResources: true,
  },
  visualizer: {
    id: 'visualizer',
    mode: 'visualizer',
    displayName: 'Chalkline Visualizer',
    assemblyName: 'ChalklineVisualizer',
    webDist: 'dist-visualizer',
    desktopDist: 'dist-desktop-visualizer',
    desktopProject: 'desktop-shell/OpenWhiteboard.BlankDesktop.csproj',
    exeName: 'ChalklineVisualizer.exe',
    packageDir: 'chalkline-visualizer',
    installerName: 'ChalklineVisualizer-Setup.exe',
    installDirName: 'ChalklineVisualizer',
    appIconName: 'assets\\projection.ico',
    noteIconName: 'assets\\owbn.ico',
    includesTextbookResources: false,
  },
}

const appAliases = {
  chalkline: 'chalkline',
  board: 'chalkline',
  github: 'chalkline',
  public: 'chalkline',
  textbook: 'textbook',
  book: 'textbook',
  visualizer: 'visualizer',
  projection: 'visualizer',
  projector: 'visualizer',
}

const profiles = {
  chalkline: ['chalkline'],
  github: ['chalkline'],
  textbook: ['textbook'],
  visualizer: ['visualizer'],
  projection: ['visualizer'],
  all: ['chalkline', 'textbook', 'visualizer'],
}

function normalizeAppId(value = 'chalkline') {
  const normalized = appAliases[String(value).toLowerCase()]
  if (!normalized) {
    throw new Error(`Unknown app variant "${value}". Use one of: ${Object.keys(appAliases).sort().join(', ')}`)
  }
  return normalized
}

function getAppConfig(value = 'chalkline') {
  return apps[normalizeAppId(value)]
}

function resolveAppSelection(value = 'chalkline') {
  const key = String(value).toLowerCase()
  const profile = profiles[key]
  if (profile) return profile.map((id) => apps[id])
  return [apps[normalizeAppId(key)]]
}

export { apps, appAliases, profiles, getAppConfig, normalizeAppId, resolveAppSelection }
