import type { Zx81TapeBitValue } from '../../../formats'
import type { Zx81TapeBitInsertion } from './zx81TapeLogicalBits'
import type { Zx81TapeWorkspace } from './zx81TapeWorkspace'

/** Proposes a locally timed insertion range centred on an empty sample position. */
export function proposedZx81TapeInsertionRange(
  workspace: Zx81TapeWorkspace,
  sample: number,
  value: Zx81TapeBitValue,
): Pick<Zx81TapeBitInsertion, 'endSample' | 'startSample'> | null {
  if (!Number.isFinite(sample)) return null
  const roundedSample = Math.round(sample)
  const tapeBits = workspace.effective.logicalBits.slice(workspace.effective.tapeBitStart, workspace.effective.tapeBitEnd)
  const previousBit = tapeBits.findLast((bit) => bit.endSample < roundedSample)
  const nextBit = tapeBits.find((bit) => bit.startSample > roundedSample)
  if (!previousBit || !nextBit) return null

  const availableStart = previousBit.endSample + 1
  const availableEnd = nextBit.startSample - 1
  if (roundedSample < availableStart || roundedSample > availableEnd || availableEnd - availableStart < 1) return null

  const desiredDuration = estimatedInsertionDuration(workspace, roundedSample, value)
  const duration = Math.max(1, Math.min(desiredDuration, availableEnd - availableStart))
  const startSample = clamp(Math.round(roundedSample - duration / 2), availableStart, availableEnd - duration)
  return { endSample: startSample + duration, startSample }
}

/** Checks that a manual insertion remains inside the tape and overlaps no other logical bit. */
export function isValidZx81TapeInsertionRange(
  workspace: Zx81TapeWorkspace,
  startSample: number,
  endSample: number,
  excludedInsertionId?: string,
): boolean {
  if (!Number.isFinite(startSample) || !Number.isFinite(endSample) || startSample < 0 || endSample <= startSample) return false
  const tapeBits = workspace.effective.logicalBits.slice(workspace.effective.tapeBitStart, workspace.effective.tapeBitEnd)
  const firstTapeBit = tapeBits[0]
  const finalTapeBit = tapeBits.at(-1)
  if (!firstTapeBit || !finalTapeBit || startSample <= firstTapeBit.startSample || endSample >= finalTapeBit.endSample) return false
  return !tapeBits.some((bit) => (
    bit.id !== excludedInsertionId && startSample <= bit.endSample && endSample >= bit.startSample
  ))
}

/** Returns insertions in deterministic sample order. */
export function orderedZx81TapeInsertions(insertions: readonly Zx81TapeBitInsertion[]): readonly Zx81TapeBitInsertion[] {
  return [...insertions].sort((left, right) => left.startSample - right.startSample || left.endSample - right.endSample || left.id.localeCompare(right.id))
}

function estimatedInsertionDuration(workspace: Zx81TapeWorkspace, sample: number, value: Zx81TapeBitValue): number {
  const nextBitIndex = workspace.effective.logicalBits.findIndex((bit) => bit.startSample > sample)
  const contextStart = Math.max(0, (nextBitIndex < 0 ? workspace.effective.logicalBits.length : nextBitIndex) - 64)
  const contextEnd = Math.min(workspace.effective.logicalBits.length, (nextBitIndex < 0 ? workspace.effective.logicalBits.length : nextBitIndex) + 64)
  const references = workspace.effective.logicalBits.slice(contextStart, contextEnd)
    .filter((bit) => bit.kind !== 'insertion' && bit.effectiveValue !== null && (value === null || bit.effectiveValue === value))
    .map((bit) => ({ distance: Math.abs((bit.startSample + bit.endSample) / 2 - sample), duration: bit.endSample - bit.startSample }))
    .filter((reference) => reference.duration > 0 && reference.duration <= workspace.automatic.sampleRate * 0.01)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 24)
    .map((reference) => reference.duration)
    .sort((left, right) => left - right)
  if (references.length > 0) return references[Math.floor(references.length / 2)]
  return Math.max(1, Math.round(workspace.automatic.sampleRate * (value === 1 ? 0.0027 : 0.0011)))
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
