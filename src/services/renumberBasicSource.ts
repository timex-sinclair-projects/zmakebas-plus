import { mapGeneratedPosition, type ExpressionNode, type LabelSourceMap, type ProgramNode, type StatementNode } from '../parser'
import type { SourcePosition, SourceSpan } from '../parser/tokens'

type RenumberBasicSourceOptions = {
  readonly ast: ProgramNode
  readonly labelIncrement?: number
  readonly labelStartLine?: number
  readonly sourceMap: LabelSourceMap | null
}

type SourceLineNumber = {
  readonly digitStart: number
  readonly oldLineNumber: number
  readonly newLineNumber: number
  readonly sourceLine: number
  readonly start: number
  readonly end: number
}

type LinePrefix = {
  readonly explicitLine: ExplicitLineSpec | null
  readonly hasCode: boolean
}

type ExplicitLineSpec = {
  readonly fieldStart: number
  readonly increment: number | null
  readonly line: number
  readonly start: number
  readonly end: number
  readonly nextIndex: number
}

type Replacement = {
  readonly start: number
  readonly end: number
  readonly text: string
}

export function renumberBasicSource(source: string, { ast, labelIncrement = 2, labelStartLine = 10, sourceMap }: RenumberBasicSourceOptions): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const normalizedSource = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const sourceLineNumbers = findSourceLineNumbers(normalizedSource, {
    labelIncrement,
    labelStartLine,
    sourceMap,
  })

  if (sourceLineNumbers.length === 0) {
    return source
  }

  const lineNumberMap = new Map<number, number>()
  const replacements: Replacement[] = []

  for (const lineNumber of sourceLineNumbers) {
    if (lineNumber.newLineNumber > 9999) {
      throw new Error('Cannot renumber: generated line numbers would exceed 9999.')
    }

    if (!lineNumberMap.has(lineNumber.oldLineNumber)) {
      lineNumberMap.set(lineNumber.oldLineNumber, lineNumber.newLineNumber)
    }
    replacements.push({
      start: lineNumber.start,
      end: lineNumber.end,
      text: formatLineNumberReplacement(lineNumber),
    })
  }

  replacements.push(...findTargetReplacements(normalizedSource, ast, sourceMap, lineNumberMap))
  return applyReplacements(normalizedSource, replacements).replace(/\n/g, newline)
}

function findSourceLineNumbers(
  source: string,
  options: {
    readonly labelIncrement: number
    readonly labelStartLine: number
    readonly sourceMap: LabelSourceMap | null
  },
): readonly SourceLineNumber[] {
  if (options.sourceMap) {
    return findLabelModeSourceLineNumbers(source, {
      labelIncrement: options.labelIncrement,
      labelStartLine: options.labelStartLine,
      sourceMap: options.sourceMap,
    })
  }

  const lines = source.endsWith('\n') ? source.slice(0, -1).split('\n') : source.split('\n')
  const sourceLineNumbers: SourceLineNumber[] = []
  let lastGeneratedLine = -1
  let nextVisibleLine = 10
  let visibleBlockEstablished = false
  let offset = 0

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const linePrefix = readLinePrefix(line)
    const explicitLine = linePrefix.explicitLine

    if (explicitLine) {
      const newLineNumber = nextAvailableLineNumber(explicitLine.line, lastGeneratedLine, nextVisibleLine, visibleBlockEstablished)
      sourceLineNumbers.push({
        oldLineNumber: explicitLine.line,
        newLineNumber,
        sourceLine: lineIndex + 1,
        digitStart: offset + explicitLine.start,
        start: offset + explicitLine.fieldStart,
        end: offset + explicitLine.end,
      })
      lastGeneratedLine = newLineNumber
      nextVisibleLine = newLineNumber + 10
      visibleBlockEstablished = true
    } else if (linePrefix.hasCode) {
      visibleBlockEstablished = false
    }

    offset += line.length + 1
  }

  return sourceLineNumbers
}

function findLabelModeSourceLineNumbers(
  source: string,
  {
    labelIncrement,
    labelStartLine,
    sourceMap,
  }: {
    readonly labelIncrement: number
    readonly labelStartLine: number
    readonly sourceMap: LabelSourceMap
  },
): readonly SourceLineNumber[] {
  const lines = source.endsWith('\n') ? source.slice(0, -1).split('\n') : source.split('\n')
  const sourceLineNumbers: SourceLineNumber[] = []
  let currentIncrement = clampInteger(labelIncrement, 1, 1000)
  let lastGeneratedLine = -1
  let nextGeneratedLine = clampInteger(labelStartLine, 0, 9999) - currentIncrement
  let nextVisibleLine = 10
  let visibleBlockEstablished = false
  let offset = 0

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const sourceLine = lineIndex + 1
    const linePrefix = readLinePrefix(line)
    const explicitLine = linePrefix.explicitLine

    if (explicitLine?.increment !== null && explicitLine?.increment !== undefined) {
      currentIncrement = explicitLine.increment
    }

    if (explicitLine) {
      const newLineNumber = nextAvailableLineNumber(explicitLine.line, lastGeneratedLine, nextVisibleLine, visibleBlockEstablished)
      sourceLineNumbers.push({
        oldLineNumber: explicitLine.line,
        newLineNumber,
        sourceLine,
        digitStart: offset + explicitLine.start,
        start: offset + explicitLine.fieldStart,
        end: offset + explicitLine.end,
      })
      nextVisibleLine = newLineNumber + 10
      visibleBlockEstablished = true

      if (linePrefix.hasCode) {
        nextGeneratedLine = newLineNumber
        lastGeneratedLine = newLineNumber
      } else {
        nextGeneratedLine = newLineNumber - currentIncrement
      }
    } else if (linePrefix.hasCode && sourceMap.originalLineToGeneratedBasicLine.has(sourceLine)) {
      nextGeneratedLine += currentIncrement
      lastGeneratedLine = nextGeneratedLine
      visibleBlockEstablished = false
    }

    offset += line.length + 1
  }

  return sourceLineNumbers
}

function readLinePrefix(line: string): LinePrefix {
  let fieldStart = 0
  let index = skipSpaces(line, fieldStart)

  if (index >= line.length || line[index] === '#') {
    return { explicitLine: null, hasCode: false }
  }

  let explicitLine = readExplicitLineSpec(line, index, fieldStart)
  if (explicitLine) {
    index = skipSpaces(line, explicitLine.nextIndex)
  }

  while (line[index] === '@') {
    const labelEnd = findLabelDeclarationEnd(line, index)
    if (labelEnd === null) {
      return { explicitLine, hasCode: index < line.length }
    }
    fieldStart = labelEnd
    index = skipSpaces(line, fieldStart)
  }

  if (!explicitLine) {
    explicitLine = readExplicitLineSpec(line, index, fieldStart)
    if (explicitLine) {
      index = skipSpaces(line, explicitLine.nextIndex)
    }
  }

  return { explicitLine, hasCode: index < line.length }
}

function readExplicitLineSpec(line: string, index: number, fieldStart: number): ExplicitLineSpec | null {
  if (!isDigit(line[index] ?? '')) {
    return null
  }

  const start = index
  while (isDigit(line[index] ?? '')) {
    index += 1
  }
  const end = index
  let increment: number | null = null

  if (line[index] === '+' && isDigit(line[index + 1] ?? '')) {
    const incrementStart = index + 1
    index = incrementStart
    while (isDigit(line[index] ?? '')) {
      index += 1
    }
    increment = Math.max(1, Number.parseInt(line.slice(incrementStart, index), 10))
  }

  return {
    fieldStart,
    increment,
    line: Number.parseInt(line.slice(start, end), 10),
    start,
    end,
    nextIndex: index,
  }
}

function findLabelDeclarationEnd(line: string, index: number): number | null {
  let cursor = index + 1
  if (!isLabelStart(line[cursor] ?? '')) {
    return null
  }

  while (isLabelPart(line[cursor] ?? '')) {
    cursor += 1
  }

  return line[cursor] === ':' ? cursor + 1 : null
}

function findTargetReplacements(
  source: string,
  ast: ProgramNode,
  sourceMap: LabelSourceMap | null,
  lineNumberMap: ReadonlyMap<number, number>,
): readonly Replacement[] {
  const replacements: Replacement[] = []

  for (const line of ast.lines) {
    for (const statement of line.statements) {
      collectTargetReplacements(source, statement, sourceMap, lineNumberMap, replacements)
    }
  }

  return replacements
}

function collectTargetReplacements(
  source: string,
  statement: StatementNode,
  sourceMap: LabelSourceMap | null,
  lineNumberMap: ReadonlyMap<number, number>,
  replacements: Replacement[],
): void {
  if (statement.type === 'ExpressionCommandStatement' && (statement.command === 'GOTO' || statement.command === 'GOSUB')) {
    addNumberLiteralReplacement(source, statement.expression, sourceMap, lineNumberMap, replacements)
    return
  }

  if (statement.type === 'OnErrStatement' && statement.action === 'GOTO') {
    addNumberLiteralReplacement(source, statement.line, sourceMap, lineNumberMap, replacements)
    return
  }

  if (statement.type === 'IfStatement') {
    for (const nestedStatement of statement.thenStatements) {
      collectTargetReplacements(source, nestedStatement, sourceMap, lineNumberMap, replacements)
    }
  }
}

function addNumberLiteralReplacement(
  source: string,
  node: ExpressionNode | null,
  sourceMap: LabelSourceMap | null,
  lineNumberMap: ReadonlyMap<number, number>,
  replacements: Replacement[],
): void {
  if (!node || node.type !== 'NumberLiteral' || !/^\d+$/.test(node.raw)) {
    return
  }

  const targetLineNumber = lineNumberMap.get(node.value)
  if (targetLineNumber === undefined) {
    return
  }

  const sourceRange = sourceRangeForSpan(node.span, sourceMap)
  if (!sourceRange || source.slice(sourceRange.start, sourceRange.end) !== node.raw) {
    return
  }

  replacements.push({
    start: sourceRange.start,
    end: sourceRange.end,
    text: String(targetLineNumber),
  })
}

function sourceRangeForSpan(span: SourceSpan, sourceMap: LabelSourceMap | null): { readonly start: number; readonly end: number } | null {
  if (!sourceMap) {
    return { start: span.start.offset, end: span.end.offset }
  }

  const start = mapGeneratedPosition(sourceMap, span.start.line, span.start.column)
  const end = mapGeneratedEndPosition(sourceMap, span.end)
  if (!start || !end) {
    return null
  }

  return { start: start.offset, end: end.offset }
}

function mapGeneratedEndPosition(sourceMap: LabelSourceMap, position: SourceSpan['end']): SourcePosition | null {
  const previousCharacter = mapGeneratedPosition(sourceMap, position.line, Math.max(1, position.column - 1))
  return previousCharacter ? { ...previousCharacter, column: previousCharacter.column + 1, offset: previousCharacter.offset + 1 } : null
}

function applyReplacements(source: string, replacements: readonly Replacement[]): string {
  const deduped = new Map<string, Replacement>()
  for (const replacement of replacements) {
    deduped.set(`${replacement.start}:${replacement.end}`, replacement)
  }

  return [...deduped.values()]
    .sort((left, right) => right.start - left.start)
    .reduce((output, replacement) => `${output.slice(0, replacement.start)}${replacement.text}${output.slice(replacement.end)}`, source)
}

function formatLineNumberReplacement(lineNumber: SourceLineNumber): string {
  const text = String(lineNumber.newLineNumber)
  return lineNumber.start < lineNumber.digitStart ? text.padStart(lineNumber.end - lineNumber.start, ' ') : text
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

function roundUpToMultipleOf10(value: number): number {
  return Math.max(10, Math.ceil(value / 10) * 10)
}

function nextAvailableLineNumber(oldLineNumber: number, lastGeneratedLine: number, nextVisibleLine: number, baseEstablished: boolean): number {
  const preferredLineNumber = baseEstablished ? nextVisibleLine : roundUpToMultipleOf10(oldLineNumber)
  return Math.max(preferredLineNumber, roundUpToMultipleOf10(lastGeneratedLine + 1))
}

function isDigit(char: string): boolean {
  return /[0-9]/.test(char)
}

function isLabelStart(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char)
}

function isLabelPart(char: string): boolean {
  return /[A-Za-z0-9_.-]/.test(char)
}
