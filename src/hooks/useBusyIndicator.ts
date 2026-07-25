import { useCallback, useEffect, useRef, useState } from 'react'

export type BusyIndicator = {
  readonly isProcessing: boolean
  readonly startProcessing: (activity: BusyActivity) => void
  readonly stopProcessing: (activity: BusyActivity) => void
}

export type BusyActivity = 'parser' | 'program-file' | 'results' | 'tape-redecode'

const minimumBusyMs = 180

export function useBusyIndicator(): BusyIndicator {
  const [isProcessing, setIsProcessing] = useState(false)
  const activeActivities = useRef(new Set<BusyActivity>())
  const busyStartedAt = useRef(0)
  const busyStopTimer = useRef<number | null>(null)

  useEffect(() => {
    const activities = activeActivities.current
    return () => {
      if (busyStopTimer.current !== null) {
        window.clearTimeout(busyStopTimer.current)
      }
      activities.clear()
      document.documentElement.classList.remove('app-busy')
    }
  }, [])

  const startProcessing = useCallback((activity: BusyActivity): void => {
    if (busyStopTimer.current !== null) {
      window.clearTimeout(busyStopTimer.current)
      busyStopTimer.current = null
    }
    if (activeActivities.current.size === 0) {
      busyStartedAt.current = performance.now()
    }
    activeActivities.current.add(activity)
    document.documentElement.classList.add('app-busy')
    setIsProcessing(true)
  }, [])

  const stopProcessing = useCallback((activity: BusyActivity): void => {
    if (!activeActivities.current.delete(activity) || activeActivities.current.size > 0) {
      return
    }
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
