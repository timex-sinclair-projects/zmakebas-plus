import { useCallback, useEffect, useRef, useState } from 'react'

export type BusyIndicator = {
  readonly isProcessing: boolean
  readonly startProcessing: () => void
  readonly stopProcessing: () => void
}

const minimumBusyMs = 180

export function useBusyIndicator(): BusyIndicator {
  const [isProcessing, setIsProcessing] = useState(false)
  const busyStartedAt = useRef(0)
  const busyStopTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (busyStopTimer.current !== null) {
        window.clearTimeout(busyStopTimer.current)
      }
      document.documentElement.classList.remove('app-busy')
    }
  }, [])

  const startProcessing = useCallback((): void => {
    if (busyStopTimer.current !== null) {
      window.clearTimeout(busyStopTimer.current)
      busyStopTimer.current = null
    }
    busyStartedAt.current = performance.now()
    document.documentElement.classList.add('app-busy')
    setIsProcessing(true)
  }, [])

  const stopProcessing = useCallback((): void => {
    const remainingMs = Math.max(0, minimumBusyMs - (performance.now() - busyStartedAt.current))

    busyStopTimer.current = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        document.documentElement.classList.remove('app-busy')
        setIsProcessing(false)
        busyStopTimer.current = null
      })
    }, remainingMs)
  }, [])

  return { isProcessing, startProcessing, stopProcessing }
}
