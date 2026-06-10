import type { BoardImage } from './core'

export const readImageFile = (file: File) =>
  new Promise<BoardImage>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const src = String(reader.result)
      const img = new window.Image()
      img.onload = () => {
        resolve({
          src,
          name: file.name,
          width: img.naturalWidth,
          height: img.naturalHeight,
        })
      }
      img.onerror = () => reject(new Error(`Unable to read image: ${file.name}`))
      img.src = src
    }
    reader.readAsDataURL(file)
  })

export async function readPdfFile(file: File, onPage?: (image: BoardImage, pageNumber: number, totalPages: number) => void) {
  const [pdfjsLib, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ])
  pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const images: BoardImage[] = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)

    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas context unavailable')

    await page.render({ canvas, canvasContext: context, viewport }).promise
    images.push({
      src: canvas.toDataURL('image/jpeg', 0.92),
      name: `${file.name.replace(/\.pdf$/i, '')}-${String(pageNumber).padStart(3, '0')}.jpg`,
      width: canvas.width,
      height: canvas.height,
    })
    onPage?.(images[images.length - 1], pageNumber, pdf.numPages)
  }

  return images
}
