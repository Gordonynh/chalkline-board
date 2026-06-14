import { chromium } from '@playwright/test'

function shouldTryInstalledBrowser(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Executable') || message.includes('playwright install')
}

export async function launchHeadlessBrowser(options = {}) {
  try {
    return await chromium.launch({ headless: true, ...options })
  } catch (error) {
    if (!shouldTryInstalledBrowser(error)) throw error
  }

  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: true, ...options })
    } catch {
      // Try the next installed browser channel.
    }
  }

  throw new Error('No Playwright browser is installed. Install Playwright browsers or Microsoft Edge/Chrome to run headless probes.')
}
