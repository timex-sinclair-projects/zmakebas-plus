import { spectrumTokenDefinitions, ts2068ExtensionTokenDefinitions, type BasicTokenDefinition, zx81TokenDefinitions } from '../parser/basicTokens'
import { defaultDialect, type BasicDialect, type BasicExtension } from '../parser/dialects'
import { lex } from '../parser/lexer'
import { commonSimpleTokenText } from '../parser/tokenText'
import type { Token, TokenKind } from '../parser/tokens'

type FormatBasicSourceOptions = {
  readonly dialect?: BasicDialect
  readonly extensions?: readonly BasicExtension[]
  readonly keywordCase?: FormatKeywordCase
}

export type FormatKeywordCase = 'upper' | 'lower'

type TokenFormat = {
  readonly text: string
  readonly forceSpaceAfter?: boolean
  readonly forceSpaceBefore?: boolean
  readonly noSpaceAfter?: boolean
  readonly noSpaceBefore?: boolean
  readonly wordLike?: boolean
}

type LabelProtectedLine = {
  readonly line: string
  readonly labels: ReadonlyMap<string, string>
}

type KeywordFormat = {
  readonly text: string
  readonly forceSpaceAfter: boolean
  readonly forceSpaceBefore: boolean
}

export function formatBasicSource(source: string, options: FormatBasicSourceOptions = {}): string {
  const dialect = options.dialect ?? defaultDialect
  const extensions = options.extensions ?? []
  const keywordCase = options.keywordCase ?? 'upper'
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const hasTrailingNewline = normalized.endsWith('\n')
  const lines = normalized.split('\n')
  if (hasTrailingNewline) {
    lines.pop()
  }

  const keywords = keywordFormatsFor(dialect)
  const formatted = lines.map((line) => formatBasicLine(line, { dialect, extensions, keywordCase, keywords }))
  return `${formatted.join(newline)}${hasTrailingNewline ? newline : ''}`
}

function formatBasicLine(
  line: string,
  context: {
    readonly dialect: BasicDialect
    readonly extensions: readonly BasicExtension[]
    readonly keywordCase: FormatKeywordCase
    readonly keywords: ReadonlyMap<TokenKind, KeywordFormat>
  },
): string {
  if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
    return line
  }

  const protectedLine = protectLabelReferences(line)
  let tokens: readonly Token[]
  try {
    tokens = lex(protectedLine.line, { dialect: context.dialect, extensions: context.extensions }).filter((token) => token.kind !== 'ENDOFLINE' && token.kind !== 'EOF')
  } catch {
    return line
  }

  return renderTokens(tokens.map((token) => formatToken(token, context.keywords, protectedLine.labels, context.dialect, context.keywordCase)))
}

function formatToken(
  token: Token,
  keywords: ReadonlyMap<TokenKind, KeywordFormat>,
  labels: ReadonlyMap<string, string>,
  dialect: BasicDialect,
  keywordCase: FormatKeywordCase,
): TokenFormat {
  if (token.kind === 'REM') {
    return { text: `${formatKeywordText('REM', keywordCase)}${String(token.value ?? '')}`, wordLike: true }
  }

  const keyword = keywords.get(token.kind)
  if (keyword) {
    return {
      text: formatKeywordText(keyword.text, keywordCase),
      forceSpaceAfter: keyword.forceSpaceAfter,
      forceSpaceBefore: keyword.forceSpaceBefore,
      wordLike: true,
    }
  }

  if (token.kind === 'VARNAME') {
    return { text: labels.get(token.lexeme) ?? token.lexeme, wordLike: true }
  }

  if (token.kind === 'LINENUMBER' || token.kind === 'NUMLIT' || token.kind === 'RAWBYTE') {
    return { text: token.lexeme, wordLike: true }
  }

  if (token.kind === 'STRINGLIT') {
    return { text: token.lexeme }
  }

  return formatPunctuation(token.kind, dialect)
}

function formatKeywordText(text: string, keywordCase: FormatKeywordCase): string {
  return keywordCase === 'lower' ? text.toLowerCase() : text.toUpperCase()
}

function formatPunctuation(kind: TokenKind, dialect: BasicDialect): TokenFormat {
  const text = kind === 'EXPON' ? (dialect === 'zx81' ? '**' : '^') : commonSimpleTokenText[kind] ?? pairedOperatorText(kind) ?? kind

  switch (kind) {
    case 'BEGINPAR':
      return { text }
    case 'ENDPAR':
    case 'COMMA':
    case 'SEMICOLON':
    case 'APOSTROPHE':
    case 'ENDOFSTAT':
      return { text, noSpaceBefore: true }
    case 'STREAM':
      return { text, noSpaceAfter: true }
    case 'EQUAL':
    case 'LESS':
    case 'GREAT':
    case 'PLUS':
    case 'MINUS':
    case 'MULT':
    case 'DIV':
    case 'EXPON':
    case 'LESSEQ':
    case 'GREATEQ':
    case 'NOTEQ':
      return { text, noSpaceAfter: true, noSpaceBefore: true }
    default:
      return { text }
  }
}

function renderTokens(tokens: readonly TokenFormat[]): string {
  let output = ''
  let previous: TokenFormat | null = null

  for (const token of tokens) {
    if (previous && shouldSeparate(previous, token)) {
      output += ' '
    }
    output += token.text
    previous = token
  }

  return output
}

function shouldSeparate(previous: TokenFormat, next: TokenFormat): boolean {
  if (previous.noSpaceAfter || next.noSpaceBefore) {
    return false
  }

  return Boolean(previous.forceSpaceAfter || next.forceSpaceBefore || (previous.wordLike && next.wordLike))
}

function keywordFormatsFor(dialect: BasicDialect): ReadonlyMap<TokenKind, KeywordFormat> {
  const definitions = dialect === 'zx81' ? zx81TokenDefinitions : dialect === 'ts2068' ? [...spectrumTokenDefinitions, ...ts2068ExtensionTokenDefinitions] : spectrumTokenDefinitions

  return new Map(definitions.map((definition, index) => [definition.kind, keywordFormat(definition, index)]))
}

function keywordFormat(definition: BasicTokenDefinition, index: number): KeywordFormat {
  const lastChar = definition.text[definition.text.length - 1] ?? ''
  return {
    text: definition.text,
    forceSpaceBefore: index >= 0x20 && /^[A-Z]/.test(definition.text),
    forceSpaceAfter: index >= 3 && (lastChar === '$' || lastChar >= 'A'),
  }
}

function pairedOperatorText(kind: TokenKind): string | null {
  switch (kind) {
    case 'LESSEQ':
      return '<='
    case 'GREATEQ':
      return '>='
    case 'NOTEQ':
      return '<>'
    default:
      return null
  }
}

function protectLabelReferences(line: string): LabelProtectedLine {
  const labels = new Map<string, string>()
  let output = ''
  let index = 0

  while (index < line.length) {
    if (line[index] === '"') {
      const string = readString(line, index)
      output += string.text
      index = string.nextIndex
      continue
    }

    if (isRemAt(line, index)) {
      output += line.slice(index)
      break
    }

    if (line[index] === '@' && isLabelStart(line[index + 1] ?? '')) {
      const label = readLabelReference(line, index)
      const placeholder = `zzlabelplaceholder${labels.size}`
      labels.set(placeholder, label.text)
      output += placeholder
      index = label.nextIndex
      continue
    }

    output += line[index]
    index += 1
  }

  return { labels, line: output }
}

function readString(line: string, start: number): { readonly text: string; readonly nextIndex: number } {
  let index = start + 1

  while (index < line.length) {
    if (line[index] === '\\' && line[index + 1] === '"' && countPreviousBackslashes(line, index) % 2 === 0) {
      index += 2
      continue
    }

    if (line[index] === '"') {
      if (line[index + 1] === '"') {
        index += 2
        continue
      }
      index += 1
      break
    }

    index += 1
  }

  return { text: line.slice(start, index), nextIndex: index }
}

function readLabelReference(line: string, start: number): { readonly text: string; readonly nextIndex: number } {
  let index = start + 1
  while (isLabelPart(line[index] ?? '')) {
    index += 1
  }
  return { text: line.slice(start, index), nextIndex: index }
}

function isRemAt(line: string, index: number): boolean {
  if (line.slice(index, index + 3).toUpperCase() !== 'REM') {
    return false
  }

  const previous = line[index - 1] ?? ''
  const next = line[index + 3] ?? ''
  return !isIdentifierPart(previous) && previous !== '$' && !isIdentifierPart(next) && next !== '$'
}

function countPreviousBackslashes(text: string, index: number): number {
  let count = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    count += 1
  }
  return count
}

function isLabelStart(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char)
}

function isLabelPart(char: string): boolean {
  return /[A-Za-z0-9_.-]/.test(char)
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9]/.test(char)
}
