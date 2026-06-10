function nextToolSettingsOpen<T>(currentTool: T, nextTool: T, settingsOpen: boolean, configurableTools: ReadonlySet<T>) {
  return currentTool === nextTool && configurableTools.has(nextTool) ? !settingsOpen : false
}

export { nextToolSettingsOpen }
