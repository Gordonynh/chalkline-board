import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { sourcePageForBoardPage, sourcePageLabel } from './core'
import type { BoardPage, BoardProject } from './core'

interface UseWhiteboardNavigationOptions {
  project: BoardProject
  currentPage: BoardPage
  pageIndex: number
  pageJumpValue: string
  setProject: Dispatch<SetStateAction<BoardProject>>
  setStatus: (status: string) => void
  setPageJumpValue: (value: string) => void
  setPageJumpOpen: (open: boolean | ((open: boolean) => boolean)) => void
  setSettingsOpen: (open: boolean) => void
  setExportPanelOpen: (open: boolean) => void
  setMorePanelOpen: (open: boolean) => void
  setBookPickerOpen: (open: boolean) => void
  setTocOpen: (open: boolean) => void
}

function useWhiteboardNavigation({
  project,
  currentPage,
  pageIndex,
  pageJumpValue,
  setProject,
  setStatus,
  setPageJumpValue,
  setPageJumpOpen,
  setSettingsOpen,
  setExportPanelOpen,
  setMorePanelOpen,
  setBookPickerOpen,
  setTocOpen,
}: UseWhiteboardNavigationOptions) {
  const closeTransientPanels = useCallback(() => {
    setSettingsOpen(false)
    setExportPanelOpen(false)
    setMorePanelOpen(false)
    setBookPickerOpen(false)
    setTocOpen(false)
  }, [setBookPickerOpen, setExportPanelOpen, setMorePanelOpen, setSettingsOpen, setTocOpen])

  const openPageJump = useCallback(() => {
    setPageJumpValue(String(pageIndex + 1))
    setPageJumpOpen((open) => !open)
    closeTransientPanels()
  }, [closeTransientPanels, pageIndex, setPageJumpOpen, setPageJumpValue])

  const goToPageIndex = useCallback(
    (targetIndex: number, message?: string) => {
      const boundedIndex = Math.max(0, Math.min(project.pages.length - 1, targetIndex))
      const target = project.pages[boundedIndex]
      if (!target) return
      setPageJumpValue(String(boundedIndex + 1))
      setPageJumpOpen(false)
      closeTransientPanels()
      if (message) setStatus(message)
      if (target.id === currentPage.id) return
      setProject((previous) => ({ ...previous, currentPageId: target.id, updatedAt: Date.now() }))
    },
    [closeTransientPanels, currentPage.id, project.pages, setPageJumpOpen, setPageJumpValue, setProject, setStatus],
  )

  const switchPage = useCallback(
    (offset: number) => {
      const targetIndex = pageIndex + offset
      if (targetIndex < 0 || targetIndex >= project.pages.length) return
      goToPageIndex(targetIndex, `已切换到第 ${targetIndex + 1} 页`)
    },
    [goToPageIndex, pageIndex, project.pages.length],
  )

  const jumpToPageNumber = useCallback(
    (value = pageJumpValue) => {
      const pageNumber = Number.parseInt(value, 10)
      if (!Number.isFinite(pageNumber)) {
        setStatus('请输入有效页码')
        return
      }
      const targetIndex = Math.max(0, Math.min(project.pages.length - 1, pageNumber - 1))
      goToPageIndex(targetIndex, `已跳转到第 ${targetIndex + 1} 页`)
    },
    [goToPageIndex, pageJumpValue, project.pages.length, setStatus],
  )

  const jumpToSourcePage = useCallback(
    (sourcePage: number, title: string) => {
      const directIndex = project.pages.findIndex((page) => sourcePageForBoardPage(page) === sourcePage)
      const numberedPages = project.pages
        .map((page, index) => ({ index, sourcePage: sourcePageForBoardPage(page) }))
        .filter((item): item is { index: number; sourcePage: number } => item.sourcePage !== undefined)
        .sort((a, b) => a.index - b.index)
      const firstNumberedPage = numberedPages[0]
      const inferredIndex =
        directIndex >= 0 || !firstNumberedPage ? -1 : firstNumberedPage.index + sourcePage - firstNumberedPage.sourcePage
      const targetIndex =
        directIndex >= 0
          ? directIndex
          : inferredIndex >= 0 && inferredIndex < project.pages.length
            ? inferredIndex
            : sourcePage - 1 >= 0 && sourcePage - 1 < project.pages.length
              ? sourcePage - 1
              : -1
      const target = project.pages[targetIndex]
      if (!target) {
        setStatus(`未找到 ${sourcePageLabel(sourcePage)} 页，请先导入整套讲义图片`)
        return
      }

      setProject((previous) => ({ ...previous, currentPageId: target.id, updatedAt: Date.now() }))
      setPageJumpOpen(false)
      closeTransientPanels()
      setStatus(`已跳转：${title}（${sourcePageLabel(sourcePage)}）`)
    },
    [closeTransientPanels, project.pages, setPageJumpOpen, setProject, setStatus],
  )

  return {
    closeTransientPanels,
    openPageJump,
    goToPageIndex,
    switchPage,
    jumpToPageNumber,
    jumpToSourcePage,
  }
}

export { useWhiteboardNavigation }
