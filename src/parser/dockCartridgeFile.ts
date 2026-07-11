import type { ProgramNode } from './ast'
import { writeWord } from './exportCommon'
import type { ProgramFileEntry } from './programFileEntry'
import { createBasicProgramBytes, detokenizeBasicProgram } from './spectrumBasicProgram'
import type { Token } from './tokens'

export type DockFileEntry = ProgramFileEntry

export type ImportedDockProgram = {
  readonly source: string
  readonly programName: string | null
}

export type DockEntryUpdateOptions = {
  readonly blockIndex: number
  readonly autostart?: boolean
}

export type DockOptions = {
  readonly autostart?: boolean
}

type DockRecord = {
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

type DockEntryBlock = {
  readonly entry: DockFileEntry
  readonly record: DockRecord
  readonly programAddress: number
  readonly programEndAddress: number
}

const chunkSize = 0x2000
const chunkCount = 8
const dckHeaderLength = 9
const dockBankId = 0x00
const arosBaseAddress = 0x8000
const arosHeaderLength = 8
const arosProgramStartAddress = arosBaseAddress + arosHeaderLength
const arosLanguageBasic = 0x01
const arosCartridgeType = 0x02
const arosAutostartEnabled = 0x01
const basicProgramTerminator = 0x80

export function listDockFileEntries(bytes: Uint8Array): DockFileEntry[] {
  return parseDockEntries(bytes).map(({ entry }) => entry)
}

export function importDockFileEntry(bytes: Uint8Array, entryId: number): ImportedDockProgram {
  const entry = parseDockEntries(bytes).find(({ entry }) => entry.id === entryId)
  if (!entry) {
    throw new Error('Unable to find the selected DCK entry.')
  }

  if (!entry.entry.loadable) {
    throw new Error(`DCK entry "${entry.entry.name ?? 'unnamed'}" is ${entry.entry.typeLabel}, not a BASIC AROS program.`)
  }

  const programBytes = readMemoryRange(entry.record, entry.programAddress, entry.programEndAddress)
  return {
    programName: null,
    source: detokenizeBasicProgram(programBytes, 'ts2068'),
  }
}

export function createDockFile(program: ProgramNode, tokens: readonly Token[], options: DockOptions = {}): Uint8Array {
  const programBytes = createBasicProgramBytes(program, tokens)
  const memory = new Uint8Array(0x10000).fill(0xff)
  const endAddress = arosProgramStartAddress + programBytes.length + 1
  if (endAddress > 0x10000) {
    throw new Error('Cannot export DCK: BASIC AROS program is too large for the DOCK upper memory bank.')
  }

  memory.set(createArosHeader(arosProgramStartAddress, usedChunkMask(arosBaseAddress, endAddress), options.autostart ?? false), arosBaseAddress)
  memory.set(programBytes, arosProgramStartAddress)
  memory[endAddress - 1] = basicProgramTerminator

  const descriptors = new Array<number>(chunkCount).fill(0)
  for (let chunk = arosBaseAddress / chunkSize; chunk < Math.ceil(endAddress / chunkSize); chunk += 1) {
    descriptors[chunk] = 0x02
  }

  return createDockRecord(dockBankId, descriptors, memory)
}

export function updateDockFileProgramEntry(originalDck: Uint8Array, program: ProgramNode, tokens: readonly Token[], options: DockEntryUpdateOptions): Uint8Array {
  const records = parseDockRecords(originalDck)
  const entry = parseDockEntriesFromRecords(records).find(({ entry: dockEntry }) => dockEntry.blockIndex === options.blockIndex)

  if (!entry?.entry.loadable) {
    throw new Error('Cannot update DCK file: selected entry is not a BASIC AROS program.')
  }

  const memory = recordMemoryImage(entry.record)
  const programBytes = createBasicProgramBytes(program, tokens)
  const endAddress = entry.programAddress + programBytes.length + 1
  if (endAddress > 0x10000) {
    throw new Error('Cannot update DCK file: BASIC AROS program is too large for the DOCK upper memory bank.')
  }

  memory.set(programBytes, entry.programAddress)
  memory[endAddress - 1] = basicProgramTerminator

  const descriptors = [...entry.record.descriptors]
  const firstChunk = Math.floor(arosBaseAddress / chunkSize)
  const lastChunk = Math.ceil(endAddress / chunkSize)
  for (let chunk = firstChunk; chunk < lastChunk; chunk += 1) {
    descriptors[chunk] = descriptors[chunk] === 0x03 ? 0x03 : 0x02
  }

  const arosHeader = readMemoryRange(entry.record, arosBaseAddress, arosBaseAddress + arosHeaderLength)
  arosHeader[4] &= ~usedChunkMask(arosBaseAddress, endAddress)
  arosHeader[5] = options.autostart ?? entry.entry.autostart ? arosAutostartEnabled : 0x00
  memory.set(arosHeader, arosBaseAddress)

  const chunks = records.map((record) => (record.index === entry.record.index ? createDockRecord(record.bank, descriptors, memory) : originalDck.slice(record.offset, record.endOffset)))
  const output = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function parseDockEntries(bytes: Uint8Array): DockEntryBlock[] {
  return parseDockEntriesFromRecords(parseDockRecords(bytes))
}

function parseDockEntriesFromRecords(records: readonly DockRecord[]): DockEntryBlock[] {
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

function parseDockRecords(bytes: Uint8Array): DockRecord[] {
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

function recordMemoryImage(record: DockRecord): Uint8Array {
  const memory = new Uint8Array(0x10000).fill(0xff)
  for (const chunk of record.chunks) {
    if (chunk.offset !== null) {
      memory.set(chunk.bytes, chunk.index * chunkSize)
    }
  }
  return memory
}

function readMemoryRange(record: DockRecord, startAddress: number, endAddress: number): Uint8Array {
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

function createArosHeader(programStartAddress: number, usedChunks: number, autostart: boolean): Uint8Array {
  const header = new Uint8Array(arosHeaderLength)
  header[0] = arosLanguageBasic
  header[1] = arosCartridgeType
  writeWord(header, 2, programStartAddress)
  header[4] = (~usedChunks) & 0xff
  header[5] = autostart ? arosAutostartEnabled : 0x00
  return header
}

function createDockRecord(bank: number, descriptors: readonly number[], memory: Uint8Array): Uint8Array {
  const payloadChunks: Uint8Array[] = []
  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    if ((descriptors[chunk] & 0x02) !== 0) {
      payloadChunks.push(memory.slice(chunk * chunkSize, (chunk + 1) * chunkSize))
    }
  }

  const output = new Uint8Array(dckHeaderLength + payloadChunks.length * chunkSize)
  output[0] = bank
  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    output[chunk + 1] = descriptors[chunk] ?? 0x00
  }

  let offset = dckHeaderLength
  for (const chunk of payloadChunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function usedChunkMask(startAddress: number, endAddress: number): number {
  let mask = 0
  for (let chunk = Math.floor(startAddress / chunkSize); chunk < Math.ceil(endAddress / chunkSize); chunk += 1) {
    mask |= 1 << chunk
  }
  return mask
}

function readWord(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}
