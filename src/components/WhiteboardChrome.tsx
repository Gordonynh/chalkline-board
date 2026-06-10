import { ArrowLeft, ArrowRight, BookOpen, Clock3, Crosshair, Eraser, FilePlus, Hand, ImagePlus, ListTree, Menu, Minimize2, MoreHorizontal, MousePointer2, PenLine, Undo2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { ToolButton } from './ToolButton'
import type { Tool } from '../whiteboard/core'
import type { BuiltInBook } from '../books'
import type { UiText } from '../i18n'

interface BottomToolbarProps {
  labels: UiText
  tool: Tool
  strokeColor: string
  quickColors: readonly string[]
  pastCount: number
  clockPanelOpen: boolean
  morePanelOpen: boolean
  bookPickerEnabled: boolean
  tocEnabled: boolean
  bookPickerOpen: boolean
  tocOpen: boolean
  onChooseTool: (tool: Tool) => void
  onStrokeColorChange: (color: string) => void
  onUndo: () => void
  onOpenBookPicker: () => void
  onOpenToc: () => void
  onToggleClock: () => void
  onToggleMore: () => void
}

function BottomToolbar({
  labels,
  tool,
  strokeColor,
  quickColors,
  pastCount,
  clockPanelOpen,
  morePanelOpen,
  bookPickerEnabled,
  tocEnabled,
  bookPickerOpen,
  tocOpen,
  onChooseTool,
  onStrokeColorChange,
  onUndo,
  onOpenBookPicker,
  onOpenToc,
  onToggleClock,
  onToggleMore,
}: BottomToolbarProps) {
  const quickColorsVisible = tool === 'pen'
  return (
    <nav className={`teaching-toolbar hite-bottom-toolbar ${quickColorsVisible ? 'has-quick-colors' : ''}`} aria-label={labels.toolbar.aria}>
      {quickColorsVisible && (
        <div className="quick-color-picker is-visible" aria-label="Quick pen colors">
          {quickColors.map((color) => (
            <button
              key={color}
              type="button"
              className={strokeColor.toLowerCase() === color.toLowerCase() ? 'selected' : ''}
              style={{ backgroundColor: color }}
              onClick={() => onStrokeColorChange(color)}
              aria-label={`Color ${color}`}
            />
          ))}
        </div>
      )}
      <ToolButton active={tool === 'select'} label={labels.toolbar.select} icon={<MousePointer2 className="hite-toolbar-svg" />} onClick={() => onChooseTool('select')} />
      <ToolButton active={tool === 'pen'} label={labels.toolbar.pen} icon={<PenLine className="hite-toolbar-svg" />} onClick={() => onChooseTool('pen')} />
      <ToolButton active={tool === 'eraser'} label={labels.toolbar.eraser} icon={<Eraser className="hite-toolbar-svg" />} onClick={() => onChooseTool('eraser')} />
      <ToolButton active={tool === 'laser'} label="Laser" icon={<Crosshair className="hite-toolbar-svg" />} onClick={() => onChooseTool('laser')} />
      <ToolButton active={tool === 'pan'} label={labels.toolbar.pan} icon={<Hand className="hite-toolbar-svg" />} onClick={() => onChooseTool('pan')} />
      <ToolButton disabled={!pastCount} label={labels.toolbar.undo} icon={<Undo2 className="hite-toolbar-svg" />} onClick={onUndo} />
      {bookPickerEnabled && <ToolButton active={bookPickerOpen} label={labels.toolbar.books} icon={<BookOpen className="hite-toolbar-svg" />} onClick={onOpenBookPicker} />}
      {tocEnabled && <ToolButton active={tocOpen} label={labels.toolbar.toc} icon={<ListTree className="hite-toolbar-svg" />} onClick={onOpenToc} />}
      <ToolButton active={clockPanelOpen} label={labels.toolbar.clock} icon={<Clock3 className="hite-toolbar-svg" />} onClick={onToggleClock} />
      <ToolButton active={morePanelOpen} label={labels.toolbar.more} icon={<MoreHorizontal className="hite-toolbar-svg" />} onClick={onToggleMore} />
    </nav>
  )
}

interface LeftCornerControlsProps {
  labels: UiText
  importsEnabled: boolean
  onImport: () => void
  onClose: () => void
  onMinimize: () => void
}

function LeftCornerControls({ labels, importsEnabled, onImport, onClose, onMinimize }: LeftCornerControlsProps) {
  return (
    <div className="corner-controls left">
      {importsEnabled && (
        <button type="button" title={labels.corner.importTitle} onClick={onImport}>
          <ImagePlus size={20} />
          <span>{labels.corner.import}</span>
        </button>
      )}
      <button type="button" title={labels.corner.close} onClick={onClose}>
        <X size={20} />
        <span>{labels.corner.close}</span>
      </button>
      <button type="button" title={labels.corner.minimize} onClick={onMinimize}>
        <Minimize2 size={20} />
        <span>{labels.corner.minimize}</span>
      </button>
    </div>
  )
}

interface RightCornerControlsProps {
  labels: UiText
  pageIndex: number
  pageCount: number
  onAddPage: () => void
  onPreviousPage: () => void
  onNextPage: () => void
  onOpenPageJump: () => void
}

function RightCornerControls({
  labels,
  pageIndex,
  pageCount,
  onAddPage,
  onPreviousPage,
  onNextPage,
  onOpenPageJump,
}: RightCornerControlsProps) {
  return (
    <div className="corner-controls right">
      <button type="button" title={labels.corner.newPageTitle} onClick={onAddPage}>
        <FilePlus size={20} />
        <span>{labels.corner.newPage}</span>
      </button>
      <button type="button" title={labels.corner.previousPage} disabled={pageIndex <= 0} onClick={onPreviousPage}>
        <ArrowLeft size={20} />
        <span>{labels.corner.previousPage}</span>
      </button>
      <button type="button" className="page-count page-count-button" title={labels.corner.jumpPage} onClick={onOpenPageJump}>
        {pageIndex + 1}/{pageCount}
      </button>
      <button type="button" title={labels.corner.nextPage} disabled={pageIndex >= pageCount - 1} onClick={onNextPage}>
        <ArrowRight size={20} />
        <span>{labels.corner.nextPage}</span>
      </button>
    </div>
  )
}

interface StatusBarProps {
  labels: UiText
  bookTitle: string
  pageName: string
  status: ReactNode
  onOpenPageJump: () => void
}

interface BookPickerProps {
  labels: UiText
  books: BuiltInBook[]
  currentBookId: string
  onClose: () => void
  onSelectBook: (bookId: string) => void
}

function BookPicker({ labels, books, currentBookId, onClose, onSelectBook }: BookPickerProps) {
  return (
    <section className="book-picker" aria-label={labels.bookPicker.aria}>
      <header>
        <div>
          <span>{labels.bookPicker.title}</span>
          <small>{labels.bookPicker.subtitle}</small>
        </div>
        <button type="button" title={labels.bookPicker.close} onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="book-grid">
        {books.map((book) => {
          const active = book.id === currentBookId
          return (
            <button key={book.id} type="button" className={`book-card ${active ? 'active' : ''}`} onClick={() => onSelectBook(book.id)}>
              <span className="book-cover">{book.coverSrc && <img src={book.coverSrc} alt="" loading="lazy" decoding="async" />}</span>
              <span className="book-meta">
                <strong>{book.shortTitle}</strong>
                <span>{book.title}</span>
                <small>{book.subtitle}</small>
                <em>{active ? labels.bookPicker.current : labels.bookPicker.open}</em>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

interface ClockPanelProps {
  labels: UiText
  now: Date
  onClose: () => void
}

const TIMER_LABEL = '\u5012\u8ba1\u65f6'
const STOPWATCH_LABEL = '\u79d2\u8868'
const CLOSE_CLOCK_LABEL = '\u5173\u95ed\u65f6\u949f'
const RESET_LABEL = '\u91cd\u7f6e'
const START_LABEL = '\u5f00\u59cb'
const PAUSE_LABEL = '\u6682\u505c'
const RESUME_LABEL = '\u7ee7\u7eed'
const TIMER_DONE_LABEL = '\u65f6\u95f4\u5230'
const MAX_TIMER_SECONDS = 23 * 3600 + 59 * 60 + 59
const twoDigits = (value: number) => value.toString().padStart(2, '0')
const clampTimerSeconds = (seconds: number) => Math.max(0, Math.min(MAX_TIMER_SECONDS, seconds))
const secondsFromMs = (ms: number) => Math.max(0, Math.ceil(ms / 1000))
const splitDuration = (totalSeconds: number) => {
  const seconds = clampTimerSeconds(totalSeconds)
  return {
    hours: Math.floor(seconds / 3600),
    minutes: Math.floor(seconds / 60) % 60,
    seconds: seconds % 60,
  }
}
const splitClockTime = (date: Date) => ({
  hours: date.getHours(),
  minutes: date.getMinutes(),
  seconds: date.getSeconds(),
})
const formatClockTime = (date: Date) => {
  const parts = splitClockTime(date)
  return `${twoDigits(parts.hours)}:${twoDigits(parts.minutes)}:${twoDigits(parts.seconds)}`
}
const clockPanelSize = { width: 600, height: 480 }
const clockPanelMargin = 12
const clampClockPanelPosition = (left: number, top: number) => ({
  left: Math.max(clockPanelMargin, Math.min(window.innerWidth - clockPanelMargin - Math.min(clockPanelSize.width, window.innerWidth - 44), left)),
  top: Math.max(clockPanelMargin, Math.min(window.innerHeight - clockPanelMargin - Math.min(clockPanelSize.height, window.innerHeight - 96), top)),
})
const wrapWheelValue = (value: number, maxExclusive: number) => (value + maxExclusive) % maxExclusive
const valueToTimerSeconds = (unit: 'hours' | 'minutes' | 'seconds', value: number, current: number) => {
  const parts = splitDuration(current)
  const next = { ...parts, [unit]: value }
  return next.hours * 3600 + next.minutes * 60 + next.seconds
}

interface ClockWheelProps {
  parts: { hours: number; minutes: number; seconds: number }
  disabled?: boolean
  onAdjust?: (unit: 'hours' | 'minutes' | 'seconds', delta: number) => void
}

function ClockWheel({ parts, disabled = true, onAdjust }: ClockWheelProps) {
  const columns = [
    { unit: 'hours' as const, value: parts.hours, max: 24 },
    { unit: 'minutes' as const, value: parts.minutes, max: 60 },
    { unit: 'seconds' as const, value: parts.seconds, max: 60 },
  ]
  return (
    <div className="clock-wheel" aria-live="polite">
      {columns.map((column, index) => {
        const previous = twoDigits(wrapWheelValue(column.value - 1, column.max))
        const current = twoDigits(column.value)
        const next = twoDigits(wrapWheelValue(column.value + 1, column.max))
        return (
          <div className="clock-wheel-column" key={column.unit}>
            <button
              type="button"
              className="clock-wheel-side"
              disabled={disabled}
              onClick={() => onAdjust?.(column.unit, -1)}
              aria-label={`${column.unit}-down`}
            >
              {previous}
            </button>
            <div className="clock-wheel-main">
              <span>{current}</span>
              {index < columns.length - 1 && <em>:</em>}
            </div>
            <button
              type="button"
              className="clock-wheel-side"
              disabled={disabled}
              onClick={() => onAdjust?.(column.unit, 1)}
              aria-label={`${column.unit}-up`}
            >
              {next}
            </button>
          </div>
        )
      })}
    </div>
  )
}

function ClockPanel({ labels, now, onClose }: ClockPanelProps) {
  const [mode, setMode] = useState<'clock' | 'timer' | 'stopwatch'>('clock')
  const [nowMs, setNowMs] = useState(() => now.getTime())
  const [timerSeconds, setTimerSeconds] = useState(60)
  const [timerDeadline, setTimerDeadline] = useState<number | null>(null)
  const [timerDone, setTimerDone] = useState(false)
  const [stopwatchBaseMs, setStopwatchBaseMs] = useState(0)
  const [stopwatchStartedAt, setStopwatchStartedAt] = useState<number | null>(null)
  const timerDeadlineRef = useRef<number | null>(null)
  const [panelPosition, setPanelPosition] = useState(() =>
    clampClockPanelPosition((window.innerWidth - clockPanelSize.width) / 2, (window.innerHeight - clockPanelSize.height) / 2 - 20),
  )
  const panelPositionFrame = useRef<number | null>(null)
  const pendingPanelPosition = useRef(panelPosition)

  useEffect(() => {
    const onResize = () => setPanelPosition((position) => clampClockPanelPosition(position.left, position.top))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    pendingPanelPosition.current = panelPosition
  }, [panelPosition])

  useEffect(() => {
    timerDeadlineRef.current = timerDeadline
  }, [timerDeadline])

  useEffect(
    () => () => {
      if (panelPositionFrame.current !== null) window.cancelAnimationFrame(panelPositionFrame.current)
    },
    [],
  )

  useEffect(() => {
    const id = window.setInterval(() => {
      const nextNow = Date.now()
      setNowMs(nextNow)
      const deadline = timerDeadlineRef.current
      if (deadline !== null && nextNow >= deadline) {
        timerDeadlineRef.current = null
        setTimerDeadline(null)
        setTimerSeconds(0)
        setTimerDone(true)
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [])

  const timerRunning = timerDeadline !== null
  const stopwatchRunning = stopwatchStartedAt !== null
  const running = mode === 'timer' ? timerRunning : mode === 'stopwatch' ? stopwatchRunning : false
  const currentTime = new Date(nowMs)
  const timerRemaining = timerDeadline === null ? timerSeconds : secondsFromMs(timerDeadline - nowMs)
  const stopwatchElapsed = stopwatchBaseMs + (stopwatchStartedAt === null ? 0 : nowMs - stopwatchStartedAt)
  const primaryDisabled = mode === 'clock' || (mode === 'timer' && !timerRunning && timerSeconds <= 0)
  const primaryText = running ? '\u23f8' : mode === 'stopwatch' && stopwatchBaseMs > 0 ? RESUME_LABEL : '\u25b6'
  const wheelParts = mode === 'clock'
    ? splitClockTime(currentTime)
    : mode === 'timer'
      ? splitDuration(timerRemaining)
      : splitDuration(Math.floor(stopwatchElapsed / 1000))

  const pauseTimer = () => {
    if (timerDeadline === null) return
    setTimerSeconds(secondsFromMs(timerDeadline - Date.now()))
    setTimerDeadline(null)
  }

  const pauseStopwatch = () => {
    if (stopwatchStartedAt === null) return
    setStopwatchBaseMs((elapsed) => elapsed + Date.now() - stopwatchStartedAt)
    setStopwatchStartedAt(null)
  }

  const setClockMode = (nextMode: 'clock' | 'timer' | 'stopwatch') => {
    pauseTimer()
    pauseStopwatch()
    setMode(nextMode)
  }

  const adjustTimer = (deltaSeconds: number) => {
    if (mode !== 'timer' || timerRunning) return
    setTimerDeadline(null)
    setTimerDone(false)
    setTimerSeconds((seconds) => clampTimerSeconds(seconds + deltaSeconds))
  }

  const adjustTimerUnit = (unit: 'hours' | 'minutes' | 'seconds', delta: number) => {
    if (mode !== 'timer' || timerRunning) return
    setTimerDone(false)
    setTimerDeadline(null)
    const max = unit === 'hours' ? 24 : 60
    setTimerSeconds((seconds) => {
      const parts = splitDuration(seconds)
      const nextValue = wrapWheelValue(parts[unit] + delta, max)
      return valueToTimerSeconds(unit, nextValue, seconds)
    })
  }

  const toggleRunning = () => {
    if (mode === 'clock') return
    if (mode === 'timer') {
      if (timerRunning) {
        pauseTimer()
        return
      }
      if (timerSeconds <= 0) return
      setTimerDone(false)
      setTimerDeadline(Date.now() + timerSeconds * 1000)
      return
    }
    if (stopwatchRunning) {
      pauseStopwatch()
      return
    }
    setStopwatchStartedAt(Date.now())
  }

  const reset = () => {
    pauseTimer()
    pauseStopwatch()
    if (mode === 'timer') {
      setTimerDeadline(null)
      setTimerSeconds(60)
      setTimerDone(false)
    }
    if (mode === 'stopwatch') {
      setStopwatchStartedAt(null)
      setStopwatchBaseMs(0)
    }
  }

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const startX = event.clientX
    const startY = event.clientY
    const startPosition = panelPosition
    const applyPosition = (position: { left: number; top: number }) => {
      pendingPanelPosition.current = position
      if (panelPositionFrame.current !== null) return
      panelPositionFrame.current = window.requestAnimationFrame(() => {
        panelPositionFrame.current = null
        setPanelPosition(pendingPanelPosition.current)
      })
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent) => {
      applyPosition(clampClockPanelPosition(startPosition.left + moveEvent.clientX - startX, startPosition.top + moveEvent.clientY - startY))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
  }

  return (
    <section
      className={`clock-panel clock-panel-${mode}`}
      aria-label={labels.toolbar.clock}
      role="dialog"
      aria-modal="false"
      style={{ left: panelPosition.left, top: panelPosition.top }}
    >
      <header onPointerDown={beginDrag}>
        <span>{labels.toolbar.clock}</span>
        <div>
          <button type="button" aria-label={labels.corner.minimize} onClick={onClose}>□</button>
          <button type="button" aria-label={CLOSE_CLOCK_LABEL} onClick={onClose}>&times;</button>
        </div>
      </header>
      <div className="clock-tabs" role="tablist" aria-label={labels.toolbar.clock}>
        <button type="button" className={mode === 'clock' ? 'active' : ''} onClick={() => setClockMode('clock')}>{labels.toolbar.clock}</button>
        <button type="button" className={mode === 'timer' ? 'active' : ''} onClick={() => setClockMode('timer')}>{TIMER_LABEL}</button>
        <button type="button" className={mode === 'stopwatch' ? 'active' : ''} onClick={() => setClockMode('stopwatch')}>{STOPWATCH_LABEL}</button>
      </div>
      <div className={`clock-face ${timerDone ? 'is-done' : ''}`}>
        {mode === 'clock' && <div className="clock-pill-time">{formatClockTime(currentTime)}</div>}
        {mode !== 'clock' && <ClockWheel parts={wheelParts} disabled={mode !== 'timer' || timerRunning} onAdjust={adjustTimerUnit} />}
        {mode === 'timer' && timerDone && <span className="clock-status-text">{TIMER_DONE_LABEL}</span>}
        {mode === 'clock' && <span className="clock-status-text">{currentTime.toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' })}</span>}
        {mode === 'timer' && !timerRunning && <div className="clock-nudge-row">
          <button type="button" onClick={() => adjustTimer(-60)}>-1\u5206</button>
          <button type="button" onClick={() => adjustTimer(60)}>+1\u5206</button>
          <button type="button" onClick={() => adjustTimer(-5)}>-5\u79d2</button>
          <button type="button" onClick={() => adjustTimer(5)}>+5\u79d2</button>
        </div>}
      </div>
      <footer>
        <button type="button" aria-label={RESET_LABEL} onClick={reset}>{'\u21bb'}</button>
        <button type="button" aria-label={running ? PAUSE_LABEL : START_LABEL} disabled={primaryDisabled} onClick={toggleRunning}>
          {primaryText}
        </button>
      </footer>
    </section>
  )
}
function StatusBar({ labels, bookTitle, pageName, status, onOpenPageJump }: StatusBarProps) {
  return (
    <div className="status-bar">
      <Menu size={15} />
      <span>{bookTitle}</span>
      <button type="button" className="status-page-button" onClick={onOpenPageJump} title={labels.corner.jumpPage}>
        {pageName}
      </button>
      <span>{status}</span>
    </div>
  )
}

export { BookPicker, BottomToolbar, ClockPanel, LeftCornerControls, RightCornerControls, StatusBar }
