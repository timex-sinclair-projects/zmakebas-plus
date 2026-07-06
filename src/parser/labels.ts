import type { SourcePosition, SourceSpan } from './tokens'

export type LabelModeOptions = {
  readonly enabled: boolean
  readonly startLine: number
  readonly increment: number
}

export type LabelSourceMap = {
  readonly labelDefinitions: ReadonlyMap<string, number>
  readonly originalLineToGeneratedBasicLine: ReadonlyMap<number, number>
  readonly generatedPositions: ReadonlyMap<number, readonly SourcePosition[]>
}

export type LabelPreprocessResult = {
  readonly source: string
  readonly sourceMap: LabelSourceMap | null
}

type LogicalLine = {
  readonly text: string
  readonly originalLines: readonly number[]
  readonly positionAt: (index: number) => SourcePosition
}

type PendingLabel = {
  readonly name: string
  readonly position: SourcePosition
}

type CodeLine = {
  readonly body: string
  readonly bodyOffset: number
  readonly generatedBasicLine: number
  readonly logicalLine: LogicalLine
}

type GeneratedLine = {
  readonly generatedText: string
  readonly positions: readonly SourcePosition[]
}

const labelStartPattern = /[A-Za-z0-9_]/
const labelPartPattern = /[A-Za-z0-9_.-]/

export class ZxBasicPreprocessError extends Error {
  readonly span: SourceSpan

  constructor(message: string, position: SourcePosition) {
    super(message)
    this.name = 'ZxBasicPreprocessError'
    this.span = { start: position, end: position }
  }
}

export function preprocessLabels(source: string, options: LabelModeOptions): LabelPreprocessResult {
  if (!options.enabled) {
    return { source, sourceMap: null }
  }

  const startLine = clampInteger(options.startLine, 0, 9999)
  const increment = clampInteger(options.increment, 1, 1000)
  const logicalLines = buildLogicalLines(source)
  const labelDefinitions = new Map<string, number>()
  const codeLines: CodeLine[] = []
  const originalLineToGeneratedBasicLine = new Map<number, number>()
  let nextGeneratedLine = startLine - increment
  let currentIncrement = increment
  let lastGeneratedLine = -1
  let pendingLabels: PendingLabel[] = []

  for (const logicalLine of logicalLines) {
    let index = skipSpaces(logicalLine.text, 0)

    if (index >= logicalLine.text.length || logicalLine.text[index] === '#') {
      continue
    }

    let explicitLine = readExplicitLineSpec(logicalLine.text, index)
    if (explicitLine) {
      if (explicitLine.increment !== null) {
        currentIncrement = explicitLine.increment
      }
      index = skipSpaces(logicalLine.text, explicitLine.nextIndex)
    }

    while (logicalLine.text[index] === '@') {
      const parsedLabel = readLabelDeclaration(logicalLine, index)
      pendingLabels.push({ name: parsedLabel.name, position: logicalLine.positionAt(index) })
      index = skipSpaces(logicalLine.text, parsedLabel.nextIndex)
    }

    if (!explicitLine) {
      const explicitLineAfterLabels = readExplicitLineSpec(logicalLine.text, index)
      if (explicitLineAfterLabels) {
        explicitLine = explicitLineAfterLabels
        if (explicitLineAfterLabels.increment !== null) {
          currentIncrement = explicitLineAfterLabels.increment
        }
        index = skipSpaces(logicalLine.text, explicitLineAfterLabels.nextIndex)
      }
    }

    if (index >= logicalLine.text.length) {
      if (explicitLine) {
        nextGeneratedLine = explicitLine.line - currentIncrement
      }
      continue
    }

    if (explicitLine) {
      nextGeneratedLine = explicitLine.line
    } else {
      nextGeneratedLine += currentIncrement
    }

    if (nextGeneratedLine <= lastGeneratedLine) {
      throw new ZxBasicPreprocessError(`Generated line number ${nextGeneratedLine} is not greater than previous line ${lastGeneratedLine}.`, logicalLine.positionAt(index))
    }

    if (nextGeneratedLine < 0 || nextGeneratedLine > 9999) {
      throw new ZxBasicPreprocessError(`Generated line number ${nextGeneratedLine} is outside 0 to 9999.`, logicalLine.positionAt(index))
    }

    for (const label of pendingLabels) {
      if (labelDefinitions.has(label.name)) {
        throw new ZxBasicPreprocessError(`Label @${label.name} is already defined.`, label.position)
      }
      labelDefinitions.set(label.name, nextGeneratedLine)
      originalLineToGeneratedBasicLine.set(label.position.line, nextGeneratedLine)
    }
    pendingLabels = []

    for (const originalLine of logicalLine.originalLines) {
      originalLineToGeneratedBasicLine.set(originalLine, nextGeneratedLine)
    }
    codeLines.push({
      body: logicalLine.text.slice(index),
      bodyOffset: index,
      generatedBasicLine: nextGeneratedLine,
      logicalLine,
    })
    lastGeneratedLine = nextGeneratedLine
  }

  const generatedLines = codeLines.map((line) => renderGeneratedLine(line, labelDefinitions))
  const generatedPositions = new Map<number, readonly SourcePosition[]>()

  generatedLines.forEach((line, index) => {
    const generatedSourceLine = index + 1
    generatedPositions.set(generatedSourceLine, line.positions)
  })

  return {
    source: generatedLines.map((line) => line.generatedText).join('\n'),
    sourceMap: {
      labelDefinitions,
      originalLineToGeneratedBasicLine,
      generatedPositions,
    },
  }
}

export function mapGeneratedPosition(sourceMap: LabelSourceMap | null, line: number, column: number): SourcePosition | null {
  if (!sourceMap) {
    return null
  }

  const positions = sourceMap.generatedPositions.get(line)
  if (!positions || positions.length === 0) {
    return null
  }

  return positions[Math.min(Math.max(column - 1, 0), positions.length - 1)] ?? null
}

function renderGeneratedLine(line: CodeLine, labelDefinitions: ReadonlyMap<string, number>): GeneratedLine {
  const renderedBody = replaceLabelReferences(line, labelDefinitions)
  const prefix = `${line.generatedBasicLine} `
  const prefixPosition = line.logicalLine.positionAt(line.bodyOffset)

  return {
    generatedText: `${prefix}${renderedBody.text}`,
    positions: [...Array.from({ length: prefix.length }, () => prefixPosition), ...renderedBody.positions],
  }
}

function replaceLabelReferences(line: CodeLine, labelDefinitions: ReadonlyMap<string, number>): { readonly text: string; readonly positions: readonly SourcePosition[] } {
  let text = ''
  const positions: SourcePosition[] = []
  let index = 0
  let inString = false
  let inRem = false

  while (index < line.body.length) {
    const char = line.body[index]
    const sourceIndex = line.bodyOffset + index

    if (char === '"') {
      text += char
      positions.push(line.logicalLine.positionAt(sourceIndex))
      if (inString && line.body[index + 1] === '"') {
        index += 1
        text += line.body[index]
        positions.push(line.logicalLine.positionAt(line.bodyOffset + index))
      } else {
        inString = !inString
      }
      index += 1
      continue
    }

    if (!inString && !inRem && isRemAt(line.body, index)) {
      inRem = true
    }

    if (!inString && !inRem && char === '@' && line.body[index - 1] !== '\\') {
      const label = findLabelReference(line, index, labelDefinitions)
      const targetLine = labelDefinitions.get(label.name)
      if (targetLine === undefined) {
        throw new ZxBasicPreprocessError(`Label @${label.name} is not defined.`, line.logicalLine.positionAt(sourceIndex))
      }
      const replacement = String(targetLine)
      text += replacement
      positions.push(...Array.from({ length: replacement.length }, () => line.logicalLine.positionAt(sourceIndex)))
      index = label.nextIndex
      continue
    }

    text += char
    positions.push(line.logicalLine.positionAt(sourceIndex))
    index += 1
  }

  return { text, positions }
}

function readLabelDeclaration(logicalLine: LogicalLine, index: number): { readonly name: string; readonly nextIndex: number } {
  const startIndex = index + 1
  let nextIndex = startIndex

  if (!isLabelStart(logicalLine.text[nextIndex] ?? '')) {
    throw new ZxBasicPreprocessError('Expected a label name after "@".', logicalLine.positionAt(index))
  }

  while (isLabelPart(logicalLine.text[nextIndex] ?? '')) {
    nextIndex += 1
  }

  const name = logicalLine.text.slice(startIndex, nextIndex)
  if (logicalLine.text[nextIndex] !== ':') {
    throw new ZxBasicPreprocessError(`Expected ":" after label @${name}.`, logicalLine.positionAt(nextIndex))
  }

  return { name, nextIndex: nextIndex + 1 }
}

function findLabelReference(
  line: CodeLine,
  index: number,
  labelDefinitions: ReadonlyMap<string, number>,
): { readonly name: string; readonly nextIndex: number } {
  const referenceStart = index + 1
  const referenceText = line.body.slice(referenceStart)

  if (!isLabelStart(referenceText[0] ?? '')) {
    throw new ZxBasicPreprocessError('Expected a label name after "@".', line.logicalLine.positionAt(line.bodyOffset + index))
  }

  let longestMatch: string | null = null

  for (const labelName of labelDefinitions.keys()) {
    if (!referenceText.startsWith(labelName)) {
      continue
    }

    const nextChar = referenceText[labelName.length] ?? ''
    if (isLabelPart(nextChar)) {
      continue
    }

    if (longestMatch === null || labelName.length > longestMatch.length) {
      longestMatch = labelName
    }
  }

  if (longestMatch !== null) {
    return { name: longestMatch, nextIndex: referenceStart + longestMatch.length }
  }

  let nextIndex = referenceStart
  while (isLabelPart(line.body[nextIndex] ?? '')) {
    nextIndex += 1
  }

  return { name: line.body.slice(referenceStart, nextIndex), nextIndex }
}

function readExplicitLineSpec(text: string, index: number): { readonly line: number; readonly increment: number | null; readonly nextIndex: number } | null {
  if (!isDigit(text[index])) {
    return null
  }

  let nextIndex = index
  while (isDigit(text[nextIndex])) {
    nextIndex += 1
  }

  const line = Number.parseInt(text.slice(index, nextIndex), 10)
  let increment: number | null = null

  if (text[nextIndex] === '+' && isDigit(text[nextIndex + 1] ?? '')) {
    const incrementStart = nextIndex + 1
    nextIndex = incrementStart
    while (isDigit(text[nextIndex])) {
      nextIndex += 1
    }
    increment = Math.max(1, Number.parseInt(text.slice(incrementStart, nextIndex), 10))
  }

  return { line, increment, nextIndex }
}

function buildLogicalLines(source: string): LogicalLine[] {
  const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const physicalLines = normalized.split('\n')
  const logicalLines: LogicalLine[] = []
  let logicalText = ''
  let originalLines: number[] = []
  let boundaries: SourcePosition[] = []
  let offset = 0

  physicalLines.forEach((lineText, lineIndex) => {
    if (lineIndex === physicalLines.length - 1 && lineText.length === 0 && normalized.endsWith('\n')) {
      return
    }

    const lineNumber = lineIndex + 1
    const continuationIndex = findContinuationIndex(lineText)
    const segmentEnd = continuationIndex ?? lineText.length
    originalLines.push(lineNumber)

    for (let index = 0; index < segmentEnd; index += 1) {
      boundaries.push(position(offset + index, lineNumber, index + 1))
      logicalText += lineText[index]
    }

    if (continuationIndex === null) {
      boundaries.push(position(offset + segmentEnd, lineNumber, segmentEnd + 1))
      logicalLines.push(makeLogicalLine(logicalText, originalLines, boundaries))
      logicalText = ''
      originalLines = []
      boundaries = []
    }

    offset += lineText.length + 1
  })

  if (logicalText.length > 0 || boundaries.length > 0) {
    boundaries.push(eofPosition(normalized))
    logicalLines.push(makeLogicalLine(logicalText, originalLines, boundaries))
  }

  return logicalLines
}

function makeLogicalLine(text: string, originalLines: readonly number[], boundaries: readonly SourcePosition[]): LogicalLine {
  return {
    text,
    originalLines,
    positionAt(index: number): SourcePosition {
      return boundaries[Math.min(Math.max(index, 0), boundaries.length - 1)]
    },
  }
}

function isRemAt(text: string, index: number): boolean {
  if (text.slice(index, index + 3).toUpperCase() !== 'REM') {
    return false
  }

  const previous = text[index - 1] ?? ''
  const next = text[index + 3] ?? ''
  return !isIdentifierPart(previous) && !isIdentifierPart(next)
}

function findContinuationIndex(lineText: string): number | null {
  let index = lineText.length - 1

  while (lineText[index] === ' ' || lineText[index] === '\t') {
    index -= 1
  }

  return lineText[index] === '\\' ? index : null
}

function skipSpaces(text: string, index: number): number {
  let next = index
  while (text[next] === ' ' || text[next] === '\t') {
    next += 1
  }
  return next
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum
  }

  return Math.min(maximum, Math.max(minimum, Math.trunc(value)))
}

function isDigit(char: string): boolean {
  return /[0-9]/.test(char)
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char)
}

function isLabelStart(char: string): boolean {
  return labelStartPattern.test(char)
}

function isLabelPart(char: string): boolean {
  return labelPartPattern.test(char)
}

function position(offset: number, line: number, column: number): SourcePosition {
  return { offset, line, column }
}

function eofPosition(source: string): SourcePosition {
  const lines = source.split('\n')

  if (source.endsWith('\n')) {
    return position(source.length, lines.length, 1)
  }

  const lastLine = lines[lines.length - 1] ?? ''
  return position(source.length, lines.length, lastLine.length + 1)
}
