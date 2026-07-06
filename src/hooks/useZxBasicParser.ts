import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ParseState } from '../components/types'
import { usePreference } from './usePreference'
import {
  mapGeneratedPosition,
  parseZxBasic,
  preprocessLabels,
  ZxBasicLexError,
  ZxBasicPreprocessError,
  ZxBasicSyntaxError,
  type BasicDialect,
  type BasicExtension,
  type LabelSourceMap,
} from '../parser'
import type { SourcePosition, SourceSpan } from '../parser/tokens'
import { sampleProgram } from '../services/sampleProgram'

export const defaultLabelStartLine = 10
export const defaultLabelIncrement = 2
const sourceParseDebounceMs = 350

type ParseRequest = {
  readonly dialect: BasicDialect
  readonly extensions: readonly BasicExtension[]
  readonly labelIncrement: number
  readonly labelModeEnabled: boolean
  readonly labelStartLine: number
  readonly source: string
  readonly revision: number
}

type ParseRequestInput = Omit<ParseRequest, 'revision'>

type ProcessedParseState = {
  readonly parseState: ParseState
  readonly sourceMap: LabelSourceMap | null
}

type UseZxBasicParserOptions = {
  readonly isProcessing: boolean
  readonly onProcessingStart: () => void
  readonly onProcessingEnd: () => void
}

export type ZxBasicParserState = {
  readonly automaticParsingEnabled: boolean
  readonly dialect: BasicDialect
  readonly spectranetEnabled: boolean
  readonly labelIncrement: number
  readonly labelModeEnabled: boolean
  readonly labelStartLine: number
  readonly parseState: ParseState
  readonly parsedSource: string
  readonly source: string
  readonly sourceMap: LabelSourceMap | null
  readonly validAutostartLines: readonly number[]
  readonly requestParse: (source?: string) => void
  readonly setDialect: (dialect: BasicDialect) => void
  readonly setSpectranetEnabled: (enabled: boolean) => void
  readonly setAutomaticParsingEnabled: (enabled: boolean) => void
  readonly setLabelIncrement: (increment: number) => void
  readonly setLabelModeEnabled: (enabled: boolean) => void
  readonly setLabelStartLine: (line: number) => void
  readonly setSource: (source: string) => void
}

export function useZxBasicParser({ isProcessing, onProcessingEnd, onProcessingStart }: UseZxBasicParserOptions): ZxBasicParserState {
  const [automaticParsingEnabled, setAutomaticParsingEnabled] = usePreference('automaticParsingEnabled')
  const [dialect, setDialect] = usePreference('dialect')
  const [spectranetEnabled, setSpectranetEnabled] = usePreference('spectranetEnabled')
  const [source, setSource] = useState(sampleProgram)
  const [labelModeEnabled, setLabelModeEnabled] = usePreference('labelModeEnabled')
  const [labelStartLine, setLabelStartLine] = usePreference('labelStartLine')
  const [labelIncrement, setLabelIncrement] = usePreference('labelIncrement')
  const [parseRequest, setParseRequest] = useState<ParseRequest>(() =>
    createParseRequest(
      {
        dialect,
        extensions: extensionsFor(dialect, spectranetEnabled),
        labelIncrement,
        labelModeEnabled,
        labelStartLine,
        source: sampleProgram,
      },
      0,
    ),
  )

  const createCurrentParseRequest = useCallback(
    (nextSource: string, revision: number): ParseRequest =>
      createParseRequest(
        {
          dialect,
          extensions: extensionsFor(dialect, spectranetEnabled),
          labelIncrement,
          labelModeEnabled,
          labelStartLine,
          source: nextSource,
        },
        revision,
      ),
    [dialect, labelIncrement, labelModeEnabled, labelStartLine, spectranetEnabled],
  )

  const requestParse = useCallback(
    (nextSource = source): void => {
      setParseRequest((request) => createCurrentParseRequest(nextSource, request.revision + 1))
    },
    [createCurrentParseRequest, source],
  )

  const processedParse = useMemo<ProcessedParseState>(() => {
    let sourceMap: LabelSourceMap | null = null

    try {
      const preprocessed = preprocessLabels(parseRequest.source, {
        enabled: parseRequest.labelModeEnabled,
        startLine: parseRequest.labelStartLine,
        increment: parseRequest.labelIncrement,
      })
      sourceMap = preprocessed.sourceMap
      const result = parseZxBasic(preprocessed.source, { dialect: parseRequest.dialect, extensions: parseRequest.extensions })
      return {
        parseState: {
          ok: true,
          ast: result.ast,
          generatedSource: preprocessed.source,
          tokens: result.tokens,
        },
        sourceMap,
      }
    } catch (error) {
      return {
        parseState: createParseFailureState(error, sourceMap),
        sourceMap,
      }
    }
  }, [parseRequest])

  const validAutostartLines = useMemo(
    () => (processedParse.parseState.ok ? processedParse.parseState.ast.lines.map((line) => line.lineNumber).sort((left, right) => left - right) : []),
    [processedParse.parseState],
  )

  useEffect(() => {
    if (
      source === parseRequest.source &&
      dialect === parseRequest.dialect &&
      arraysEqual(extensionsFor(dialect, spectranetEnabled), parseRequest.extensions) &&
      labelModeEnabled === parseRequest.labelModeEnabled &&
      labelStartLine === parseRequest.labelStartLine &&
      labelIncrement === parseRequest.labelIncrement
    ) {
      return
    }

    if (!automaticParsingEnabled) {
      return
    }

    const sourceChanged = source !== parseRequest.source
    const optionsChanged =
      dialect !== parseRequest.dialect ||
      !arraysEqual(extensionsFor(dialect, spectranetEnabled), parseRequest.extensions) ||
      labelModeEnabled !== parseRequest.labelModeEnabled ||
      labelStartLine !== parseRequest.labelStartLine ||
      labelIncrement !== parseRequest.labelIncrement
    const delay = sourceChanged && !optionsChanged ? sourceParseDebounceMs : 0
    const parseTimer = window.setTimeout(() => {
      onProcessingStart()
      requestParse()
    }, delay)

    return () => window.clearTimeout(parseTimer)
  }, [
    automaticParsingEnabled,
    dialect,
    labelIncrement,
    labelModeEnabled,
    labelStartLine,
    onProcessingStart,
    parseRequest.dialect,
    parseRequest.extensions,
    parseRequest.labelIncrement,
    parseRequest.labelModeEnabled,
    parseRequest.labelStartLine,
    parseRequest.source,
    requestParse,
    source,
    spectranetEnabled,
  ])

  useEffect(() => {
    if (
      isProcessing &&
      source === parseRequest.source &&
      dialect === parseRequest.dialect &&
      arraysEqual(extensionsFor(dialect, spectranetEnabled), parseRequest.extensions) &&
      labelModeEnabled === parseRequest.labelModeEnabled &&
      labelStartLine === parseRequest.labelStartLine &&
      labelIncrement === parseRequest.labelIncrement
    ) {
      onProcessingEnd()
    }
  }, [
    dialect,
    isProcessing,
    labelIncrement,
    labelModeEnabled,
    labelStartLine,
    onProcessingEnd,
    parseRequest.dialect,
    parseRequest.extensions,
    parseRequest.labelIncrement,
    parseRequest.labelModeEnabled,
    parseRequest.labelStartLine,
    parseRequest.source,
    source,
    spectranetEnabled,
  ])

  return {
    automaticParsingEnabled,
    dialect,
    spectranetEnabled,
    labelIncrement,
    labelModeEnabled,
    labelStartLine,
    parseState: processedParse.parseState,
    parsedSource: parseRequest.source,
    requestParse,
    setAutomaticParsingEnabled,
    setDialect,
    setSpectranetEnabled,
    setLabelIncrement,
    setLabelModeEnabled,
    setLabelStartLine,
    setSource,
    source,
    sourceMap: processedParse.sourceMap,
    validAutostartLines,
  }
}

function createParseRequest(input: ParseRequestInput, revision: number): ParseRequest {
  return { ...input, revision }
}

function createParseFailureState(error: unknown, sourceMap: LabelSourceMap | null): ParseState {
  if (error instanceof ZxBasicPreprocessError) {
    return {
      ok: false,
      title: 'Label error',
      message: error.message,
      line: error.span.start.line,
      column: error.span.start.column,
      tokens: [],
    }
  }

  if (error instanceof ZxBasicSyntaxError || error instanceof ZxBasicLexError) {
    const originalSpan = mapErrorSpan(sourceMap, error.span)
    return {
      ok: false,
      title: error instanceof ZxBasicLexError ? 'Token error' : 'Syntax error',
      message: error.message,
      line: originalSpan.start.line,
      column: originalSpan.start.column,
      endColumn: originalSpan.end.line === originalSpan.start.line && originalSpan.end.column > originalSpan.start.column ? originalSpan.end.column : undefined,
      tokens: [],
    }
  }

  return {
    ok: false,
    title: 'Internal error',
    message: error instanceof Error ? error.message : 'Unknown validation error.',
    tokens: [],
  }
}

function extensionsFor(dialect: BasicDialect, spectranetEnabled: boolean): readonly BasicExtension[] {
  return dialect === 'spectrum' && spectranetEnabled ? ['spectranet'] : []
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function mapErrorSpan(sourceMap: LabelSourceMap | null, span: SourceSpan): SourceSpan {
  const start = mapGeneratedPosition(sourceMap, span.start.line, span.start.column) ?? span.start
  const end = mapGeneratedEndPosition(sourceMap, span.end) ?? span.end
  return { start, end }
}

function mapGeneratedEndPosition(sourceMap: LabelSourceMap | null, position: SourcePosition): SourcePosition | null {
  if (!sourceMap) {
    return null
  }

  const previousCharacter = mapGeneratedPosition(sourceMap, position.line, Math.max(1, position.column - 1))
  return previousCharacter ? { ...previousCharacter, column: previousCharacter.column + 1, offset: previousCharacter.offset + 1 } : null
}
