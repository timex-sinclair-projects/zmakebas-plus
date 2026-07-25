import {
  importPFile,
  importPartialPFile,
  type DecodedZx81Wav,
  type ImportedPartialPFileLine,
  type PartialPFileByte,
  type Zx81TapeBitValue,
  type Zx81TapeByte,
  type Zx81TapeSourceMapping,
} from '../../../formats'
import { assembleZx81TapeBytes } from '../../../formats/zx81/tape/zx81TapeBytes'
import { resynchronizeZx81BasicMappings, type Zx81TapeBasicMapping } from './zx81BasicResynchronizer'
import { isValidZx81TapeInsertionRange, orderedZx81TapeInsertions, proposedZx81TapeInsertionRange } from './zx81TapeInsertionRanges'
import {
  deriveZx81TapeLogicalBits,
  type Zx81TapeBitInsertion,
  type Zx81TapeBitMerge,
  type Zx81TapeLogicalBit,
} from './zx81TapeLogicalBits'

export type { Zx81TapeBasicMapping } from './zx81BasicResynchronizer'
export type { Zx81TapeBitInsertion, Zx81TapeBitMerge, Zx81TapeLogicalBit } from './zx81TapeLogicalBits'

const maximumTapeEditHistory = 256
const maximumTapeBitInsertions = 4_096

export type Zx81TapeBitOverride = {
  readonly bitId: string
  readonly value: Zx81TapeBitValue
}

export type EffectiveZx81TapeDecode = {
  readonly basicMappings: readonly Zx81TapeBasicMapping[]
  readonly bytes: readonly Zx81TapeByte[]
  readonly error: string | null
  readonly logicalBits: readonly Zx81TapeLogicalBit[]
  readonly pFileBytes: Uint8Array | null
  readonly source: string | null
  readonly sourceMappings: readonly Zx81TapeSourceMapping[]
  readonly tapeBitEnd: number
  readonly tapeBitStart: number
  readonly unknownBasicBitCount: number
  readonly unknownNonBasicBitCount: number
}

type Zx81TapeEditSnapshot = {
  readonly insertions: readonly Zx81TapeBitInsertion[]
  readonly merges: readonly Zx81TapeBitMerge[]
  readonly overrides: readonly Zx81TapeBitOverride[]
  readonly suppressedBitIds: readonly string[]
}

export type Zx81TapeWorkspace = {
  readonly automatic: DecodedZx81Wav
  readonly effective: EffectiveZx81TapeDecode
  readonly fileName: string
  readonly id: string
  readonly insertions: readonly Zx81TapeBitInsertion[]
  readonly merges: readonly Zx81TapeBitMerge[]
  readonly nextInsertionSequence: number
  readonly overrides: readonly Zx81TapeBitOverride[]
  readonly redoStack: readonly Zx81TapeEditSnapshot[]
  readonly suppressedBitIds: readonly string[]
  readonly undoStack: readonly Zx81TapeEditSnapshot[]
}

/** Creates an editable, non-destructive tape document around an automatic decode. */
export function createZx81TapeWorkspace(automatic: DecodedZx81Wav, fileName: string): Zx81TapeWorkspace {
  const workspace = {
    automatic,
    fileName,
    id: `${fileName}-${automatic.programId}-${automatic.sampleRate}-${automatic.samples.length}`,
    insertions: [],
    merges: [],
    nextInsertionSequence: 1,
    overrides: [],
    redoStack: [],
    suppressedBitIds: [],
    undoStack: [],
  }
  return { ...workspace, effective: deriveEffectiveDecode(workspace) }
}

/** Returns blank editor text while a tape workspace has no strictly valid BASIC decode. */
export function editorSourceForZx81WavProgram(workspace: Zx81TapeWorkspace): string {
  return workspace.effective.source ?? ''
}

/** Replaces one automatic bit decision, or clears the override when value is undefined. */
export function setZx81TapeBitOverride(
  workspace: Zx81TapeWorkspace,
  bitId: string,
  value: Zx81TapeBitValue | undefined,
): Zx81TapeWorkspace {
  if (!workspace.automatic.bits.some((bit) => bit.id === bitId)) {
    return workspace
  }

  const nextOverrides = workspace.overrides.filter((override) => override.bitId !== bitId)
  if (value !== undefined) {
    nextOverrides.push({ bitId, value })
  }
  if (overridesEqual(workspace.overrides, nextOverrides)) {
    return workspace
  }

  return rebuildWorkspace({
    ...workspace,
    overrides: nextOverrides,
    redoStack: [],
    undoStack: [...workspace.undoStack, editSnapshot(workspace)].slice(-maximumTapeEditHistory),
  })
}

/** Inserts one user-authored logical bit into an empty sample range. */
export function insertZx81TapeBit(
  workspace: Zx81TapeWorkspace,
  sample: number,
  value: Zx81TapeBitValue,
): Zx81TapeWorkspace {
  if (workspace.insertions.length >= maximumTapeBitInsertions) return workspace
  const range = proposedZx81TapeInsertionRange(workspace, sample, value)
  if (!range) return workspace

  const roundedSample = Math.round(sample)
  const insertion: Zx81TapeBitInsertion = {
    ...range,
    id: `inserted-bit-${roundedSample}-${workspace.nextInsertionSequence}`,
    value,
  }
  return rebuildWorkspace({
    ...workspace,
    insertions: orderedZx81TapeInsertions([...workspace.insertions, insertion]),
    nextInsertionSequence: workspace.nextInsertionSequence + 1,
    redoStack: [],
    undoStack: [...workspace.undoStack, editSnapshot(workspace)].slice(-maximumTapeEditHistory),
  })
}

/** Changes the value of a user-authored logical bit. */
export function setZx81TapeBitInsertionValue(
  workspace: Zx81TapeWorkspace,
  insertionId: string,
  value: Zx81TapeBitValue,
): Zx81TapeWorkspace {
  const insertion = workspace.insertions.find((candidate) => candidate.id === insertionId)
  if (!insertion || insertion.value === value) return workspace
  return rebuildWorkspace({
    ...workspace,
    insertions: workspace.insertions.map((candidate) => candidate.id === insertionId ? { ...candidate, value } : candidate),
    redoStack: [],
    undoStack: [...workspace.undoStack, editSnapshot(workspace)].slice(-maximumTapeEditHistory),
  })
}

/** Moves the sample boundaries of a user-authored logical bit without changing PCM. */
export function resizeZx81TapeBitInsertion(
  workspace: Zx81TapeWorkspace,
  insertionId: string,
  startSample: number,
  endSample: number,
): Zx81TapeWorkspace {
  const insertion = workspace.insertions.find((candidate) => candidate.id === insertionId)
  const nextStart = Math.round(startSample)
  const nextEnd = Math.round(endSample)
  if (
    !insertion
    || (insertion.startSample === nextStart && insertion.endSample === nextEnd)
    || !isValidZx81TapeInsertionRange(workspace, nextStart, nextEnd, insertionId)
  ) return workspace

  return rebuildWorkspace({
    ...workspace,
    insertions: orderedZx81TapeInsertions(workspace.insertions.map((candidate) => (
      candidate.id === insertionId ? { ...candidate, endSample: nextEnd, startSample: nextStart } : candidate
    ))),
    redoStack: [],
    undoStack: [...workspace.undoStack, editSnapshot(workspace)].slice(-maximumTapeEditHistory),
  })
}

/** Deletes one user-authored logical bit while retaining all automatic evidence. */
export function deleteZx81TapeBitInsertion(workspace: Zx81TapeWorkspace, insertionId: string): Zx81TapeWorkspace {
  const nextInsertions = workspace.insertions.filter((insertion) => insertion.id !== insertionId)
  if (nextInsertions.length === workspace.insertions.length) return workspace
  return rebuildWorkspace({
    ...workspace,
    insertions: nextInsertions,
    redoStack: [],
    undoStack: [...workspace.undoStack, editSnapshot(workspace)].slice(-maximumTapeEditHistory),
  })
}

/** Splits one effective logical bit into two independently assignable unknown bits. */
export function splitZx81TapeBit(workspace: Zx81TapeWorkspace, logicalBitId: string): Zx81TapeWorkspace {
  const logicalBit = editableLogicalBit(workspace, logicalBitId)
  if (!logicalBit || !canSplitZx81TapeBit(workspace, logicalBitId)) return workspace

  const midpoint = Math.round((logicalBit.startSample + logicalBit.endSample) / 2)
  if (midpoint <= logicalBit.startSample || midpoint >= logicalBit.endSample) return workspace
  const firstInsertion = splitInsertion(logicalBit.startSample, midpoint, workspace.nextInsertionSequence)
  const secondInsertion = splitInsertion(midpoint, logicalBit.endSample, workspace.nextInsertionSequence + 1)
  const physicalBitIds = new Set(logicalBit.physicalBitIds)
  const memberInsertionIds = new Set(logicalMemberIds(workspace, logicalBit).filter((bitId) => (
    workspace.insertions.some((insertion) => insertion.id === bitId)
  )))
  return rebuildWorkspace({
    ...workspace,
    insertions: orderedZx81TapeInsertions([
      ...workspace.insertions.filter((insertion) => !memberInsertionIds.has(insertion.id)),
      firstInsertion,
      secondInsertion,
    ]),
    merges: workspace.merges.filter((merge) => merge.id !== logicalBit.id),
    nextInsertionSequence: workspace.nextInsertionSequence + 2,
    overrides: workspace.overrides.filter((override) => !physicalBitIds.has(override.bitId)),
    redoStack: [],
    suppressedBitIds: orderedUniqueStrings([...workspace.suppressedBitIds, ...physicalBitIds]),
    undoStack: [...workspace.undoStack, editSnapshot(workspace)].slice(-maximumTapeEditHistory),
  })
}

/** Returns whether a logical bit has enough sample coverage and edit capacity to split. */
export function canSplitZx81TapeBit(workspace: Zx81TapeWorkspace, logicalBitId: string): boolean {
  const logicalBit = editableLogicalBit(workspace, logicalBitId)
  if (!logicalBit || logicalBit.endSample - logicalBit.startSample < 2) return false
  const replacedInsertionCount = logicalMemberIds(workspace, logicalBit).filter((bitId) => (
    workspace.insertions.some((insertion) => insertion.id === bitId)
  )).length
  return workspace.insertions.length - replacedInsertionCount + 2 <= maximumTapeBitInsertions
}

/** Removes one effective logical bit without changing waveform samples or automatic evidence. */
export function deleteZx81TapeBit(workspace: Zx81TapeWorkspace, logicalBitId: string): Zx81TapeWorkspace {
  const logicalBit = editableLogicalBit(workspace, logicalBitId)
  if (!logicalBit) return workspace
  const physicalBitIds = new Set(logicalBit.physicalBitIds)
  const memberInsertionIds = new Set(logicalMemberIds(workspace, logicalBit).filter((bitId) => (
    workspace.insertions.some((insertion) => insertion.id === bitId)
  )))
  return rebuildWorkspace({
    ...workspace,
    insertions: workspace.insertions.filter((insertion) => !memberInsertionIds.has(insertion.id)),
    merges: workspace.merges.filter((merge) => merge.id !== logicalBit.id),
    overrides: workspace.overrides.filter((override) => !physicalBitIds.has(override.bitId)),
    redoStack: [],
    suppressedBitIds: orderedUniqueStrings([...workspace.suppressedBitIds, ...physicalBitIds]),
    undoStack: [...workspace.undoStack, editSnapshot(workspace)].slice(-maximumTapeEditHistory),
  })
}

/** Combines contiguous effective logical bits and preserves a value common to every selected bit. */
export function mergeZx81TapeBits(
  workspace: Zx81TapeWorkspace,
  bitIds: readonly string[],
): Zx81TapeWorkspace {
  const selection = validatedMergeSelection(workspace, bitIds)
  if (!selection) return workspace

  const nextMerge: Zx81TapeBitMerge = {
    bitIds: selection.memberIds,
    id: `merge-${selection.memberIds.join('-')}`,
    value: selection.value,
  }
  const replacedMergeIds = new Set(selection.replacedMergeIds)
  const nextMerges = [...workspace.merges.filter((merge) => !replacedMergeIds.has(merge.id)), nextMerge]

  return rebuildWorkspace({
    ...workspace,
    merges: nextMerges,
    redoStack: [],
    undoStack: [...workspace.undoStack, editSnapshot(workspace)].slice(-maximumTapeEditHistory),
  })
}

/** Changes the value of an existing logical merge. */
export function setZx81TapeBitMergeValue(
  workspace: Zx81TapeWorkspace,
  mergeId: string,
  value: Zx81TapeBitValue,
): Zx81TapeWorkspace {
  const merge = workspace.merges.find((candidate) => candidate.id === mergeId)
  if (!merge || merge.value === value) return workspace
  return rebuildWorkspace({
    ...workspace,
    merges: workspace.merges.map((candidate) => candidate.id === mergeId ? { ...candidate, value } : candidate),
    redoStack: [],
    undoStack: [...workspace.undoStack, editSnapshot(workspace)].slice(-maximumTapeEditHistory),
  })
}

/** Removes one logical merge and reveals its original physical detections. */
export function unmergeZx81TapeBits(workspace: Zx81TapeWorkspace, mergeId: string): Zx81TapeWorkspace {
  const nextMerges = workspace.merges.filter((merge) => merge.id !== mergeId)
  if (nextMerges.length === workspace.merges.length) {
    return workspace
  }
  return rebuildWorkspace({
    ...workspace,
    merges: nextMerges,
    redoStack: [],
    undoStack: [...workspace.undoStack, editSnapshot(workspace)].slice(-maximumTapeEditHistory),
  })
}

/** Restores the previous tape-domain override snapshot. */
export function undoZx81TapeEdit(workspace: Zx81TapeWorkspace): Zx81TapeWorkspace {
  const previous = workspace.undoStack.at(-1)
  if (!previous) {
    return workspace
  }
  return rebuildWorkspace({
    ...workspace,
    insertions: previous.insertions,
    merges: previous.merges,
    overrides: previous.overrides,
    redoStack: [...workspace.redoStack, editSnapshot(workspace)].slice(-maximumTapeEditHistory),
    suppressedBitIds: previous.suppressedBitIds,
    undoStack: workspace.undoStack.slice(0, -1),
  })
}

/** Reapplies the most recently undone tape-domain override snapshot. */
export function redoZx81TapeEdit(workspace: Zx81TapeWorkspace): Zx81TapeWorkspace {
  const next = workspace.redoStack.at(-1)
  if (!next) {
    return workspace
  }
  return rebuildWorkspace({
    ...workspace,
    insertions: next.insertions,
    merges: next.merges,
    overrides: next.overrides,
    redoStack: workspace.redoStack.slice(0, -1),
    suppressedBitIds: next.suppressedBitIds,
    undoStack: [...workspace.undoStack, editSnapshot(workspace)].slice(-maximumTapeEditHistory),
  })
}

function rebuildWorkspace(workspace: Omit<Zx81TapeWorkspace, 'effective'>): Zx81TapeWorkspace {
  return { ...workspace, effective: deriveEffectiveDecode(workspace) }
}

function deriveEffectiveDecode(workspace: Omit<Zx81TapeWorkspace, 'effective'>): EffectiveZx81TapeDecode {
  const overrideValues = new Map(workspace.overrides.map((override) => [override.bitId, override.value]))
  const logicalStream = deriveZx81TapeLogicalBits(
    workspace.automatic.bits,
    workspace.automatic.tapeBitStart,
    workspace.automatic.tapeBitEnd,
    overrideValues,
    workspace.merges,
    workspace.insertions,
    new Set(workspace.suppressedBitIds),
  )
  const tapeByteLength = workspace.automatic.filenameByteLength + workspace.automatic.pFileByteLength
  const assembled = assembleZx81TapeBytes(
    logicalStream.bits,
    logicalStream.tapeBitStart,
    logicalStream.tapeBitEnd,
    tapeByteLength,
  )
  const { bytes } = assembled
  const pFileStart = workspace.automatic.filenameByteLength
  const pFileEnd = pFileStart + workspace.automatic.pFileByteLength
  const partialPFileBytes = assembled.partialBytes.slice(pFileStart, pFileEnd)
  const partialImported = importPartialPFile(partialPFileBytes)
  const pFileBytes = partialBytesToUint8Array(partialPFileBytes)
  const basicProgramBytes = partialImported.programEnd === null
    ? null
    : partialBytesToUint8Array(partialPFileBytes.slice(0, partialImported.programEnd))
  const unknownBasicBitCount = partialImported.programEnd === null
    ? countUnknownBits(partialPFileBytes)
    : countUnknownBits(partialPFileBytes.slice(0, partialImported.programEnd))
  const unknownNonBasicBitCount = partialImported.programEnd === null
    ? 0
    : countUnknownBits(partialPFileBytes.slice(partialImported.programEnd))
  const alignedBasicMappings = mapBasicRanges(partialImported.lines, bytes, partialPFileBytes, pFileStart)
  const basicMappings = resynchronizeZx81BasicMappings(
    workspace.automatic,
    logicalStream.bits,
    logicalStream.tapeBitStart,
    logicalStream.tapeBitEnd,
    alignedBasicMappings,
  )

  if (!basicProgramBytes) {
    return {
      basicMappings,
      bytes,
      error: partialMappingError(basicMappings) ?? partialImported.error ?? 'The BASIC program contains unknown bits.',
      logicalBits: logicalStream.bits,
      pFileBytes,
      source: null,
      sourceMappings: [],
      tapeBitEnd: logicalStream.tapeBitEnd,
      tapeBitStart: logicalStream.tapeBitStart,
      unknownBasicBitCount,
      unknownNonBasicBitCount,
    }
  }

  try {
    const imported = importPFile(basicProgramBytes)
    return {
      basicMappings,
      bytes,
      error: unknownNonBasicBitCount > 0
        ? `BASIC decoded; ${unknownNonBasicBitCount.toLocaleString()} unknown bits remain outside the BASIC program.`
        : null,
      logicalBits: logicalStream.bits,
      pFileBytes,
      source: imported.source,
      sourceMappings: mapSourceRanges(imported.mappings, bytes, pFileStart),
      tapeBitEnd: logicalStream.tapeBitEnd,
      tapeBitStart: logicalStream.tapeBitStart,
      unknownBasicBitCount,
      unknownNonBasicBitCount,
    }
  } catch (error) {
    return {
      basicMappings,
      bytes,
      error: error instanceof Error ? error.message : 'The effective P-file is invalid.',
      logicalBits: logicalStream.bits,
      pFileBytes,
      source: null,
      sourceMappings: [],
      tapeBitEnd: logicalStream.tapeBitEnd,
      tapeBitStart: logicalStream.tapeBitStart,
      unknownBasicBitCount,
      unknownNonBasicBitCount,
    }
  }
}

function partialBytesToUint8Array(bytes: readonly PartialPFileByte[]): Uint8Array | null {
  if (bytes.length === 0 || bytes.some((byte) => byte.knownMask !== 0xff)) {
    return null
  }
  return Uint8Array.from(bytes.map((byte) => byte.value))
}

function mapBasicRanges(
  mappings: readonly ImportedPartialPFileLine[],
  bytes: readonly Zx81TapeByte[],
  partialPFileBytes: readonly PartialPFileByte[],
  pFileStart: number,
): Zx81TapeBasicMapping[] {
  return mappings.flatMap((mapping) => {
    const firstByte = bytes[pFileStart + mapping.pFileStart]
    const lastByte = bytes[pFileStart + mapping.pFileEnd - 1]
    if (!firstByte || !lastByte) {
      return []
    }
    const unknownBitIds: string[] = []
    for (let pFileOffset = mapping.pFileStart; pFileOffset < mapping.pFileEnd; pFileOffset += 1) {
      const byte = bytes[pFileStart + pFileOffset]
      const partialByte = partialPFileBytes[pFileOffset]
      if (!byte || !partialByte) continue
      for (let bitOffset = 0; bitOffset < 8; bitOffset += 1) {
        if ((partialByte.knownMask & (0x80 >> bitOffset)) === 0) {
          const bitId = byte.bitIds[bitOffset]
          if (bitId) unknownBitIds.push(bitId)
        }
      }
    }
    return [{
      ...mapping,
      endSample: lastByte.endSample,
      firstBitId: firstByte.bitIds[0] ?? '',
      startSample: firstByte.startSample,
      unknownBitIds,
    }]
  })
}

function countUnknownBits(bytes: readonly PartialPFileByte[]): number {
  return bytes.reduce((total, byte) => total + 8 - popcount(byte.knownMask), 0)
}

function partialMappingError(mappings: readonly Zx81TapeBasicMapping[]): string | null {
  const issueCount = mappings.filter((mapping) => mapping.status !== 'clean').length
  if (issueCount === 0) {
    return null
  }
  const resynchronised = mappings.some((mapping) => /decoding resynchronised/.test(mapping.text))
  return `${issueCount.toLocaleString()} BASIC ${issueCount === 1 ? 'range contains' : 'ranges contain'} ambiguous or damaged data.${resynchronised ? ' Decoding resynchronised after a signal dropout.' : ''}`
}

function popcount(value: number): number {
  let count = 0
  for (let remaining = value & 0xff; remaining !== 0; remaining &= remaining - 1) count += 1
  return count
}

function mapSourceRanges(
  mappings: readonly { readonly pFileEnd: number; readonly pFileStart: number; readonly sourceEnd: number; readonly sourceStart: number }[],
  bytes: readonly Zx81TapeByte[],
  pFileStart: number,
): Zx81TapeSourceMapping[] {
  return mappings.flatMap((mapping) => {
    const firstByte = bytes[pFileStart + mapping.pFileStart]
    const lastByte = bytes[pFileStart + mapping.pFileEnd - 1]
    return firstByte && lastByte
      ? [{ ...mapping, endSample: lastByte.endSample, startSample: firstByte.startSample }]
      : []
  })
}

function overridesEqual(left: readonly Zx81TapeBitOverride[], right: readonly Zx81TapeBitOverride[]): boolean {
  return left.length === right.length && left.every((override) => right.some((candidate) => candidate.bitId === override.bitId && candidate.value === override.value))
}

function editSnapshot(workspace: Pick<Zx81TapeWorkspace, 'insertions' | 'merges' | 'overrides' | 'suppressedBitIds'>): Zx81TapeEditSnapshot {
  return {
    insertions: workspace.insertions,
    merges: workspace.merges,
    overrides: workspace.overrides,
    suppressedBitIds: workspace.suppressedBitIds,
  }
}

function editableLogicalBit(workspace: Zx81TapeWorkspace, logicalBitId: string): Zx81TapeLogicalBit | null {
  const bitIndex = workspace.effective.logicalBits.findIndex((bit) => bit.id === logicalBitId)
  return bitIndex >= workspace.effective.tapeBitStart && bitIndex < workspace.effective.tapeBitEnd
    ? workspace.effective.logicalBits[bitIndex]
    : null
}

function splitInsertion(
  startSample: number,
  endSample: number,
  sequence: number,
): Zx81TapeBitInsertion {
  return {
    endSample,
    id: `inserted-bit-${startSample}-${sequence}`,
    startSample,
    value: null,
  }
}

function orderedUniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort()
}

function validatedMergeSelection(
  workspace: Zx81TapeWorkspace,
  bitIds: readonly string[],
): {
  readonly memberIds: readonly string[]
  readonly replacedMergeIds: readonly string[]
  readonly value: Zx81TapeBitValue
} | null {
  if (bitIds.length < 2 || new Set(bitIds).size !== bitIds.length) return null
  const indices = bitIds.map((bitId) => workspace.effective.logicalBits.findIndex((bit) => bit.id === bitId))
  if (
    indices[0] < workspace.effective.tapeBitStart
    || indices.at(-1)! >= workspace.effective.tapeBitEnd
    || indices.some((index, position) => index < 0 || (position > 0 && index !== indices[position - 1] + 1))
  ) return null

  const selectedBits = indices.map((index) => workspace.effective.logicalBits[index])
  const replacedMergeIds = selectedBits.filter((bit) => bit.kind === 'merge').map((bit) => bit.id)
  const memberIds = selectedBits.flatMap((bit) => logicalMemberIds(workspace, bit))
  const replacedMergeIdSet = new Set(replacedMergeIds)
  const overlappingMerge = workspace.merges.some((merge) => (
    !replacedMergeIdSet.has(merge.id) && merge.bitIds.some((bitId) => memberIds.includes(bitId))
  ))
  if (overlappingMerge) return null

  const firstValue = selectedBits[0].effectiveValue
  const value = selectedBits.every((bit) => bit.effectiveValue === firstValue) ? firstValue : null
  return { memberIds, replacedMergeIds, value }
}

function logicalMemberIds(workspace: Zx81TapeWorkspace, logicalBit: Zx81TapeLogicalBit): readonly string[] {
  if (logicalBit.kind !== 'merge') return [logicalBit.id]
  return workspace.merges.find((merge) => merge.id === logicalBit.id)?.bitIds ?? [logicalBit.id]
}
