import type { ProgramNode } from '../../parser/ast'
import type { Token } from '../../parser/tokens'
import { writeWord } from '../common/exportCommon'
import { createBasicProgramBytes } from '../spectrum/spectrumBasicProgram'
import {
  arosAutostartEnabled,
  arosBaseAddress,
  arosCartridgeType,
  arosHeaderLength,
  arosLanguageBasic,
  arosProgramStartAddress,
  basicProgramTerminator,
  chunkCount,
  chunkSize,
  dckHeaderLength,
  dockBankId,
  parseDockEntriesFromRecords,
  parseDockRecords,
  readMemoryRange,
  recordMemoryImage,
} from './dockCartridge'

export type DockEntryUpdateOptions = {
  readonly blockIndex: number
  readonly autostart?: boolean
}

export type DockOptions = {
  readonly autostart?: boolean
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
  const entry = parseDockEntriesFromRecords(records).find(({ entry: candidate }) => candidate.blockIndex === options.blockIndex)
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
  const lastChunk = Math.ceil(endAddress / chunkSize)
  for (let chunk = Math.floor(arosBaseAddress / chunkSize); chunk < lastChunk; chunk += 1) {
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
