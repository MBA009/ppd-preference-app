import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Camera QR scanning that works on both Android and iPhone browsers.
 *
 * - Chrome on Android has the built-in BarcodeDetector, which is fast and free, so we use it when it exists.
 * - Safari on iPhone (and desktop Firefox) does not, so we fall back to jsQR, a small JavaScript decoder.
 *
 * The camera needs a secure origin: https:// or http://localhost.
 */

export type ScanStatus = 'idle' | 'starting' | 'scanning' | 'denied' | 'insecure' | 'unsupported' | 'error'

interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats?: () => Promise<string[]>
}
const NativeDetector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector

const MAX_DECODE_WIDTH = 800 // downscale big camera frames before the JS decoder
const MIN_GAP_MS = 120 //       about 8 decode attempts per second is plenty for a QR code

export function useQrScanner(video: RefObject<HTMLVideoElement>, onCode: (text: string) => void, enabled = true) {
  const [status, setStatus] = useState<ScanStatus>('idle')
  const [attempt, setAttempt] = useState(0)
  const handler = useRef(onCode)
  handler.current = onCode

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let stream: MediaStream | undefined
    let timer = 0

    async function start() {
      if (!window.isSecureContext) return setStatus('insecure')
      if (!navigator.mediaDevices?.getUserMedia) return setStatus('unsupported')
      setStatus('starting')
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
      } catch (e) {
        const name = (e as DOMException).name
        return setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error')
      }
      const el = video.current
      if (stopped || !el) { stream.getTracks().forEach((t) => t.stop()); return }
      el.srcObject = stream
      el.muted = true
      el.setAttribute('playsinline', 'true') // iOS Safari: do not open the camera full screen
      try { await el.play() } catch { /* autoplay can be blocked; the loop below waits for frames */ }
      if (stopped) return
      setStatus('scanning')

      let native: BarcodeDetectorLike | null = null
      if (NativeDetector) {
        try {
          const formats = (await NativeDetector.getSupportedFormats?.()) ?? ['qr_code']
          if (formats.includes('qr_code')) native = new NativeDetector({ formats: ['qr_code'] })
        } catch { native = null }
      }
      const jsQR = native ? null : (await import('jsqr')).default
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { willReadFrequently: true })

      const tick = async () => {
        if (stopped) return
        try {
          if (el.readyState >= 2 && el.videoWidth) {
            let text: string | undefined
            if (native) {
              text = (await native.detect(el))[0]?.rawValue
            } else if (jsQR && ctx) {
              const w = Math.min(el.videoWidth, MAX_DECODE_WIDTH)
              const h = Math.round((el.videoHeight * w) / el.videoWidth)
              canvas.width = w
              canvas.height = h
              ctx.drawImage(el, 0, 0, w, h)
              text = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data
            }
            if (text && !stopped) handler.current(text)
          }
        } catch {
          native = null // the native detector failed once; stay on the JS decoder from now on
        }
        if (!stopped) timer = window.setTimeout(tick, MIN_GAP_MS)
      }
      tick()
    }

    start().catch(() => setStatus('error'))

    return () => {
      stopped = true
      window.clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
      if (video.current) video.current.srcObject = null
    }
  }, [enabled, attempt, video])

  return { status, retry: () => setAttempt((n) => n + 1) }
}
