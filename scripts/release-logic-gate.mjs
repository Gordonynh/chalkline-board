import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dateFromReleaseVersion, localDateStamp, localTimestamp, releaseDirectoryName, releaseFromCli, resolveReleaseVersion } from './release.mjs'

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chalkline-release-logic-'))

try {
  const now = new Date()
  const base = `0.${now.getMonth() + 1}${now.getDate()}.`
  const dateStamp = localDateStamp(now)
  const timestamp = localTimestamp(now)

  await fs.mkdir(path.join(tempRoot, `all-v${base}2-${dateStamp}-010203`))
  await fs.mkdir(path.join(tempRoot, `textbook-v${base}7-${dateStamp}-020304`))
  await fs.mkdir(path.join(tempRoot, `legacy-${dateStamp}-without-semver`))
  await fs.mkdir(path.join(tempRoot, `all-v0.101.99-${dateStamp}-030405`))

  const nextVersion = await resolveReleaseVersion(null, tempRoot)
  const explicitVersion = await resolveReleaseVersion('0.66.12', tempRoot)
  const directoryName = releaseDirectoryName('All', nextVersion)
  const crossedMidnightDirectoryName = releaseDirectoryName('textbook', '0.613.9', new Date(2026, 5, 14, 0, 0, 1))
  const ambiguousJanuaryDate = localDateStamp(dateFromReleaseVersion(new Date(2026, 0, 12, 1, 2, 3), '0.111.1'))
  const ambiguousNovemberDate = localDateStamp(dateFromReleaseVersion(new Date(2026, 10, 2, 1, 2, 3), '0.111.1'))

  assert(nextVersion === `${base}8`, `expected next version ${base}8, got ${nextVersion}`)
  assert(explicitVersion === '0.66.12', `explicit version changed: ${explicitVersion}`)
  assert(directoryName.startsWith(`all-v${nextVersion}-${dateStamp}-`), `release directory did not use local date: ${directoryName}`)
  assert(
    crossedMidnightDirectoryName === 'textbook-v0.613.9-20260613-000001',
    `cross-midnight release directory used the wrong date: ${crossedMidnightDirectoryName}`,
  )
  assert(ambiguousJanuaryDate === '20260111', `ambiguous 0.111 date did not resolve near January 11: ${ambiguousJanuaryDate}`)
  assert(ambiguousNovemberDate === '20261101', `ambiguous 0.111 date did not resolve near November 1: ${ambiguousNovemberDate}`)
  assert(/-\d{6}$/.test(directoryName), `release directory missing local time suffix: ${directoryName}`)
  assert(timestamp.startsWith(`${dateStamp}-`), `local timestamp does not start with local date stamp: ${timestamp}`)
  assert(importWithoutArgvScriptWorks(), 'release module import failed when process.argv[1] is absent')
  assert(await rejectsReleaseArgs(['--out', '--version', '0.614.99'], 'Missing value for --out.'), 'release accepted --out without a value')
  assert(await rejectsReleaseArgs(['--format=', '--version', '0.614.99'], 'Missing value for --format.'), 'release accepted an empty --format value')
  assert(await rejectsReleaseArgs(['--unknown', 'value'], 'Unknown release option "--unknown"'), 'release accepted an unknown option')

  let rejected = false
  try {
    await resolveReleaseVersion('1.0.0', tempRoot)
  } catch {
    rejected = true
  }
  assert(rejected, 'invalid release version was accepted')

  console.log(
    JSON.stringify(
      {
        ok: true,
        nextVersion,
        explicitVersion,
        directoryName,
        crossedMidnightDirectoryName,
        dateStamp,
      },
      null,
      2,
    ),
  )
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function rejectsReleaseArgs(args, expectedMessage) {
  try {
    await releaseFromCli(args)
    return false
  } catch (error) {
    return error instanceof Error && error.message.includes(expectedMessage)
  }
}

function importWithoutArgvScriptWorks() {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "process.argv.splice(1, 1); await import('./scripts/release.mjs');",
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  return result.status === 0
}
