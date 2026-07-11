import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import Button from 'react-bootstrap/Button'
import Dropdown from 'react-bootstrap/Dropdown'
import Form from 'react-bootstrap/Form'
import { BsBullseye, BsCheckAll, BsClipboard, BsClipboardPlus, BsTextLeft, BsThreeDotsVertical, BsZoomIn, BsZoomOut } from 'react-icons/bs'
import type { BasicDialect, BasicExtension } from '../parser'
import { GoToLineControl } from './GoToLineControl'
import { SourceCodeEditor, type SourceCodeEditorHandle } from './SourceCodeEditor'
import type { SourceCursorPosition, SourceDiagnostic, SourceNavigationRequest } from './types'

const defaultEditorFontSize = 15
const minEditorFontSize = 12
const maxEditorFontSize = 22

type SourcePanelProps = {
  readonly source: string
  readonly dialect: BasicDialect
  readonly extensions: readonly BasicExtension[]
  readonly diagnostic: SourceDiagnostic | null
  readonly gotoLineMode: 'basic' | 'source'
  readonly navigationRequest: SourceNavigationRequest | null
  readonly screenWidth: number
  readonly screenWrapHintsEnabled: boolean
  readonly showLineNumbers: boolean
  readonly onSourceDraftChange: (source: string) => void
  readonly onSourceChange: (source: string) => void
  readonly onCursorChange: (position: SourceCursorPosition) => void
  readonly onFormatSource: () => void
  readonly onGotoError: () => void
  readonly onGotoLine: (lineNumber: number) => void
  readonly onError: (message: string) => void
}

export function SourcePanel({
  source,
  dialect,
  extensions,
  diagnostic,
  gotoLineMode,
  navigationRequest,
  screenWidth,
  screenWrapHintsEnabled,
  showLineNumbers,
  onSourceDraftChange,
  onSourceChange,
  onCursorChange,
  onFormatSource,
  onGotoError,
  onGotoLine,
  onError,
}: SourcePanelProps) {
  const editorRef = useRef<SourceCodeEditorHandle | null>(null)
  const sourcePropRef = useRef(source)
  const [, startDeferredSourceChange] = useTransition()
  const [draftSource, setDraftSource] = useState(source)
  const [gotoLine, setGotoLine] = useState('')
  const [editorFontSize, setEditorFontSize] = useState(defaultEditorFontSize)
  const canZoomOut = editorFontSize > minEditorFontSize
  const canZoomIn = editorFontSize < maxEditorFontSize
  const canGotoError = diagnostic !== null

  useEffect(() => {
    if (source === sourcePropRef.current) {
      return
    }

    sourcePropRef.current = source
    setDraftSource(source)
    onSourceDraftChange(source)
  }, [onSourceDraftChange, source])

  const moveEditorToRange = useCallback((selectionStart: number, selectionEnd: number): void => {
    editorRef.current?.revealRange(selectionStart, selectionEnd)
  }, [])

  useEffect(() => {
    if (!navigationRequest) {
      return
    }

    const target = findSourceLine(draftSource, navigationRequest.line)
    if (!target) {
      return
    }

    const columnOffset = Math.min(Math.max(0, navigationRequest.column - 1), target.text.length)
    const endColumnOffset = Math.min(Math.max(columnOffset + 1, (navigationRequest.endColumn ?? navigationRequest.column + 1) - 1), target.text.length)
    moveEditorToRange(target.offset + columnOffset, target.offset + endColumnOffset)
  }, [draftSource, moveEditorToRange, navigationRequest])

  function handleSourceInput(nextSource: string): void {
    onSourceDraftChange(nextSource)
    setDraftSource(nextSource)
    startDeferredSourceChange(() => onSourceChange(nextSource))
  }

  function replaceSourceSelection(insertedText: string): void {
    editorRef.current?.replaceSelection(insertedText)
  }

  async function handleCopySource(): Promise<void> {
    const selectedText = editorRef.current?.getSelectionText() || draftSource

    try {
      await navigator.clipboard.writeText(selectedText)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unable to copy source.')
    }
  }

  async function handlePasteSource(): Promise<void> {
    try {
      const pastedText = await navigator.clipboard.readText()
      replaceSourceSelection(pastedText)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unable to paste source.')
    }
  }

  function handleSelectAllSource(): void {
    editorRef.current?.selectAll()
  }

  function handleZoomOut(): void {
    setEditorFontSize((currentFontSize) => Math.max(minEditorFontSize, currentFontSize - 1))
  }

  function handleZoomIn(): void {
    setEditorFontSize((currentFontSize) => Math.min(maxEditorFontSize, currentFontSize + 1))
  }

  function handleSourceBlur(): void {
    if (draftSource !== source) {
      onSourceChange(draftSource)
    }
  }

  function handleGoto(): void {
    const lineNumber = Number.parseInt(gotoLine, 10)
    if (!Number.isFinite(lineNumber)) {
      return
    }

    const target = gotoLineMode === 'source' ? findClosestSourceLine(draftSource, lineNumber) : findNextBasicLine(draftSource, lineNumber)
    if (!target) {
      return
    }

    moveEditorToRange(target.offset, target.offset + target.text.length)
    onGotoLine(target.targetLineNumber)
  }

  return (
    <section className="tool-panel source-panel">
      <div className="source-panel-header">
        <Form.Label htmlFor="basic-source" className="source-title">
          BASIC listing
        </Form.Label>
        <div className="source-toolbar">
          {canGotoError && (
            <Button type="button" variant="outline-danger" size="sm" className="source-goto-error-button me-2" onClick={onGotoError}>
              <BsBullseye aria-hidden="true" />
              Go to error
            </Button>
          )}
          <GoToLineControl className="goto-line-control" id="goto-line" value={gotoLine} onChange={setGotoLine} onSubmit={handleGoto} />
          <Dropdown align="end" className="editor-actions-menu">
            <Dropdown.Toggle variant="outline-secondary" size="sm" className="source-icon-button" aria-label="Editor actions" title="Editor actions">
              <BsThreeDotsVertical aria-hidden="true" />
            </Dropdown.Toggle>
            <Dropdown.Menu>
              <Dropdown.Item onClick={() => void handleCopySource()}>
                <BsClipboard aria-hidden="true" />
                Copy
              </Dropdown.Item>
              <Dropdown.Item onClick={() => void handlePasteSource()}>
                <BsClipboardPlus aria-hidden="true" />
                Paste
              </Dropdown.Item>
              <Dropdown.Item onClick={handleSelectAllSource}>
                <BsCheckAll aria-hidden="true" />
                Select all
              </Dropdown.Item>
              <Dropdown.Divider />
              <Dropdown.Item onClick={onFormatSource}>
                <BsTextLeft aria-hidden="true" />
                Format all
              </Dropdown.Item>
              <Dropdown.Divider />
              <Dropdown.Item disabled={!canZoomIn} onClick={handleZoomIn}>
                <BsZoomIn aria-hidden="true" />
                Zoom in
              </Dropdown.Item>
              <Dropdown.Item disabled={!canZoomOut} onClick={handleZoomOut}>
                <BsZoomOut aria-hidden="true" />
                Zoom out
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        </div>
      </div>
      <SourceCodeEditor
        ref={editorRef}
        ariaLabel="BASIC listing"
        dialect={dialect}
        extensions={extensions}
        diagnostic={draftSource === source ? diagnostic : null}
        fontSize={editorFontSize}
        id="basic-source"
        screenWidth={screenWidth}
        screenWrapHintsEnabled={screenWrapHintsEnabled}
        showLineNumbers={showLineNumbers}
        value={draftSource}
        onBlur={handleSourceBlur}
        onChange={handleSourceInput}
        onCursorChange={onCursorChange}
      />
    </section>
  )
}

function findSourceLine(source: string, lineNumber: number): { lineIndex: number; offset: number; text: string } | null {
  if (lineNumber < 1) {
    return null
  }

  const lines = source.split('\n')
  if (lineNumber > lines.length) {
    return null
  }

  let offset = 0
  for (let index = 0; index < lineNumber - 1; index += 1) {
    offset += lines[index].length + 1
  }

  return {
    lineIndex: lineNumber - 1,
    offset,
    text: lines[lineNumber - 1],
  }
}

function findClosestSourceLine(source: string, lineNumber: number): { targetLineNumber: number; lineIndex: number; offset: number; text: string } | null {
  const lines = source.split('\n')
  if (lines.length === 0) {
    return null
  }

  const targetLineNumber = Math.min(Math.max(1, lineNumber), lines.length)
  const target = findSourceLine(source, targetLineNumber)
  return target ? { ...target, targetLineNumber } : null
}

function findNextBasicLine(source: string, lineNumber: number): { targetLineNumber: number; lineIndex: number; offset: number; text: string } | null {
  const lines = source.split('\n')
  let offset = 0
  let lastBasicLine: { lineIndex: number; offset: number; text: string; basicLineNumber: number } | null = null

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const text = lines[lineIndex]
    const match = /^\s*(\d+)\b/.exec(text)
    if (match) {
      const basicLineNumber = Number.parseInt(match[1], 10)
      const currentLine = { lineIndex, offset, text, basicLineNumber }

      if (basicLineNumber >= lineNumber) {
        return { targetLineNumber: basicLineNumber, lineIndex, offset, text }
      }

      lastBasicLine = currentLine
    }
    offset += text.length + 1
  }

  return lastBasicLine
    ? { targetLineNumber: lastBasicLine.basicLineNumber, lineIndex: lastBasicLine.lineIndex, offset: lastBasicLine.offset, text: lastBasicLine.text }
    : null
}
