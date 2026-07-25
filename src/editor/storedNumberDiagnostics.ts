import type { Diagnostic } from '@codemirror/lint'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { decodeStoredNumberBytes, mapGeneratedEndPosition, mapGeneratedPosition, type BasicDialect, type LabelSourceMap, type Token } from '../parser'
import type { SourcePosition } from '../parser/tokens'

/** Creates editor diagnostics and resolution actions for preserved Sinclair numeric records. */
export function createStoredNumberDiagnostics(
  state: EditorState,
  tokens: readonly Token[],
  sourceMap: LabelSourceMap | null,
  dialect: BasicDialect,
): readonly Diagnostic[] {
  return tokens.flatMap((token, index) => {
    const storedNumber = token.storedNumber
    if (token.kind !== 'NUMLIT' || !storedNumber || typeof token.value !== 'number') {
      return []
    }

    const previousToken = tokens[index - 1]
    const isBinaryLiteral = dialect !== 'zx81' && previousToken?.kind === 'BIN'
    const visibleValue = isBinaryLiteral ? Number.parseInt(token.lexeme, 2) : token.value
    const storedValue = storedNumber.kind === 'bytes' ? decodeStoredNumberBytes(storedNumber.bytes) : storedNumber.value
    const sameValue = Object.is(visibleValue, storedValue) || visibleValue === storedValue
    const from = mappedEditorOffset(state, storedNumber.span.start, sourceMap, false)
    const to = mappedEditorOffset(state, storedNumber.span.end, sourceMap, true)
    const storedValueSource = storedNumberSourceText(storedValue)
    const canRemainBinary = isBinaryLiteral && Number.isInteger(storedValue) && storedValue >= 0 && storedValue <= 0xffff
    const replacementSource = canRemainBinary ? storedValue.toString(2) : storedValueSource
    const replacementStartPosition = isBinaryLiteral && !canRemainBinary ? previousToken.span.start : token.span.start
    const replacementStart = mappedEditorOffset(state, replacementStartPosition, sourceMap, false)
    const replacementDistance = from - replacementStart
    const visibleSource = isBinaryLiteral ? `BIN ${token.lexeme}` : token.lexeme

    return [
      {
        actions: [
          {
            name: 'Use text value',
            apply(view: EditorView, currentFrom: number, currentTo: number): void {
              view.dispatch({ changes: { from: currentFrom, to: currentTo, insert: '' } })
            },
          },
          {
            name: 'Use stored value',
            apply(view: EditorView, currentFrom: number, currentTo: number): void {
              const replacementFrom = Math.max(0, currentFrom - replacementDistance)
              view.dispatch({ changes: { from: replacementFrom, to: currentTo, insert: replacementSource } })
            },
          },
        ],
        from,
        markClass: 'source-stored-number-diagnostic',
        message: sameValue
          ? storedNumber.kind === 'bytes'
            ? `Stored number uses noncanonical bytes for ${storedValueSource}.`
            : `Stored/runtime value matches the text value ${storedValueSource}.`
          : `Text value is ${visibleSource} (${visibleValue}); stored/runtime value is ${storedValueSource}.`,
        severity: sameValue ? ('info' as const) : ('warning' as const),
        source: 'Stored number',
        to,
      },
    ]
  })
}

function mappedEditorOffset(state: EditorState, position: SourcePosition, sourceMap: LabelSourceMap | null, isEnd: boolean): number {
  if (!sourceMap) {
    return sourcePositionToEditorOffset(state, position)
  }

  const mappedPosition = isEnd ? mapGeneratedEndPosition(sourceMap, position) : mapGeneratedPosition(sourceMap, position.line, position.column)
  return mappedPosition ? sourcePositionToEditorOffset(state, mappedPosition) : 0
}

function sourcePositionToEditorOffset(state: EditorState, position: SourcePosition): number {
  const line = state.doc.line(Math.min(Math.max(1, position.line), state.doc.lines))
  return line.from + Math.min(Math.max(0, position.column - 1), line.length)
}

function storedNumberSourceText(value: number): string {
  if (Object.is(value, -0)) {
    return '0'
  }

  return String(value).replace('e', 'E')
}
