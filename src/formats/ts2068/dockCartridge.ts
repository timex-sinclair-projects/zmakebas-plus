import type { ProgramFileEntry } from '../common/programFileEntry'

export type DockFileEntry = ProgramFileEntry

export type DockRecord = {
  readonly index: number
  readonly offset: number
  readonly endOffset: number
  readonly bank: number
  readonly descriptors: readonly number[]
  readonly chunks: readonly DockChunk[]
}

type DockChunk = {
  readonly index: number
  readonly descriptor: number
  readonly offset: number | null
  readonly bytes: Uint8Array
}

export type DockEntryBlock = {
  readonly entry: DockFileEntry
  readonly record: DockRecord
  readonly programAddress: number
  readonly programEndAddress: number
}

export const chunkSize = 0x2000
export const chunkCount = 8
export const dckHeaderLength = 9
export const dockBankId = 0x00
export const arosBaseAddress = 0x8000
export const arosHeaderLength = 8
export const arosProgramStartAddress = arosBaseAddress + arosHeaderLength
export const arosLanguageBasic = 0x01
export const arosCartridgeType = 0x02
export const arosAutostartEnabled = 0x01
export const basicProgramTerminator = 0x80

export function parseDockEntries(bytes: Uint8Array): DockEntryBlock[] {
  return parseDockEntriesFromRecords(parseDockRecords(bytes))
}

export function parseDockEntriesFromRecords(records: readonly DockRecord[]): DockEntryBlock[] {
  const entries: DockEntryBlock[] = []

  for (const record of records) {
    const arosHeader = readMemoryRangeOrNull(record, arosBaseAddress, arosBaseAddress + arosHeaderLength)
    if (!arosHeader) {
      entries.push({
        entry: createDockSectionSummaryEntry(record, entries.length),
        programAddress: 0,
        programEndAddress: 0,
        record,
      })
      continue
    }

    const language = arosHeader[0]
    const cartridgeType = arosHeader[1]
    const startAddress = readWord(arosHeader, 2)
    const autostart = arosHeader[5] !== 0
    const loadable = record.bank === dockBankId && language === arosLanguageBasic && cartridgeType === arosCartridgeType && startAddress >= arosProgramStartAddress && startAddress < 0x10000
    const programEndAddress = loadable ? findBasicProgramEndAddress(record, startAddress) : null
    const basicLength = programEndAddress === null ? null : programEndAddress - startAddress

    entries.push({
      entry: {
        autostart,
        autostartLine: null,
        basicLength,
        blockIndex: record.index,
        dataLength: basicLength ?? record.chunks.reduce((length, chunk) => length + (chunk.offset === null ? 0 : chunk.bytes.length), 0),
        id: entries.length,
        loadable: loadable && basicLength !== null && basicLength > 0,
        name: record.bank === dockBankId ? 'DOCK AROS' : `Bank ${record.bank} AROS`,
        type: language === arosLanguageBasic ? 'program' : 'code',
        typeLabel: language === arosLanguageBasic ? 'BASIC AROS' : 'Machine-code AROS',
      },
      programAddress: startAddress,
      programEndAddress: programEndAddress ?? startAddress,
      record,
    })
  }

  return entries
}

function createDockSectionSummaryEntry(record: DockRecord, id: number): DockEntryBlock['entry'] {
  const presentChunks = record.chunks.filter((chunk) => chunk.offset !== null)
  return {
    autostart: false,
    autostartLine: null,
    basicLength: null,
    blockIndex: record.index,
    dataLength: presentChunks.reduce((length, chunk) => length + chunk.bytes.length, 0),
    details: chunkDetails(record),
    id,
    loadable: false,
    metaOnTitleLine: true,
    name: dockBankName(record.bank),
    type: 'unknown',
    typeLabel: 'DCK section',
  }
}

function dockBankName(bank: number): string {
  switch (bank) {
    case 0x00:
      return 'DOCK bank'
    case 0xfe:
      return 'EXROM bank'
    case 0xff:
      return 'HOME bank'
    default:
      return `Bank ${bank}`
  }
}

function chunkDetails(record: DockRecord): readonly string[] {
  const chunks = record.chunks.filter((chunk) => chunk.descriptor !== 0)
  if (chunks.length === 0) {
    return ['No chunks']
  }

  return chunks.map((chunk) => `Chunk ${chunk.index}: ${chunkDescriptorLabel(chunk.descriptor)}`)
}

function chunkDescriptorLabel(descriptor: number): string {
  switch (descriptor) {
    case 0x01:
      return 'RAM'
    case 0x02:
      return 'ROM'
    case 0x03:
      return 'RAM image'
    default:
      return 'empty'
  }
}

export function parseDockRecords(bytes: Uint8Array): DockRecord[] {
  const records: DockRecord[] = []
  let offset = 0

  while (offset < bytes.length) {
    const recordOffset = offset
    if (offset + dckHeaderLength > bytes.length) {
      throw new Error('Invalid DCK file: truncated bank header.')
    }

    const bank = bytes[offset]
    const descriptors = [...bytes.slice(offset + 1, offset + dckHeaderLength)]
    for (const descriptor of descriptors) {
      if (descriptor > 0x03) {
        throw new Error('Invalid DCK file: unsupported chunk descriptor.')
      }
    }
    offset += dckHeaderLength

    const chunks: DockChunk[] = []
    for (let index = 0; index < chunkCount; index += 1) {
      const descriptor = descriptors[index]
      const hasImage = (descriptor & 0x02) !== 0
      if (!hasImage) {
        chunks.push({ bytes: new Uint8Array(chunkSize).fill(0xff), descriptor, index, offset: null })
        continue
      }

      if (offset + chunkSize > bytes.length) {
        throw new Error('Invalid DCK file: truncated chunk image.')
      }

      chunks.push({ bytes: bytes.slice(offset, offset + chunkSize), descriptor, index, offset })
      offset += chunkSize
    }

    records.push({ bank, chunks, descriptors, endOffset: offset, index: records.length, offset: recordOffset })
  }

  return records
}

function findBasicProgramEndAddress(record: DockRecord, startAddress: number): number | null {
  let address = startAddress

  while (address < 0x10000) {
    const firstByte = readMemoryByte(record, address)
    if (firstByte === null) {
      return null
    }

    if ((firstByte & 0x80) !== 0) {
      return address
    }

    if (address + 4 > 0x10000) {
      return null
    }

    const lineLengthLow = readMemoryByte(record, address + 2)
    const lineLengthHigh = readMemoryByte(record, address + 3)
    if (lineLengthLow === null || lineLengthHigh === null) {
      return null
    }

    const lineLength = lineLengthLow | (lineLengthHigh << 8)
    if (lineLength === 0 || address + 4 + lineLength > 0x10000) {
      return null
    }

    address += 4 + lineLength
  }

  return null
}

export function recordMemoryImage(record: DockRecord): Uint8Array {
  const memory = new Uint8Array(0x10000).fill(0xff)
  for (const chunk of record.chunks) {
    if (chunk.offset !== null) {
      memory.set(chunk.bytes, chunk.index * chunkSize)
    }
  }
  return memory
}

export function readMemoryRange(record: DockRecord, startAddress: number, endAddress: number): Uint8Array {
  const range = readMemoryRangeOrNull(record, startAddress, endAddress)
  if (!range) {
    throw new Error('Invalid DCK file: selected BASIC AROS program spans missing chunk data.')
  }
  return range
}

function readMemoryRangeOrNull(record: DockRecord, startAddress: number, endAddress: number): Uint8Array | null {
  if (startAddress < 0 || endAddress > 0x10000 || endAddress < startAddress) {
    return null
  }

  const output = new Uint8Array(endAddress - startAddress)
  for (let address = startAddress; address < endAddress; address += 1) {
    const byte = readMemoryByte(record, address)
    if (byte === null) {
      return null
    }
    output[address - startAddress] = byte
  }
  return output
}

function readMemoryByte(record: DockRecord, address: number): number | null {
  const chunk = record.chunks[Math.floor(address / chunkSize)]
  if (!chunk || chunk.offset === null) {
    return null
  }
  return chunk.bytes[address % chunkSize]
}

function readWord(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}
