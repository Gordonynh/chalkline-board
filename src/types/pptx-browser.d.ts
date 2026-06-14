declare module 'pptx-browser' {
  export class PptxRenderer {
    slideCount: number
    slideSize: { cx: number; cy: number }
    load(
      source: File | Blob | ArrayBuffer | Uint8Array,
      onProgress?: (progress: number, message: string) => void,
    ): Promise<void>
    renderSlide(slideIndex: number, canvas: HTMLCanvasElement, width?: number): Promise<void>
    renderAllSlides(width?: number): Promise<HTMLCanvasElement[]>
    getAnimations?(slideIndex: number): Array<{ clickNum?: number }>
    createPlayer?(canvas: HTMLCanvasElement): PptxPlayer
    destroy(): void
  }

  export class PptxPlayer {
    loadSlide(slideIndex: number): Promise<void>
    nextClick(): Promise<void>
    play(autoAdvanceMs?: number): Promise<void>
    pause(): void
    stop(): Promise<void>
  }

  export class SlideShow {
    constructor(
      renderer: PptxRenderer,
      container: HTMLElement,
      opts?: {
        fullscreen?: boolean
        showNotes?: boolean
        showThumbs?: boolean
        showHud?: boolean
        loop?: boolean
        autoAdvance?: number
        onSlideChange?: (index: number | null) => void
      },
    )
    start(slideIndex?: number): Promise<void>
    stop(): void
    goto(index: number): Promise<void>
    next(): Promise<void>
    prev(): Promise<void>
    readonly currentIndex: number
    readonly isPlaying: boolean
  }
}
