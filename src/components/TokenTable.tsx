import { useEffect, useMemo, useRef, useState } from 'react'
import Table from 'react-bootstrap/Table'
import { useResizableColumns, type ResizableColumn } from '../hooks/useResizableColumns'
import type { Token } from '../parser'
import type { LineNavigationRequest } from './types'

type TokenTableProps = {
  readonly navigationRequest: LineNavigationRequest | null
  readonly tokens: readonly Token[]
}

const ROW_HEIGHT_PX = 34
const OVERSCAN_ROWS = 12
const MIN_COLUMN_WIDTH_PX = 56

type TokenColumnKey = 'index' | 'kind' | 'lexeme' | 'line' | 'column'

type TokenColumn = ResizableColumn<TokenColumnKey> & {
  readonly label: string
}

const TOKEN_COLUMNS: readonly TokenColumn[] = [
  { key: 'index', label: '#', defaultWidth: 72, minWidth: 56 },
  { key: 'kind', label: 'Kind', defaultWidth: 132, minWidth: 96 },
  { key: 'lexeme', label: 'Lexeme', defaultWidth: 280, minWidth: 140 },
  { key: 'line', label: 'Line', defaultWidth: 92, minWidth: 72 },
  { key: 'column', label: 'Column', defaultWidth: 104, minWidth: 84 },
]

export function TokenTable({ navigationRequest, tokens }: TokenTableProps) {
  const tableKey =
    tokens.length === 0 ? 'empty' : `${tokens.length}-${tokens[0].span.start.offset}-${tokens[tokens.length - 1].span.end.offset}`

  return <VirtualizedTokenTable key={tableKey} navigationRequest={navigationRequest} tokens={tokens} />
}

function VirtualizedTokenTable({ navigationRequest, tokens }: TokenTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(480)
  const { beginColumnResize, columnWidths, endColumnResize, handleResizeKeyDown, resetColumnWidth, tableWidth, updateColumnResize } = useResizableColumns(
    TOKEN_COLUMNS,
    MIN_COLUMN_WIDTH_PX,
  )
  const selectedTokenIndex = useMemo(
    () => (navigationRequest ? findClosestBasicLineTokenIndex(tokens, navigationRequest.line) : null),
    [navigationRequest, tokens],
  )

  useEffect(() => {
    const scrollElement = scrollRef.current

    if (!scrollElement) {
      return
    }

    const observedElement: HTMLDivElement = scrollElement

    function updateViewportHeight(): void {
      setViewportHeight(observedElement.clientHeight)
    }

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(updateViewportHeight)
    observer.observe(observedElement)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!navigationRequest) {
      return
    }

    if (selectedTokenIndex === null) {
      return
    }

    const nextScrollTop = selectedTokenIndex * ROW_HEIGHT_PX

    if (scrollRef.current) {
      scrollRef.current.scrollTop = nextScrollTop
    }
  }, [navigationRequest, selectedTokenIndex])

  const visibleRange = useMemo(() => {
    const visibleRows = Math.ceil(viewportHeight / ROW_HEIGHT_PX)
    const maxScrollTop = Math.max(0, tokens.length * ROW_HEIGHT_PX - viewportHeight)
    const effectiveScrollTop = Math.min(scrollTop, maxScrollTop)
    const start = Math.max(0, Math.floor(effectiveScrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROWS)
    const end = Math.min(tokens.length, start + visibleRows + OVERSCAN_ROWS * 2)

    return {
      end,
      start,
      visibleTokens: tokens.slice(start, end),
    }
  }, [scrollTop, tokens, viewportHeight])

  const topSpacerHeight = visibleRange.start * ROW_HEIGHT_PX
  const bottomSpacerHeight = Math.max(0, tokens.length - visibleRange.end) * ROW_HEIGHT_PX

  return (
    <div className="token-table-wrap" ref={scrollRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div className="token-table-status">
        Showing {tokens.length === 0 ? 0 : visibleRange.start + 1}-{visibleRange.end} of {tokens.length.toLocaleString()} tokens
      </div>
      <Table hover size="sm" className="token-table" style={{ width: tableWidth }}>
        <colgroup>
          {TOKEN_COLUMNS.map((column) => (
            <col key={column.key} style={{ width: columnWidths[column.key] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {TOKEN_COLUMNS.map((column) => (
              <th key={column.key} scope="col">
                <span className="token-column-label">{column.label}</span>
                <button
                  aria-label={`Resize ${column.label} column`}
                  className="token-column-resizer"
                  onDoubleClick={() => resetColumnWidth(column)}
                  onKeyDown={(event) => handleResizeKeyDown(event, column)}
                  onPointerCancel={endColumnResize}
                  onPointerDown={(event) => beginColumnResize(event, column)}
                  onPointerMove={updateColumnResize}
                  onPointerUp={endColumnResize}
                  title="Drag to resize. Double-click to reset."
                  type="button"
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {topSpacerHeight > 0 ? <SpacerRow height={topSpacerHeight} /> : null}
          {visibleRange.visibleTokens.map((token, index) => {
            const tokenIndex = visibleRange.start + index

            return (
              <tr className={tokenIndex === selectedTokenIndex ? 'is-selected' : undefined} key={`${token.kind}-${token.span.start.offset}-${tokenIndex}`}>
                <td>{tokenIndex + 1}</td>
                <td>
                  <code className="token-kind">{token.kind}</code>
                </td>
                <td>{token.lexeme || ' '}</td>
                <td>{token.span.start.line}</td>
                <td>{token.span.start.column}</td>
              </tr>
            )
          })}
          {bottomSpacerHeight > 0 ? <SpacerRow height={bottomSpacerHeight} /> : null}
        </tbody>
      </Table>
    </div>
  )
}

function findClosestBasicLineTokenIndex(tokens: readonly Token[], lineNumber: number): number | null {
  let closestIndex: number | null = null
  let closestLineNumber: number | null = null
  let closestDistance = Number.POSITIVE_INFINITY

  tokens.forEach((token, index) => {
    if (token.kind !== 'LINENUMBER') {
      return
    }

    const basicLineNumber = typeof token.value === 'number' ? token.value : Number.parseInt(token.lexeme, 10)
    const distance = Math.abs(basicLineNumber - lineNumber)

    if (distance < closestDistance || (distance === closestDistance && (closestLineNumber === null || basicLineNumber < closestLineNumber))) {
      closestIndex = index
      closestLineNumber = basicLineNumber
      closestDistance = distance
    }
  })

  return closestIndex
}

function SpacerRow({ height }: { readonly height: number }) {
  return (
    <tr className="virtual-spacer" style={{ height }}>
      <td colSpan={TOKEN_COLUMNS.length} />
    </tr>
  )
}
