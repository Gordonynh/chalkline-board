import { useEffect, useState } from 'react'

const imageCache = new Map<string, { image?: HTMLImageElement; promise?: Promise<HTMLImageElement> }>()
const displayImageCache = new Map<string, { image?: CanvasImageSource; promise?: Promise<CanvasImageSource> }>()
const MAX_SOURCE_IMAGES = 12
const MAX_DISPLAY_IMAGES = 8
const MAX_DISPLAY_PRELOAD_QUEUE = 16
const displayPreloadQueue: Array<{ key: string; maxDimension: number; src: string }> = []
const queuedDisplayPreloads = new Set<string>()
let displayPreloadIdleHandle: number | undefined
let displayPreloadActive = false

const requestIdle = (callback: () => void) => {
  const idleCallback = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback
  if (idleCallback) return idleCallback(callback, { timeout: 900 })
  return window.setTimeout(callback, 160)
}

const trimCache = <T,>(cache: Map<string, T>, maxEntries: number) => {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value
    if (!oldestKey) return
    cache.delete(oldestKey)
  }
}

const touchCacheEntry = <T,>(cache: Map<string, T>, key: string, value: T) => {
  cache.delete(key)
  cache.set(key, value)
}

function loadCanvasImage(src: string) {
  const cached = imageCache.get(src)
  if (cached?.image) return Promise.resolve(cached.image)
  if (cached?.promise) return cached.promise

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image()
    image.decoding = 'async'
    image.onload = async () => {
      if (typeof image.decode === 'function') {
        await image.decode().catch(() => undefined)
      }
      touchCacheEntry(imageCache, src, { image })
      trimCache(imageCache, MAX_SOURCE_IMAGES)
      resolve(image)
    }
    image.onerror = () => {
      imageCache.delete(src)
      reject(new Error('image load failed'))
    }
    image.src = src
  })
  touchCacheEntry(imageCache, src, { promise })
  return promise
}

function preloadImages(sources: string[]) {
  sources.forEach((source) => {
    void loadCanvasImage(source).catch(() => undefined)
  })
}

async function loadDisplayImage(src: string, maxDimension: number) {
  const key = `${src}@${maxDimension}`
  const cached = displayImageCache.get(key)
  if (cached?.image) return cached.image
  if (cached?.promise) return cached.promise

  const promise = loadCanvasImage(src).then((image): CanvasImageSource => {
    const largestDimension = Math.max(image.naturalWidth, image.naturalHeight)
    if (largestDimension <= maxDimension) return image

    const scale = maxDimension / largestDimension
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) return image
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas
  })
  touchCacheEntry(displayImageCache, key, { promise })
  promise
    .then((image) => {
      touchCacheEntry(displayImageCache, key, { image })
      trimCache(displayImageCache, MAX_DISPLAY_IMAGES)
    })
    .catch(() => displayImageCache.delete(key))
  return promise
}

const scheduleNextDisplayPreload = () => {
  if (displayPreloadIdleHandle !== undefined || displayPreloadActive) return
  displayPreloadIdleHandle = requestIdle(() => {
    displayPreloadIdleHandle = undefined
    const item = displayPreloadQueue.shift()
    if (!item) return
    queuedDisplayPreloads.delete(item.key)
    if (displayImageCache.get(item.key)?.image || displayImageCache.get(item.key)?.promise) {
      scheduleNextDisplayPreload()
      return
    }

    displayPreloadActive = true
    void loadDisplayImage(item.src, item.maxDimension)
      .catch(() => undefined)
      .finally(() => {
        displayPreloadActive = false
        scheduleNextDisplayPreload()
      })
  })
}

function preloadDisplayImages(sources: string[], maxDimension: number) {
  for (const source of sources) {
    const key = `${source}@${maxDimension}`
    if (displayImageCache.get(key)?.image || displayImageCache.get(key)?.promise || queuedDisplayPreloads.has(key)) continue
    while (displayPreloadQueue.length >= MAX_DISPLAY_PRELOAD_QUEUE) {
      const dropped = displayPreloadQueue.shift()
      if (dropped) queuedDisplayPreloads.delete(dropped.key)
    }
    queuedDisplayPreloads.add(key)
    displayPreloadQueue.push({ key, maxDimension, src: source })
  }
  scheduleNextDisplayPreload()
}

function useCachedDisplayImage(src: string | undefined, maxDimension: number) {
  const cacheKey = src ? `${src}@${maxDimension}` : undefined
  const [image, setImage] = useState<CanvasImageSource | undefined>(() => (cacheKey ? displayImageCache.get(cacheKey)?.image : undefined))

  useEffect(() => {
    let active = true
    if (!src) {
      const timer = window.setTimeout(() => setImage(undefined), 0)
      return () => {
        active = false
        window.clearTimeout(timer)
      }
    }

    void loadDisplayImage(src, maxDimension)
      .then((loaded) => {
        if (active) setImage(loaded)
      })
      .catch(() => {
        if (active) setImage(undefined)
      })
    return () => {
      active = false
    }
  }, [maxDimension, src])

  return image
}

export { loadCanvasImage, preloadDisplayImages, preloadImages, useCachedDisplayImage }
