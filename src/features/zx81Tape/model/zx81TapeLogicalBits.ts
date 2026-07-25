import type { Zx81TapeBit, Zx81TapeBitValue } from '../../../formats'

const minimumLongGapRatio = 1.75

export type Zx81TapeBitMerge = {
  readonly bitIds: readonly string[]
  readonly id: string
  readonly value: Zx81TapeBitValue
}

export type Zx81TapeBitInsertion = {
  readonly endSample: number
  readonly id: string
  readonly startSample: number
  readonly value: Zx81TapeBitValue
}

export type Zx81TapeLogicalBit = {
  readonly automaticValue: Zx81TapeBitValue
  readonly confidence: number
  readonly effectiveValue: Zx81TapeBitValue
  readonly endSample: number
  readonly id: string
  readonly index: number
  readonly kind: 'automatic' | 'insertion' | 'merge' | 'override'
  readonly physicalBitIds: readonly string[]
  readonly startSample: number
}

export type Zx81TapeLogicalBitStream = {
  readonly bits: readonly Zx81TapeLogicalBit[]
  readonly tapeBitEnd: number
  readonly tapeBitStart: number
}

export type Zx81TapeLogicalGap = {
  readonly afterBit: Zx81TapeLogicalBit
  readonly beforeBit: Zx81TapeLogicalBit
  readonly endSample: number
  readonly startSample: number
}

export type Zx81TapeLogicalGapNavigation = {
  readonly next: Zx81TapeLogicalGap | null
  readonly previous: Zx81TapeLogicalGap | null
}

/** Finds both wrapped long-gap navigation targets in one timing pass. */
export function zx81TapeLogicalGapNavigation(
  bits: readonly Zx81TapeLogicalBit[],
  tapeBitStart: number,
  tapeBitEnd: number,
  selectedBitIds: readonly string[],
): Zx81TapeLogicalGapNavigation {
  const { end, start } = boundedLogicalBitRange(bits.length, tapeBitStart, tapeBitEnd)
  if (end - start < 2) return { next: null, previous: null }

  const positiveGaps: number[] = []
  const gaps: Array<Zx81TapeLogicalGap & { readonly beforeIndex: number }> = []
  for (let index = start; index < end - 1; index += 1) {
    const beforeBit = bits[index]
    const afterBit = bits[index + 1]
    const gapSamples = afterBit.startSample - beforeBit.endSample
    if (gapSamples <= 0) continue
    positiveGaps.push(gapSamples)
    gaps.push({
      afterBit,
      beforeBit,
      beforeIndex: index,
      endSample: afterBit.startSample,
      startSample: beforeBit.endSample,
    })
  }
  if (positiveGaps.length === 0) return { next: null, previous: null }

  positiveGaps.sort((left, right) => left - right)
  const normalGapSamples = median(positiveGaps)
  const longGaps = gaps.filter((gap) => gap.endSample - gap.startSample > normalGapSamples * minimumLongGapRatio)
  if (longGaps.length === 0) return { next: null, previous: null }

  const nextSelectedIndex = selectedLogicalBitIndex(bits, start, end, selectedBitIds, 1)
  const previousSelectedIndex = selectedLogicalBitIndex(bits, start, end, selectedBitIds, -1)
  return {
    next: longGaps.find((gap) => gap.beforeIndex > nextSelectedIndex) ?? longGaps[0],
    previous: longGaps.findLast((gap) => gap.beforeIndex < previousSelectedIndex) ?? longGaps.at(-1) ?? null,
  }
}

/** Finds the next effective-bit gap materially longer than normal, wrapping once. */
export function nextLongZx81TapeLogicalGap(
  bits: readonly Zx81TapeLogicalBit[],
  tapeBitStart: number,
  tapeBitEnd: number,
  selectedBitIds: readonly string[],
): Zx81TapeLogicalGap | null {
  return zx81TapeLogicalGapNavigation(bits, tapeBitStart, tapeBitEnd, selectedBitIds).next
}

/** Finds the previous effective-bit gap materially longer than normal, wrapping once. */
export function previousLongZx81TapeLogicalGap(
  bits: readonly Zx81TapeLogicalBit[],
  tapeBitStart: number,
  tapeBitEnd: number,
  selectedBitIds: readonly string[],
): Zx81TapeLogicalGap | null {
  return zx81TapeLogicalGapNavigation(bits, tapeBitStart, tapeBitEnd, selectedBitIds).previous
}

/** Finds the next unresolved effective bit in the selected tape range, wrapping once. */
export function nextUnknownZx81TapeLogicalBit(
  bits: readonly Zx81TapeLogicalBit[],
  tapeBitStart: number,
  tapeBitEnd: number,
  selectedBitIds: readonly string[],
): Zx81TapeLogicalBit | null {
  return findUnknownZx81TapeLogicalBit(bits, tapeBitStart, tapeBitEnd, selectedBitIds, 1)
}

/** Finds the previous unresolved effective bit in the selected tape range, wrapping once. */
export function previousUnknownZx81TapeLogicalBit(
  bits: readonly Zx81TapeLogicalBit[],
  tapeBitStart: number,
  tapeBitEnd: number,
  selectedBitIds: readonly string[],
): Zx81TapeLogicalBit | null {
  return findUnknownZx81TapeLogicalBit(bits, tapeBitStart, tapeBitEnd, selectedBitIds, -1)
}

function findUnknownZx81TapeLogicalBit(
  bits: readonly Zx81TapeLogicalBit[],
  tapeBitStart: number,
  tapeBitEnd: number,
  selectedBitIds: readonly string[],
  direction: -1 | 1,
): Zx81TapeLogicalBit | null {
  const { end, start } = boundedLogicalBitRange(bits.length, tapeBitStart, tapeBitEnd)
  const count = end - start
  if (count === 0) return null

  const selectedIndex = selectedLogicalBitIndex(bits, start, end, selectedBitIds, direction)
  const relativeSelection = selectedIndex < start || selectedIndex >= end
    ? direction > 0 ? -1 : count
    : selectedIndex - start
  for (let offset = 1; offset <= count; offset += 1) {
    const relativeIndex = (relativeSelection + direction * offset + count) % count
    const candidate = bits[start + relativeIndex]
    if (candidate.effectiveValue === null) return candidate
  }
  return null
}

function boundedLogicalBitRange(
  bitCount: number,
  tapeBitStart: number,
  tapeBitEnd: number,
): { readonly end: number; readonly start: number } {
  const start = Math.max(0, Math.min(bitCount, Math.trunc(tapeBitStart)))
  return {
    end: Math.max(start, Math.min(bitCount, Math.trunc(tapeBitEnd))),
    start,
  }
}

function selectedLogicalBitIndex(
  bits: readonly Zx81TapeLogicalBit[],
  start: number,
  end: number,
  selectedBitIds: readonly string[],
  direction: -1 | 1,
): number {
  const selectedIds = new Set(selectedBitIds)
  let selectedIndex = direction > 0 ? start - 1 : end
  for (let index = start; index < end; index += 1) {
    if (!selectedIds.has(bits[index].id) && !bits[index].physicalBitIds.some((bitId) => selectedIds.has(bitId))) continue
    selectedIndex = index
    if (direction < 0) break
  }
  return selectedIndex
}

function median(sortedValues: readonly number[]): number {
  return sortedValues[Math.floor((sortedValues.length - 1) / 2)]
}

/** Applies non-destructive overrides, suppression, insertions, and logical merges to a detector stream. */
export function deriveZx81TapeLogicalBits(
  bits: readonly Zx81TapeBit[],
  physicalTapeBitStart: number,
  physicalTapeBitEnd: number,
  overrideValues: ReadonlyMap<string, Zx81TapeBitValue>,
  merges: readonly Zx81TapeBitMerge[],
  insertions: readonly Zx81TapeBitInsertion[] = [],
  suppressedBitIds: ReadonlySet<string> = new Set(),
): Zx81TapeLogicalBitStream {
  const logicalBits: Zx81TapeLogicalBit[] = []
  const tapeStartSample = bits[physicalTapeBitStart]?.startSample
  const tapeEndSample = bits[physicalTapeBitEnd - 1]?.endSample

  for (let physicalIndex = 0; physicalIndex < bits.length;) {
    const physicalBit = bits[physicalIndex]
    if (suppressedBitIds.has(physicalBit.id)) {
      physicalIndex += 1
      continue
    }

    const overridden = overrideValues.has(physicalBit.id)
    logicalBits.push({
      automaticValue: physicalBit.automaticValue,
      confidence: physicalBit.confidence,
      effectiveValue: overridden ? overrideValues.get(physicalBit.id) ?? null : physicalBit.automaticValue,
      endSample: physicalBit.endSample,
      id: physicalBit.id,
      index: logicalBits.length,
      kind: overridden ? 'override' : 'automatic',
      physicalBitIds: [physicalBit.id],
      startSample: physicalBit.startSample,
    })
    physicalIndex += 1
  }

  const insertedStream = insertLogicalBits(logicalBits, tapeStartSample, tapeEndSample, insertions)
  return mergeLogicalBits(insertedStream.bits, tapeStartSample, tapeEndSample, merges)
}

function insertLogicalBits(
  physicalBits: readonly Zx81TapeLogicalBit[],
  tapeStartSample: number | undefined,
  tapeEndSample: number | undefined,
  insertions: readonly Zx81TapeBitInsertion[],
): Zx81TapeLogicalBitStream {
  const orderedInsertions = [...insertions].sort((left, right) => (
    left.startSample - right.startSample || left.endSample - right.endSample || left.id.localeCompare(right.id)
  ))
  const bits: Zx81TapeLogicalBit[] = []
  let insertionIndex = 0
  const appendInsertion = (insertion: Zx81TapeBitInsertion): void => {
    bits.push({
      automaticValue: null,
      confidence: 1,
      effectiveValue: insertion.value,
      endSample: insertion.endSample,
      id: insertion.id,
      index: bits.length,
      kind: 'insertion',
      physicalBitIds: [],
      startSample: insertion.startSample,
    })
  }
  for (const physicalBit of physicalBits) {
    while (orderedInsertions[insertionIndex]?.startSample < physicalBit.startSample) {
      appendInsertion(orderedInsertions[insertionIndex])
      insertionIndex += 1
    }
    bits.push({ ...physicalBit, index: bits.length })
  }
  while (insertionIndex < orderedInsertions.length) {
    appendInsertion(orderedInsertions[insertionIndex])
    insertionIndex += 1
  }

  return logicalStreamForSamples(bits, tapeStartSample, tapeEndSample)
}

function mergeLogicalBits(
  logicalBits: readonly Zx81TapeLogicalBit[],
  tapeStartSample: number | undefined,
  tapeEndSample: number | undefined,
  merges: readonly Zx81TapeBitMerge[],
): Zx81TapeLogicalBitStream {
  const mergeByFirstBitId = new Map(merges.map((merge) => [merge.bitIds[0], merge]))
  const bits: Zx81TapeLogicalBit[] = []
  for (let logicalIndex = 0; logicalIndex < logicalBits.length;) {
    const logicalBit = logicalBits[logicalIndex]
    const merge = mergeByFirstBitId.get(logicalBit.id)
    const members = merge ? logicalBits.slice(logicalIndex, logicalIndex + merge.bitIds.length) : []
    if (merge && arraysEqual(members.map((member) => member.id), merge.bitIds)) {
      bits.push({
        automaticValue: commonAutomaticValue(members),
        confidence: Math.min(...members.map((member) => member.confidence)),
        effectiveValue: merge.value,
        endSample: members.at(-1)?.endSample ?? logicalBit.endSample,
        id: merge.id,
        index: bits.length,
        kind: 'merge',
        physicalBitIds: members.flatMap((member) => member.physicalBitIds),
        startSample: logicalBit.startSample,
      })
      logicalIndex += members.length
      continue
    }
    bits.push({ ...logicalBit, index: bits.length })
    logicalIndex += 1
  }
  return logicalStreamForSamples(bits, tapeStartSample, tapeEndSample)
}

function logicalStreamForSamples(
  bits: readonly Zx81TapeLogicalBit[],
  tapeStartSample: number | undefined,
  tapeEndSample: number | undefined,
): Zx81TapeLogicalBitStream {
  if (tapeStartSample === undefined || tapeEndSample === undefined) return { bits, tapeBitEnd: 0, tapeBitStart: 0 }
  const tapeBitStart = bits.findIndex((bit) => bit.startSample >= tapeStartSample && bit.endSample <= tapeEndSample)
  if (tapeBitStart < 0) return { bits, tapeBitEnd: 0, tapeBitStart: 0 }
  const finalTapeBitIndex = bits.findLastIndex((bit) => bit.startSample >= tapeStartSample && bit.endSample <= tapeEndSample)
  return { bits, tapeBitEnd: finalTapeBitIndex + 1, tapeBitStart }
}

function commonAutomaticValue(bits: readonly Pick<Zx81TapeBit, 'automaticValue'>[]): Zx81TapeBitValue {
  const firstValue = bits[0]?.automaticValue ?? null
  return bits.every((bit) => bit.automaticValue === firstValue) ? firstValue : null
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
