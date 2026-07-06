import { ZxBasicLexError } from './errors'
import { spectrumTokenDefinitions, ts2068ExtensionTokenDefinitions, type BasicTokenDefinition, zx81TokenDefinitions } from './basicTokens'
import {
  defaultDialect,
  isSpectranetEnabled,
  isSpectrumFamilyDialect,
  spectranetStatementKinds,
  ts2068OnlyKeywordKinds,
  zx81OnlyStatementKinds,
  type BasicDialect,
  type BasicExtension,
} from './dialects'
import { parseSpectrumDisplayControlEscape } from './exportCommon'
import { lexerSimpleTokenText } from './tokenText'
import type { SourcePosition, SourceSpan, Token, TokenKind } from './tokens'

type KeywordSpec = {
  readonly text: string
  readonly kind: TokenKind
  readonly consumesRestOfLine?: boolean
}

export type LexOptions = {
  readonly dialect?: BasicDialect
  readonly extensions?: readonly BasicExtension[]
}

const keywordSpecs = ([
  { text: '%LISTEN', kind: 'SN_LISTEN' },
  { text: '%ACCEPT', kind: 'SN_ACCEPT' },
  { text: '%CLOSE', kind: 'SN_CLOSE' },
  { text: '%FOPEN', kind: 'SN_FOPEN' },
  { text: '%OPEN', kind: 'SN_OPEN' },
  { text: '%ONEOF', kind: 'SN_ONEOF' },
  { text: '%MOUNT', kind: 'SN_MOUNT' },
  { text: '%UMOUNT', kind: 'SN_UMOUNT' },
  { text: '%CAT', kind: 'SN_CAT' },
  { text: '%CD', kind: 'SN_CD' },
  { text: '%INFO', kind: 'SN_INFO' },
  { text: '%FS', kind: 'SN_FS' },
  { text: '%LOADSNAP', kind: 'SN_LOADSNAP' },
  { text: '%LOAD', kind: 'SN_LOAD' },
  { text: '%SAVE', kind: 'SN_SAVE' },
  { text: '%ALOAD', kind: 'SN_ALOAD' },
  { text: '%ASAVE', kind: 'SN_ASAVE' },
  { text: '%TAPEIN', kind: 'SN_TAPEIN' },
  { text: '%MKDIR', kind: 'SN_MKDIR' },
  { text: '%RMDIR', kind: 'SN_RMDIR' },
  { text: '%MV', kind: 'SN_MV' },
  { text: '%RM', kind: 'SN_RM' },
  { text: '%CP', kind: 'SN_CP' },
  { text: '%CONNECT', kind: 'SN_CONNECT' },
  { text: '%OPENDIR', kind: 'SN_OPENDIR' },
  { text: '%RECLAIM', kind: 'SN_RECLAIM' },
  { text: '%CONTROL', kind: 'SN_CONTROL' },
  { text: '%IFCONFIG', kind: 'SN_IFCONFIG' },
  { text: '%FSCONFIG', kind: 'SN_FSCONFIG' },
  ...keywordSpecsFromBasicTokens([...spectrumTokenDefinitions, ...ts2068ExtensionTokenDefinitions, ...zx81TokenDefinitions]),
  { text: 'ONERR', kind: 'ONERR' },
  { text: 'OPEN#', kind: 'OPEN' },
  { text: 'CLOSE#', kind: 'CLOSE' },
] as KeywordSpec[])
  .filter(uniqueKeywordSpec())
  .sort((left, right) => right.text.length - left.text.length)

function keywordSpecsFromBasicTokens(definitions: readonly BasicTokenDefinition[]): KeywordSpec[] {
  return definitions.filter((definition) => /^[A-Z]/.test(definition.text)).map(keywordSpecFromBasicToken)
}

function keywordSpecFromBasicToken(definition: BasicTokenDefinition): KeywordSpec {
  const spec: KeywordSpec = {
    kind: definition.kind,
    text: definition.text,
  }

  return definition.kind === 'REM' ? { ...spec, consumesRestOfLine: true } : spec
}

function uniqueKeywordSpec(): (spec: KeywordSpec) => boolean {
  const seen = new Set<string>()
  return (spec) => {
    const key = `${spec.kind}\0${spec.text}\0${spec.consumesRestOfLine ? 'rest' : ''}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  }
}

const simpleTokens = new Map<string, TokenKind>(lexerSimpleTokenText)

const pairedTokens = new Map<string, TokenKind>([
  ['<=', 'LESSEQ'],
  ['>=', 'GREATEQ'],
  ['<>', 'NOTEQ'],
  ['**', 'EXPON'],
])

type LogicalLine = {
  readonly text: string
  readonly positionAt: (index: number) => SourcePosition
}

export function lex(source: string, options: LexOptions = {}): Token[] {
  const tokens: Token[] = []
  const dialect = options.dialect ?? defaultDialect
  const extensions = options.extensions ?? []
  const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const logicalLines = buildLogicalLines(normalized)

  logicalLines.forEach((logicalLine) => {
    tokenizeLine(logicalLine, tokens, dialect, extensions)
    tokens.push(makeToken('ENDOFLINE', '', logicalLine.positionAt(logicalLine.text.length)))
  })

  tokens.push(makeToken('EOF', '', eofPosition(normalized)))
  return tokens
}

function tokenizeLine(logicalLine: LogicalLine, tokens: Token[], dialect: BasicDialect, extensions: readonly BasicExtension[]): void {
  const lineText = logicalLine.text
  const positionAt = logicalLine.positionAt
  let index = 0
  let previousSignificantToken: Token | null = null

  index = skipSpaces(lineText, index)
  if (index < lineText.length && isDigit(lineText[index])) {
    const start = index
    while (index < lineText.length && isDigit(lineText[index])) {
      index += 1
    }
    const lexeme = lineText.slice(start, index)
    previousSignificantToken = pushToken(tokens, makeToken('LINENUMBER', lexeme, positionAt(start), positionAt(index), Number(lexeme)))
  }

  while (index < lineText.length) {
    index = skipSpaces(lineText, index)
    if (index >= lineText.length) {
      break
    }

    const start = index
    const startPosition = positionAt(start)
    const paired = pairedTokens.get(lineText.slice(index, index + 2))
    if (paired) {
      index += 2
      previousSignificantToken = pushToken(tokens, makeToken(paired, lineText.slice(start, index), startPosition, positionAt(index)))
      continue
    }

    const simple = simpleTokens.get(lineText[index])
    if (simple) {
      index += 1
      const kind = simple === 'STREAM' ? 'STREAM' : simple
      previousSignificantToken = pushToken(tokens, makeToken(kind, lineText.slice(start, index), startPosition, positionAt(index)))
      continue
    }

    if (lineText[index] === '<') {
      index += 1
      previousSignificantToken = pushToken(tokens, makeToken('LESS', '<', startPosition, positionAt(index)))
      continue
    }

    if (lineText[index] === '>') {
      index += 1
      previousSignificantToken = pushToken(tokens, makeToken('GREAT', '>', startPosition, positionAt(index)))
      continue
    }

    if (lineText[index] === '"') {
      const stringToken = readString(lineText, positionAt, index)
      previousSignificantToken = pushToken(tokens, stringToken.token)
      index = stringToken.nextIndex
      continue
    }

    if (isNumberStart(lineText, index)) {
      const numberToken = readNumber(lineText, positionAt, index)
      previousSignificantToken = pushToken(tokens, numberToken.token)
      index = numberToken.nextIndex
      continue
    }

    if (isRawByteEscapeStart(lineText, index)) {
      const rawByteToken = readRawByteEscape(lineText, positionAt, index, dialect)
      tokens.push(...rawByteToken.tokens)
      index = rawByteToken.nextIndex
      continue
    }

    const keyword = matchKeyword(lineText, index, dialect, extensions)
    if (keyword) {
      if (keyword.consumesRestOfLine) {
        const lexeme = lineText.slice(index)
        tokens.push(makeToken(keyword.kind, lexeme, startPosition, positionAt(lineText.length), lexeme.slice(keyword.text.length)))
        break
      }
      index += keyword.text.length
      previousSignificantToken = pushToken(tokens, makeToken(keyword.kind, lineText.slice(start, index), startPosition, positionAt(index)))
      continue
    }

    if (isIdentifierStart(lineText[index])) {
      const variableToken = readVariable(lineText, positionAt, index)
      previousSignificantToken = pushToken(tokens, variableToken.token)
      index = variableToken.nextIndex
      continue
    }

    if (lineText[index] === '%' && canStartStatement(previousSignificantToken) && isSpectranetEnabled(dialect, extensions)) {
      throw spectranetCommandError(lineText, index, positionAt)
    }

    throw new ZxBasicLexError(`Unexpected character "${lineText[index]}".`, spanFrom(startPosition, positionAt(index + 1)))
  }
}

function isRawByteEscapeStart(lineText: string, index: number): boolean {
  return lineText[index] === '\\' && lineText[index + 1] === '{'
}

function readRawByteEscape(
  lineText: string,
  positionAt: (index: number) => SourcePosition,
  start: number,
  dialect: BasicDialect,
): { tokens: readonly Token[]; nextIndex: number } {
  const end = lineText.indexOf('}', start + 2)
  if (end === -1) {
    throw new ZxBasicLexError('Unterminated raw byte escape.', spanFrom(positionAt(start), positionAt(lineText.length)))
  }

  const rawValue = lineText.slice(start + 2, end)
  const span = spanFrom(positionAt(start), positionAt(end + 1))
  if (isSpectrumFamilyDialect(dialect)) {
    try {
      const controlBytes = parseSpectrumDisplayControlEscape(rawValue)
      if (controlBytes) {
        return {
          nextIndex: end + 1,
          tokens: controlBytes.map((value) => makeToken('RAWBYTE', lineText.slice(start, end + 1), positionAt(start), positionAt(end + 1), value)),
        }
      }
    } catch (error) {
      throw new ZxBasicLexError(`Invalid display-control escape "\\{${rawValue}}": ${error instanceof Error ? error.message : String(error)}`, span)
    }
  }

  if (!/^(?:0x[0-9a-fA-F]+|\d+)$/.test(rawValue)) {
    throw new ZxBasicLexError(`Invalid raw byte escape "\\{${rawValue}}".`, span)
  }

  const value = Number.parseInt(rawValue, rawValue.toLowerCase().startsWith('0x') ? 16 : 10)
  if (value < 0 || value > 0xff) {
    throw new ZxBasicLexError(`Raw byte escape "\\{${rawValue}}" is outside the byte range.`, span)
  }

  return {
    nextIndex: end + 1,
    tokens: [makeToken('RAWBYTE', lineText.slice(start, end + 1), positionAt(start), positionAt(end + 1), value)],
  }
}

function pushToken(tokens: Token[], token: Token): Token {
  tokens.push(token)
  return token
}

function readString(lineText: string, positionAt: (index: number) => SourcePosition, start: number): { token: Token; nextIndex: number } {
  let index = start + 1
  let value = ''

  while (index < lineText.length) {
    const char = lineText[index]
    if (isEscapedQuoteStart(lineText, index)) {
      value += '"'
      index += 2
      continue
    }

    if (char === '"') {
      if (lineText[index + 1] === '"') {
        value += '"'
        index += 2
        continue
      }
      index += 1
      return {
        token: makeToken('STRINGLIT', lineText.slice(start, index), positionAt(start), positionAt(index), value),
        nextIndex: index,
      }
    }
    value += char
    index += 1
  }

  throw new ZxBasicLexError('Unterminated string literal.', spanFrom(positionAt(start), positionAt(index)))
}

function isEscapedQuoteStart(text: string, index: number): boolean {
  return text[index] === '\\' && text[index + 1] === '"' && countPreviousBackslashes(text, index) % 2 === 0
}

function countPreviousBackslashes(text: string, index: number): number {
  let count = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    count += 1
  }
  return count
}

function readNumber(lineText: string, positionAt: (index: number) => SourcePosition, start: number): { token: Token; nextIndex: number } {
  let index = start

  while (index < lineText.length && isDigit(lineText[index])) {
    index += 1
  }

  if (lineText[index] === '.') {
    index += 1
    while (index < lineText.length && isDigit(lineText[index])) {
      index += 1
    }
  }

  if (lineText[index]?.toUpperCase() === 'E') {
    const exponentStart = index
    let exponentIndex = index + 1
    if (lineText[exponentIndex] === '+' || lineText[exponentIndex] === '-') {
      exponentIndex += 1
    }
    const digitStart = exponentIndex
    while (exponentIndex < lineText.length && isDigit(lineText[exponentIndex])) {
      exponentIndex += 1
    }
    if (exponentIndex > digitStart) {
      index = exponentIndex
    } else {
      index = exponentStart
    }
  }

  const lexeme = lineText.slice(start, index)
  return {
    token: makeToken('NUMLIT', lexeme, positionAt(start), positionAt(index), Number(lexeme)),
    nextIndex: index,
  }
}

function readVariable(lineText: string, positionAt: (index: number) => SourcePosition, start: number): { token: Token; nextIndex: number } {
  let index = start + 1
  while (index < lineText.length && isIdentifierPart(lineText[index])) {
    index += 1
  }
  if (lineText[index] === '$') {
    index += 1
  }
  const lexeme = lineText.slice(start, index)
  return {
    token: makeToken('VARNAME', lexeme, positionAt(start), positionAt(index), lexeme),
    nextIndex: index,
  }
}

function buildLogicalLines(source: string): LogicalLine[] {
  const physicalLines = source.split('\n')
  const logicalLines: LogicalLine[] = []
  let logicalText = ''
  let boundaries: SourcePosition[] = []
  let offset = 0

  physicalLines.forEach((lineText, lineIndex) => {
    if (lineIndex === physicalLines.length - 1 && lineText.length === 0 && source.endsWith('\n')) {
      return
    }

    const lineNumber = lineIndex + 1
    const continuationIndex = findContinuationIndex(lineText)
    const segmentEnd = continuationIndex ?? lineText.length
    appendLogicalSegment(lineText, segmentEnd, lineNumber, offset, boundaries, (char) => {
      logicalText += char
    })

    if (continuationIndex === null) {
      const endPosition = position(offset + segmentEnd, lineNumber, segmentEnd + 1)
      boundaries.push(endPosition)
      logicalLines.push(makeLogicalLine(logicalText, boundaries))
      logicalText = ''
      boundaries = []
    }

    offset += lineText.length + 1
  })

  if (logicalText.length > 0 || boundaries.length > 0) {
    const fallback = eofPosition(source)
    boundaries.push(fallback)
    logicalLines.push(makeLogicalLine(logicalText, boundaries))
  }

  return logicalLines
}

function appendLogicalSegment(
  lineText: string,
  segmentEnd: number,
  lineNumber: number,
  lineOffset: number,
  boundaries: SourcePosition[],
  appendChar: (char: string) => void,
): void {
  for (let index = 0; index < segmentEnd; index += 1) {
    boundaries.push(position(lineOffset + index, lineNumber, index + 1))
    appendChar(lineText[index])
  }
}

function makeLogicalLine(text: string, boundaries: readonly SourcePosition[]): LogicalLine {
  return {
    text,
    positionAt(index: number): SourcePosition {
      return boundaries[Math.min(Math.max(index, 0), boundaries.length - 1)]
    },
  }
}

function findContinuationIndex(lineText: string): number | null {
  let index = lineText.length - 1

  while (lineText[index] === ' ' || lineText[index] === '\t') {
    index -= 1
  }

  return lineText[index] === '\\' ? index : null
}

function matchKeyword(lineText: string, index: number, dialect: BasicDialect, extensions: readonly BasicExtension[]): KeywordSpec | null {
  const upperText = lineText.toUpperCase()
  for (const keyword of keywordSpecs) {
    if (!isKeywordTokenSupportedByDialect(keyword.kind, dialect, extensions)) {
      continue
    }
    if (!upperText.startsWith(keyword.text, index)) {
      continue
    }
    const previous = index === 0 ? '' : lineText[index - 1]
    const next = lineText[index + keyword.text.length] ?? ''
    if (isIdentifierPart(previous) || previous === '$') {
      continue
    }
    if (requiresRightBoundary(keyword.text) && (isIdentifierPart(next) || next === '$')) {
      continue
    }
    return keyword
  }
  return null
}

function canStartStatement(previousSignificantToken: Token | null): boolean {
  return previousSignificantToken === null || previousSignificantToken.kind === 'LINENUMBER' || previousSignificantToken.kind === 'ENDOFSTAT' || previousSignificantToken.kind === 'THEN'
}

function spectranetCommandError(
  lineText: string,
  index: number,
  positionAt: (index: number) => SourcePosition,
): ZxBasicLexError {
  const fragment = readPercentCommandFragment(lineText, index)
  const upperFragment = fragment.toUpperCase()
  const matchingCommands = spectranetCommandTexts().filter((command) => command.startsWith(upperFragment))
  const span = spanFrom(positionAt(index), positionAt(index + fragment.length))

  if (matchingCommands.length === 1 && upperFragment.length < matchingCommands[0].length) {
    return new ZxBasicLexError(`Incomplete Spectranet command "${fragment}"; did you mean "${matchingCommands[0]}"?`, span)
  }

  return new ZxBasicLexError(`Unknown or incomplete Spectranet command "${fragment}".`, span)
}

function readPercentCommandFragment(lineText: string, index: number): string {
  let next = index + 1
  while (next < lineText.length && isIdentifierPart(lineText[next])) {
    next += 1
  }
  return lineText.slice(index, next)
}

function spectranetCommandTexts(): readonly string[] {
  return keywordSpecs.filter((keyword) => spectranetStatementKinds.has(keyword.kind)).map((keyword) => keyword.text)
}

function isKeywordTokenSupportedByDialect(kind: TokenKind, dialect: BasicDialect, extensions: readonly BasicExtension[]): boolean {
  if (spectranetStatementKinds.has(kind)) {
    return isSpectranetEnabled(dialect, extensions)
  }

  if (dialect === 'spectrum') {
    return !zx81OnlyStatementKinds.has(kind) && !ts2068OnlyKeywordKinds.has(kind)
  }

  if (dialect === 'ts2068') {
    return !zx81OnlyStatementKinds.has(kind)
  }

  return true
}

function requiresRightBoundary(text: string): boolean {
  if (text.endsWith('#')) {
    return false
  }

  const last = text[text.length - 1]
  return /[A-Z0-9$#]/.test(last)
}

function isNumberStart(lineText: string, index: number): boolean {
  if (isDigit(lineText[index])) {
    return true
  }
  return lineText[index] === '.' && isDigit(lineText[index + 1] ?? '')
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z]/.test(char)
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9]/.test(char)
}

function isDigit(char: string): boolean {
  return /[0-9]/.test(char)
}

function skipSpaces(lineText: string, index: number): number {
  let next = index
  while (lineText[next] === ' ' || lineText[next] === '\t') {
    next += 1
  }
  return next
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

function spanFrom(start: SourcePosition, end: SourcePosition): SourceSpan {
  return { start, end }
}

function makeToken(kind: TokenKind, lexeme: string, start: SourcePosition, end = start, value?: number | string): Token {
  return {
    kind,
    lexeme,
    span: spanFrom(start, end),
    value,
  }
}
