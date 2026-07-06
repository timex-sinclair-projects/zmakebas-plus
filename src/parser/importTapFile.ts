import { spectrumTokenDefinitions, ts2068ExtensionTokenDefinitions, type BasicTokenDefinition } from './basicTokens'
import { isSpectrumFamilyDialect, type BasicDialect } from './dialects'
import { formatSpectrumDisplayControlEscape, formatSpectrumTextControlEscape } from './exportCommon'
import { spectrumBlockGraphicSource } from './graphicEscapes'

export type ImportedTapProgram = {
  readonly source: string
  readonly programName: string | null
}

export type TapFileEntryType = 'program' | 'number-array' | 'character-array' | 'code' | 'unknown'

export type TapFileEntry = {
  readonly id: number
  readonly blockIndex: number
  readonly name: string | null
  readonly type: TapFileEntryType
  readonly typeLabel: string
  readonly dataLength: number
  readonly loadable: boolean
  readonly autostartLine: number | null
  readonly basicLength: number | null
}

type TapBlock = {
  readonly flag: number
  readonly payload: Uint8Array
}

type TapEntryBlock = {
  readonly entry: TapFileEntry
  readonly dataPayload: Uint8Array
}

type KeywordText = {
  readonly text: string
  readonly needsLeftPadding?: boolean
  readonly needsRightPadding?: boolean
}

const tokenNumberMarker = 0x0e
const lineEndByte = 0x0d
const basicHeaderType = 0x00
const headerBlockFlag = 0x00
const dataBlockFlag = 0xff
const maxBasicLineNumber = 9999

const spectrumTokenTexts = new Map<number, KeywordText>(spectrumTokenDefinitions.map((definition, tokenIndex) => [definition.byte, romKeywordText(tokenIndex, definition)]))

const ts2068TokenTexts = new Map<number, KeywordText>([
  ...spectrumTokenTexts,
  ...ts2068ExtensionTokenDefinitions.map((definition, index) => [definition.byte, romKeywordText(spectrumTokenDefinitions.length + index, definition)] as const),
])

export function importTapFile(bytes: Uint8Array, dialect: BasicDialect): ImportedTapProgram {
  const program = listTapFileEntries(bytes).find((entry) => entry.loadable)
  if (!program) {
    throw new Error('Unable to find a BASIC program in this TAP file.')
  }

  return importTapFileEntry(bytes, dialect, program.id)
}

export function importTapFileEntry(bytes: Uint8Array, dialect: BasicDialect, entryId: number): ImportedTapProgram {
  if (!isSpectrumFamilyDialect(dialect)) {
    throw new Error('TAP upload is supported in ZX Spectrum and TS2068 modes.')
  }

  const program = parseTapEntries(bytes).find(({ entry }) => entry.id === entryId)
  if (!program) {
    throw new Error('Unable to find the selected TAP entry.')
  }

  if (!program.entry.loadable || program.entry.basicLength === null) {
    throw new Error(`TAP entry "${program.entry.name ?? 'unnamed'}" is ${program.entry.typeLabel}, not a BASIC program.`)
  }

  return {
    programName: program.entry.name,
    source: detokenizeBasicProgram(program.dataPayload.slice(0, program.entry.basicLength), dialect),
  }
}

export function listTapFileEntries(bytes: Uint8Array): TapFileEntry[] {
  return parseTapEntries(bytes).map(({ entry }) => entry)
}

function parseTapBlocks(bytes: Uint8Array): TapBlock[] {
  const blocks: TapBlock[] = []
  let offset = 0

  while (offset < bytes.length) {
    if (offset + 2 > bytes.length) {
      throw new Error('Invalid TAP file: truncated block length.')
    }

    const blockLength = readWord(bytes, offset)
    offset += 2

    if (blockLength < 2 || offset + blockLength > bytes.length) {
      throw new Error('Invalid TAP file: truncated block data.')
    }

    const flag = bytes[offset]
    const payload = bytes.slice(offset + 1, offset + blockLength - 1)
    const expectedChecksum = bytes[offset + blockLength - 1]
    const actualChecksum = checksum(bytes.subarray(offset, offset + blockLength - 1))
    if (expectedChecksum !== actualChecksum) {
      throw new Error('Invalid TAP file: block checksum mismatch.')
    }

    blocks.push({ flag, payload })
    offset += blockLength
  }

  return blocks
}

function parseTapEntries(bytes: Uint8Array): TapEntryBlock[] {
  const blocks = parseTapBlocks(bytes)
  const entries: TapEntryBlock[] = []

  for (let index = 0; index < blocks.length; index += 1) {
    const header = blocks[index]
    const data = blocks[index + 1]

    if (!header || !data || header.flag !== headerBlockFlag || data.flag !== dataBlockFlag || header.payload.length !== 17) {
      continue
    }

    const type = tapEntryType(header.payload[0])
    const dataLength = readWord(header.payload, 11)
    if (data.payload.length < dataLength || dataLength === 0) {
      continue
    }

    const programLength = readWord(header.payload, 15)
    const basicLength = programLength > 0 && programLength <= dataLength ? programLength : dataLength
    const autostartLine = decodeTapAutostartLine(readWord(header.payload, 13))
    const loadable = type === 'program'
    entries.push({
      dataPayload: data.payload,
      entry: {
        autostartLine: loadable ? autostartLine : null,
        basicLength: loadable ? basicLength : null,
        blockIndex: index,
        dataLength,
        id: entries.length,
        loadable,
        name: decodeTapName(header.payload.subarray(1, 11)),
        type,
        typeLabel: tapEntryTypeLabel(type),
      },
    })
  }

  return entries
}

function decodeTapAutostartLine(value: number): number | null {
  return value <= maxBasicLineNumber ? value : null
}

function tapEntryType(value: number): TapFileEntryType {
  switch (value) {
    case basicHeaderType:
      return 'program'
    case 0x01:
      return 'number-array'
    case 0x02:
      return 'character-array'
    case 0x03:
      return 'code'
    default:
      return 'unknown'
  }
}

function tapEntryTypeLabel(type: TapFileEntryType): string {
  switch (type) {
    case 'program':
      return 'BASIC program'
    case 'number-array':
      return 'Number array'
    case 'character-array':
      return 'Character array'
    case 'code':
      return 'Code'
    case 'unknown':
      return 'Unknown'
  }
}

function detokenizeBasicProgram(programBytes: Uint8Array, dialect: BasicDialect): string {
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

function decodeTapName(bytes: Uint8Array): string | null {
  const name = String.fromCharCode(...bytes).trim()
  return name.length > 0 ? name : null
}

function readWord(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function checksum(bytes: Uint8Array): number {
  return bytes.reduce((value, byte) => value ^ byte, 0)
}
