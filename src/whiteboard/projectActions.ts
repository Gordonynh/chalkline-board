import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { getBuiltInBook } from '../books'
import type { BuiltInBook } from '../books'
import { SELECTED_BOOK_KEY, initialProject, makeId, saveProject } from './core'
import type { BoardImage, BoardPage, BoardPresentation, BoardProject, HostCommand } from './core'
import { noteFileName, parseNoteFileText, serializeNoteFile } from './noteFormat'

const PRESENTATION_PACKAGE_EXTENSIONS = ['.pptx', '.pptm', '.ppsx', '.ppsm', '.potx', '.potm']
const WORD_PACKAGE_EXTENSIONS = ['.docx', '.docm', '.dotx', '.dotm']
const SPREADSHEET_PACKAGE_EXTENSIONS = ['.xlsx', '.xlsm', '.xltx', '.xltm']
const ODP_EXTENSIONS = ['.odp']
const CONVERT_TO_PRESENTATION_EXTENSIONS = ['.ppt', '.pps', '.pot']
const CONVERT_TO_WORD_EXTENSIONS = ['.doc', '.dot']
const CONVERT_TO_SPREADSHEET_EXTENSIONS = ['.xls']
const IMAGE_EXTENSIONS = ['.svg']
const TEXT_LIKE_EXTENSIONS = ['.txt', '.md', '.csv', '.tsv', '.json', '.html', '.htm', '.xml', '.log', '.rtf', '.odt', '.ods']
const PRESENTATION_PACKAGE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.presentationml.template',
  'application/vnd.ms-powerpoint.template.macroenabled.12',
])
const WORD_PACKAGE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  'application/vnd.ms-word.template.macroenabled.12',
])
const SPREADSHEET_PACKAGE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  'application/vnd.ms-excel.template.macroenabled.12',
])
const hasExtension = (name: string, extensions: readonly string[]) => extensions.some((extension) => name.endsWith(extension))

const yieldToBrowser = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      window.setTimeout(resolve, 0)
    }
  })

const isSupportedImportFile = (file: File) => {
  const name = file.name.toLowerCase()
  return (
    file.type.startsWith('image/') ||
    hasExtension(name, IMAGE_EXTENSIONS) ||
    file.type === 'application/pdf' ||
    name.endsWith('.pdf') ||
    PRESENTATION_PACKAGE_MIME_TYPES.has(file.type) ||
    hasExtension(name, PRESENTATION_PACKAGE_EXTENSIONS) ||
    WORD_PACKAGE_MIME_TYPES.has(file.type) ||
    hasExtension(name, WORD_PACKAGE_EXTENSIONS) ||
    SPREADSHEET_PACKAGE_MIME_TYPES.has(file.type) ||
    hasExtension(name, SPREADSHEET_PACKAGE_EXTENSIONS) ||
    file.type.startsWith('text/') ||
    hasExtension(name, TEXT_LIKE_EXTENSIONS) ||
    hasExtension(name, ODP_EXTENSIONS) ||
    hasExtension(name, CONVERT_TO_PRESENTATION_EXTENSIONS) ||
    hasExtension(name, CONVERT_TO_WORD_EXTENSIONS) ||
    hasExtension(name, CONVERT_TO_SPREADSHEET_EXTENSIONS)
  )
}

const isLegacyOfficeFile = (file: File) => {
  const name = file.name.toLowerCase()
  return (
    hasExtension(name, CONVERT_TO_PRESENTATION_EXTENSIONS) ||
    hasExtension(name, CONVERT_TO_WORD_EXTENSIONS) ||
    hasExtension(name, CONVERT_TO_SPREADSHEET_EXTENSIONS)
  )
}

const legacyOfficeTargetExtension = (file: File) => {
  const name = file.name.toLowerCase()
  if (hasExtension(name, CONVERT_TO_PRESENTATION_EXTENSIONS)) return 'PPTX'
  if (hasExtension(name, CONVERT_TO_WORD_EXTENSIONS)) return 'DOCX'
  if (hasExtension(name, CONVERT_TO_SPREADSHEET_EXTENSIONS)) return 'XLSX'
  return 'OOXML'
}

type ImportResult = {
  supportedFiles: number
  importedPages: number
  requestedLegacyOfficeConversions: number
  skippedLegacyOfficeFiles: number
  failedFiles: number
}

type ImportFilesOptions = {
  preserveCurrentPages?: boolean
}

const statusForImportResult = (result: ImportResult) => {
  const notes = [
    result.requestedLegacyOfficeConversions > 0 ? `converting ${result.requestedLegacyOfficeConversions} legacy Office file(s)` : '',
    result.skippedLegacyOfficeFiles > 0 ? `skipped ${result.skippedLegacyOfficeFiles} legacy Office file(s)` : '',
    result.failedFiles > 0 ? `failed ${result.failedFiles} unreadable file(s)` : '',
  ].filter(Boolean)
  if (result.importedPages > 0) {
    return `Imported ${result.importedPages} pages${notes.length ? `; ${notes.join('; ')}` : ''}`
  }
  if (notes.length) return notes.join('; ')
  return 'No supported files imported'
}

interface UseProjectActionsOptions {
  project: BoardProject
  currentBook: BuiltInBook
  currentPage: BoardPage
  selectedBookId: string
  setProject: Dispatch<SetStateAction<BoardProject>>
  setProjectReady: Dispatch<SetStateAction<boolean>>
  setSelectedBookId: Dispatch<SetStateAction<string>>
  setPast: Dispatch<SetStateAction<BoardPage[][]>>
  setFuture: Dispatch<SetStateAction<BoardPage[][]>>
  setStatus: Dispatch<SetStateAction<string>>
  setBookPickerOpen: Dispatch<SetStateAction<boolean>>
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  setExportPanelOpen: Dispatch<SetStateAction<boolean>>
  setMorePanelOpen: Dispatch<SetStateAction<boolean>>
  setTocOpen: Dispatch<SetStateAction<boolean>>
  setPageJumpOpen: Dispatch<SetStateAction<boolean>>
  setSelectedStrokeId: Dispatch<SetStateAction<string | null>>
  setSelectedTextId: Dispatch<SetStateAction<string | null>>
  updateCurrentPage: (updater: (page: BoardPage) => BoardPage, recordHistory?: boolean) => void
  fitPage: () => void
  clearLiveInkCanvas: () => void
  resetStrokeInput: () => void
}

function useProjectActions({
  project,
  currentBook,
  currentPage,
  selectedBookId,
  setProject,
  setProjectReady,
  setSelectedBookId,
  setPast,
  setFuture,
  setStatus,
  setBookPickerOpen,
  setSettingsOpen,
  setExportPanelOpen,
  setMorePanelOpen,
  setTocOpen,
  setPageJumpOpen,
  setSelectedStrokeId,
  setSelectedTextId,
  updateCurrentPage,
  fitPage,
  clearLiveInkCanvas,
  resetStrokeInput,
}: UseProjectActionsOptions) {
  const closePanels = useCallback(() => {
    setBookPickerOpen(false)
    setSettingsOpen(false)
    setExportPanelOpen(false)
    setMorePanelOpen(false)
    setTocOpen(false)
    setPageJumpOpen(false)
  }, [setBookPickerOpen, setExportPanelOpen, setMorePanelOpen, setPageJumpOpen, setSettingsOpen, setTocOpen])

  const recordProjectHistory = useCallback(() => {
    setPast((items) => [...items.slice(-40), project.pages])
    setFuture([])
  }, [project.pages, setFuture, setPast])

  const addBlankPage = useCallback(() => {
    const page: BoardPage = {
      id: makeId(),
      name: `Blank page ${project.pages.length + 1}`,
      strokes: [],
      view: { x: 0, y: 0, scale: 1 },
    }
    recordProjectHistory()
    setProject((previous) => ({
      ...previous,
      pages: [...previous.pages, page],
      currentPageId: page.id,
      updatedAt: Date.now(),
    }))
  }, [project.pages.length, recordProjectHistory, setProject])

  const importFiles = useCallback(
    async (files: FileList | File[], options: ImportFilesOptions = {}) => {
      const supportedFiles = Array.from(files).filter(isSupportedImportFile)
      if (!supportedFiles.length) {
        return {
          supportedFiles: 0,
          importedPages: 0,
          requestedLegacyOfficeConversions: 0,
          skippedLegacyOfficeFiles: 0,
          failedFiles: 0,
        } satisfies ImportResult
      }
      setStatus('Importing files...')
      recordProjectHistory()

      let importedCount = 0
      let skippedLegacyOfficeCount = 0
      let requestedLegacyOfficeConversionCount = 0
      let failedImportCount = 0
      let firstImportedId = ''
      const recordImportAppend = (pages: BoardPage[], fileName: string) => {
        const targetWindow = window as Window & {
          __openWhiteboardImportEvents?: Array<{
            fileName: string
            appendedPages: number
            importedCount: number
            pageNames: string[]
          }>
        }
        targetWindow.__openWhiteboardImportEvents ??= []
        targetWindow.__openWhiteboardImportEvents.push({
          fileName,
          appendedPages: pages.length,
          importedCount,
          pageNames: pages.map((page) => page.image?.name ?? page.name),
        })
      }
      const appendImages = (images: BoardImage[], sourceFileName: string, presentation?: { id: string; firstSlideIndex: number }) => {
        if (!images.length) return
        const pages = images.map<BoardPage>((image, imageIndex) => {
          const page: BoardPage = {
            id: makeId(),
            name: image.name || `Imported page ${importedCount + 1}`,
            image,
            presentation: presentation
              ? { id: presentation.id, slideIndex: presentation.firstSlideIndex + imageIndex }
              : undefined,
            strokes: [],
            view: { x: 0, y: 0, scale: 1 },
          }
          importedCount += 1
          firstImportedId ||= page.id
          return page
        })
        setProject((previous) => {
          const shouldReplaceEmptyPage =
            !options.preserveCurrentPages &&
            previous.pages.length === 1 &&
            !previous.pages[0].image &&
            !previous.pages[0].strokes.length &&
            !(previous.pages[0].texts?.length)
          return {
            ...previous,
            pages: shouldReplaceEmptyPage ? pages : [...previous.pages, ...pages],
            currentPageId: firstImportedId || previous.currentPageId,
            updatedAt: Date.now(),
          }
        })
        recordImportAppend(pages, sourceFileName)
      }

      const {
        isDocxFile,
        isOdpFile,
        isPptxFile,
        isSpreadsheetFile,
        isSvgFile,
        isTextLikeFile,
        readDocxFile,
        readFileAsDataUrl,
        readOdpFile,
        readImageFile,
        readPdfFile,
        readPptxFile,
        readSpreadsheetFile,
        readSvgFile,
        readTextLikeFile,
      } = await import('./importers')
      for (const file of supportedFiles) {
        try {
          if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            await readPdfFile(file, (image, pageNumber, totalPages) => {
              appendImages([image], file.name)
              setStatus(`Importing PDF: ${pageNumber}/${totalPages}`)
            })
          } else if (isPptxFile(file)) {
            const presentationId = makeId()
            const presentationSrc = await readFileAsDataUrl(file)
            let slideCount = 0
            await readPptxFile(file, (image, slideNumber, totalSlides) => {
              slideCount = totalSlides
              appendImages([image], file.name, { id: presentationId, firstSlideIndex: slideNumber - 1 })
              setStatus(`Importing presentation: ${slideNumber}/${totalSlides}`)
            })
            const presentation: BoardPresentation = {
              id: presentationId,
              name: file.name,
              kind: 'pptx',
              src: presentationSrc,
              slideCount,
            }
            setProject((previous) => ({
              ...previous,
              presentations: [...(previous.presentations ?? []), presentation],
              updatedAt: Date.now(),
            }))
          } else if (isOdpFile(file)) {
            appendImages(await readOdpFile(file), file.name)
            setStatus(`Imported ODP: ${importedCount} pages`)
          } else if (isDocxFile(file)) {
            await readDocxFile(file, (image, pageNumber, totalPages) => {
              appendImages([image], file.name)
              setStatus(`Importing DOCX: ${pageNumber}/${totalPages}`)
            })
            setStatus(`Imported DOCX: ${importedCount} pages`)
          } else if (isSpreadsheetFile(file)) {
            await readSpreadsheetFile(file, (image, pageNumber, totalPages, sheetName) => {
              appendImages([image], file.name)
              setStatus(`Importing spreadsheet ${sheetName}: ${pageNumber}/${totalPages}`)
            })
            setStatus(`Imported spreadsheet: ${importedCount} pages`)
          } else if (isSvgFile(file)) {
            appendImages([await readSvgFile(file)], file.name)
            setStatus(`Imported SVG: ${importedCount} pages`)
          } else if (isTextLikeFile(file)) {
            await readTextLikeFile(file, (image, pageNumber, totalPages) => {
              appendImages([image], file.name)
              setStatus(`Importing text: ${pageNumber}/${totalPages}`)
            })
            setStatus(`Imported text: ${importedCount} pages`)
          } else if (isLegacyOfficeFile(file)) {
            const webview = (window as Window & { chrome?: { webview?: { postMessage: (message: string) => void } } }).chrome?.webview
            if (webview?.postMessage) {
              const content = await readFileAsDataUrl(file)
              webview.postMessage(
                JSON.stringify({
                  type: 'convert-office-file',
                  fileName: file.name,
                  content,
                  preserveCurrentPages: Boolean(options.preserveCurrentPages),
                }),
              )
              requestedLegacyOfficeConversionCount += 1
              setStatus(`Converting ${file.name} to ${legacyOfficeTargetExtension(file)}...`)
            } else {
              skippedLegacyOfficeCount += 1
              setStatus('Legacy Office files need PPTX/DOCX/XLSX conversion first; desktop mode can auto-convert with LibreOffice installed')
            }
          } else {
            appendImages([await readImageFile(file)], file.name)
            setStatus(`Imported ${importedCount} pages`)
          }
        } catch (error) {
          failedImportCount += 1
          console.warn(`Import failed for ${file.name}`, error)
          setStatus(`Skipped unreadable file: ${file.name}`)
        } finally {
          await yieldToBrowser()
        }
      }

      const result: ImportResult = {
        supportedFiles: supportedFiles.length,
        importedPages: importedCount,
        requestedLegacyOfficeConversions: requestedLegacyOfficeConversionCount,
        skippedLegacyOfficeFiles: skippedLegacyOfficeCount,
        failedFiles: failedImportCount,
      }
      setStatus(statusForImportResult(result))
      window.setTimeout(fitPage, 100)
      return result
    },
    [fitPage, recordProjectHistory, setProject, setStatus],
  )

  const exportProject = useCallback(async () => {
    const { exportProjectJson } = await import('./exporters')
    exportProjectJson(project)
    setMorePanelOpen(false)
    setStatus('Whiteboard note exported')
  }, [project, setMorePanelOpen, setStatus])

  const saveNow = useCallback(async () => {
    setStatus('Saving...')
    const webview = (
      window as Window & {
        chrome?: { webview?: { postMessage: (message: string) => void } }
      }
    ).chrome?.webview

    if (webview) {
      try {
        webview.postMessage(
          JSON.stringify({
            type: 'save-note-file',
            fileName: noteFileName(),
            content: serializeNoteFile(project),
          }),
        )
        setMorePanelOpen(false)
        setStatus('Saving whiteboard note...')
      } catch {
        setStatus('Save failed')
      }
      return
    }

    try {
      const nextProject = { ...project, updatedAt: Date.now() }
      await saveProject(nextProject)
      setMorePanelOpen(false)
      setStatus(`Saved ${new Date(nextProject.updatedAt).toLocaleTimeString('en-US', { hour12: false })}`)
    } catch {
      setStatus('Save failed')
    }
  }, [project, setMorePanelOpen, setStatus])

  const resetCurrentView = useCallback(() => {
    fitPage()
    setMorePanelOpen(false)
    setStatus('View reset')
  }, [fitPage, setMorePanelOpen, setStatus])

  const importProject = useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const parsed = parseNoteFileText(String(reader.result))
          const parsedBook = getBuiltInBook(parsed.bookId || currentBook.id)
          setPast([])
          setFuture([])
          setSelectedBookId(parsedBook.id)
          localStorage.setItem(SELECTED_BOOK_KEY, parsedBook.id)
          setProject({ ...parsed, bookId: parsedBook.id, updatedAt: Date.now() })
          setProjectReady(true)
          closePanels()
          setStatus('Project imported')
        } catch {
          setStatus('Project file format is invalid')
        }
      }
      reader.readAsText(file)
    },
    [
      closePanels,
      currentBook.id,
      setFuture,
      setPast,
      setProject,
      setProjectReady,
      setSelectedBookId,
      setStatus,
    ],
  )

  const exportCurrentPng = useCallback(async () => {
    setStatus('Exporting PNG...')
    const { exportPagePng } = await import('./exporters')
    const exported = await exportPagePng(currentPage)
    setStatus(exported ? 'PNG exported' : 'PNG export failed')
  }, [currentPage, setStatus])

  const exportAllPdf = useCallback(async () => {
    setStatus('Exporting PDF...')
    const { exportProjectPdf } = await import('./exporters')
    await exportProjectPdf(project)
    setStatus(`Exported ${project.pages.length} pages to PDF`)
  }, [project, setStatus])

  const sendHostCommand = useCallback(
    (command: HostCommand) => {
      const webview = (window as Window & { chrome?: { webview?: { postMessage: (message: string) => void } } }).chrome?.webview
      if (webview) {
        webview.postMessage(command)
        return
      }
      if (command === 'close') {
        window.close()
        setStatus('Close the browser tab to exit in browser mode')
        return
      }
      setStatus('Minimize is only available in the desktop app')
    },
    [setStatus],
  )

  const clearCurrentPage = useCallback(() => {
    updateCurrentPage((page) => ({ ...page, strokes: [], texts: [] }), true)
    setSelectedStrokeId(null)
    setSelectedTextId(null)
    clearLiveInkCanvas()
    resetStrokeInput()
    setStatus('Current page annotations cleared')
  }, [clearLiveInkCanvas, resetStrokeInput, setSelectedStrokeId, setSelectedTextId, setStatus, updateCurrentPage])

  const selectBuiltInBook = useCallback(
    (bookId: string) => {
      const nextBook = getBuiltInBook(bookId)
      if (nextBook.id === selectedBookId) {
        setBookPickerOpen(false)
        setStatus(`Current book: ${nextBook.shortTitle}`)
        return
      }
      void saveProject(project).catch(() => undefined)
      localStorage.setItem(SELECTED_BOOK_KEY, nextBook.id)
      setProjectReady(false)
      setProject(initialProject(nextBook.id))
      setSelectedBookId(nextBook.id)
      closePanels()
      setSelectedStrokeId(null)
      setSelectedTextId(null)
      setPast([])
      setFuture([])
      clearLiveInkCanvas()
      resetStrokeInput()
      setStatus(`Opening ${nextBook.shortTitle}...`)
    },
    [
      clearLiveInkCanvas,
      closePanels,
      project,
      resetStrokeInput,
      selectedBookId,
      setBookPickerOpen,
      setFuture,
      setPast,
      setProject,
      setProjectReady,
      setSelectedBookId,
      setSelectedStrokeId,
      setSelectedTextId,
      setStatus,
    ],
  )

  return {
    addBlankPage,
    importFiles,
    exportProject,
    saveNow,
    resetCurrentView,
    importProject,
    exportCurrentPng,
    exportAllPdf,
    sendHostCommand,
    clearCurrentPage,
    selectBuiltInBook,
  }
}

export { useProjectActions }
