import { pageSize, renderPageCanvas } from './core'
import type { BoardPage, BoardProject } from './core'
import { NOTE_MIME_TYPE, noteFileName, serializeNoteFile } from './noteFormat'

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export function exportProjectJson(project: BoardProject) {
  const blob = new Blob([serializeNoteFile(project)], { type: NOTE_MIME_TYPE })
  downloadBlob(blob, noteFileName())
}

export async function exportPagePng(page: BoardPage) {
  const canvas = await renderPageCanvas(page, 2)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return false
  downloadBlob(blob, `${page.name.replace(/\.[^.]+$/, '') || 'whiteboard'}.png`)
  return true
}

export async function exportProjectPdf(project: BoardProject) {
  const { jsPDF } = await import('jspdf')
  const firstSize = pageSize(project.pages[0])
  const pdf = new jsPDF({
    orientation: firstSize.width >= firstSize.height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [firstSize.width, firstSize.height],
    compress: true,
  })

  for (let index = 0; index < project.pages.length; index += 1) {
    const page = project.pages[index]
    const size = pageSize(page)
    if (index > 0) {
      pdf.addPage([size.width, size.height], size.width >= size.height ? 'landscape' : 'portrait')
    }
    const canvas = await renderPageCanvas(page, 1.5)
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, size.width, size.height)
  }

  pdf.save(`open-whiteboard-${new Date().toISOString().slice(0, 10)}.pdf`)
}
