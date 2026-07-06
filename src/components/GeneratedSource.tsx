import { useEffect, useMemo, useRef } from 'react'
import type { LineNavigationRequest } from './types'

type GeneratedSourceProps = {
  readonly navigationRequest: LineNavigationRequest | null
  readonly source: string
}

export function GeneratedSource({ navigationRequest, source }: GeneratedSourceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const lines = useMemo(() => splitGeneratedLines(source), [source])
  const selectedBasicLineNumber = useMemo(
    () => (navigationRequest ? findNextGeneratedLine(lines, navigationRequest.line)?.basicLineNumber ?? null : null),
    [lines, navigationRequest],
  )

  useEffect(() => {
    if (!navigationRequest || selectedBasicLineNumber === null) {
      return
    }

    const container = containerRef.current
    const target = container?.querySelector<HTMLElement>(`[data-basic-line="${selectedBasicLineNumber}"]`)
    if (!container || !target) {
      return
    }

    const containerRect = container.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const targetScrollTop = targetRect.top - containerRect.top + container.scrollTop - container.clientHeight * 0.35
    container.scrollTop = Math.max(0, targetScrollTop)
  }, [navigationRequest, selectedBasicLineNumber])

  return (
    <div ref={containerRef} className="generated-source" aria-label="Generated BASIC">
      {lines.map((line) => (
        <div
          className={`generated-source-line${line.basicLineNumber !== null && line.basicLineNumber === selectedBasicLineNumber ? ' is-selected' : ''}`}
          data-basic-line={line.basicLineNumber ?? undefined}
          key={line.index}
        >
          {line.text || ' '}
        </div>
      ))}
    </div>
  )
}

type GeneratedLine = {
  readonly basicLineNumber: number | null
  readonly index: number
  readonly text: string
}

function splitGeneratedLines(source: string): readonly GeneratedLine[] {
  return source.split('\n').map((text, index) => {
    const match = /^\s*(\d+)\b/.exec(text)

    return {
      basicLineNumber: match ? Number.parseInt(match[1], 10) : null,
      index,
      text,
    }
  })
}

function findNextGeneratedLine(lines: readonly GeneratedLine[], lineNumber: number): GeneratedLine | null {
  let lastBasicLine: GeneratedLine | null = null

  for (const line of lines) {
    if (line.basicLineNumber === null) {
      continue
    }

    if (line.basicLineNumber >= lineNumber) {
      return line
    }

    lastBasicLine = line
  }

  return lastBasicLine
}
