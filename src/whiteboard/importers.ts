import type { BoardImage } from './core'

const PPTX_WIDTH = 1920
const PDF_RENDER_SCALE = 2
const PDF_MAX_DIMENSION = 2200
const IMPORT_MAX_CANVAS_PIXELS = 5_000_000
const TEXT_PAGE_WIDTH = 1280
const TEXT_PAGE_HEIGHT = 720
const TEXT_PAGE_PADDING = 64
const TEXT_LINE_HEIGHT = 32
const TEXT_FONT = '22px "Microsoft YaHei", "Segoe UI", sans-serif'
const DOC_PAGE_WIDTH = 1240
const DOC_PAGE_HEIGHT = 1754
const DOC_PAGE_PADDING = 96
const SHEET_PAGE_WIDTH = 1440
const SHEET_PAGE_HEIGHT = 900
const SHEET_PAGE_PADDING = 48
const SHEET_ROW_HEIGHT = 36
const SHEET_HEADER_HEIGHT = 78
const SHEET_MIN_COLUMN_WIDTH = 110
const SHEET_MAX_COLUMN_WIDTH = 260
const SHEET_FONT = '20px "Microsoft YaHei", "Segoe UI", sans-serif'
const SHEET_HEADER_FONT = '600 20px "Microsoft YaHei", "Segoe UI", sans-serif'
const ODP_SLIDE_WIDTH = 1600
const ODP_SLIDE_HEIGHT = 900
const ODP_SLIDE_PADDING = 84
const PRESENTATION_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.presentationml.template',
  'application/vnd.ms-powerpoint.template.macroenabled.12',
])
const WORD_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  'application/vnd.ms-word.template.macroenabled.12',
])
const SPREADSHEET_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  'application/vnd.ms-excel.template.macroenabled.12',
])

const stripExtension = (name: string, extension: RegExp) => name.replace(extension, '')

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

const boundedCanvasScale = (width: number, height: number, preferredScale: number, maxDimension: number, maxPixels: number) => {
  const dimensionScale = maxDimension / Math.max(width, height)
  const pixelScale = Math.sqrt(maxPixels / Math.max(1, width * height))
  return Math.max(0.1, Math.min(preferredScale, dimensionScale, pixelScale))
}

const wrapLine = (context: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  const line = text || ' '
  const tokens = line.includes(' ') ? line.split(/(\s+)/) : Array.from(line)
  const wrapped: string[] = []
  let current = ''
  for (const token of tokens) {
    const next = current + token
    if (current && context.measureText(next).width > maxWidth) {
      wrapped.push(current.trimEnd())
      current = token.trimStart()
    } else {
      current = next
    }
  }
  wrapped.push(current.trimEnd())
  return wrapped
}

const renderTextDocument = (
  name: string,
  text: string,
  options: { monospace?: boolean; title?: string } = {},
  onPage?: (image: BoardImage, pageNumber: number, totalPages: number) => void,
) => {
  const measureCanvas = document.createElement('canvas')
  const measureContext = measureCanvas.getContext('2d')
  if (!measureContext) throw new Error('canvas context unavailable')
  measureContext.font = options.monospace ? '20px Consolas, "Microsoft YaHei", monospace' : TEXT_FONT

  const maxTextWidth = TEXT_PAGE_WIDTH - TEXT_PAGE_PADDING * 2
  const sourceLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const lines = sourceLines.flatMap((line) => wrapLine(measureContext, line, maxTextWidth))
  const linesPerPage = Math.max(1, Math.floor((TEXT_PAGE_HEIGHT - TEXT_PAGE_PADDING * 2) / TEXT_LINE_HEIGHT))
  const pageCount = Math.max(1, Math.ceil(lines.length / linesPerPage))
  const images: BoardImage[] = []

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const canvas = document.createElement('canvas')
    canvas.width = TEXT_PAGE_WIDTH
    canvas.height = TEXT_PAGE_HEIGHT
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas context unavailable')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, TEXT_PAGE_WIDTH, TEXT_PAGE_HEIGHT)
    context.fillStyle = '#0f172a'
    context.font = '600 24px "Microsoft YaHei", "Segoe UI", sans-serif'
    context.textBaseline = 'top'
    context.fillText(options.title ?? name, TEXT_PAGE_PADDING, 28)
    context.strokeStyle = '#e5e7eb'
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(TEXT_PAGE_PADDING, 62)
    context.lineTo(TEXT_PAGE_WIDTH - TEXT_PAGE_PADDING, 62)
    context.stroke()

    context.fillStyle = '#111827'
    context.font = options.monospace ? '20px Consolas, "Microsoft YaHei", monospace' : TEXT_FONT
    context.textBaseline = 'top'

    const startLine = pageIndex * linesPerPage
    const pageLines = lines.slice(startLine, startLine + linesPerPage)
    pageLines.forEach((line, lineIndex) => {
      const y = TEXT_PAGE_PADDING + 18 + lineIndex * TEXT_LINE_HEIGHT
      if (options.monospace && lineIndex % 2 === 0) {
        context.fillStyle = 'rgba(15, 23, 42, 0.035)'
        context.fillRect(TEXT_PAGE_PADDING - 10, y - 4, maxTextWidth + 20, TEXT_LINE_HEIGHT)
        context.fillStyle = '#111827'
      }
      context.fillText(line, TEXT_PAGE_PADDING, y)
    })
    context.fillStyle = '#9ca3af'
    context.font = '16px "Segoe UI", sans-serif'
    context.fillText(`${pageIndex + 1}/${pageCount}`, TEXT_PAGE_WIDTH - TEXT_PAGE_PADDING - 56, TEXT_PAGE_HEIGHT - 36)

    const image: BoardImage = {
      src: canvas.toDataURL('image/jpeg', 0.92),
      name: `${name}-${String(pageIndex + 1).padStart(3, '0')}.jpg`,
      width: TEXT_PAGE_WIDTH,
      height: TEXT_PAGE_HEIGHT,
    }
    images.push(image)
    onPage?.(image, pageIndex + 1, pageCount)
  }

  return images
}

const renderHtmlDocument = async (
  name: string,
  html: string,
  options: { title: string },
  onPage?: (image: BoardImage, pageNumber: number, totalPages: number) => void,
) => {
  const { default: html2canvas } = await import('html2canvas')
  const host = document.createElement('section')
  const content = document.createElement('article')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    `${`width:${DOC_PAGE_WIDTH}px`}`,
    'background:#fff',
    'pointer-events:none',
    'z-index:-1',
  ].join(';')
  content.style.cssText = [
    'box-sizing:border-box',
    `${`width:${DOC_PAGE_WIDTH}px`}`,
    `${`min-height:${DOC_PAGE_HEIGHT}px`}`,
    `${`padding:${DOC_PAGE_PADDING}px`}`,
    'background:#fff',
    'color:#111827',
    'font:28px/1.58 "Microsoft YaHei","Segoe UI",Arial,sans-serif',
    'overflow-wrap:anywhere',
  ].join(';')
  content.innerHTML = [
    '<style>',
    '.ow-doc-title{font:700 34px/1.25 "Microsoft YaHei","Segoe UI",sans-serif;margin:0 0 36px;color:#0f172a;border-bottom:1px solid #e5e7eb;padding-bottom:20px;}',
    '.ow-doc-body h1{font-size:40px;line-height:1.25;margin:34px 0 18px;}',
    '.ow-doc-body h2{font-size:34px;line-height:1.3;margin:30px 0 16px;}',
    '.ow-doc-body h3{font-size:30px;line-height:1.35;margin:26px 0 14px;}',
    '.ow-doc-body p{margin:0 0 18px;}',
    '.ow-doc-body ul,.ow-doc-body ol{margin:0 0 20px 38px;padding:0;}',
    '.ow-doc-body li{margin:8px 0;}',
    '.ow-doc-body table{border-collapse:collapse;width:100%;margin:20px 0;font-size:24px;}',
    '.ow-doc-body th,.ow-doc-body td{border:1px solid #cbd5e1;padding:10px 12px;vertical-align:top;}',
    '.ow-doc-body th{background:#eef6f5;font-weight:700;}',
    '.ow-doc-body img{max-width:100%;height:auto;}',
    '.ow-doc-body blockquote{border-left:6px solid #99d8d2;margin:20px 0;padding:8px 0 8px 24px;color:#334155;}',
    '</style>',
    `<h1 class="ow-doc-title">${escapeHtml(options.title)}</h1>`,
    `<div class="ow-doc-body">${html || '<p>(empty document)</p>'}</div>`,
  ].join('')
  host.appendChild(content)
  document.body.appendChild(host)

  try {
    await Promise.all(Array.from(content.querySelectorAll('img')).map((image) => {
      if (image.complete) return Promise.resolve()
      return new Promise<void>((resolve) => {
        image.onload = () => resolve()
        image.onerror = () => resolve()
      })
    }))
    await nextFrame()
    const contentHeight = Math.max(DOC_PAGE_HEIGHT, Math.ceil(content.scrollHeight))
    const pageCount = Math.max(1, Math.ceil(contentHeight / DOC_PAGE_HEIGHT))
    const images: BoardImage[] = []

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const snapshot = document.createElement('div')
      snapshot.style.cssText = [
        'position:fixed',
        'left:-100000px',
        'top:0',
        `${`width:${DOC_PAGE_WIDTH}px`}`,
        `${`height:${DOC_PAGE_HEIGHT}px`}`,
        'overflow:hidden',
        'background:#fff',
        'pointer-events:none',
        'z-index:-1',
      ].join(';')
      const clone = content.cloneNode(true) as HTMLElement
      clone.style.marginTop = `${-(pageIndex * DOC_PAGE_HEIGHT)}px`
      clone.style.minHeight = `${contentHeight}px`
      snapshot.appendChild(clone)
      document.body.appendChild(snapshot)
      await nextFrame()
      const canvas = await html2canvas(snapshot, {
        backgroundColor: '#ffffff',
        scale: 1,
        logging: false,
        useCORS: false,
        width: DOC_PAGE_WIDTH,
        height: DOC_PAGE_HEIGHT,
        windowWidth: DOC_PAGE_WIDTH,
        windowHeight: DOC_PAGE_HEIGHT,
      })
      snapshot.remove()
      const image: BoardImage = {
        src: canvas.toDataURL('image/jpeg', 0.92),
        name: `${name}-${String(pageIndex + 1).padStart(3, '0')}.jpg`,
        width: DOC_PAGE_WIDTH,
        height: DOC_PAGE_HEIGHT,
      }
      images.push(image)
      onPage?.(image, pageIndex + 1, pageCount)
      await nextFrame()
    }
    return images
  } finally {
    host.remove()
  }
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })

const sanitizeImportedHtml = (html: string) => {
  const documentValue = new DOMParser().parseFromString(html, 'text/html')
  documentValue.querySelectorAll('script, iframe, object, embed, meta, link').forEach((element) => element.remove())
  documentValue.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim().toLowerCase()
      if (name.startsWith('on') || value.startsWith('javascript:')) {
        element.removeAttribute(attribute.name)
      }
    }
  })
  return documentValue.body.innerHTML
}

const decodeRtfEscapes = (text: string) => text
  .replace(/\\'([0-9a-fA-F]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
  .replace(/\\u(-?\d+)\??/g, (_match, value: string) => {
    const code = Number.parseInt(value, 10)
    if (!Number.isFinite(code)) return ''
    const normalized = code < 0 ? code + 65536 : code
    try {
      return String.fromCharCode(normalized)
    } catch {
      return ''
    }
  })

const rtfToPlainText = (rtf: string) => {
  const text = decodeRtfEscapes(rtf)
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\line/g, '\n')
    .replace(/\\tab/g, '\t')
    .replace(/[{}]/g, '')
    .replace(/\\[a-zA-Z]+\d* ?/g, '')
    .replace(/\\[^a-zA-Z0-9]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return text || 'RTF document'
}

const odtContentToPlainText = (xml: string) => {
  const documentValue = new DOMParser().parseFromString(xml, 'application/xml')
  const parserError = documentValue.querySelector('parsererror')
  if (parserError) throw new Error('ODT content.xml is not valid XML')
  const body = documentValue.getElementsByTagName('office:text')[0] ?? documentValue.documentElement
  const blockNames = new Set(['text:h', 'text:p', 'text:list-item'])
  const lines: string[] = []
  const walk = (node: Node, parts: string[]) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '')
      return
    }
    if (!(node instanceof Element)) return
    const name = node.nodeName
    if (name === 'text:line-break') {
      parts.push('\n')
      return
    }
    if (name === 'text:tab') {
      parts.push('\t')
      return
    }
    if (name === 'text:s') {
      const count = Number.parseInt(node.getAttribute('text:c') ?? '1', 10)
      parts.push(' '.repeat(Math.max(1, Number.isFinite(count) ? count : 1)))
      return
    }
    for (const child of Array.from(node.childNodes)) walk(child, parts)
  }
  const collectBlock = (element: Element) => {
    const parts: string[] = []
    walk(element, parts)
    const text = parts.join('').replace(/[ \t]+\n/g, '\n').trim()
    if (text) lines.push(text)
  }
  for (const element of Array.from(body.getElementsByTagName('*'))) {
    if (blockNames.has(element.nodeName)) collectBlock(element)
  }
  return lines.join('\n\n') || 'ODT document'
}

const readOdtPlainText = async (file: File) => {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const content = zip.file('content.xml')
  if (!content) throw new Error('ODT content.xml was not found')
  return odtContentToPlainText(await content.async('string'))
}

const odsContentToSheets = (xml: string) => {
  const documentValue = new DOMParser().parseFromString(xml, 'application/xml')
  const parserError = documentValue.querySelector('parsererror')
  if (parserError) throw new Error('ODS content.xml is not valid XML')
  const tables = Array.from(documentValue.getElementsByTagName('table:table'))
  return tables.map((table, tableIndex) => {
    const sheetName = table.getAttribute('table:name') || `Sheet ${tableIndex + 1}`
    const rows: string[][] = []
    for (const row of Array.from(table.getElementsByTagName('table:table-row'))) {
      const repeatRows = Math.min(Number.parseInt(row.getAttribute('table:number-rows-repeated') ?? '1', 10) || 1, 100)
      const cells: string[] = []
      for (const cell of Array.from(row.getElementsByTagName('table:table-cell'))) {
        const repeatColumns = Math.min(Number.parseInt(cell.getAttribute('table:number-columns-repeated') ?? '1', 10) || 1, 100)
        const paragraphs = Array.from(cell.getElementsByTagName('text:p'))
        const value = paragraphs.length
          ? paragraphs.map((paragraph) => paragraph.textContent ?? '').join('\n').trim()
          : (cell.getAttribute('office:value') ?? cell.getAttribute('office:string-value') ?? '').trim()
        for (let index = 0; index < repeatColumns; index += 1) cells.push(value)
      }
      if (cells.some((cell) => cell.trim())) {
        for (let index = 0; index < repeatRows; index += 1) rows.push([...cells])
      }
    }
    return { sheetName, rows: rows.length ? rows : [['(empty sheet)']] }
  })
}

const readOdsSheets = async (file: File) => {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const content = zip.file('content.xml')
  if (!content) throw new Error('ODS content.xml was not found')
  return odsContentToSheets(await content.async('string'))
}

const elementText = (element: Element) =>
  (element.textContent ?? '').replace(/\s+/g, ' ').trim()

const odpContentToSlides = (xml: string) => {
  const documentValue = new DOMParser().parseFromString(xml, 'application/xml')
  const parserError = documentValue.querySelector('parsererror')
  if (parserError) throw new Error('ODP content.xml is not valid XML')
  const pages = Array.from(documentValue.getElementsByTagName('draw:page'))
  const slides = pages.map((page, pageIndex) => {
    const title = page.getAttribute('draw:name') || `Slide ${pageIndex + 1}`
    const lines: string[] = []
    for (const element of Array.from(page.getElementsByTagName('*'))) {
      if (element.nodeName === 'text:h' || element.nodeName === 'text:p') {
        const text = elementText(element)
        if (text && lines[lines.length - 1] !== text) lines.push(text)
      }
    }
    return { title, lines: lines.length ? lines : ['(empty slide)'] }
  })
  return slides.length ? slides : [{ title: 'Slide 1', lines: ['ODP presentation'] }]
}

const readOdpSlides = async (file: File) => {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const content = zip.file('content.xml')
  if (!content) throw new Error('ODP content.xml was not found')
  return odpContentToSlides(await content.async('string'))
}

const renderOdpSlide = (
  presentationName: string,
  fileName: string,
  slide: { title: string; lines: string[] },
  slideNumber: number,
  totalSlides: number,
) => {
  const canvas = document.createElement('canvas')
  canvas.width = ODP_SLIDE_WIDTH
  canvas.height = ODP_SLIDE_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas context unavailable')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, ODP_SLIDE_WIDTH, ODP_SLIDE_HEIGHT)

  context.fillStyle = '#0f766e'
  context.fillRect(0, 0, ODP_SLIDE_WIDTH, 16)
  context.fillStyle = '#0f172a'
  context.font = '700 44px "Microsoft YaHei", "Segoe UI", sans-serif'
  context.textBaseline = 'top'
  context.fillText(slide.title || fileName, ODP_SLIDE_PADDING, 72)
  context.strokeStyle = '#d7dee8'
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(ODP_SLIDE_PADDING, 142)
  context.lineTo(ODP_SLIDE_WIDTH - ODP_SLIDE_PADDING, 142)
  context.stroke()

  context.font = '30px "Microsoft YaHei", "Segoe UI", sans-serif'
  context.fillStyle = '#1f2937'
  const maxTextWidth = ODP_SLIDE_WIDTH - ODP_SLIDE_PADDING * 2
  let y = 190
  for (const line of slide.lines) {
    for (const wrapped of wrapLine(context, line, maxTextWidth)) {
      if (y > ODP_SLIDE_HEIGHT - 116) break
      context.fillText(wrapped, ODP_SLIDE_PADDING, y)
      y += 48
    }
    y += 12
    if (y > ODP_SLIDE_HEIGHT - 116) break
  }

  context.fillStyle = '#94a3b8'
  context.font = '18px "Segoe UI", sans-serif'
  context.fillText(`${fileName}  ${slideNumber}/${totalSlides}`, ODP_SLIDE_PADDING, ODP_SLIDE_HEIGHT - 48)

  return {
    src: canvas.toDataURL('image/jpeg', 0.92),
    name: `${presentationName}-${String(slideNumber).padStart(3, '0')}.jpg`,
    width: ODP_SLIDE_WIDTH,
    height: ODP_SLIDE_HEIGHT,
  } satisfies BoardImage
}

const spreadsheetCellText = (cell: unknown) => {
  if (cell === null || cell === undefined) return ''
  if (cell instanceof Date) {
    const date = cell.toISOString().slice(0, 10)
    const time = cell.toISOString().slice(11, 16)
    return time === '00:00' ? date : `${date} ${time}`
  }
  if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE'
  return String(cell)
}

const clampColumnWidth = (width: number) =>
  Math.max(SHEET_MIN_COLUMN_WIDTH, Math.min(SHEET_MAX_COLUMN_WIDTH, Math.ceil(width + 28)))

const spreadsheetColumnWidths = (rows: unknown[][]) => {
  const measureCanvas = document.createElement('canvas')
  const context = measureCanvas.getContext('2d')
  if (!context) throw new Error('canvas context unavailable')
  context.font = SHEET_FONT
  const columnCount = Math.max(1, ...rows.map((row) => row.length))
  const widths = Array.from({ length: columnCount }, () => SHEET_MIN_COLUMN_WIDTH)
  rows.slice(0, 120).forEach((row) => {
    row.forEach((cell, columnIndex) => {
      widths[columnIndex] = Math.max(widths[columnIndex], clampColumnWidth(context.measureText(spreadsheetCellText(cell)).width))
    })
  })
  const availableWidth = SHEET_PAGE_WIDTH - SHEET_PAGE_PADDING * 2
  const totalWidth = widths.reduce((sum, width) => sum + width, 0)
  if (totalWidth <= availableWidth) return widths
  const scale = availableWidth / totalWidth
  return widths.map((width) => Math.max(72, Math.floor(width * scale)))
}

const drawSpreadsheetCellText = (
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  bold = false,
) => {
  context.save()
  context.beginPath()
  context.rect(x + 8, y, Math.max(1, width - 16), SHEET_ROW_HEIGHT)
  context.clip()
  context.fillStyle = bold ? '#0f172a' : '#111827'
  context.font = bold ? SHEET_HEADER_FONT : SHEET_FONT
  context.textBaseline = 'middle'
  context.fillText(text, x + 10, y + SHEET_ROW_HEIGHT / 2)
  context.restore()
}

const spreadsheetPageCount = (rows: unknown[][]) => {
  const safeRows = rows.length ? rows : [['(empty sheet)']]
  const rowsPerPage = Math.max(1, Math.floor((SHEET_PAGE_HEIGHT - SHEET_HEADER_HEIGHT - SHEET_PAGE_PADDING) / SHEET_ROW_HEIGHT))
  return Math.max(1, Math.ceil(safeRows.length / rowsPerPage))
}

const renderSpreadsheetSheet = (
  workbookName: string,
  fileName: string,
  sheetName: string,
  rows: unknown[][],
  onPage?: (image: BoardImage, pageNumber: number, totalPages: number, sheetName: string) => void,
) => {
  const safeRows = rows.length ? rows : [['(empty sheet)']]
  const columnWidths = spreadsheetColumnWidths(safeRows)
  const rowsPerPage = Math.max(1, Math.floor((SHEET_PAGE_HEIGHT - SHEET_HEADER_HEIGHT - SHEET_PAGE_PADDING) / SHEET_ROW_HEIGHT))
  const pageCount = spreadsheetPageCount(safeRows)
  const images: BoardImage[] = []

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const canvas = document.createElement('canvas')
    canvas.width = SHEET_PAGE_WIDTH
    canvas.height = SHEET_PAGE_HEIGHT
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas context unavailable')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, SHEET_PAGE_WIDTH, SHEET_PAGE_HEIGHT)

    context.fillStyle = '#0f172a'
    context.font = '600 26px "Microsoft YaHei", "Segoe UI", sans-serif'
    context.textBaseline = 'top'
    context.fillText(`${fileName} - ${sheetName}`, SHEET_PAGE_PADDING, 26)
    context.fillStyle = '#64748b'
    context.font = '16px "Segoe UI", sans-serif'
    context.fillText(`${pageIndex + 1}/${pageCount}`, SHEET_PAGE_WIDTH - SHEET_PAGE_PADDING - 64, 34)

    const startRow = pageIndex * rowsPerPage
    const pageRows = safeRows.slice(startRow, startRow + rowsPerPage)
    let y = SHEET_HEADER_HEIGHT
    for (const [rowOffset, row] of pageRows.entries()) {
      const rowIndex = startRow + rowOffset
      const isHeader = rowIndex === 0
      context.fillStyle = isHeader ? '#eef6f5' : rowIndex % 2 === 0 ? '#ffffff' : '#f8fafc'
      context.fillRect(SHEET_PAGE_PADDING, y, SHEET_PAGE_WIDTH - SHEET_PAGE_PADDING * 2, SHEET_ROW_HEIGHT)
      let x = SHEET_PAGE_PADDING
      for (let columnIndex = 0; columnIndex < columnWidths.length; columnIndex += 1) {
        const width = columnWidths[columnIndex]
        context.strokeStyle = '#d7dee8'
        context.lineWidth = 1
        context.strokeRect(x, y, width, SHEET_ROW_HEIGHT)
        drawSpreadsheetCellText(context, spreadsheetCellText(row[columnIndex]), x, y, width, isHeader)
        x += width
      }
      y += SHEET_ROW_HEIGHT
    }

    const image: BoardImage = {
      src: canvas.toDataURL('image/jpeg', 0.92),
      name: `${workbookName}-${sheetName}-${String(pageIndex + 1).padStart(3, '0')}.jpg`,
      width: SHEET_PAGE_WIDTH,
      height: SHEET_PAGE_HEIGHT,
    }
    images.push(image)
    onPage?.(image, pageIndex + 1, pageCount, sheetName)
  }

  return images
}

const parseDelimitedText = (text: string, delimiter: ',' | '\t') => {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]
    if (quoted) {
      if (character === '"' && normalized[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
      continue
    }
    if (character === '"') {
      quoted = true
    } else if (character === delimiter) {
      row.push(cell)
      cell = ''
    } else if (character === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }
  if (cell || row.length || normalized.endsWith(delimiter)) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((items) => items.some((item) => item.trim()))
}

export const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })

export const readImageFile = (file: File) =>
  new Promise<BoardImage>((resolve, reject) => {
    readFileAsDataUrl(file)
      .then((src) => {
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
      })
      .catch(reject)
  })

export const isSvgFile = (file: File) =>
  file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)

const sanitizeSvgText = (svg: string) => {
  const documentValue = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const parseError = documentValue.querySelector('parsererror')
  const root = documentValue.documentElement
  if (parseError || root.nodeName.toLowerCase() !== 'svg') {
    throw new Error('Unable to read SVG')
  }

  documentValue.querySelectorAll('script, foreignObject, iframe, object, embed').forEach((element) => element.remove())
  documentValue.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase()
      const attributeValue = attribute.value.trim().toLowerCase()
      const isHref = attributeName === 'href' || attributeName === 'xlink:href'
      const isUnsafeHref =
        isHref &&
        (attributeValue.startsWith('javascript:') ||
          attributeValue.startsWith('http:') ||
          attributeValue.startsWith('https:') ||
          attributeValue.startsWith('file:'))
      if (attributeName.startsWith('on') || attributeValue.startsWith('javascript:') || isUnsafeHref) {
        element.removeAttribute(attribute.name)
      }
    }
  })

  return new XMLSerializer().serializeToString(documentValue)
}

const parseSvgLength = (value: string | null) => {
  if (!value || value.trim().endsWith('%')) return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const svgIntrinsicSize = (svgText: string) => {
  const documentValue = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const root = documentValue.documentElement
  const width = parseSvgLength(root.getAttribute('width'))
  const height = parseSvgLength(root.getAttribute('height'))
  if (width && height) return { width, height }

  const viewBox = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  if (viewBox.length === 4 && viewBox.every((item) => Number.isFinite(item)) && viewBox[2] > 0 && viewBox[3] > 0) {
    return { width: viewBox[2], height: viewBox[3] }
  }
  return { width: 1280, height: 720 }
}

export const readSvgFile = async (file: File) => {
  const { Canvg } = await import('canvg')
  const sanitizedSvg = sanitizeSvgText(await file.text())
  const size = svgIntrinsicSize(sanitizedSvg)
  const scale = boundedCanvasScale(size.width, size.height, 1, PDF_MAX_DIMENSION, IMPORT_MAX_CANVAS_PIXELS)
  const width = Math.max(1, Math.round(size.width * scale))
  const height = Math.max(1, Math.round(size.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas context unavailable')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.scale(scale, scale)
  const renderer = Canvg.fromString(context, sanitizedSvg, {
    ignoreAnimation: true,
    ignoreMouse: true,
    ignoreClear: true,
  })
  await renderer.render()
  return {
    src: canvas.toDataURL('image/jpeg', 0.92),
    name: `${stripExtension(file.name, /\.svg$/i)}-001.jpg`,
    width,
    height,
  } satisfies BoardImage
}

export async function readPdfFile(file: File, onPage?: (image: BoardImage, pageNumber: number, totalPages: number) => void) {
  const [pdfjsLib, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ])
  pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const images: BoardImage[] = []

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const baseViewport = page.getViewport({ scale: 1 })
      const renderScale = boundedCanvasScale(
        baseViewport.width,
        baseViewport.height,
        PDF_RENDER_SCALE,
        PDF_MAX_DIMENSION,
        IMPORT_MAX_CANVAS_PIXELS,
      )
      const viewport = page.getViewport({ scale: renderScale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(viewport.width))
      canvas.height = Math.max(1, Math.round(viewport.height))

      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas context unavailable')

      await page.render({ canvas, canvasContext: context, viewport }).promise
      images.push({
        src: canvas.toDataURL('image/jpeg', 0.92),
        name: `${file.name.replace(/\.pdf$/i, '')}-${String(pageNumber).padStart(3, '0')}.jpg`,
        width: canvas.width,
        height: canvas.height,
      })
      page.cleanup?.()
      onPage?.(images[images.length - 1], pageNumber, pdf.numPages)
      await nextFrame()
    }
  } finally {
    await pdf.destroy()
  }

  return images
}

export const isPptxFile = (file: File) =>
  PRESENTATION_MIME_TYPES.has(file.type) ||
  /\.(pptx|pptm|ppsx|ppsm|potx|potm)$/i.test(file.name)

export const isOdpFile = (file: File) =>
  file.type === 'application/vnd.oasis.opendocument.presentation' ||
  /\.odp$/i.test(file.name)

export const isDocxFile = (file: File) =>
  WORD_MIME_TYPES.has(file.type) ||
  /\.(docx|docm|dotx|dotm)$/i.test(file.name)

export const isSpreadsheetFile = (file: File) =>
  SPREADSHEET_MIME_TYPES.has(file.type) ||
  /\.(xlsx|xlsm|xltx|xltm)$/i.test(file.name)

export const isTextLikeFile = (file: File) => {
  const name = file.name.toLowerCase()
  return (
    file.type.startsWith('text/') ||
    name.endsWith('.txt') ||
    name.endsWith('.md') ||
    name.endsWith('.csv') ||
    name.endsWith('.tsv') ||
    name.endsWith('.json') ||
    name.endsWith('.html') ||
    name.endsWith('.htm') ||
    name.endsWith('.xml') ||
    name.endsWith('.log') ||
    name.endsWith('.rtf') ||
    name.endsWith('.odt') ||
    name.endsWith('.ods')
  )
}

export async function readTextLikeFile(
  file: File,
  onPage?: (image: BoardImage, pageNumber: number, totalPages: number) => void,
) {
  const name = stripExtension(file.name, /\.(txt|md|csv|tsv|json|html|htm|xml|log|rtf|odt|ods)$/i)
  if (/\.odt$/i.test(file.name)) {
    return renderTextDocument(name, await readOdtPlainText(file), { title: file.name }, onPage)
  }
  if (/\.ods$/i.test(file.name)) {
    const sheets = await readOdsSheets(file)
    return sheets.flatMap((sheet) =>
      renderSpreadsheetSheet(name, file.name, sheet.sheetName, sheet.rows, (image, pageNumber, totalPages) => {
        onPage?.(image, pageNumber, totalPages)
      }),
    )
  }
  const text = await file.text()
  if (/\.(html|htm)$/i.test(file.name)) {
    return renderHtmlDocument(name, sanitizeImportedHtml(text), { title: file.name }, onPage)
  }
  if (/\.(csv|tsv)$/i.test(file.name)) {
    const delimiter = file.name.toLowerCase().endsWith('.tsv') ? '\t' : ','
    return renderSpreadsheetSheet(name, file.name, delimiter === '\t' ? 'TSV' : 'CSV', parseDelimitedText(text, delimiter), (image, pageNumber, totalPages) => {
      onPage?.(image, pageNumber, totalPages)
    })
  }
  if (/\.rtf$/i.test(file.name)) {
    return renderTextDocument(name, rtfToPlainText(text), { title: file.name }, onPage)
  }
  const monospace = /\.(json|xml|log)$/i.test(file.name)
  return renderTextDocument(name, text, { monospace, title: file.name }, onPage)
}

export async function readDocxFile(
  file: File,
  onPage?: (image: BoardImage, pageNumber: number, totalPages: number) => void,
) {
  const mammoth = await import('mammoth/mammoth.browser')
  const result = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    {
      includeDefaultStyleMap: true,
      includeEmbeddedStyleMap: true,
      ignoreEmptyParagraphs: false,
    },
  )
  return renderHtmlDocument(stripExtension(file.name, /\.(docx|docm|dotx|dotm)$/i), result.value, { title: file.name }, onPage)
}

export async function readSpreadsheetFile(
  file: File,
  onPage?: (image: BoardImage, pageNumber: number, totalPages: number, sheetName: string) => void,
) {
  const { default: readXlsxFile } = await import('read-excel-file/browser')
  const sheets = await readXlsxFile(file)
  const workbookName = stripExtension(file.name, /\.(xlsx|xlsm|xltx|xltm)$/i)
  const sheetInputs = sheets.map((sheet, sheetIndex) => ({
    sheetName: sheet.sheet || `Sheet ${sheetIndex + 1}`,
    rows: sheet.data,
  }))
  const totalPages = sheetInputs.reduce((sum, sheet) => sum + spreadsheetPageCount(sheet.rows), 0)
  let pageNumber = 0

  return sheetInputs.flatMap((sheet) =>
    renderSpreadsheetSheet(workbookName, file.name, sheet.sheetName, sheet.rows, (image) => {
      pageNumber += 1
      onPage?.(image, pageNumber, totalPages, sheet.sheetName)
    }),
  )
}

export async function readPptxFile(
  file: File,
  onSlide?: (image: BoardImage, slideNumber: number, totalSlides: number) => void,
) {
  const { PptxRenderer } = await import('pptx-browser')
  const renderer = new PptxRenderer()
  const images: BoardImage[] = []

  try {
    await renderer.load(file)

    for (let slideIndex = 0; slideIndex < renderer.slideCount; slideIndex += 1) {
      const canvas = document.createElement('canvas')
      await renderer.renderSlide(slideIndex, canvas, PPTX_WIDTH)
      const slideNumber = slideIndex + 1
      const image: BoardImage = {
        src: canvas.toDataURL('image/jpeg', 0.92),
        name: `${file.name.replace(/\.(pptx|pptm|ppsx|ppsm|potx|potm)$/i, '')}-${String(slideNumber).padStart(3, '0')}.jpg`,
        width: canvas.width,
        height: canvas.height,
      }
      images.push(image)
      onSlide?.(image, slideNumber, renderer.slideCount)
      await nextFrame()
    }
  } finally {
    renderer.destroy()
  }

  return images
}

export async function readOdpFile(file: File) {
  const presentationName = stripExtension(file.name, /\.odp$/i)
  const slides = await readOdpSlides(file)
  return slides.map((slide, index) => renderOdpSlide(presentationName, file.name, slide, index + 1, slides.length))
}
