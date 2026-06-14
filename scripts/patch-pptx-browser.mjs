import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const renderPath = path.join(root, 'node_modules', 'pptx-browser', 'src', 'render.js')

const patches = [
  {
    before: [
  "    const bullet = pPr ? parseBullet(pPr, defRPr, themeColors, themeData) : null;",
  "",
  "    // Spacing",
  "    const spcBef = g1(pPr, 'spcBef');",
  "    const spcAft = g1(pPr, 'spcAft');",
  "    const lnSpc = g1(pPr, 'lnSpc');",
  "    const defRPr = g1(pPr, 'defRPr');",
    ].join('\n'),
    after: [
  "    const defRPr = g1(pPr, 'defRPr');",
  "    const bullet = pPr ? parseBullet(pPr, defRPr, themeColors, themeData) : null;",
  "",
  "    // Spacing",
  "    const spcBef = g1(pPr, 'spcBef');",
  "    const spcAft = g1(pPr, 'spcAft');",
  "    const lnSpc = g1(pPr, 'lnSpc');",
    ].join('\n'),
  },
  {
    before: 'export async function renderGroupShape(ctx, grpSpEl, rels, imageCache, themeColors, themeData, scale) {',
    after: 'export async function renderGroupShape(ctx, grpSpEl, rels, imageCache, themeColors, themeData, scale, files) {',
  },
  {
    before: "    else if (ln === 'grpSp') await renderGroupShape(ctx, child, rels, imageCache, themeColors, themeData, scale);",
    after: "    else if (ln === 'grpSp') await renderGroupShape(ctx, child, rels, imageCache, themeColors, themeData, scale, files);",
  },
  {
    before: "      else if (ln === 'grpSp') await renderGroupShape(ctx, child, rels, imageCache, themeColors, themeData, scale);",
    after: "      else if (ln === 'grpSp') await renderGroupShape(ctx, child, rels, imageCache, themeColors, themeData, scale, files);",
  },
]

try {
  let source = await fs.readFile(renderPath, 'utf8')
  let changed = false
  for (const patch of patches) {
    if (source.includes(patch.after)) continue
    if (!source.includes(patch.before)) {
      throw new Error('pptx-browser render.js patch target was not found')
    }
    source = source.replace(patch.before, patch.after)
    changed = true
  }
  if (changed) {
    await fs.writeFile(renderPath, source, 'utf8')
    console.log('patched pptx-browser render.js')
  }
} catch (error) {
  if (error?.code === 'ENOENT') process.exit(0)
  throw error
}
