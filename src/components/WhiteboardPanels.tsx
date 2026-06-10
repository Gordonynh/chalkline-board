import { Download, Eraser, Expand, FileDown, Highlighter, Languages, Redo2, Save, Trash2, Upload, X } from 'lucide-react'
import type { BuiltInBook } from '../books'
import type { UiText } from '../i18n'
import { pantonePenColors, sourcePageLabel, standardPenColors } from '../whiteboard/core'
import type { Tool } from '../whiteboard/core'

interface ToolSettingsPanelProps {
  labels: UiText
  tool: Tool
  strokeColor: string
  strokeWidth: number
  highlightOpacity: number
  eraserRadius: number
  onStrokeColorChange: (color: string) => void
  onStrokeWidthChange: (width: number) => void
  onHighlightOpacityChange: (opacity: number) => void
  onEraserRadiusChange: (radius: number) => void
  onClearCurrentPage: () => void
}

interface ExportPanelProps {
  labels: UiText
  onExportCurrentPng: () => void
  onExportAllPdf: () => void
  onExportProject: () => void
}

interface MorePanelProps {
  labels: UiText
  onClose: () => void
  onSaveNow: () => void
  onImportProject: () => void
  onExportProject: () => void
  onChooseHighlighter: () => void
  onOpenExportPanel: () => void
  onToggleLanguage: () => void
  onRedo?: () => void
  redoDisabled?: boolean
  onResetCurrentView: () => void
  onClearCurrentPage: () => void
}

interface PageJumpPanelProps {
  labels: UiText
  pageJumpValue: string
  pageCount: number
  onClose: () => void
  onValueChange: (value: string) => void
  onJump: () => void
  onFitPage: () => void
}

interface TocPanelProps {
  labels: UiText
  currentBook: BuiltInBook
  currentSourcePage: number | undefined
  onClose: () => void
  onJumpToSourcePage: (page: number, title: string) => void
}

function ToolSettingsPanel({
  labels,
  tool,
  strokeColor,
  strokeWidth,
  highlightOpacity,
  eraserRadius,
  onStrokeColorChange,
  onStrokeWidthChange,
  onHighlightOpacityChange,
  onEraserRadiusChange,
  onClearCurrentPage,
}: ToolSettingsPanelProps) {
  const title = tool === 'eraser' ? labels.panels.eraser : tool === 'highlighter' ? labels.panels.highlighter : labels.panels.pen
  if (tool === 'eraser') {
    return (
      <section className="tool-popover eraser-popover" aria-label={labels.panels.eraser}>
        <EraserSettingsContent
          eraserLabel={labels.panels.eraser}
          clearInkLabel={labels.panels.clearCurrentPage}
          clearScreenLabel={labels.panels.clearScreen}
          eraserSizeLabel={labels.panels.eraserSize}
          eraserRadius={eraserRadius}
          onEraserRadiusChange={onEraserRadiusChange}
          onClearInk={onClearCurrentPage}
          onClearScreen={onClearCurrentPage}
        />
      </section>
    )
  }

  return (
    <section className="tool-popover pen-popover" aria-label={labels.panels.toolSettings}>
      <PenSettingsContent
        title={title}
        colorLabel={labels.panels.color}
        strokeWidthLabel={labels.panels.strokeWidth}
        highlightOpacityLabel={labels.panels.highlightOpacity}
        strokeColor={strokeColor}
        strokeWidth={strokeWidth}
        highlightOpacity={tool === 'highlighter' ? highlightOpacity : undefined}
        onStrokeColorChange={onStrokeColorChange}
        onStrokeWidthChange={onStrokeWidthChange}
        onHighlightOpacityChange={onHighlightOpacityChange}
      />
    </section>
  )
}

interface PenSettingsContentProps {
  title: string
  colorLabel: string
  strokeWidthLabel: string
  strokeColor: string
  strokeWidth: number
  highlightOpacityLabel?: string
  highlightOpacity?: number
  onStrokeColorChange: (color: string) => void
  onStrokeWidthChange: (width: number) => void
  onHighlightOpacityChange?: (opacity: number) => void
}

function PenSettingsContent({
  title,
  colorLabel,
  strokeWidthLabel,
  strokeColor,
  strokeWidth,
  highlightOpacityLabel,
  highlightOpacity,
  onStrokeColorChange,
  onStrokeWidthChange,
  onHighlightOpacityChange,
}: PenSettingsContentProps) {
  return (
    <>
      <header>{title}</header>
      <div className="pen-palette-body">
        <div className="color-grid" aria-label={colorLabel}>
          {[standardPenColors, pantonePenColors].map((row, rowIndex) => (
            <div key={rowIndex ? 'pantone' : 'standard'} className="color-grid-row">
              {row.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-swatch ${strokeColor.toLowerCase() === color.toLowerCase() ? 'selected' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => onStrokeColorChange(color)}
                  aria-label={`${colorLabel} ${color}`}
                />
              ))}
            </div>
          ))}
        </div>
        <label className="slider-row">
          <span>{strokeWidthLabel}</span>
          <input min="2" max="28" type="range" value={strokeWidth} onChange={(event) => onStrokeWidthChange(Number(event.target.value))} />
          <em>{strokeWidth}</em>
        </label>
        {highlightOpacity !== undefined && highlightOpacityLabel && onHighlightOpacityChange && (
          <label className="slider-row">
            <span>{highlightOpacityLabel}</span>
            <input
              min="15"
              max="70"
              type="range"
              value={Math.round(highlightOpacity * 100)}
              onChange={(event) => onHighlightOpacityChange(Number(event.target.value) / 100)}
            />
            <em>{Math.round(highlightOpacity * 100)}</em>
          </label>
        )}
      </div>
    </>
  )
}

interface EraserSettingsContentProps {
  eraserLabel: string
  clearInkLabel: string
  clearScreenLabel: string
  eraserSizeLabel: string
  eraserRadius: number
  onEraserRadiusChange: (radius: number) => void
  onClearInk: () => void
  onClearScreen: () => void
}

function EraserSettingsContent({
  eraserLabel,
  clearInkLabel,
  clearScreenLabel,
  eraserSizeLabel,
  eraserRadius,
  onEraserRadiusChange,
  onClearInk,
  onClearScreen,
}: EraserSettingsContentProps) {
  return (
    <>
      <div className="eraser-actions">
        <button type="button" className="palette-tool selected">
          <Eraser size={28} />
          <span>{eraserLabel}</span>
        </button>
        <button type="button" className="palette-tool" onClick={onClearInk}>
          <Eraser size={28} />
          <span>{clearInkLabel}</span>
        </button>
        <button type="button" className="palette-tool" onClick={onClearScreen}>
          <Trash2 size={28} />
          <span>{clearScreenLabel}</span>
        </button>
      </div>
      <div className="popover-separator" />
      <div className="eraser-size-row" aria-label={eraserSizeLabel}>
        {[18, 34, 54].map((size) => (
          <button
            key={size}
            type="button"
            className={`eraser-dot-button ${Math.abs(eraserRadius - size) <= 8 ? 'selected' : ''}`}
            onClick={() => onEraserRadiusChange(size)}
            aria-label={`${eraserSizeLabel} ${size}`}
          >
            <span style={{ width: Math.max(7, size / 3), height: Math.max(7, size / 3) }} />
          </button>
        ))}
      </div>
    </>
  )
}

function ExportPanel({ labels, onExportCurrentPng, onExportAllPdf, onExportProject }: ExportPanelProps) {
  return (
    <section className="side-panel export-panel" aria-label={labels.panels.exportSettings}>
      <header>
        <span>{labels.panels.export}</span>
      </header>
      <button type="button" className="panel-action" onClick={onExportCurrentPng}>
        <Download size={16} />
        {labels.panels.exportCurrentPng}
      </button>
      <button type="button" className="panel-action" onClick={onExportAllPdf}>
        <FileDown size={16} />
        {labels.panels.exportAllPdf}
      </button>
      <button type="button" className="panel-action" onClick={onExportProject}>
        <FileDown size={16} />
        {labels.panels.exportProjectJson}
      </button>
    </section>
  )
}

function MorePanel({
  labels,
  onClose,
  onSaveNow,
  onImportProject,
  onExportProject,
  onChooseHighlighter,
  onOpenExportPanel,
  onToggleLanguage,
  onRedo,
  redoDisabled,
  onResetCurrentView,
  onClearCurrentPage,
}: MorePanelProps) {
  return (
    <section className="side-panel more-panel" aria-label={labels.panels.moreActions}>
      <header>
        <span>{labels.toolbar.more}</span>
        <button type="button" title={labels.panels.closeMore} onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      {onRedo && (
        <button type="button" className="panel-action" disabled={redoDisabled} onClick={onRedo}>
          <Redo2 size={16} />
          {labels.panels.redo}
        </button>
      )}
      <button type="button" className="panel-action" onClick={onChooseHighlighter}>
        <Highlighter size={16} />
        {labels.panels.highlighter}
      </button>
      <button type="button" className="panel-action" onClick={onOpenExportPanel}>
        <FileDown size={16} />
        {labels.panels.export}
      </button>
      <button type="button" className="panel-action" onClick={onSaveNow}>
        <Save size={16} />
        {labels.panels.saveProgress}
      </button>
      <button type="button" className="panel-action" onClick={onToggleLanguage}>
        <Languages size={16} />
        {labels.panels.language}: {labels.switchLanguage}
      </button>
      <button type="button" className="panel-action" onClick={onImportProject}>
        <Upload size={16} />
        {labels.panels.importProjectJson}
      </button>
      <button type="button" className="panel-action" onClick={onExportProject}>
        <Download size={16} />
        {labels.panels.exportProjectJson}
      </button>
      <button type="button" className="panel-action" onClick={onResetCurrentView}>
        <Expand size={16} />
        {labels.panels.resetView}
      </button>
      <button type="button" className="panel-action danger" onClick={onClearCurrentPage}>
        <Trash2 size={16} />
        {labels.panels.clearCurrentPage}
      </button>
    </section>
  )
}

function PageJumpPanel({ labels, pageJumpValue, pageCount, onClose, onValueChange, onJump, onFitPage }: PageJumpPanelProps) {
  return (
    <section className="page-jump-panel" aria-label={labels.panels.jumpPanel}>
      <header>
        <span>{labels.panels.jumpPanel}</span>
        <button type="button" title={labels.panels.closeJumpPanel} onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="page-jump-row">
        <input
          value={pageJumpValue}
          type="number"
          min={1}
          max={pageCount}
          inputMode="numeric"
          autoFocus
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onJump()
          }}
          aria-label={labels.panels.pageNumber}
        />
        <span>/ {pageCount}</span>
      </div>
      <div className="page-jump-actions">
        <button type="button" onClick={onJump}>
          {labels.panels.jump}
        </button>
        <button type="button" onClick={onFitPage}>
          {labels.panels.fitPage}
        </button>
      </div>
    </section>
  )
}

function TocPanel({ labels, currentBook, currentSourcePage, onClose, onJumpToSourcePage }: TocPanelProps) {
  return (
    <aside className="toc-panel" aria-label={labels.panels.toc}>
      <header>
        <span>{currentBook.shortTitle} · {labels.panels.toc}</span>
        <button type="button" title={labels.panels.closeToc} onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="toc-list">
        {currentBook.toc.map((chapter) => {
          const chapterActive = currentSourcePage !== undefined && currentSourcePage >= chapter.page && currentSourcePage <= chapter.endPage
          return (
            <section key={chapter.title} className={`toc-chapter ${chapterActive ? 'active' : ''}`}>
              <button type="button" className="toc-chapter-button" onClick={() => onJumpToSourcePage(chapter.page, chapter.title)}>
                <span>{chapter.title}</span>
                <small>
                  {sourcePageLabel(chapter.page)}-{sourcePageLabel(chapter.endPage)}
                </small>
              </button>
              {chapter.sections.length > 0 && (
                <div className="toc-sections">
                  {chapter.sections.map((section) => (
                    <button
                      key={`${section.title}-${section.page}`}
                      type="button"
                      className={`toc-section-button ${currentSourcePage === section.page ? 'active' : ''}`}
                      onClick={() => onJumpToSourcePage(section.page, section.title)}
                    >
                      <span>{section.title}</span>
                      <small>{sourcePageLabel(section.page)}</small>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </aside>
  )
}

export { EraserSettingsContent, ExportPanel, MorePanel, PageJumpPanel, PenSettingsContent, TocPanel, ToolSettingsPanel }
