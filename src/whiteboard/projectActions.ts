import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { getBuiltInBook } from '../books'
import type { BuiltInBook } from '../books'
import { SELECTED_BOOK_KEY, initialProject, makeId, saveProject } from './core'
import type { BoardImage, BoardPage, BoardProject, HostCommand } from './core'
import { noteFileName, parseNoteFileText, serializeNoteFile } from './noteFormat'

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
      name: `空白页 ${project.pages.length + 1}`,
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
    async (files: FileList | File[]) => {
      const supportedFiles = Array.from(files).filter((file) => file.type.startsWith('image/') || file.type === 'application/pdf')
      if (!supportedFiles.length) return
      setStatus('正在导入文件...')
      recordProjectHistory()

      let importedCount = 0
      let firstImportedId = ''
      const appendImages = (images: BoardImage[]) => {
        if (!images.length) return
        const pages = images.map<BoardPage>((image) => {
          const page: BoardPage = {
            id: makeId(),
            name: image.name || `讲义页 ${importedCount + 1}`,
            image,
            strokes: [],
            view: { x: 0, y: 0, scale: 1 },
          }
          importedCount += 1
          firstImportedId ||= page.id
          return page
        })
        setProject((previous) => {
          const shouldReplaceEmptyPage =
            previous.pages.length === 1 && !previous.pages[0].image && !previous.pages[0].strokes.length
          return {
            ...previous,
            pages: shouldReplaceEmptyPage ? pages : [...previous.pages, ...pages],
            currentPageId: firstImportedId || previous.currentPageId,
            updatedAt: Date.now(),
          }
        })
      }

      const { readImageFile, readPdfFile } = await import('./importers')
      for (const file of supportedFiles) {
        if (file.type === 'application/pdf') {
          await readPdfFile(file, (image, pageNumber, totalPages) => {
            appendImages([image])
            setStatus(`正在导入 PDF：${pageNumber}/${totalPages}`)
          })
        } else {
          appendImages([await readImageFile(file)])
          setStatus(`已导入 ${importedCount} 页`)
        }
      }

      setStatus(`已导入 ${importedCount} 页`)
      window.setTimeout(fitPage, 100)
    },
    [fitPage, recordProjectHistory, setProject, setStatus],
  )

  const exportProject = useCallback(async () => {
    const { exportProjectJson } = await import('./exporters')
    exportProjectJson(project)
    setMorePanelOpen(false)
    setStatus('已导出白板笔记')
  }, [project, setMorePanelOpen, setStatus])

  const saveNow = useCallback(async () => {
    setStatus('正在保存...')
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
        setStatus('正在保存白板笔记...')
      } catch {
        setStatus('保存失败')
      }
      return
    }

    try {
      const nextProject = { ...project, updatedAt: Date.now() }
      await saveProject(nextProject)
      setMorePanelOpen(false)
      setStatus(`已保存 ${new Date(nextProject.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}`)
    } catch {
      setStatus('保存失败')
    }
  }, [project, setMorePanelOpen, setStatus])

  const resetCurrentView = useCallback(() => {
    fitPage()
    setMorePanelOpen(false)
    setStatus('已重置视图')
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
          setStatus('已导入项目')
        } catch {
          setStatus('项目文件格式不正确')
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
        setStatus('浏览器模式请直接关闭标签页')
        return
      }
      setStatus('最小化仅在桌面版可用')
    },
    [setStatus],
  )

  const clearCurrentPage = useCallback(() => {
    updateCurrentPage((page) => ({ ...page, strokes: [], texts: [] }), true)
    setSelectedStrokeId(null)
    setSelectedTextId(null)
    clearLiveInkCanvas()
    resetStrokeInput()
    setStatus('已清空当前页批注')
  }, [clearLiveInkCanvas, resetStrokeInput, setSelectedStrokeId, setSelectedTextId, setStatus, updateCurrentPage])

  const selectBuiltInBook = useCallback(
    (bookId: string) => {
      const nextBook = getBuiltInBook(bookId)
      if (nextBook.id === selectedBookId) {
        setBookPickerOpen(false)
        setStatus(`当前书籍：${nextBook.shortTitle}`)
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
      setStatus(`正在打开 ${nextBook.shortTitle}...`)
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
