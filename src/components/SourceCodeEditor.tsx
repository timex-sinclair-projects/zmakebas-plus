import { linter, lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { EditorSelection, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import CodeMirror from '@uiw/react-codemirror'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, type CSSProperties } from 'react'
import { lex, scanStringLiteralDisplayItems, type BasicDialect, type BasicExtension, type Token, type TokenKind } from '../parser'
import type { SourceCursorPosition, SourceDiagnostic } from './types'
import { createZxBasicLanguageExtensions } from './zxBasicLanguage'

export type SourceCodeEditorHandle = {
  readonly focus: () => void
  readonly getSelectionText: () => string
  readonly replaceSelection: (insertedText: string) => void
  readonly selectAll: () => void
  readonly revealRange: (selectionStart: number, selectionEnd: number) => void
}

type SourceCodeEditorProps = {
  readonly id: string
  readonly dialect: BasicDialect
  readonly extensions: readonly BasicExtension[]
  readonly diagnostic: SourceDiagnostic | null
  readonly fontSize: number
  readonly screenWidth: number
  readonly screenWrapHintsEnabled: boolean
  readonly showLineNumbers: boolean
  readonly value: string
  readonly ariaLabel: string
  readonly onBlur: () => void
  readonly onChange: (value: string) => void
  readonly onCursorChange: (position: SourceCursorPosition) => void
}

export const SourceCodeEditor = forwardRef<SourceCodeEditorHandle, SourceCodeEditorProps>(function SourceCodeEditor(
  { id, dialect, extensions: basicExtensions, diagnostic, fontSize, screenWidth, screenWrapHintsEnabled, showLineNumbers, value, ariaLabel, onBlur, onChange, onCursorChange },
  ref,
) {
  const viewRef = useRef<EditorView | null>(null)
  const onBlurRef = useRef(onBlur)
  const onChangeRef = useRef(onChange)
  const onCursorChangeRef = useRef(onCursorChange)
  const cursorPositionRef = useRef<SourceCursorPosition | null>(null)

  onBlurRef.current = onBlur
  onChangeRef.current = onChange
  onCursorChangeRef.current = onCursorChange

  const basicSetup = useMemo(
    () => ({
      allowMultipleSelections: false,
      autocompletion: false,
      bracketMatching: true,
      closeBrackets: false,
      closeBracketsKeymap: false,
      completionKeymap: false,
      crosshairCursor: false,
      defaultKeymap: true,
      drawSelection: true,
      dropCursor: true,
      foldGutter: false,
      foldKeymap: false,
      highlightActiveLine: true,
      highlightActiveLineGutter: showLineNumbers,
      highlightSelectionMatches: true,
      highlightSpecialChars: true,
      history: true,
      historyKeymap: true,
      indentOnInput: false,
      lintKeymap: false,
      lineNumbers: showLineNumbers,
      rectangularSelection: false,
      searchKeymap: true,
      syntaxHighlighting: false,
    }),
    [showLineNumbers],
  )
  const editorStyle = useMemo(
    () =>
      ({
        '--editor-font-size': `${fontSize}px`,
        '--editor-line-height': `${Math.round(fontSize * 1.6)}px`,
      }) as CSSProperties,
    [fontSize],
  )

  const extensions = useMemo<Extension[]>(
    () => [
      EditorView.lineWrapping,
      EditorView.domEventHandlers({
        blur: (_event, view) => {
          window.setTimeout(() => {
            const activeElement = view.dom.ownerDocument.activeElement
            if (activeElement && view.dom.contains(activeElement)) {
              return
            }

            onBlurRef.current()
          })
        },
      }),
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet && !update.docChanged) {
          return
        }

        const position = cursorPositionFromState(update.state)
        const previousPosition = cursorPositionRef.current
        if (previousPosition?.line === position.line && previousPosition.column === position.column) {
          return
        }

        cursorPositionRef.current = position
        onCursorChangeRef.current(position)
      }),
      createScreenWrapHintExtension(dialect, basicExtensions, screenWrapHintsEnabled, screenWidth),
      linter(null),
      lintGutter(),
      ...createZxBasicLanguageExtensions(dialect, basicExtensions),
    ],
    [dialect, basicExtensions, screenWidth, screenWrapHintsEnabled],
  )

  const focus = useCallback((): void => {
    const view = viewRef.current
    if (!view) {
      return
    }

    view.contentDOM.focus({ preventScroll: true })
  }, [])

  const handleChange = useCallback((nextValue: string): void => {
    onChangeRef.current(nextValue)
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }

    const editorDiagnostic = diagnostic ? sourceDiagnosticToCodeMirrorDiagnostic(view.state, diagnostic) : null
    view.dispatch(setDiagnostics(view.state, editorDiagnostic ? [editorDiagnostic] : []))
  }, [diagnostic])

  useImperativeHandle(
    ref,
    () => ({
      focus,
      getSelectionText(): string {
        const view = viewRef.current
        if (!view) {
          return ''
        }

        return view.state.selection.ranges
          .filter((range) => !range.empty)
          .map((range) => view.state.doc.sliceString(range.from, range.to))
          .join('\n')
      },
      replaceSelection(insertedText: string): void {
        const view = viewRef.current
        if (!view) {
          return
        }

        view.dispatch(view.state.replaceSelection(insertedText))
        focus()
      },
      selectAll(): void {
        const view = viewRef.current
        if (!view) {
          return
        }

        view.dispatch({
          selection: EditorSelection.single(0, view.state.doc.length),
          scrollIntoView: true,
        })
        focus()
      },
      revealRange(selectionStart: number, selectionEnd: number): void {
        const view = viewRef.current
        if (!view) {
          return
        }

        const documentLength = view.state.doc.length
        const from = Math.min(Math.max(0, selectionStart), documentLength)
        const to = Math.min(Math.max(from, selectionEnd), documentLength)

        view.dispatch({
          selection: EditorSelection.single(from, to),
          effects: EditorView.scrollIntoView(from, { y: 'center' }),
        })
        focus()
      },
    }),
    [focus],
  )

  return (
    <div className="source-code-editor" style={editorStyle}>
      <CodeMirror
        aria-label={ariaLabel}
        basicSetup={basicSetup}
        extensions={extensions}
        height="100%"
        id={id}
        indentWithTab={false}
        onChange={handleChange}
        onCreateEditor={(view) => {
          viewRef.current = view
          const position = cursorPositionFromState(view.state)
          cursorPositionRef.current = position
          onCursorChangeRef.current(position)
        }}
        theme="light"
        value={value}
      />
    </div>
  )
})

function cursorPositionFromState(state: EditorState): SourceCursorPosition {
  const line = state.doc.lineAt(state.selection.main.head)
  return {
    line: line.number,
    column: state.selection.main.head - line.from + 1,
  }
}

function sourceDiagnosticToCodeMirrorDiagnostic(state: EditorState, sourceDiagnostic: SourceDiagnostic): Diagnostic {
  const lineNumber = Math.min(Math.max(1, sourceDiagnostic.line), state.doc.lines)
  const line = state.doc.line(lineNumber)
  const columnOffset = Math.min(Math.max(0, sourceDiagnostic.column - 1), line.length)
  const endColumnOffset = Math.min(Math.max(columnOffset + 1, (sourceDiagnostic.endColumn ?? sourceDiagnostic.column + 1) - 1), line.length)

  return {
    from: line.from + columnOffset,
    to: line.from + endColumnOffset,
    severity: 'error',
    source: sourceDiagnostic.title,
    message: sourceDiagnostic.message,
    markClass: 'source-parser-diagnostic',
  }
}

class ScreenWrapMarkerWidget extends WidgetType {
  private readonly screenWidth: number

  constructor(screenWidth: number) {
    super()
    this.screenWidth = screenWidth
  }

  toDOM(): HTMLElement {
    const marker = document.createElement('span')
    marker.className = 'cm-screen-wrap-marker'
    marker.textContent = '↵'
    marker.title = `Screen wraps here at column ${this.screenWidth}`
    marker.setAttribute('aria-hidden', 'true')
    marker.contentEditable = 'false'
    return marker
  }

  ignoreEvent(): boolean {
    return true
  }
}

function createScreenWrapHintExtension(dialect: BasicDialect, extensions: readonly BasicExtension[], enabled: boolean, screenWidth: number): Extension {
  const effectiveScreenWidth = Math.max(1, Math.trunc(screenWidth))

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = enabled ? buildScreenWrapDecorations(view, dialect, extensions, effectiveScreenWidth) : Decoration.none
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = enabled ? buildScreenWrapDecorations(update.view, dialect, extensions, effectiveScreenWidth) : Decoration.none
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  )
}

function buildScreenWrapDecorations(view: EditorView, dialect: BasicDialect, extensions: readonly BasicExtension[], screenWidth: number): DecorationSet {
  const source = view.state.doc.toString()
  const offsets = findScreenWrapMarkerOffsets(source, dialect, extensions, screenWidth)
  const screenWrapMarkerWidget = new ScreenWrapMarkerWidget(screenWidth)
  const markers = offsets.map((offset) => Decoration.widget({ widget: screenWrapMarkerWidget, side: 1 }).range(offset))

  return Decoration.set(markers, true)
}

function findScreenWrapMarkerOffsets(source: string, dialect: BasicDialect, extensions: readonly BasicExtension[], screenWidth: number): readonly number[] {
  let tokens: readonly Token[]

  try {
    tokens = lex(source, { dialect, extensions })
  } catch {
    return []
  }

  const markerOffsets: number[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.kind !== 'PRINT' && token.kind !== 'LPRINT') {
      continue
    }

    const statementEnd = findStatementEnd(tokens, index + 1)
    markerOffsets.push(...findPrintStatementScreenWrapOffsets(tokens.slice(index + 1, statementEnd), dialect, screenWidth))
    index = statementEnd - 1
  }

  return markerOffsets
}

function findStatementEnd(tokens: readonly Token[], startIndex: number): number {
  for (let index = startIndex; index < tokens.length; index += 1) {
    const kind = tokens[index].kind
    if (kind === 'ENDOFSTAT' || kind === 'ENDOFLINE' || kind === 'EOF') {
      return index
    }
  }

  return tokens.length
}

function findPrintStatementScreenWrapOffsets(tokens: readonly Token[], dialect: BasicDialect, screenWidth: number): readonly number[] {
  const markerOffsets: number[] = []
  let screenColumn: number | null = 0

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]

    if (token.kind === 'AT') {
      const atControl = readAtControl(tokens, index)
      if (!atControl || atControl.column !== 0) {
        return []
      }

      screenColumn = 0
      index = atControl.nextIndex - 1
      continue
    }

    if (skipControlArgumentKinds.has(token.kind)) {
      index = Math.min(tokens.length - 1, index + 1)
      continue
    }

    if (token.kind === 'TAB') {
      screenColumn = null
      index = Math.min(tokens.length - 1, index + 1)
      continue
    }

    if (token.kind === 'SEMICOLON') {
      continue
    }

    if (token.kind === 'APOSTROPHE') {
      screenColumn = 0
      continue
    }

    if (token.kind === 'COMMA') {
      screenColumn = screenColumn === null ? null : nextPrintZoneColumn(screenColumn, screenWidth)
      continue
    }

    if (token.kind === 'STRINGLIT') {
      if (screenColumn !== null) {
        const result = findStringLiteralWrapOffsets(token, dialect, screenColumn, screenWidth)
        markerOffsets.push(...result.markerOffsets)
        screenColumn = result.nextColumn
      }
      continue
    }

    if (isPrintableExpressionToken(token.kind)) {
      screenColumn = null
    }
  }

  return markerOffsets
}

const skipControlArgumentKinds = new Set<TokenKind>(['INK', 'PAPER', 'FLASH', 'BRIGHT', 'INVERSE', 'OVER', 'STREAM'])

function readAtControl(tokens: readonly Token[], atIndex: number): { readonly column: number; readonly nextIndex: number } | null {
  const commaIndex = tokens.findIndex((token, index) => index > atIndex && token.kind === 'COMMA')
  if (commaIndex < 0 || commaIndex + 1 >= tokens.length) {
    return null
  }

  const columnToken = tokens[commaIndex + 1]
  if (columnToken.kind !== 'NUMLIT' || typeof columnToken.value !== 'number') {
    return null
  }

  return {
    column: columnToken.value,
    nextIndex: commaIndex + 2,
  }
}

function nextPrintZoneColumn(screenColumn: number, screenWidth: number): number {
  const zoneWidth = Math.max(1, Math.floor(screenWidth / 2))
  return screenColumn < zoneWidth ? zoneWidth : 0
}

function findStringLiteralWrapOffsets(token: Token, dialect: BasicDialect, startColumn: number, screenWidth: number): { readonly markerOffsets: readonly number[]; readonly nextColumn: number } {
  const markerOffsets: number[] = []
  let screenColumn = startColumn

  for (const item of scanStringLiteralDisplayItems(token.lexeme, dialect)) {
    if (item.displayColumns === 1) {
      screenColumn = (screenColumn + 1) % screenWidth

      if (screenColumn === 0 && item.sourceEndIndex < token.lexeme.length - 1) {
        markerOffsets.push(token.span.start.offset + item.sourceEndIndex)
      }
    } else if (item.kind === 'comma') {
      screenColumn = nextPrintZoneColumn(screenColumn, screenWidth)
    } else if (item.kind === 'tab' || item.kind === 'at') {
      screenColumn = item.column % screenWidth
    }
  }

  return {
    markerOffsets,
    nextColumn: screenColumn,
  }
}

function isPrintableExpressionToken(kind: TokenKind): boolean {
  return kind === 'NUMLIT' || kind === 'VARNAME' || kind === 'RND' || kind === 'INKEY' || kind === 'PI' || kind === 'FN'
}
