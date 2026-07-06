import { type BasicTokenDefinition, zx81TokenDefinitions } from './basicTokens'
import { zx81BlockGraphicSources, zx81InverseCharacterSources } from './graphicEscapes'

export type ImportedPFile = {
  readonly source: string
}

type KeywordText = {
  readonly text: string
  readonly needsLeftPadding?: boolean
  readonly needsRightPadding?: boolean
}

const programBaseAddress = 0x407d
const pFileHeaderLength = 0x74
const lineEndByte = 0x76
const numberMarker = 0x7e

const tokenTexts = new Map<number, KeywordText>(zx81TokenDefinitions.map((definition) => [definition.byte, zx81KeywordText(definition)]))

export function importPFile(bytes: Uint8Array): ImportedPFile {
  const programBytes = extractProgramBytes(bytes)

  return {
    source: detokenizeProgram(programBytes),
  }
}

function extractProgramBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length < pFileHeaderLength) {
    throw new Error('Invalid ZX81 P file: file is too short to contain a system header.')
  }

  const dFileAddress = readWord(bytes, 3)
  const programLength = dFileAddress - programBaseAddress
  if (programLength < 0 || pFileHeaderLength + programLength > bytes.length) {
    throw new Error('Invalid ZX81 P file: D_FILE pointer does not describe a valid BASIC program area.')
  }

  return bytes.slice(pFileHeaderLength, pFileHeaderLength + programLength)
}

function detokenizeProgram(programBytes: Uint8Array): string {
  const lines: string[] = []
  let offset = 0

  while (offset < programBytes.length) {
    if (offset + 4 > programBytes.length) {
      throw new Error('Invalid ZX81 P file: truncated BASIC line header.')
    }

    const lineNumber = (programBytes[offset] << 8) | programBytes[offset + 1]
    const lineLength = readWord(programBytes, offset + 2)
    offset += 4

    if (lineLength === 0 || offset + lineLength > programBytes.length) {
      throw new Error(`Invalid ZX81 P file: truncated BASIC line ${lineNumber}.`)
    }

    const lineBytes = programBytes.subarray(offset, offset + lineLength)
    if (lineBytes[lineBytes.length - 1] !== lineEndByte) {
      throw new Error(`Invalid ZX81 P file: line ${lineNumber} is missing its terminator.`)
    }

    lines.push(`${lineNumber} ${detokenizeLine(lineBytes.subarray(0, lineBytes.length - 1)).trimEnd()}`)
    offset += lineLength
  }

  return lines.join('\n')
}

function detokenizeLine(lineBytes: Uint8Array): string {
  let output = ''
  let inString = false
  let justAppendedKeywordPadding = false

  for (let index = 0; index < lineBytes.length; index += 1) {
    const byte = lineBytes[index]

    if (inString) {
      if (byte === 0x0b) {
        output += '"'
        inString = false
      } else {
        output += byteToStringSource(byte)
      }
      justAppendedKeywordPadding = false
      continue
    }

    if (byte === numberMarker && index + 5 < lineBytes.length) {
      index += 5
      continue
    }

    if (byte === 0x00 && justAppendedKeywordPadding) {
      continue
    }

    if (byte === 0x0b) {
      output += '"'
      inString = true
      justAppendedKeywordPadding = false
      continue
    }

    const keyword = tokenTexts.get(byte)
    if (keyword) {
      if (byte === 0xea) {
        return `${output}${keyword.text} ${detokenizeRem(lineBytes.subarray(index + 1))}`
      }

      output = appendKeyword(output, keyword)
      justAppendedKeywordPadding = Boolean(keyword.needsRightPadding)
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

function zx81KeywordText(definition: BasicTokenDefinition): KeywordText {
  const tokenIndex = definition.byte < 0x80 ? definition.byte : definition.byte & 0x3f
  const firstChar = definition.text[0] ?? ''
  const lastChar = definition.text[definition.text.length - 1] ?? ''
  const isHighToken = definition.byte >= 0x80

  // Mirrors the ZX81 ROM TOKEN-ADD spacing rules.
  return {
    text: definition.text,
    needsLeftPadding: isHighToken && tokenIndex >= 0x18 && isZx81AlphanumericTokenChar(firstChar),
    needsRightPadding: isHighToken && (lastChar === '$' || isZx81AlphanumericTokenChar(lastChar)),
  }
}

function isZx81AlphanumericTokenChar(char: string): boolean {
  return /^[A-Z0-9]$/.test(char)
}

function needsSourceSeparatorBefore(output: string): boolean {
  const previous = output[output.length - 1]
  return previous !== undefined && !/[ \t(,;+\-*/=<>']/.test(previous)
}

function detokenizeRem(bytes: Uint8Array): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]
    if (byte === numberMarker && index + 5 < bytes.length) {
      index += 5
      continue
    }
    output += byteToRemSource(byte, index === bytes.length - 1)
  }
  return output
}

function byteToStringSource(byte: number): string {
  if (byte === 0xc0) {
    return '""'
  }

  return byteToPlainSource(byte)
}

function byteToRemSource(byte: number, isLastByte: boolean): string {
  if (isLastByte && byte === 0x00) {
    return '\\{0}'
  }

  const blockGraphic = zx81BlockGraphicSources.get(byte)
  if (blockGraphic !== undefined && isLastByte && blockGraphic.endsWith(' ')) {
    return `\\{${byte}}`
  }

  return byteToPlainSource(byte)
}

function byteToPlainSource(byte: number): string {
  if (byte === 0x0c) {
    return '\\\\'
  }

  if (byte === 0x00) {
    return ' '
  }

  if (byte >= 0xa6 && byte <= 0xbf) {
    return `\\${String.fromCharCode('A'.charCodeAt(0) + byte - 0xa6)}`
  }

  if (byte >= 0x9c && byte <= 0xa5) {
    return `\\${String.fromCharCode('0'.charCodeAt(0) + byte - 0x9c)}`
  }

  const blockGraphic = zx81BlockGraphicSources.get(byte)
  if (blockGraphic !== undefined) {
    return blockGraphic
  }

  const inverseCharacter = zx81InverseCharacterSources.get(byte)
  if (inverseCharacter !== undefined) {
    return inverseCharacter
  }

  if (byte === 0xc0) {
    return '`'
  }

  if (byte >= 0x1c && byte <= 0x25) {
    return String.fromCharCode('0'.charCodeAt(0) + byte - 0x1c)
  }

  if (byte >= 0x26 && byte <= 0x3f) {
    return String.fromCharCode('A'.charCodeAt(0) + byte - 0x26)
  }

  switch (byte) {
    case 0x0b:
      return '"'
    case 0x0d:
      return '$'
    case 0x0e:
      return ':'
    case 0x0f:
      return '?'
    case 0x10:
      return '('
    case 0x11:
      return ')'
    case 0x12:
      return '>'
    case 0x13:
      return '<'
    case 0x14:
      return '='
    case 0x15:
      return '+'
    case 0x16:
      return '-'
    case 0x17:
      return '*'
    case 0x18:
      return '/'
    case 0x19:
      return ';'
    case 0x1a:
      return ','
    case 0x1b:
      return '.'
    default:
      return `\\{${byte}}`
  }
}

function readWord(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}
