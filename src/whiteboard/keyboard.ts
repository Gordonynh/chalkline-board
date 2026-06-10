import { useEffect } from 'react'
import { isEditableKeyboardTarget, toolLabels, toolShortcuts } from './core'
import type { Tool } from './core'

interface UseWhiteboardKeyboardOptions {
  pageCount: number
  selectedStrokeId: string | null
  selectedTextId: string | null
  setSpacePressed: (pressed: boolean) => void
  closePanelsAndSelection: () => void
  openPageJump: () => void
  switchPage: (offset: number) => void
  goToPageIndex: (targetIndex: number, message?: string) => void
  chooseTool: (tool: Tool) => void
  setStatus: (status: string) => void
  undo: () => void
  redo: () => void
  saveNow: () => Promise<void>
  deleteSelectedStroke: () => void
}

function useWhiteboardKeyboard({
  pageCount,
  selectedStrokeId,
  selectedTextId,
  setSpacePressed,
  closePanelsAndSelection,
  openPageJump,
  switchPage,
  goToPageIndex,
  chooseTool,
  setStatus,
  undo,
  redo,
  saveNow,
  deleteSelectedStroke,
}: UseWhiteboardKeyboardOptions) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editableTarget = isEditableKeyboardTarget(event.target)
      if (event.code === 'Space') {
        event.preventDefault()
        setSpacePressed(true)
      }
      if (!editableTarget && event.key === 'Escape') {
        closePanelsAndSelection()
        return
      }
      if (!editableTarget && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        openPageJump()
        return
      }
      if (!editableTarget && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
          event.preventDefault()
          switchPage(-1)
          return
        }
        if (event.key === 'ArrowRight' || event.key === 'PageDown') {
          event.preventDefault()
          switchPage(1)
          return
        }
        if (event.key === 'Home') {
          event.preventDefault()
          goToPageIndex(0, '已回到第 1 页')
          return
        }
        if (event.key === 'End') {
          event.preventDefault()
          goToPageIndex(pageCount - 1, `已到达第 ${pageCount} 页`)
          return
        }
      }
      if (!editableTarget && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const shortcutTool = toolShortcuts[event.key.toLowerCase()]
        if (shortcutTool) {
          event.preventDefault()
          chooseTool(shortcutTool)
          setStatus(`已切换到${toolLabels[shortcutTool]}`)
          return
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undo()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveNow()
      }
      if (!editableTarget && (event.key === 'Delete' || event.key === 'Backspace') && (selectedStrokeId || selectedTextId)) {
        event.preventDefault()
        deleteSelectedStroke()
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePressed(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  })
}

export { useWhiteboardKeyboard }
