import type { ProgramNode } from './ast'
import { spectrumTokenDefinitions, tokenByteMap, ts2068ExtensionTokenDefinitions, type BasicTokenDefinition } from './basicTokens'
import { spectranetStatementKinds, type BasicDialect } from './dialects'
import { collectVariableStartOffsets, encodeSinclairFloatBytes, formatSpectrumDisplayControlEscape, formatSpectrumTextControlEscape, normalizeRemPayload } from './exportCommon'
import { spectrumBlockGraphicSource } from './graphicEscapes'
import { readSpectrumTextEscape } from './textEscapes'
import { spectrumSimpleTokenText } from './tokenText'
import type { Token } from './tokens'

type KeywordText = {
  readonly text: string
  readonly needsLeftPadding?: boolean
  readonly needsRightPadding?: boolean
}

const tokenNumberMarker = 0x0e
const lineEndByte = 0x0d
const defFnParameterMarker = [0x0e, 0x00, 0x00, 0x00, 0x00, 0x00]

const tokenBytes = tokenByteMap([...spectrumTokenDefinitions, ...ts2068ExtensionTokenDefinitions])
const spectrumTokenTexts = new Map<number, KeywordText>(spectrumTokenDefinitions.map((definition, tokenIndex) => [definition.byte, romKeywordText(tokenIndex, definition)]))
const ts2068TokenTexts = new Map<number, KeywordText>([
  ...spectrumTokenTexts,
  ...ts2068ExtensionTokenDefinitions.map((definition, index) => [definition.byte, romKeywordText(spectrumTokenDefinitions.length + index, definition)] as const),
])

export function createBasicProgramBytes(program: ProgramNode, tokens: readonly Token[]): Uint8Array {
  const variableOffsets = collectVariableStartOffsets(program)
  const lineBytes: number[] = []
  let index = 0

  while (index < tokens.length && tokens[index].kind !== 'EOF') {
    const lineNumber = tokens[index]
    if (lineNumber.kind !== 'LINENUMBER') {
      throw new Error(`Cannot export BASIC program: expected a line number at source line ${lineNumber.span.start.line}.`)
    }

    const lineBody: number[] = []
    let previousSignificantToken: Token | null = null
    let defFnParameterDepth: number | null = null
    let inDefFnHeader = false
    const number = Number(lineNumber.value)
    index += 1

    while (index < tokens.length && tokens[index].kind !== 'ENDOFLINE' && tokens[index].kind !== 'EOF') {
      const token = tokens[index]
      const encoded = encodeToken(token, variableOffsets.has(token.span.start.offset), previousSignificantToken)
      lineBody.push(...encoded)

      if (shouldAppendDefFnParameterMarker(token, previousSignificantToken, inDefFnHeader, defFnParameterDepth)) {
        lineBody.push(...defFnParameterMarker)
      }

      if (token.kind === 'DEFFN') {
        inDefFnHeader = true
        defFnParameterDepth = null
      } else if (inDefFnHeader) {
        if (token.kind === 'BEGINPAR') {
          defFnParameterDepth = defFnParameterDepth === null ? 1 : defFnParameterDepth + 1
        } else if (token.kind === 'ENDPAR' && defFnParameterDepth !== null) {
          defFnParameterDepth -= 1
        } else if (token.kind === 'EQUAL' && defFnParameterDepth === 0) {
          inDefFnHeader = false
          defFnParameterDepth = null
        }
      }

      if (token.kind !== 'RAWBYTE') {
        previousSignificantToken = token
      }
      index += 1
    }

    lineBody.push(lineEndByte)
    lineBytes.push((number >> 8) & 0xff, number & 0xff, lineBody.length & 0xff, (lineBody.length >> 8) & 0xff, ...lineBody)

    if (tokens[index]?.kind === 'ENDOFLINE') {
      index += 1
    }
  }

  return Uint8Array.from(lineBytes)
}

export function detokenizeBasicProgram(programBytes: Uint8Array, dialect: BasicDialect): string {
  const lines: string[] = []
  let offset = 0

  while (offset < programBytes.length) {
    if (offset + 4 > programBytes.length) {
      throw new Error('Invalid BASIC program: truncated line header.')
    }

    const lineNumber = (programBytes[offset] << 8) | programBytes[offset + 1]
    const lineLength = readWord(programBytes, offset + 2)
    offset += 4

    if (lineLength === 0 || offset + lineLength > programBytes.length) {
      throw new Error(`Invalid BASIC program: truncated line ${lineNumber}.`)
    }

    const lineBytes = programBytes.subarray(offset, offset + lineLength)
    if (lineBytes[lineBytes.length - 1] !== lineEndByte) {
      throw new Error(`Invalid BASIC program: line ${lineNumber} is missing its terminator.`)
    }

    lines.push(`${lineNumber} ${detokenizeLine(lineBytes.subarray(0, lineBytes.length - 1), dialect).trimEnd()}`)
    offset += lineLength
  }

  return lines.join('\n')
}

function shouldAppendDefFnParameterMarker(
  token: Token,
  previousSignificantToken: Token | null,
  inDefFnHeader: boolean,
  defFnParameterDepth: number | null,
): boolean {
  return inDefFnHeader && defFnParameterDepth === 1 && (previousSignificantToken?.kind === 'BEGINPAR' || previousSignificantToken?.kind === 'COMMA') && token.kind !== 'ENDPAR'
}

function encodeToken(token: Token, isVariableToken: boolean, previousSignificantToken: Token | null): number[] {
  if (spectranetStatementKinds.has(token.kind)) {
    const prefix = previousSignificantToken === null ? ' ' : ''
    return encodeSpectrumText(`${prefix}${token.lexeme} `)
  }

  if (token.kind === 'REM') {
    return [0xea, ...encodeSpectrumText(normalizeRemPayload(String(token.value ?? '')))]
  }

  if (token.kind === 'STRINGLIT' || token.kind === 'VARNAME' || isVariableToken) {
    return encodeSpectrumText(token.lexeme)
  }

  if (token.kind === 'RAWBYTE') {
    return [Number(token.value) & 0xff]
  }

  if (token.kind === 'NUMLIT') {
    if (previousSignificantToken?.kind === 'BIN') {
      return [...encodeSpectrumText(token.lexeme), tokenNumberMarker, ...encodeSpectrumNumber(parseBinaryLiteral(token))]
    }
    return [...encodeSpectrumText(token.lexeme), tokenNumberMarker, ...encodeSpectrumNumber(Number(token.value))]
  }

  const simpleText = spectrumSimpleTokenText[token.kind]
  if (simpleText) {
    return encodeSpectrumText(simpleText)
  }

  const tokenByte = tokenBytes[token.kind]
  if (tokenByte !== undefined) {
    return [tokenByte]
  }

  throw new Error(`Cannot export BASIC program: unsupported token ${token.kind} at ${token.span.start.line}:${token.span.start.column}.`)
}

function detokenizeLine(lineBytes: Uint8Array, dialect: BasicDialect): string {
  const keywordTexts = dialect === 'ts2068' ? ts2068TokenTexts : spectrumTokenTexts
  let output = ''
  let inString = false
  let justAppendedKeywordPadding = false

  for (let index = 0; index < lineBytes.length; index += 1) {
    const byte = lineBytes[index]

    if (inString) {
      const textControl = textControlSource(lineBytes, index)
      if (textControl) {
        output += textControl.source
        index += textControl.consumed - 1
        justAppendedKeywordPadding = false
        continue
      }

      output += byteToStringSource(byte)
      justAppendedKeywordPadding = false
      if (byte === 0x22) {
        inString = false
      }
      continue
    }

    if (byte === tokenNumberMarker && index + 5 < lineBytes.length) {
      index += 5
      continue
    }

    if (byte === 0x20 && justAppendedKeywordPadding) {
      continue
    }

    if (byte === 0x22) {
      output += '"'
      inString = true
      justAppendedKeywordPadding = false
      continue
    }

    if (byte === 0x3a) {
      output += ': '
      justAppendedKeywordPadding = true
      continue
    }

    const keyword = keywordTexts.get(byte)
    if (keyword) {
      if (byte === 0xea) {
        return `${output}${keyword.text} ${detokenizeRem(lineBytes.subarray(index + 1))}`
      }

      output = appendKeyword(output, keyword)
      justAppendedKeywordPadding = Boolean(keyword.needsRightPadding)
      continue
    }

    const displayControl = displayControlSource(lineBytes, index)
    if (displayControl) {
      output += displayControl.source
      index += 1
      justAppendedKeywordPadding = false
      continue
    }

    output += byteToPlainSource(byte)
    justAppendedKeywordPadding = false
  }

  return output
}

function appendKeyword(output: string, keyword: KeywordText): string {
  const leftPadding = keyword.needsLeftPadding && needsSourceSeparatorBefore(output) ? ' ' : ''
  const nextOutput = `${output}${leftPadding}${keyword.text}`
  return keyword.needsRightPadding ? `${nextOutput} ` : nextOutput
}

function romKeywordText(tokenIndex: number, definition: BasicTokenDefinition): KeywordText {
  const lastChar = definition.text[definition.text.length - 1] ?? ''

  // Mirrors the Spectrum/TS2068 ROM PO-TOKENS/PO-SEARCH spacing rules.
  return {
    text: definition.text,
    needsLeftPadding: tokenIndex >= 0x20 && /^[A-Z]/.test(definition.text),
    needsRightPadding: tokenIndex >= 3 && (lastChar === '$' || lastChar >= 'A'),
  }
}

function needsSourceSeparatorBefore(output: string): boolean {
  const previous = output[output.length - 1]
  return previous !== undefined && !/[ \t:(,;+\-*/^=<>#']/.test(previous)
}

function detokenizeRem(bytes: Uint8Array): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 1) {
    const textControl = textControlSource(bytes, index)
    if (textControl) {
      output += textControl.source
      index += textControl.consumed - 1
      continue
    }

    output += byteToRemSource(bytes[index], index === bytes.length - 1)
  }
  return output
}

function textControlSource(bytes: Uint8Array, index: number): { readonly consumed: number; readonly source: string } | null {
  return formatSpectrumTextControlEscape(bytes, index)
}

function displayControlSource(bytes: Uint8Array, index: number): { readonly source: string } | null {
  if (index + 1 >= bytes.length) {
    return null
  }

  const source = formatSpectrumDisplayControlEscape(bytes[index], bytes[index + 1])
  return source ? { source } : null
}

function byteToStringSource(byte: number): string {
  if (byte === 0x22) {
    return '"'
  }

  if (byte === 0x5c) {
    return '\\\\'
  }

  if (byte === 0x7f) {
    return '\\*'
  }

  const blockGraphic = spectrumBlockGraphicSource(byte)
  if (blockGraphic) {
    return blockGraphic
  }

  if (byte >= 0x20 && byte <= 0x7e) {
    return String.fromCharCode(byte)
  }

  return `\\{${byte}}`
}

function byteToRemSource(byte: number, isLastByte: boolean): string {
  if (byte === 0x5c) {
    return '\\\\'
  }

  if (byte === 0x7f) {
    return '\\*'
  }

  const blockGraphic = spectrumBlockGraphicSource(byte)
  if (blockGraphic) {
    if (isLastByte && blockGraphic.endsWith(' ')) {
      return `\\{${byte}}`
    }

    return blockGraphic
  }

  if (byte >= 0x20 && byte <= 0x7e) {
    return String.fromCharCode(byte)
  }

  return `\\{${byte}}`
}

function byteToPlainSource(byte: number): string {
  if (byte >= 0x20 && byte <= 0x7e) {
    return String.fromCharCode(byte)
  }

  return `\\{${byte}}`
}

function encodeSpectrumText(text: string): number[] {
  const bytes: number[] = []

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char !== '\\') {
      bytes.push(char.charCodeAt(0) & 0xff)
      continue
    }

    const escape = readSpectrumTextEscape(text, index)
    bytes.push(...escape.bytes)
    index = escape.sourceEndIndex - 1
  }

  return bytes
}

function encodeSpectrumNumber(value: number): number[] {
  const absoluteValue = Math.abs(value)

  if (Number.isInteger(value) && absoluteValue <= 65535) {
    return [0x00, 0x00, absoluteValue & 0xff, (absoluteValue >> 8) & 0xff, 0x00]
  }

  return encodeSinclairFloatBytes(absoluteValue, { exportFormat: 'BASIC program', numericRange: 'Spectrum' })
}

function parseIntegerLiteral(text: string, radix: number): number {
  if (radix === 0) {
    return Number.parseInt(text, text.toLowerCase().startsWith('0x') ? 16 : 10)
  }

  return Number.parseInt(text, radix)
}

function parseBinaryLiteral(token: Token): number {
  if (!/^[01]+$/.test(token.lexeme)) {
    throw new Error(`Cannot export BASIC program: invalid BIN literal ${token.lexeme} at ${token.span.start.line}:${token.span.start.column}.`)
  }

  return parseIntegerLiteral(token.lexeme, 2)
}

function readWord(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}
