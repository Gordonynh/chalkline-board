import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { Camera, Crosshair, Eraser, Hand, Image as ImageIcon, Minimize2, MousePointer2, PenLine, RotateCcw, Undo2, X } from 'lucide-react'
import './App.css'
import { ToolButton } from './components/ToolButton'
import { ToolSettingsPanel } from './components/WhiteboardPanels'
import { detectLanguage, uiText } from './i18n'
import {
  appendPointerSamples,
  drawSignatureStroke,
  finalizeVelocityStroke,
  makeId,
  makeTapStroke,
  stripStrokeRuntimeState,
} from './whiteboard/core'
import type { BoardPointerPoint, Stroke, Tool } from './whiteboard/core'
import { eraseStrokesAtPoints, withDynamicEraserRadius } from './whiteboard/eraser'
import {
  LASER_TRAIL_COLOR,
  LASER_TRAIL_HIDE_DELAY_MS,
  appendLaserTrailPoint,
  laserTrailPolylinePoints,
  lastLaserTrailPoint,
  snapshotLaserTrails,
  trimLaserTrailHistory,
} from './laserTrail'
import type { LaserTrail } from './laserTrail'

type ProjectionTool = Extract<Tool, 'select' | 'pen' | 'eraser' | 'pan' | 'laser'>

type ProjectionView = {
  x: number
  y: number
  scale: number
  rotation: number
}

const initialView: ProjectionView = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: -90,
}

declare global {
  interface Window {
    __projectionDebug?: {
      pointerDowns: number
      laserPoints: number
      tool: ProjectionTool
    }
  }
}

const makeProjectionPoint = (event: PointerEvent, pressure = true): BoardPointerPoint => ({
  x: event.clientX,
  y: event.clientY,
  screenX: event.clientX,
  screenY: event.clientY,
  pressure: pressure && event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : undefined,
  time: performance.now(),
})

const coalescedProjectionEvents = (event: PointerEvent) => {
  const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
  return events.length ? events : [event]
}

const updateProjectionDebug = (tool: ProjectionTool, delta: Partial<{ pointerDowns: number; laserPoints: number }>) => {
  const previous = window.__projectionDebug ?? { pointerDowns: 0, laserPoints: 0, tool }
  window.__projectionDebug = {
    pointerDowns: previous.pointerDowns + (delta.pointerDowns ?? 0),
    laserPoints: previous.laserPoints + (delta.laserPoints ?? 0),
    tool,
  }
}

function ProjectionApp() {
  const labels = uiText[detectLanguage()]
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const inkCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const activePointerRef = useRef<number | null>(null)
  const draftStrokeRef = useRef<Stroke | null>(null)
  const eraserPointRef = useRef<BoardPointerPoint | null>(null)
  const eraserStartStrokesRef = useRef<Stroke[] | null>(null)
  const eraserChangedRef = useRef(false)
  const panStartRef = useRef<{ x: number; y: number; view: ProjectionView } | null>(null)
  const strokesRef = useRef<Stroke[]>([])
  const laserHideTimer = useRef<number | undefined>(undefined)
  const laserFrame = useRef<number | null>(null)
  const laserTrailsRef = useRef<LaserTrail[]>([])
  const activeLaserTrailRef = useRef<LaserTrail | null>(null)
  const laserPointSeq = useRef(0)
  const [tool, setTool] = useState<ProjectionTool>('pen')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [strokeColor, setStrokeColor] = useState('#ef1f18')
  const [strokeWidth, setStrokeWidth] = useState(8)
  const [eraserRadius, setEraserRadius] = useState(34)
  const [view, setView] = useState<ProjectionView>(initialView)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [past, setPast] = useState<Stroke[][]>([])
  const [albumOpen, setAlbumOpen] = useState(false)
  const [captures, setCaptures] = useState<string[]>([])
  const [activeCapture, setActiveCapture] = useState<string | null>(null)
  const [laserTrails, setLaserTrails] = useState<LaserTrail[]>([])
  const [laserTrailFading, setLaserTrailFading] = useState(false)
  const [status, setStatus] = useState<string>(labels.visualizer.camera)

  const redrawInk = useCallback(() => {
    const canvas = inkCanvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, window.innerWidth, window.innerHeight)
    for (const stroke of strokesRef.current) {
      context.save()
      context.globalAlpha = stroke.opacity
      drawSignatureStroke(context, stroke, 1)
      context.restore()
    }
  }, [])

  useEffect(() => {
    strokesRef.current = strokes
    redrawInk()
  }, [redrawInk, strokes, view])

  useEffect(() => {
    const resize = () => {
      const canvas = inkCanvasRef.current
      if (!canvas) return
      const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
      canvas.width = Math.round(window.innerWidth * ratio)
      canvas.height = Math.round(window.innerHeight * ratio)
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      redrawInk()
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [redrawInk])

  useEffect(() => {
    let active = true
    let currentStream: MediaStream | null = null
    if (!navigator.mediaDevices?.getUserMedia) {
      window.setTimeout(() => setStatus(labels.visualizer.cameraUnsupported), 0)
      return
    }

    const attachStream = async (stream: MediaStream) => {
      if (!active) {
        stream.getTracks().forEach((track) => track.stop())
        return true
      }
      currentStream = stream
      const videoElement = videoRef.current
      if (!videoElement) return true
      videoElement.srcObject = stream
      videoElement.muted = true
      videoElement.playsInline = true
      await videoElement.play().catch(() => undefined)
      const label = stream.getVideoTracks()[0]?.label
      setStatus(label || labels.visualizer.camera)
      return true
    }

    const tryOpenCamera = async (constraints: MediaStreamConstraints) => {
      try {
        await attachStream(await navigator.mediaDevices.getUserMedia(constraints))
        return true
      } catch {
        return false
      }
    }

    const openCamera = async () => {
      const preferredConstraints: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        },
        {
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        },
        { video: true, audio: false },
      ]

      for (const constraints of preferredConstraints) {
        if (!active) return
        if (await tryOpenCamera(constraints)) return
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices?.()
        const cameras = (devices ?? []).filter((device) => device.kind === 'videoinput')
        for (const camera of cameras) {
          if (!active) return
          if (await tryOpenCamera({ video: { deviceId: { exact: camera.deviceId } }, audio: false })) return
        }
      } catch {
        // Device enumeration is optional; the generic attempts above already
        // cover browsers and WebView2 builds that do not expose it.
      }

      if (active) setStatus(labels.visualizer.openCameraFailed)
    }

    void openCamera()
    return () => {
      active = false
      const stream = currentStream ?? videoRef.current?.srcObject
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop())
    }
  }, [labels.visualizer.camera, labels.visualizer.cameraUnsupported, labels.visualizer.openCameraFailed])

  const laserHeadPoint = useMemo(() => lastLaserTrailPoint(laserTrails), [laserTrails])
  const laserStyle = useMemo(() => ({
    '--laser-color': LASER_TRAIL_COLOR,
    '--laser-width': `${Math.max(5, Math.min(18, strokeWidth * 0.95))}px`,
    '--laser-head-size': `${Math.max(12, Math.min(28, strokeWidth + 8))}px`,
  }) as CSSProperties, [strokeWidth])

  const contentStyle = useMemo(() => ({
    transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale}) rotate(${view.rotation}deg)`,
  }), [view])

  const recordStrokes = (next: Stroke[]) => {
    setPast((items) => [...items.slice(-40), strokesRef.current])
    strokesRef.current = next
    setStrokes(next)
  }

  const setLiveStrokes = (next: Stroke[]) => {
    strokesRef.current = next
    setStrokes(next)
  }

  const beginEraserGesture = () => {
    eraserStartStrokesRef.current = strokesRef.current
    eraserChangedRef.current = false
    eraserPointRef.current = null
  }

  const applyEraserPoints = (points: BoardPointerPoint[]) => {
    if (!points.length) return
    const result = eraseStrokesAtPoints(strokesRef.current, points, eraserRadius, 1)
    if (!result.changed) return
    eraserChangedRef.current = true
    setLiveStrokes(result.strokes)
  }

  const finishEraserGesture = () => {
    const startStrokes = eraserStartStrokesRef.current
    if (startStrokes && eraserChangedRef.current) {
      setPast((items) => [...items.slice(-40), startStrokes])
    }
    eraserStartStrokesRef.current = null
    eraserChangedRef.current = false
    eraserPointRef.current = null
  }

  const commitDraftStroke = (event?: PointerEvent) => {
    const draft = draftStrokeRef.current
    if (!draft) return false
    if (event) appendPointerSamples(draft, [makeProjectionPoint(event)], 1)
    const committed = stripStrokeRuntimeState(draft.points.length < 4 ? makeTapStroke(draft) : finalizeVelocityStroke(draft))
    draftStrokeRef.current = null
    recordStrokes([...strokesRef.current, committed])
    return true
  }

  const appendLaser = (event: PointerEvent) => {
    if (!activeLaserTrailRef.current) return
    if (!appendLaserTrailPoint(activeLaserTrailRef.current.points, makeProjectionPoint(event, false), `laser-${laserPointSeq.current++}`)) return
    updateProjectionDebug(tool, { laserPoints: 1 })
    trimLaserTrailHistory(laserTrailsRef.current)
    setLaserTrails(snapshotLaserTrails(laserTrailsRef.current))
    flushLaserTrail()
  }

  const flushLaserTrail = () => {
    if (laserFrame.current !== null) return
    laserFrame.current = window.requestAnimationFrame(() => {
      laserFrame.current = null
      setLaserTrails(snapshotLaserTrails(laserTrailsRef.current))
    })
  }

  const beginLaser = () => {
    if (laserHideTimer.current) window.clearTimeout(laserHideTimer.current)
    setLaserTrailFading(false)
    const trail: LaserTrail = { id: `projection-laser-${laserPointSeq.current++}`, points: [] }
    laserTrailsRef.current.push(trail)
    activeLaserTrailRef.current = trail
  }

  const endLaser = () => {
    activeLaserTrailRef.current = null
    setLaserTrailFading(true)
    flushLaserTrail()
    laserHideTimer.current = window.setTimeout(() => {
      laserTrailsRef.current = []
      setLaserTrailFading(false)
      flushLaserTrail()
    }, LASER_TRAIL_HIDE_DELAY_MS)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    updateProjectionDebug(tool, { pointerDowns: 1 })
    if (event.button !== 0) return
    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic and some touch-generated pointer events can arrive without
      // an active capture target. Drawing should continue without capture.
    }
    activePointerRef.current = event.pointerId
    const nativeEvent = event.nativeEvent
    if (tool === 'pan') {
      panStartRef.current = { x: nativeEvent.clientX, y: nativeEvent.clientY, view }
      return
    }
    if (tool === 'laser') {
      beginLaser()
      appendLaser(nativeEvent)
      return
    }
    if (tool === 'eraser') {
      beginEraserGesture()
      const point = withDynamicEraserRadius(makeProjectionPoint(nativeEvent, false), eraserPointRef.current, eraserRadius)
      eraserPointRef.current = point
      applyEraserPoints([point])
      return
    }
    if (tool !== 'pen') return
    draftStrokeRef.current = {
      id: makeId(),
      kind: 'pen',
      color: strokeColor,
      width: strokeWidth,
      opacity: 1,
      points: [nativeEvent.clientX, nativeEvent.clientY],
      pressures: [nativeEvent.pressure || 0.96],
      pressureSource: nativeEvent.pointerType === 'pen' && nativeEvent.pressure > 0 ? 'native' : 'velocity',
      lastInputTime: performance.now(),
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return
    event.preventDefault()
    const nativeEvent = event.nativeEvent
    if (tool === 'pan' && panStartRef.current) {
      const start = panStartRef.current
      setView({ ...start.view, x: start.view.x + nativeEvent.clientX - start.x, y: start.view.y + nativeEvent.clientY - start.y })
      return
    }
    if (tool === 'laser') {
      appendLaser(nativeEvent)
      return
    }
    if (tool === 'eraser') {
      const points = coalescedProjectionEvents(nativeEvent).map((item) => {
        const tracked = withDynamicEraserRadius(makeProjectionPoint(item, false), eraserPointRef.current, eraserRadius)
        eraserPointRef.current = tracked
        return tracked
      })
      applyEraserPoints(points)
      return
    }
    const draft = draftStrokeRef.current
    if (!draft) return
    appendPointerSamples(draft, coalescedProjectionEvents(nativeEvent).map((item) => makeProjectionPoint(item)), 1)
    const canvas = inkCanvasRef.current
    const context = canvas?.getContext('2d')
    if (!context) return
    redrawInk()
    context.save()
    context.setTransform(Math.max(1, Math.min(window.devicePixelRatio || 1, 2)), 0, 0, Math.max(1, Math.min(window.devicePixelRatio || 1, 2)), 0, 0)
    context.globalAlpha = draft.opacity
    drawSignatureStroke(context, draft, 1, 0.5)
    context.restore()
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return
    event.preventDefault()
    activePointerRef.current = null
    panStartRef.current = null
    if (tool === 'laser') endLaser()
    commitDraftStroke(event.nativeEvent)
    if (tool === 'eraser') finishEraserGesture()
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Pointer capture can already be released by the browser.
    }
  }

  const onWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    if (tool !== 'pan') return
    event.preventDefault()
    const nextScale = Math.max(0.2, Math.min(6, view.scale * (event.deltaY < 0 ? 1.08 : 0.92)))
    setView((previous) => ({ ...previous, scale: nextScale }))
  }

  const settleActiveInputBeforeToolChange = () => {
    if (draftStrokeRef.current) commitDraftStroke()
    if (eraserStartStrokesRef.current) finishEraserGesture()
    if (activeLaserTrailRef.current) endLaser()
    activePointerRef.current = null
    panStartRef.current = null
    eraserPointRef.current = null
  }

  const chooseTool = (nextTool: ProjectionTool) => {
    settleActiveInputBeforeToolChange()
    setTool(nextTool)
    setSettingsOpen((open) => nextTool === 'pen' || nextTool === 'eraser' ? (nextTool === tool ? !open : true) : false)
  }

  const captureFrame = () => {
    const source = activeCapture || videoRef.current
    if (!source) {
      setStatus(labels.visualizer.noCaptureSource)
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    const context = canvas.getContext('2d')
    if (!context) {
      setStatus(labels.visualizer.composeCanvasFailed)
      return
    }
    context.fillStyle = '#05070c'
    context.fillRect(0, 0, canvas.width, canvas.height)
    if (typeof source === 'string') {
      const image = new Image()
      image.onload = () => {
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        const src = canvas.toDataURL('image/jpeg', 0.9)
        setCaptures((items) => [src, ...items].slice(0, 24))
        setActiveCapture(src)
        setAlbumOpen(true)
        setStatus(labels.visualizer.captured)
      }
      image.src = source
      return
    }
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    const src = canvas.toDataURL('image/jpeg', 0.9)
    setCaptures((items) => [src, ...items].slice(0, 24))
    setActiveCapture(src)
    setAlbumOpen(true)
    setStatus(labels.visualizer.captured)
  }

  const undo = () => {
    setPast((items) => {
      const previous = items.at(-1)
      if (!previous) return items
      strokesRef.current = previous
      setStrokes(previous)
      return items.slice(0, -1)
    })
  }

  return (
    <main className="visualizer-shell">
      <section className="visualizer-stage">
        <div className="visualizer-frame" data-testid="visualizer-frame">
          <div className="visualizer-content" style={contentStyle}>
            {activeCapture ? (
              <img className="visualizer-source" src={activeCapture} alt={labels.visualizer.capturedImage} />
            ) : (
              <video ref={videoRef} className="visualizer-source" playsInline muted autoPlay />
            )}
          </div>
          <canvas
            ref={inkCanvasRef}
            className={`visualizer-ink-canvas ${tool}`}
            data-testid="visualizer-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          />
          {laserTrails.length > 0 && (
            <div className={`visualizer-laser-trail laser-trail ${laserTrailFading ? 'is-fading' : ''}`} style={laserStyle} aria-hidden="true">
              <svg className="laser-trail-svg">
                {laserTrails.map((trail) =>
                  trail.points.length > 1 ? (
                    <g key={trail.id}>
                      <polyline className="laser-trail-glow" points={laserTrailPolylinePoints(trail.points)} />
                      <polyline className="laser-trail-line" points={laserTrailPolylinePoints(trail.points)} />
                    </g>
                  ) : null,
                )}
              </svg>
              {laserHeadPoint && <span className="laser-trail-head" style={{ left: laserHeadPoint.x, top: laserHeadPoint.y }} />}
            </div>
          )}
        </div>
        <div className="visualizer-status">
          <img src="/app-icon.png" alt="" />
          <span>{status}</span>
        </div>
        {settingsOpen && (
          <div className="visualizer-settings">
            <ToolSettingsPanel
              labels={labels}
              tool={tool === 'eraser' ? 'eraser' : 'pen'}
              strokeColor={strokeColor}
              strokeWidth={strokeWidth}
              highlightOpacity={0.35}
              eraserRadius={eraserRadius}
              onStrokeColorChange={setStrokeColor}
              onStrokeWidthChange={setStrokeWidth}
              onHighlightOpacityChange={() => undefined}
              onEraserRadiusChange={setEraserRadius}
              onClearCurrentPage={() => recordStrokes([])}
            />
          </div>
        )}
        {albumOpen && (
          <section className="visualizer-album-panel" aria-label={labels.visualizer.albumAlt}>
            <header>
              <span>{labels.visualizer.album}</span>
              <button type="button" onClick={() => setAlbumOpen(false)} title={labels.visualizer.closeAlbum}>
                <X size={16} />
              </button>
            </header>
            <div className="visualizer-album-grid">
              {captures.map((src, index) => (
                <button key={`${src.slice(0, 48)}-${index}`} type="button" className={src === activeCapture ? 'active' : ''} onClick={() => setActiveCapture(src)}>
                  <img src={src} alt={labels.visualizer.capturedImage} />
                  <span>{index + 1}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </section>
      <nav className="visualizer-toolbar hite-bottom-toolbar" aria-label={labels.visualizer.toolbar}>
        <ToolButton active={tool === 'select'} label={labels.toolbar.select} icon={<MousePointer2 className="visualizer-toolbar-svg" />} onClick={() => chooseTool('select')} />
        <ToolButton active={tool === 'pen'} label={labels.toolbar.pen} icon={<PenLine className="visualizer-toolbar-svg" />} onClick={() => chooseTool('pen')} />
        <ToolButton active={tool === 'eraser'} label={labels.toolbar.eraser} icon={<Eraser className="visualizer-toolbar-svg" />} onClick={() => chooseTool('eraser')} />
        <ToolButton active={tool === 'laser'} label={labels.visualizer.laser} icon={<Crosshair className="visualizer-toolbar-svg" />} onClick={() => chooseTool('laser')} />
        <ToolButton active={tool === 'pan'} label={labels.toolbar.pan} icon={<Hand className="visualizer-toolbar-svg" />} onClick={() => chooseTool('pan')} />
        <ToolButton disabled={!past.length} label={labels.toolbar.undo} icon={<Undo2 className="visualizer-toolbar-svg" />} onClick={undo} />
        <span className="visualizer-toolbar-divider" />
        <ToolButton label={labels.visualizer.rotate} icon={<RotateCcw className="visualizer-toolbar-svg" />} onClick={() => setView((item) => ({ ...item, rotation: item.rotation - 90 }))} />
        <ToolButton label={labels.visualizer.capture} icon={<Camera className="visualizer-toolbar-svg" />} onClick={captureFrame} />
        <ToolButton active={albumOpen} label={labels.visualizer.album} icon={<ImageIcon className="visualizer-toolbar-svg" />} onClick={() => setAlbumOpen((open) => !open)} />
        <ToolButton label={labels.corner.minimize} icon={<Minimize2 className="visualizer-toolbar-svg" />} onClick={() => window.chrome?.webview?.postMessage?.('minimize')} />
        <ToolButton label={labels.corner.close} icon={<X className="visualizer-toolbar-svg" />} onClick={() => window.chrome?.webview?.postMessage?.('close')} />
      </nav>
    </main>
  )
}

export default ProjectionApp
