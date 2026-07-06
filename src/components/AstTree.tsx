import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ProgramNode } from '../parser'
import type { LineNavigationRequest } from './types'

type AstTreeProps = {
  readonly ast: ProgramNode
  readonly navigationRequest: LineNavigationRequest | null
}

type TreeNodeProps = {
  readonly name: string
  readonly selectedLineNumber: number | null
  readonly value: unknown
  readonly depth?: number
}

export function AstTree({ ast, navigationRequest }: AstTreeProps) {
  const treeRef = useRef<HTMLDivElement | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const selectedLineNumber = useMemo(
    () => (navigationRequest ? findClosestAstLineNumber(ast, navigationRequest.line) : null),
    [ast, navigationRequest],
  )

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!navigationRequest) {
      return
    }

    if (selectedLineNumber === null) {
      return
    }

    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollTreeLineIntoView(treeRef.current, selectedLineNumber)
        scrollFrameRef.current = null
      })
    })
  }, [navigationRequest, selectedLineNumber])

  return (
    <div className="ast-tree-wrap" ref={treeRef}>
      <ol className="tree-list root-tree">
        <TreeNode name="ast" selectedLineNumber={selectedLineNumber} value={ast} />
      </ol>
    </div>
  )
}

function TreeNode({ name, selectedLineNumber, value, depth = 0 }: TreeNodeProps) {
  if (Array.isArray(value)) {
    const defaultOpen = depth === 0
    const forceOpen = selectedLineNumber !== null && containsLineNumber(value, selectedLineNumber)

    return (
      <TreeBranch
        defaultOpen={defaultOpen}
        forceOpen={forceOpen}
        meta={`${value.length} items`}
        name={name}
        nodeType="array"
        renderChildren={() =>
          value.map((item, index) => (
            <TreeNode key={`${name}-${index}`} name={getArrayItemName(item)} selectedLineNumber={selectedLineNumber} value={item} depth={depth + 1} />
          ))
        }
      />
    )
  }

  if (isRecord(value)) {
    const entries = Object.entries(value)
    const nodeType = typeof value.type === 'string' ? value.type : 'object'
    const defaultOpen = depth < 1
    const basicLineNumber = getBasicLineNumber(value)
    const isSelected = basicLineNumber !== null && basicLineNumber === selectedLineNumber
    const forceOpen = isSelected || (selectedLineNumber !== null && containsLineNumber(value, selectedLineNumber))

    return (
      <TreeBranch
        basicLineNumber={basicLineNumber}
        defaultOpen={defaultOpen}
        forceOpen={forceOpen}
        isSelected={isSelected}
        name={name}
        nodeType={nodeType}
        renderChildren={() => entries.map(([key, child]) => <TreeNode key={key} name={key} selectedLineNumber={selectedLineNumber} value={child} depth={depth + 1} />)}
      />
    )
  }

  return (
    <li className="tree-node tree-leaf">
      {name ? <span className="tree-name">{name}</span> : null}
      <span className={`tree-value ${value === null ? 'is-null' : ''}`}>{formatPrimitive(value)}</span>
    </li>
  )
}

type TreeBranchProps = {
  readonly basicLineNumber?: number | null
  readonly defaultOpen: boolean
  readonly forceOpen: boolean
  readonly isSelected?: boolean
  readonly meta?: string
  readonly name: string
  readonly nodeType: string
  readonly renderChildren: () => ReactNode
}

function TreeBranch({ basicLineNumber, defaultOpen, forceOpen, isSelected = false, meta, name, nodeType, renderChildren }: TreeBranchProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const effectiveOpen = forceOpen || isOpen

  return (
    <li className={`tree-node${isSelected ? ' is-selected' : ''}`} data-basic-line={basicLineNumber ?? undefined}>
      <details className="tree-branch" open={effectiveOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
        <summary className="tree-summary">
          {name && name !== nodeType ? <span className="tree-name">{name}</span> : null}
          <span className="tree-badge">{nodeType}</span>
          {meta ? <span className="tree-meta">{meta}</span> : null}
        </summary>
        {effectiveOpen ? <ol className="tree-list">{renderChildren()}</ol> : null}
      </details>
    </li>
  )
}

function findClosestAstLineNumber(ast: ProgramNode, lineNumber: number): number | null {
  let closestLineNumber: number | null = null
  let closestDistance = Number.POSITIVE_INFINITY

  for (const line of ast.lines) {
    const distance = Math.abs(line.lineNumber - lineNumber)
    if (distance < closestDistance || (distance === closestDistance && (closestLineNumber === null || line.lineNumber < closestLineNumber))) {
      closestLineNumber = line.lineNumber
      closestDistance = distance
    }
  }

  return closestLineNumber
}

function scrollTreeLineIntoView(container: HTMLDivElement | null, lineNumber: number): void {
  const target = container?.querySelector<HTMLElement>(`[data-basic-line="${lineNumber}"]`)

  if (!container || !target) {
    return
  }

  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const targetScrollTop = targetRect.top - containerRect.top + container.scrollTop - container.clientHeight * 0.3
  container.scrollTop = Math.max(0, targetScrollTop)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getArrayItemName(value: unknown): string {
  if (isRecord(value) && typeof value.type === 'string') {
    return value.type
  }

  return ''
}

function getBasicLineNumber(value: Record<string, unknown>): number | null {
  return value.type === 'Line' && typeof value.lineNumber === 'number' ? value.lineNumber : null
}

function containsLineNumber(value: unknown, lineNumber: number): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => isRecord(item) && getBasicLineNumber(item) === lineNumber)
  }

  if (isRecord(value)) {
    if (getBasicLineNumber(value) === lineNumber) {
      return true
    }

    return Array.isArray(value.lines) && containsLineNumber(value.lines, lineNumber)
  }

  return false
}

function formatPrimitive(value: unknown): string {
  if (typeof value === 'string') {
    return `"${value}"`
  }

  if (value === null) {
    return 'null'
  }

  return String(value)
}
