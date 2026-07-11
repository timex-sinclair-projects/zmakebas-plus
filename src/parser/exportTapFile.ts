import type { ProgramNode } from './ast'
import { writeWord } from './exportCommon'
import { createBasicProgramBytes } from './spectrumBasicProgram'
import type { Token } from './tokens'

const noAutostartLine = 0x8000
const defaultTapName = 'ZXBASIC'

export type TapOptions = {
  readonly filename?: string
  readonly autostartLine?: number
}

export type TapEntryUpdateOptions = TapOptions & {
  readonly blockIndex: number
}

export function createTapFile(program: ProgramNode, tokens: readonly Token[], options: TapOptions = {}): Uint8Array {
  const programBytes = createBasicProgramBytes(program, tokens)
  const headerPayload = createProgramHeaderPayload(programBytes.length, options.filename ?? defaultTapName, options.autostartLine ?? noAutostartLine)
  const headerBlock = createTapBlock(0x00, headerPayload)
  const dataBlock = createTapBlock(0xff, programBytes)
  const tap = new Uint8Array(headerBlock.length + dataBlock.length)
  tap.set(headerBlock, 0)
  tap.set(dataBlock, headerBlock.length)
  return tap
}

export function createPlus3DosFile(program: ProgramNode, tokens: readonly Token[], options: TapOptions = {}): Uint8Array {
  const programBytes = createBasicProgramBytes(program, tokens)
  const header = createPlus3DosHeader(programBytes.length, options.autostartLine ?? noAutostartLine)
  const output = new Uint8Array(header.length + programBytes.length)
  output.set(header, 0)
  output.set(programBytes, header.length)
  return output
}

export function updateTapFileProgramEntry(originalTap: Uint8Array, program: ProgramNode, tokens: readonly Token[], options: TapEntryUpdateOptions): Uint8Array {
  const blocks = parseTapBlockRecords(originalTap)
  const headerBlock = blocks[options.blockIndex]
  const dataBlock = blocks[options.blockIndex + 1]

  if (!headerBlock || !dataBlock || headerBlock.flag !== 0x00 || dataBlock.flag !== 0xff || headerBlock.payload.length !== 17 || headerBlock.payload[0] !== 0x00) {
    throw new Error('Cannot update TAP file: selected entry is not a BASIC program.')
  }

  const programBytes = createBasicProgramBytes(program, tokens)
  const updatedHeaderBlock = createTapBlock(0x00, createProgramHeaderPayload(programBytes.length, options.filename ?? defaultTapName, options.autostartLine ?? noAutostartLine))
  const updatedDataBlock = createTapBlock(0xff, programBytes)
  const chunks = blocks.map((block) => {
    if (block.index === options.blockIndex) {
      return updatedHeaderBlock
    }

    if (block.index === options.blockIndex + 1) {
      return updatedDataBlock
    }

    return originalTap.slice(block.offset, block.endOffset)
  })
  const output = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function createProgramHeaderPayload(programLength: number, filename: string, autostartLine: number): Uint8Array {
  const payload = new Uint8Array(17)
  payload[0] = 0x00

  const name = filename.slice(0, 10).padEnd(10, ' ')
  for (let index = 0; index < 10; index += 1) {
    payload[index + 1] = name.charCodeAt(index) & 0xff
  }

  writeWord(payload, 11, programLength)
  writeWord(payload, 13, autostartLine)
  writeWord(payload, 15, programLength)
  return payload
}

function createPlus3DosHeader(programLength: number, autostartLine: number): Uint8Array {
  const header = new Uint8Array(128)
  header.set([0x50, 0x4c, 0x55, 0x53, 0x33, 0x44, 0x4f, 0x53, 0x1a, 0x01, 0x00])

  writeWord(header, 11, programLength + header.length)
  header[15] = 0x00
  writeWord(header, 16, programLength)
  writeWord(header, 18, autostartLine)
  writeWord(header, 20, programLength)

  header[127] = checksumSum(header.subarray(0, 127))
  return header
}

function createTapBlock(flag: number, payload: Uint8Array): Uint8Array {
  const blockLength = payload.length + 2
  const block = new Uint8Array(blockLength + 2)
  writeWord(block, 0, blockLength)
  block[2] = flag
  block.set(payload, 3)
  block[block.length - 1] = checksum(block.subarray(2, block.length - 1))
  return block
}

type TapBlockRecord = {
  readonly index: number
  readonly offset: number
  readonly endOffset: number
  readonly flag: number
  readonly payload: Uint8Array
}

function parseTapBlockRecords(bytes: Uint8Array): TapBlockRecord[] {
  const blocks: TapBlockRecord[] = []
  let offset = 0

  while (offset < bytes.length) {
    const blockOffset = offset
    if (offset + 2 > bytes.length) {
      throw new Error('Cannot update TAP file: truncated block length.')
    }

    const blockLength = bytes[offset] | (bytes[offset + 1] << 8)
    offset += 2

    if (blockLength < 2 || offset + blockLength > bytes.length) {
      throw new Error('Cannot update TAP file: truncated block data.')
    }

    const flag = bytes[offset]
    const payload = bytes.slice(offset + 1, offset + blockLength - 1)
    const expectedChecksum = bytes[offset + blockLength - 1]
    const actualChecksum = checksum(bytes.subarray(offset, offset + blockLength - 1))
    if (expectedChecksum !== actualChecksum) {
      throw new Error('Cannot update TAP file: block checksum mismatch.')
    }

    offset += blockLength
    blocks.push({ endOffset: offset, flag, index: blocks.length, offset: blockOffset, payload })
  }

  return blocks
}

function checksum(bytes: Uint8Array): number {
  return bytes.reduce((value, byte) => value ^ byte, 0)
}

function checksumSum(bytes: Uint8Array): number {
  return bytes.reduce((value, byte) => (value + byte) & 0xff, 0)
}
