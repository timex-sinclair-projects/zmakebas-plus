import { type PartialPFileByte } from './importPartialPFile'
import { importPFile, type ImportedPFileSourceMapping } from './importPFile'
import type { Zx81TapeBit, Zx81TapeSignalAnalysis } from './tape/zx81TapeSignal'
import {
  decodePartialFilename,
  enumeratePartialByteValues,
  expectedPFileLengths,
  maximumConflictingFilenameBits,
  maximumUnavailableTailBits,
  minimumPFileLength,
  popcount,
  readPartialTapeByte,
  type PFileLengthCandidate,
  type PartialTapeByte,
} from './zx81WavPartialDecode'

const maximumFilenameLength = 64
const maximumCandidatesPerChannel = 128
const maximumEntryLeaderSearchBits = 8_192
const maximumEntryStartClusterBits = maximumFilenameLength * 8
const maximumRecoverableUnavailableTailBits = 512
const maximumReviewableEntryUnknownBits = 512
const maximumUnknownCandidateRatio = 0.02
const maximumProvisionalUnknownCandidateRatio = 0.08
const maximumUnknownFilenameBits = 8
const maximumUnknownDFilePointerBits = 4

export type FoundCandidate = {
  readonly analysis: Zx81TapeSignalAnalysis
  readonly candidate: Candidate
  readonly channelIndex: number
  readonly signalCarrierRecoveryApplied: boolean
  readonly signalRestorationApplied: boolean
}

export type Candidate = {
  readonly bitEnd: number
  readonly bitStart: number
  readonly confidence: number
  readonly decodeError: string | null
  readonly filename: string
  readonly filenameByteLength: number
  readonly pFileBytes: Uint8Array
  readonly score: number
  readonly source: string | null
  readonly sourceMappings: readonly ImportedPFileSourceMapping[]
  readonly unknownBitCount: number
}

export function candidateStartSample(item: {
  readonly analysis: Zx81TapeSignalAnalysis
  readonly candidate: Candidate
}): number {
  return item.analysis.bits[item.candidate.bitStart]?.startSample ?? 0
}

export function findProgramCandidates(
  analysis: Zx81TapeSignalAnalysis,
  candidateAttemptLimit: number,
  candidateByteLimit: number,
  onProgress?: (fraction: number) => void,
): Candidate[] {
  const candidates: Candidate[] = []
  const candidateBudget = { remainingBytes: candidateByteLimit }
  let remainingStartAttempts = candidateAttemptLimit
  let completedStartAttempts = 0
  const progressStride = Math.max(1, Math.floor(candidateAttemptLimit / 100))
  let nextProgressAttempt = progressStride
  onProgress?.(0)
  for (const region of analysis.regions) {
    let searchStart = region.bitStart
    const lastPossibleStart = region.bitEnd - minimumPFileLength * 8
    while (
      searchStart <= lastPossibleStart
      && remainingStartAttempts > 0
      && candidates.length < maximumCandidatesPerChannel
    ) {
      const maximumStart = Math.min(lastPossibleStart, searchStart + maximumEntryLeaderSearchBits - 1)
      let entry: Candidate | null = null
      let fallbackEntry: Candidate | null = null
      let entryClusterStart = -1
      for (
        let bitStart = searchStart;
        bitStart <= maximumStart && remainingStartAttempts > 0 && candidateBudget.remainingBytes > 0;
        bitStart += 1
      ) {
        remainingStartAttempts -= 1
        completedStartAttempts += 1
        if (onProgress && completedStartAttempts >= nextProgressAttempt) {
          onProgress(completedStartAttempts / candidateAttemptLimit)
          nextProgressAttempt += progressStride
        }
        const candidate = readCandidateAt(analysis.bits, bitStart, region.bitEnd, candidateBudget)
        if (!candidate || candidate.bitStart < searchStart || candidate.bitStart < region.bitStart) continue
        if (!fallbackEntry || entrySelectionCost(candidate, searchStart) < entrySelectionCost(fallbackEntry, searchStart)) {
          fallbackEntry = candidate
        }
        if (!isReviewableEntry(candidate)) continue
        if (entryClusterStart < 0) {
          entryClusterStart = candidate.bitStart
        }
        if (candidate.bitStart > entryClusterStart + maximumEntryStartClusterBits) break
        if (
          !entry
          || (sameCandidatePayload(candidate, entry) && preferPayloadFraming(candidate, entry))
          || (
            !sameCandidatePayload(candidate, entry)
            && candidate.score > entry.score
            && (candidate.bitEnd > entry.bitEnd || !isCredibleBoundaryFilename(entry))
          )
        ) entry = candidate
      }
      entry ??= fallbackEntry
      if (!entry) break
      candidates.push(entry)
      searchStart = Math.max(searchStart + 1, entry.bitEnd)
    }
    if (remainingStartAttempts === 0 || candidates.length >= maximumCandidatesPerChannel) break
  }
  onProgress?.(1)
  return candidates
}

function isReviewableEntry(candidate: Candidate): boolean {
  return candidate.source !== null || candidate.unknownBitCount <= maximumReviewableEntryUnknownBits
}

function sameCandidatePayload(left: Candidate, right: Candidate): boolean {
  const leftPayloadStart = left.bitStart + left.filenameByteLength * 8
  const rightPayloadStart = right.bitStart + right.filenameByteLength * 8
  return left.pFileBytes.length === right.pFileBytes.length && Math.abs(leftPayloadStart - rightPayloadStart) <= 8
}

function preferPayloadFraming(candidate: Candidate, existing: Candidate): boolean {
  if (candidate.filename.startsWith('?') || existing.filename.startsWith('?')) {
    const candidateKnownCharacters = candidate.filename.length - countCharacters(candidate.filename, '?')
    const existingKnownCharacters = existing.filename.length - countCharacters(existing.filename, '?')
    if (candidateKnownCharacters !== existingKnownCharacters) return candidateKnownCharacters > existingKnownCharacters
  }
  if (isCredibleLeadingFilenameRecovery(candidate.filename, existing.filename)) return true
  if (isCredibleLeadingFilenameRecovery(existing.filename, candidate.filename)) return false
  return candidate.score > existing.score
}

function isCredibleLeadingFilenameRecovery(longer: string, shorter: string): boolean {
  if (!longer.startsWith('?') || longer.length <= shorter.length || countCharacters(longer, '?') > countCharacters(shorter, '?') + 1) {
    return false
  }
  const suffix = longer.slice(-shorter.length)
  return [...suffix].every((character, index) => character === '?' || shorter[index] === '?' || character === shorter[index])
}

function countCharacters(value: string, character: string): number {
  return [...value].filter((candidate) => candidate === character).length
}

function knownFilenameCharacterCount(candidate: Candidate): number {
  return candidate.filename.length - countCharacters(candidate.filename, '?')
}

function isCredibleBoundaryFilename(candidate: Candidate): boolean {
  return !candidate.filename.includes('?')
}

function entrySelectionCost(candidate: Candidate, searchStart: number): number {
  const boundaryDistance = Math.max(0, candidate.bitStart - searchStart) / maximumEntryLeaderSearchBits
  const unknownCost = Math.min(2, candidate.unknownBitCount / 5_000)
  const knownFilenameCharacters = knownFilenameCharacterCount(candidate)
  const damagedKnownBitCost = candidate.source === null && candidate.unknownBitCount === 0 ? 0.75 : 0
  const strictSourceBonus = candidate.source === null ? 0 : -0.5
  return boundaryDistance * 1.5 + unknownCost + damagedKnownBitCost + strictSourceBonus -
    candidate.confidence * 0.1 - knownFilenameCharacters * 0.01
}

function readCandidateAt(
  bits: readonly Zx81TapeBit[],
  bitStart: number,
  bitEnd: number,
  candidateBudget: { remainingBytes: number },
): Candidate | null {
  const filenameBytes: PartialTapeByte[] = []
  let bestCandidate: Candidate | null = null
  let ignoredTerminatorCount = 0
  for (let index = 0; index < maximumFilenameLength; index += 1) {
    const byte = readPartialTapeByte(bits, bitStart + index * 8, bitEnd)
    if (byte === null) {
      break
    }
    filenameBytes.push(byte)
    if ((byte.knownMask & 0x80) !== 0 && (byte.value & 0x80) !== 0) {
      const candidate = readCandidateAfterFilename(
        bits,
        bitStart,
        bitEnd,
        filenameBytes,
        ignoredTerminatorCount,
        candidateBudget,
      )
      if (candidate) {
        bestCandidate = candidate
        break
      }
      if (filenameBytes.length >= 3) break
      ignoredTerminatorCount += 1
      if (ignoredTerminatorCount > maximumConflictingFilenameBits) break
    }
  }
  return bestCandidate
}

function readCandidateAfterFilename(
  bits: readonly Zx81TapeBit[],
  bitStart: number,
  bitEnd: number,
  filenameBytes: readonly PartialTapeByte[],
  ignoredTerminatorCount: number,
  candidateBudget: { remainingBytes: number },
): Candidate | null {
  const filenameByteLength = filenameBytes.length
  const filenameUnknownBitCount = filenameBytes.reduce((total, byte) => total + byte.unknownBitCount, 0)
  const decodedFilename = decodePartialFilename(filenameBytes)
  const filename = decodedFilename?.filename ?? ''
  const filenameConflictingBitCount = (decodedFilename?.conflictingBitCount ?? 0) + ignoredTerminatorCount
  if (
    !decodedFilename ||
    filenameUnknownBitCount > maximumUnknownFilenameBits ||
    filenameConflictingBitCount > maximumConflictingFilenameBits ||
    ((filenameUnknownBitCount > 0 || filenameConflictingBitCount > 0) && !isPlausibleProvisionalFilename(filename))
  ) {
    return null
  }
  let bestCandidate: Candidate | null = null
  const unshiftedLengths = expectedPFileLengths(
    bits,
    bitStart,
    bitEnd,
    filenameByteLength,
    maximumRecoverableUnavailableTailBits,
  )
  const framingShifts = unshiftedLengths.length > 0 || (filenameUnknownBitCount === 0 && filenameConflictingBitCount === 0)
    ? [{ framingBitShift: 0, lengths: unshiftedLengths }]
    : [-1, 1].map((framingBitShift) => ({
        framingBitShift,
        lengths: expectedPFileLengths(
          bits,
          bitStart + framingBitShift,
          bitEnd,
          filenameByteLength,
          maximumRecoverableUnavailableTailBits,
        ),
      }))
  for (const { framingBitShift, lengths } of framingShifts) {
    const candidateBitStart = bitStart + framingBitShift
    for (const pFileLength of lengths) {
      const candidate = readCandidateWithLength(
        bits,
        candidateBitStart,
        bitEnd,
        filename,
        filenameByteLength,
        filenameUnknownBitCount,
        filenameConflictingBitCount,
        framingBitShift,
        pFileLength,
        candidateBudget,
      )
      if (candidate && (!bestCandidate || candidate.score > bestCandidate.score)) {
        bestCandidate = candidate
      }
    }
  }
  return bestCandidate
}

function readCandidateWithLength(
  bits: readonly Zx81TapeBit[],
  bitStart: number,
  bitEnd: number,
  filename: string,
  filenameByteLength: number,
  filenameUnknownBitCount: number,
  filenameConflictingBitCount: number,
  framingBitShift: number,
  lengthCandidate: PFileLengthCandidate,
  candidateBudget: { remainingBytes: number },
): Candidate | null {
  const pFileLength = lengthCandidate.length
  const declaredCandidateBitEnd = bitStart + (filenameByteLength + pFileLength) * 8
  const unavailableTailBitCount = Math.max(0, declaredCandidateBitEnd - bitEnd)
  if (
    unavailableTailBitCount > maximumRecoverableUnavailableTailBits
    || (
      unavailableTailBitCount > maximumUnavailableTailBits
      && !hasStrongUnavailableTailEvidence(
        filename,
        filenameUnknownBitCount,
        filenameConflictingBitCount,
        framingBitShift,
        lengthCandidate,
      )
    )
  ) {
    return null
  }
  const candidateBitEnd = Math.min(declaredCandidateBitEnd, bitEnd)

  const pFileBytes = new Uint8Array(pFileLength)
  const partialPFileBytes: PartialPFileByte[] = []
  let unknownBitCount = 0
  for (let offset = 0; offset < pFileLength; offset += 1) {
    if (candidateBudget.remainingBytes === 0) return null
    candidateBudget.remainingBytes -= 1
    const byteBitStart = bitStart + (filenameByteLength + offset) * 8
    const byte = readPartialTapeByte(bits, byteBitStart, bitEnd)
    const partialByte = byte ?? { knownMask: 0, unknownBitCount: 8, value: 0 }
    unknownBitCount += partialByte.unknownBitCount
    pFileBytes[offset] = partialByte.value
    partialPFileBytes.push({ knownMask: partialByte.knownMask, value: partialByte.value })
    if (
      partialPFileBytes.length === minimumPFileLength &&
      !hasPlausibleBasicArea(partialPFileBytes, pFileLength)
    ) return null
  }

  const confidence = meanConfidence(bits, bitStart, candidateBitEnd)
  const filenamePadding = Math.max(0, filenameByteLength - filename.length)
  const framingDamageBitCount = filenameUnknownBitCount + filenameConflictingBitCount + lengthCandidate.unknownBitCount
  const provisionalFraming = framingDamageBitCount > 0 || framingBitShift !== 0
  const totalUnknownBitCount = filenameUnknownBitCount + unknownBitCount
  if (unknownBitCount > 0 || provisionalFraming) {
    const maximumUnknownRatio = provisionalFraming
      ? maximumProvisionalUnknownCandidateRatio
      : maximumUnknownCandidateRatio
    if (
      unknownBitCount / (pFileLength * 8) > maximumUnknownRatio ||
      !isPlausibleRecoveryFilename(filename, {
        exactFilename: filenameUnknownBitCount === 0 && filenameConflictingBitCount === 0,
        redundantPointerSupport: lengthCandidate.redundantPointerSupport,
      })
    ) {
      return null
    }
    return {
      bitEnd: candidateBitEnd,
      bitStart,
      confidence,
      decodeError: provisionalCandidateError(
        filenameUnknownBitCount,
        filenameConflictingBitCount,
        lengthCandidate.unknownBitCount,
        framingBitShift,
        unknownBitCount,
        unavailableTailBitCount,
      ),
      filename,
      filenameByteLength,
      pFileBytes,
      score: confidence + 0.1 + filename.length * 0.001 - filenamePadding * 0.02 -
        (filenameUnknownBitCount + filenameConflictingBitCount) * 0.002 - unknownBitCount * 0.0001 +
        lengthCandidate.redundantPointerSupport * 0.01 - Math.abs(framingBitShift) * 0.02 -
        (unknownBitCount > 0 ? 0.25 : 0),
      source: null,
      sourceMappings: [],
      unknownBitCount: totalUnknownBitCount,
    }
  }

  try {
    const imported = importPFile(pFileBytes)
    return {
      bitEnd: candidateBitEnd,
      bitStart,
      confidence,
      decodeError: null,
      filename,
      filenameByteLength,
      pFileBytes,
      score: confidence + (filename.length > 0 ? 0.1 + filename.length * 0.001 : 0) - filenamePadding * 0.02 +
        lengthCandidate.redundantPointerSupport * 0.01,
      source: imported.source,
      sourceMappings: imported.mappings,
      unknownBitCount: 0,
    }
  } catch (error) {
    const decodeError = error instanceof Error ? error.message : 'The candidate P-file is structurally damaged.'
    if (!isRecoverablePFileError(decodeError)) {
      return null
    }
    return {
      bitEnd: candidateBitEnd,
      bitStart,
      confidence,
      decodeError,
      filename,
      filenameByteLength,
      pFileBytes,
      score: confidence + 0.1 + filename.length * 0.001 - filenamePadding * 0.02 - 0.25 +
        lengthCandidate.redundantPointerSupport * 0.01,
      source: null,
      sourceMappings: [],
      unknownBitCount: 0,
    }
  }
}

function provisionalCandidateError(
  filenameUnknownBitCount: number,
  filenameConflictingBitCount: number,
  lengthPointerUnknownBitCount: number,
  framingBitShift: number,
  pFileUnknownBitCount: number,
  unavailableTailBitCount: number,
): string {
  const issues: string[] = []
  if (filenameUnknownBitCount > 0) {
    issues.push(`the filename contains ${formatBitCount(filenameUnknownBitCount)}`)
  }
  if (filenameConflictingBitCount > 0) {
    issues.push(`the filename contains ${filenameConflictingBitCount.toLocaleString()} conflicting detected bit${filenameConflictingBitCount === 1 ? '' : 's'}`)
  }
  if (lengthPointerUnknownBitCount > 0) {
    issues.push(`the saved-length pointer contains ${formatBitCount(lengthPointerUnknownBitCount)}`)
  }
  if (framingBitShift !== 0) {
    issues.push('a one-bit filename/P-file framing shift was inferred')
  }
  if (pFileUnknownBitCount > 0) {
    issues.push(`the P-file contains ${formatBitCount(pFileUnknownBitCount)}`)
  }
  if (unavailableTailBitCount > 0) {
    issues.push(`${formatBitCount(unavailableTailBitCount)} are unavailable tail bits`)
  }
  return `This provisional candidate is damaged: ${issues.join('; ')}.`
}

function formatBitCount(count: number): string {
  return `${count.toLocaleString()} unknown bit${count === 1 ? '' : 's'}`
}

function isRecoverablePFileError(message: string): boolean {
  return /(?:truncated BASIC line|BASIC line \d+|line \d+ is missing its terminator)/.test(message)
}

function hasStrongUnavailableTailEvidence(
  filename: string,
  filenameUnknownBitCount: number,
  filenameConflictingBitCount: number,
  framingBitShift: number,
  lengthCandidate: PFileLengthCandidate,
): boolean {
  return filenameUnknownBitCount === 0
    && filenameConflictingBitCount === 0
    && framingBitShift === 0
    && lengthCandidate.redundantPointerSupport >= 1
    && isPlausibleRecoveryFilename(filename, {
      exactFilename: true,
      redundantPointerSupport: lengthCandidate.redundantPointerSupport,
    })
}

function isPlausibleRecoveryFilename(
  filename: string,
  evidence: {
    readonly exactFilename?: boolean
    readonly redundantPointerSupport?: number
  } = {},
): boolean {
  const shortExactFilename = filename.length > 0
    && filename.length < 3
    && evidence.exactFilename === true
    && (evidence.redundantPointerSupport ?? 0) >= 1
    && /^[A-Z0-9]+$/.test(filename)
  return shortExactFilename
    || (
      filename.length >= 3
      && /^[A-Z0-9?][A-Z0-9? ]*$/.test(filename)
      && /[A-Z0-9]/.test(filename)
      && !filename.startsWith('? ')
    )
}

function isPlausibleProvisionalFilename(filename: string): boolean {
  return isPlausibleRecoveryFilename(filename) && (filename.match(/[A-Z0-9]/g)?.length ?? 0) >= 2
}

function hasPlausibleBasicArea(
  pFileBytes: readonly PartialPFileByte[],
  declaredPFileLength = pFileBytes.length,
): boolean {
  if (pFileBytes.length < minimumPFileLength) {
    return false
  }
  const dFileLow = partialPFileByte(pFileBytes[3])
  const dFileHigh = partialPFileByte(pFileBytes[4])
  if (!dFileLow || !dFileHigh || dFileLow.unknownBitCount + dFileHigh.unknownBitCount > maximumUnknownDFilePointerBits) {
    return false
  }
  for (const low of enumeratePartialByteValues(dFileLow)) {
    for (const high of enumeratePartialByteValues(dFileHigh)) {
      const programLength = (low | (high << 8)) - 0x407d
      if (programLength < 0 || minimumPFileLength + programLength > declaredPFileLength) continue
      return true
    }
  }
  return false
}

function partialPFileByte(byte: PartialPFileByte | undefined): PartialTapeByte | null {
  if (!byte) return null
  return { ...byte, unknownBitCount: 8 - popcount(byte.knownMask) }
}

export function deduplicateChannelCandidates(
  found: readonly FoundCandidate[],
  sampleRate: number,
): FoundCandidate[] {
  const deduplicated: typeof found[number][] = []
  for (const item of found) {
    const startSample = candidateStartSample(item)
    const duplicateIndex = deduplicated.findIndex((candidate) => {
      if (Math.abs(startSample - candidateStartSample(candidate)) > sampleRate) return false
      return item.channelIndex === candidate.channelIndex
        || sameCrossChannelProgram(item.candidate, candidate.candidate)
    })
    if (duplicateIndex < 0) {
      deduplicated.push(item)
    } else if (compareCandidateQuality(item.candidate, deduplicated[duplicateIndex].candidate) < 0) {
      deduplicated[duplicateIndex] = item
    }
  }
  return deduplicated
}

function sameCrossChannelProgram(left: Candidate, right: Candidate): boolean {
  if (left.pFileBytes.length !== right.pFileBytes.length || !compatibleCandidateFilenames(left.filename, right.filename)) {
    return false
  }
  return left.source === null || right.source === null || left.source === right.source
}

function compatibleCandidateFilenames(left: string, right: string): boolean {
  return left.length === right.length && [...left].every((character, index) => (
    character === '?' || right[index] === '?' || character === right[index]
  ))
}

export function compareCandidateQuality(left: Candidate, right: Candidate): number {
  const validDifference = Number(right.source !== null) - Number(left.source !== null)
  if (validDifference !== 0) {
    return validDifference
  }
  return left.unknownBitCount - right.unknownBitCount || right.score - left.score
}

function meanConfidence(bits: readonly Zx81TapeBit[], start: number, end: number): number {
  let total = 0
  for (let index = start; index < Math.min(end, bits.length); index += 1) {
    total += bits[index].confidence
  }
  return total / Math.max(1, Math.min(end, bits.length) - start)
}
