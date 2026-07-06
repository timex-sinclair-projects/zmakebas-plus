import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

export type ResizableColumn<Key extends string> = {
  readonly key: Key
  readonly defaultWidth: number
  readonly minWidth?: number
}

export function useResizableColumns<Key extends string, Column extends ResizableColumn<Key>>(
  columns: readonly Column[],
  fallbackMinWidth: number,
) {
  const resizingRef = useRef<{
    readonly column: Column
    readonly pointerId: number
    readonly startClientX: number
    readonly startWidth: number
  } | null>(null)
  const [columnWidths, setColumnWidths] = useState(() => createDefaultColumnWidths(columns))
  const tableWidth = useMemo(() => columns.reduce((total, column) => total + columnWidths[column.key], 0), [columnWidths, columns])

  const resizeColumn = useCallback(
    (column: Column, nextWidth: number) => {
      const minWidth = column.minWidth ?? fallbackMinWidth

      setColumnWidths((currentWidths) => ({
        ...currentWidths,
        [column.key]: Math.max(minWidth, Math.round(nextWidth)),
      }))
    },
    [fallbackMinWidth],
  )

  const resetColumnWidth = useCallback((column: Column) => resizeColumn(column, column.defaultWidth), [resizeColumn])

  const beginColumnResize = useCallback(
    (event: PointerEvent<HTMLButtonElement>, column: Column) => {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      resizingRef.current = {
        column,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startWidth: columnWidths[column.key],
      }
    },
    [columnWidths],
  )

  const updateColumnResize = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const resizeState = resizingRef.current

      if (!resizeState || resizeState.pointerId !== event.pointerId) {
        return
      }

      resizeColumn(resizeState.column, resizeState.startWidth + event.clientX - resizeState.startClientX)
    },
    [resizeColumn],
  )

  const endColumnResize = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const resizeState = resizingRef.current

    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return
    }

    resizingRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  const handleResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, column: Column) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home') {
        return
      }

      event.preventDefault()

      if (event.key === 'Home') {
        resetColumnWidth(column)
        return
      }

      const direction = event.key === 'ArrowLeft' ? -1 : 1
      const step = event.shiftKey ? 24 : 8
      resizeColumn(column, columnWidths[column.key] + direction * step)
    },
    [columnWidths, resetColumnWidth, resizeColumn],
  )

  return {
    beginColumnResize,
    columnWidths,
    endColumnResize,
    handleResizeKeyDown,
    resetColumnWidth,
    tableWidth,
    updateColumnResize,
  }
}

function createDefaultColumnWidths<Key extends string, Column extends ResizableColumn<Key>>(columns: readonly Column[]): Record<Key, number> {
  const widths = {} as Record<Key, number>

  for (const column of columns) {
    widths[column.key] = column.defaultWidth
  }

  return widths
}
