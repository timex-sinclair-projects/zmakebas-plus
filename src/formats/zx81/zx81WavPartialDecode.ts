import type { PartialPFileByte } from './importPartialPFile'
import type { Zx81TapeBit } from './tape/zx81TapeSignal'

export const minimumPFileLength = 0x74
export const maximumUnavailableTailBits = 7
export const maximumConflictingFilenameBits = 4

const pFileBaseAddress = 0x4009
const maximumUnknownLengthPointerBits = 4
const filenameCharacterValues = [
  0,
  ...Array.from({ length: 10 }, (_, index) => 0x1c + index),
  ...Array.from({ length: 26 }, (_, index) => 0x26 + index),
]

export type PartialTapeByte = PartialPFileByte & {
  readonly unknownBitCount: number
}

export type PFileLengthCandidate = {
  readonly length: number
  readonly redundantPointerSupport: number
  readonly unknownBitCount: number
}

export type DecodedPartialFilename = {
  readonly conflictingBitCount: number
  readonly filename: string
}

export function expectedPFileLengths(
  bits: readonly Zx81TapeBit[],
  bitStart: number,
  bitEnd: number,
  filenameByteLength: number,
  maximumUnavailableBitCount = maximumUnavailableTailBits,
): PFileLengthCandidate[] {
  if (bitStart + (filenameByteLength + minimumPFileLength) * 8 > bitEnd) return []
  const low = readPartialTapeByte(bits, bitStart + (filenameByteLength + 11) * 8, bitEnd)
  const high = readPartialTapeByte(bits, bitStart + (filenameByteLength + 12) * 8, bitEnd)
  if (!low || !high) return []
  const unknownBitCount = low.unknownBitCount + high.unknownBitCount
  if (unknownBitCount > maximumUnknownLengthPointerBits) return []

  const maximumLength = Math.floor((bitEnd + maximumUnavailableBitCount - bitStart) / 8) - filenameByteLength
  const candidates: PFileLengthCandidate[] = []
  for (const lowValue of enumeratePartialByteValues(low)) {
    for (const highValue of enumeratePartialByteValues(high)) {
      const length = (lowValue | (highValue << 8)) - pFileBaseAddress
      if (length < minimumPFileLength || length > maximumLength) continue
      candidates.push({
        length,
        redundantPointerSupport: redundantLengthPointerSupport(
          bits,
          bitStart,
          bitEnd,
          filenameByteLength,
          length + pFileBaseAddress,
        ),
        unknownBitCount,
      })
    }
  }
  return candidates.sort((left, right) => (
    right.redundantPointerSupport - left.redundantPointerSupport || right.length - left.length
  ))
}

export function enumeratePartialByteValues(byte: PartialTapeByte): number[] {
  const values: number[] = []
  const knownValue = byte.value & byte.knownMask
  const unknownMask = (~byte.knownMask) & 0xff
  let subset = unknownMask
  do {
    values.push(knownValue | subset)
    subset = (subset - 1) & unknownMask
  } while (subset !== unknownMask)
  return values
}

export function readPartialTapeByte(bits: readonly Zx81TapeBit[], bitStart: number, bitEnd: number): PartialTapeByte | null {
  if (bitStart < 0 || bitStart >= bitEnd) return null
  let value = 0
  let knownMask = 0
  for (let index = 0; index < 8; index += 1) {
    const bit = bitStart + index < bitEnd ? bits[bitStart + index]?.automaticValue : undefined
    value <<= 1
    knownMask <<= 1
    if (bit !== null && bit !== undefined) {
      value |= bit
      knownMask |= 1
    }
  }
  return { knownMask, unknownBitCount: 8 - popcount(knownMask), value }
}

export function decodePartialFilename(bytes: readonly PartialTapeByte[]): DecodedPartialFilename | null {
  const characters: string[] = []
  let conflictingBitCount = 0
  for (const byte of bytes) {
    const characterMask = byte.knownMask & 0x7f
    let minimumMismatch = 8
    let candidates: number[] = []
    for (const value of filenameCharacterValues) {
      const mismatches = popcount((value ^ byte.value) & characterMask)
      if (mismatches < minimumMismatch) {
        minimumMismatch = mismatches
        candidates = [value]
      } else if (mismatches === minimumMismatch) {
        candidates.push(value)
      }
    }
    if (minimumMismatch > maximumConflictingFilenameBits) return null
    characters.push(candidates.length === 1 && minimumMismatch === 0 ? decodeFilenameByte(candidates[0]) : '?')
    conflictingBitCount += minimumMismatch
  }
  return { conflictingBitCount, filename: characters.join('').trim() }
}

export function popcount(value: number): number {
  let count = 0
  for (let remaining = value & 0xff; remaining !== 0; remaining &= remaining - 1) count += 1
  return count
}

function redundantLengthPointerSupport(
  bits: readonly Zx81TapeBit[],
  bitStart: number,
  bitEnd: number,
  filenameByteLength: number,
  address: number,
): number {
  let support = 0
  for (const pFileOffset of [17, 19]) {
    const low = readPartialTapeByte(bits, bitStart + (filenameByteLength + pFileOffset) * 8, bitEnd)
    const high = readPartialTapeByte(bits, bitStart + (filenameByteLength + pFileOffset + 1) * 8, bitEnd)
    if (low && high && partialByteMatches(low, address & 0xff) && partialByteMatches(high, address >> 8)) {
      support += (popcount(low.knownMask) + popcount(high.knownMask)) / 16
    }
  }
  return support
}

function partialByteMatches(byte: PartialTapeByte, value: number): boolean {
  return (value & byte.knownMask) === (byte.value & byte.knownMask)
}

function decodeFilenameByte(value: number): string {
  if (value >= 0x1c && value <= 0x25) {
    return String.fromCharCode('0'.charCodeAt(0) + value - 0x1c)
  }
  if (value >= 0x26 && value <= 0x3f) {
    return String.fromCharCode('A'.charCodeAt(0) + value - 0x26)
  }
  return value === 0 ? ' ' : '�'
}
