const apps = {
  chalkline: {
    id: 'chalkline',
    mode: 'blank',
    displayName: 'Chalkline Board',
    webDist: 'dist',
    desktopDist: 'dist-desktop',
    desktopProject: 'desktop-shell/OpenWhiteboard.BlankDesktop.csproj',
    exeName: 'ChalklineBoard.exe',
    packageDir: 'chalkline-board',
    installerName: 'ChalklineBoard-Setup.exe',
    installDirName: 'ChalklineBoard',
    includesTextbookResources: false,
  },
}

const appAliases = {
  chalkline: 'chalkline',
  board: 'chalkline',
  github: 'chalkline',
  public: 'chalkline',
}

const profiles = {
  chalkline: ['chalkline'],
  github: ['chalkline'],
}

function normalizeAppId(value = 'chalkline') {
  const normalized = appAliases[String(value).toLowerCase()]
  if (!normalized) {
    throw new Error(`Unknown app variant "${value}". Use one of: ${Object.keys(appAliases).sort().join(', ')}`)
  }
  return normalized
}

function resolveAppSelection(value = 'chalkline') {
  const key = String(value).toLowerCase()
  const profile = profiles[key]
  if (profile) return profile.map((id) => apps[id])
  return [apps[normalizeAppId(key)]]
}

export { apps, appAliases, profiles, normalizeAppId, resolveAppSelection }
