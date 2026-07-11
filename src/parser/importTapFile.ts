import { isSpectrumFamilyDialect, type BasicDialect } from './dialects'
import type { ProgramFileEntry, ProgramFileEntryType } from './programFileEntry'
import { detokenizeBasicProgram } from './spectrumBasicProgram'

export type ImportedTapProgram = {
  readonly source: string
  readonly programName: string | null
}

export type TapFileEntryType = ProgramFileEntryType

export type TapFileEntry = ProgramFileEntry

const basicHeaderType = 0x00
const headerBlockFlag = 0x00
const dataBlockFlag = 0xff
const maxBasicLineNumber = 9999

type TapBlock = {
  readonly flag: number
  readonly payload: Uint8Array
}

type TapEntryBlock = {
  readonly entry: TapFileEntry
  readonly dataPayload: Uint8Array
}

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
        autostart: loadable && autostartLine !== null,
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
