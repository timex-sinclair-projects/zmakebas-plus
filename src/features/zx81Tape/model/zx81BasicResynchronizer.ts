import type { DecodedZx81Wav, PartialPFileLineStatus } from '../../../formats'
import { detokenizeZx81Line } from '../../../formats/zx81/importPFile'
import type { Zx81TapeLogicalBit } from './zx81TapeLogicalBits'

const maximumResyncSearchBits = 8_192
const minimumValidatedLineCount = 3
const maximumRecoveredLineCount = 10_000
const maximumRecoveredLineLength = 4_096

export type Zx81TapeBasicMapping = {
  readonly decodedPreview?: string
  readonly endSample: number
  readonly firstBitId: string
  readonly pFileEnd: number
  readonly pFileStart: number
  readonly startSample: number
  readonly status: PartialPFileLineStatus
  readonly text: string
  readonly unknownBitIds: readonly string[]
}

type RecoveredBasicLine = {
  readonly bitEnd: number
  readonly bitStart: number
  readonly lineLength: number
  readonly lineNumber: number
  readonly text: string
}

/** Re-locks display-only BASIC mappings after a bounded, structurally verified bit-phase change. */
export function resynchronizeZx81BasicMappings(
  automatic: DecodedZx81Wav,
  bits: readonly Zx81TapeLogicalBit[],
  tapeBitStart: number,
  tapeBitEnd: number,
  mappings: readonly Zx81TapeBasicMapping[],
): Zx81TapeBasicMapping[] {
  const damagedMappingIndex = mappings.findIndex((mapping) => mapping.status === 'damaged')
  if (damagedMappingIndex < 0) {
    return [...mappings]
  }

  const damagedMapping = mappings[damagedMappingIndex]
  const searchStart = bitIndexForId(bits, damagedMapping.firstBitId)
  const previousLineNumber = previousKnownLineNumber(mappings, damagedMappingIndex)
  if (searchStart < 0 || previousLineNumber === null) {
    return [...mappings]
  }

  const recoveredStart = findRecoveredStart(bits, tapeBitEnd, searchStart, previousLineNumber)
  if (recoveredStart === null) {
    return [...mappings]
  }

  const recoveredLines = readRecoveredLines(bits, tapeBitStart, tapeBitEnd, recoveredStart, previousLineNumber)
  if (recoveredLines.length < minimumValidatedLineCount) {
    return [...mappings]
  }

  return [
    ...mappings.slice(0, damagedMappingIndex),
    createDamagedGapMapping(automatic, bits, tapeBitStart, damagedMapping, recoveredLines[0]),
    ...recoveredLines.map((line) => createRecoveredMapping(automatic, bits, tapeBitStart, line)),
  ]
}

function findRecoveredStart(
  bits: readonly Zx81TapeLogicalBit[],
  tapeBitEnd: number,
  searchStart: number,
  previousLineNumber: number,
): number | null {
  const minimumLineBits = 5 * 8
  const searchEnd = Math.min(tapeBitEnd - minimumLineBits, searchStart + maximumResyncSearchBits)
  for (let bitStart = searchStart; bitStart <= searchEnd; bitStart += 1) {
    let nextBitStart = bitStart
    let nextPreviousLineNumber = previousLineNumber
    let validatedLineCount = 0
    while (validatedLineCount < minimumValidatedLineCount) {
      const line = readLineAt(bits, 0, tapeBitEnd, nextBitStart, nextPreviousLineNumber)
      if (!line) {
        break
      }
      validatedLineCount += 1
      nextBitStart = line.bitEnd
      nextPreviousLineNumber = line.lineNumber
    }
    if (validatedLineCount >= minimumValidatedLineCount) {
      return bitStart
    }
  }
  return null
}

function readRecoveredLines(
  bits: readonly Zx81TapeLogicalBit[],
  tapeBitStart: number,
  tapeBitEnd: number,
  bitStart: number,
  previousLineNumber: number,
): RecoveredBasicLine[] {
  const lines: RecoveredBasicLine[] = []
  let nextBitStart = bitStart
  let nextPreviousLineNumber = previousLineNumber
  while (lines.length < maximumRecoveredLineCount) {
    const line = readLineAt(bits, tapeBitStart, tapeBitEnd, nextBitStart, nextPreviousLineNumber)
    if (!line) {
      break
    }
    lines.push(line)
    nextBitStart = line.bitEnd
    nextPreviousLineNumber = line.lineNumber
  }
  return lines
}

function readLineAt(
  bits: readonly Zx81TapeLogicalBit[],
  tapeBitStart: number,
  tapeBitEnd: number,
  bitStart: number,
  previousLineNumber: number,
): RecoveredBasicLine | null {
  const high = readTapeByte(bits, tapeBitStart, tapeBitEnd, bitStart)
  const low = readTapeByte(bits, tapeBitStart, tapeBitEnd, bitStart + 8)
  const lengthLow = readTapeByte(bits, tapeBitStart, tapeBitEnd, bitStart + 16)
  const lengthHigh = readTapeByte(bits, tapeBitStart, tapeBitEnd, bitStart + 24)
  if (high === null || low === null || lengthLow === null || lengthHigh === null) {
    return null
  }

  const lineNumber = (high << 8) | low
  const lineLength = lengthLow | (lengthHigh << 8)
  const bitEnd = bitStart + (4 + lineLength) * 8
  if (
    lineNumber <= previousLineNumber
    || lineNumber > 9_999
    || lineLength < 1
    || lineLength > maximumRecoveredLineLength
    || bitEnd > tapeBitEnd
  ) {
    return null
  }

  const lineBytes = new Uint8Array(lineLength)
  for (let byteOffset = 0; byteOffset < lineLength; byteOffset += 1) {
    const value = readTapeByte(bits, tapeBitStart, tapeBitEnd, bitStart + (4 + byteOffset) * 8)
    if (value === null) {
      return null
    }
    lineBytes[byteOffset] = value
  }
  if (lineBytes[lineLength - 1] !== 0x76) {
    return null
  }

  return {
    bitEnd,
    bitStart,
    lineLength,
    lineNumber,
    text: `${lineNumber} ${detokenizeZx81Line(lineBytes.subarray(0, -1)).trimEnd()}`,
  }
}

function readTapeByte(
  bits: readonly Zx81TapeLogicalBit[],
  tapeBitStart: number,
  tapeBitEnd: number,
  bitStart: number,
): number | null {
  if (bitStart < tapeBitStart || bitStart + 8 > tapeBitEnd) {
    return null
  }
  let value = 0
  for (let bitOffset = 0; bitOffset < 8; bitOffset += 1) {
    const bitValue = bits[bitStart + bitOffset]?.effectiveValue
    if (bitValue === null || bitValue === undefined) {
      return null
    }
    value = (value << 1) | bitValue
  }
  return value
}

function createDamagedGapMapping(
  automatic: DecodedZx81Wav,
  bits: readonly Zx81TapeLogicalBit[],
  tapeBitStart: number,
  damagedMapping: Zx81TapeBasicMapping,
  recoveredLine: RecoveredBasicLine,
): Zx81TapeBasicMapping {
  const finalGapBit = bits[recoveredLine.bitStart - 1]
  const unknownBitIds = bits
    .slice(Math.max(tapeBitStart, bitIndexForId(bits, damagedMapping.firstBitId)), recoveredLine.bitStart)
    .filter((bit) => bit.effectiveValue === null)
    .map((bit) => bit.id)
  const previewText = damagedMapping.decodedPreview
    ? `; current byte alignment: ${damagedMapping.decodedPreview}`
    : ''
  return {
    ...damagedMapping,
    endSample: finalGapBit?.endSample ?? damagedMapping.endSample,
    pFileEnd: effectivePFileOffset(tapeBitStart, automatic.filenameByteLength, recoveredLine.bitStart),
    status: 'damaged',
    text: `⟦damaged BASIC data: signal dropout${previewText}; decoding resynchronised at line ${recoveredLine.lineNumber}⟧`,
    unknownBitIds,
  }
}

function createRecoveredMapping(
  automatic: DecodedZx81Wav,
  bits: readonly Zx81TapeLogicalBit[],
  tapeBitStart: number,
  line: RecoveredBasicLine,
): Zx81TapeBasicMapping {
  const firstBit = bits[line.bitStart]
  const finalBit = bits[line.bitEnd - 1]
  const pFileStart = effectivePFileOffset(tapeBitStart, automatic.filenameByteLength, line.bitStart)
  return {
    endSample: finalBit.endSample,
    firstBitId: firstBit.id,
    pFileEnd: pFileStart + 4 + line.lineLength,
    pFileStart,
    startSample: firstBit.startSample,
    status: 'clean',
    text: line.text,
    unknownBitIds: [],
  }
}

function previousKnownLineNumber(mappings: readonly Zx81TapeBasicMapping[], end: number): number | null {
  for (let index = end - 1; index >= 0; index -= 1) {
    const match = /^(\d+)\s/.exec(mappings[index].text)
    if (match) {
      return Number(match[1])
    }
  }
  return null
}

function effectivePFileOffset(tapeBitStart: number, filenameByteLength: number, bitStart: number): number {
  return Math.max(0, Math.floor((bitStart - tapeBitStart) / 8) - filenameByteLength)
}

function bitIndexForId(bits: readonly Zx81TapeLogicalBit[], bitId: string): number {
  return bits.findIndex((bit) => bit.id === bitId || bit.physicalBitIds.includes(bitId))
}
