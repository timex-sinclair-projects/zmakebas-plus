import type { Zx81TapeWorkspace } from '../model/zx81TapeWorkspace'
import type { Zx81TapeInsertionRangeDraft } from './zx81TapeCanvas'

export function extendedLogicalBitRange(
  workspace: Zx81TapeWorkspace,
  selectedBitIds: readonly string[],
  targetBitIds: readonly string[],
): readonly string[] {
  const selectedIndices = selectedBitIds.map((bitId) => workspace.effective.logicalBits.findIndex((bit) => bit.id === bitId))
  const targetIndex = workspace.effective.logicalBits.findIndex((bit) => bit.id === targetBitIds.at(-1))
  if (selectedIndices.some((index) => index < 0) || targetIndex < 0) return []
  const selectedStart = Math.min(...selectedIndices)
  const selectedEnd = Math.max(...selectedIndices)
  const anchorIndex = targetIndex < selectedStart ? selectedEnd : selectedStart
  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  return workspace.effective.logicalBits.slice(start, end + 1).map((bit) => bit.id)
}

export function resizedInsertionRange(
  workspace: Zx81TapeWorkspace,
  range: Zx81TapeInsertionRangeDraft,
  boundary: 'end' | 'start',
  sample: number,
): Zx81TapeInsertionRangeDraft {
  const otherBits = workspace.effective.logicalBits
    .slice(workspace.effective.tapeBitStart, workspace.effective.tapeBitEnd)
    .filter((bit) => bit.id !== range.id)
  if (boundary === 'start') {
    const previousBit = otherBits.findLast((bit) => bit.endSample < range.endSample)
    return { ...range, startSample: clamp(sample, (previousBit?.endSample ?? -1) + 1, range.endSample - 1) }
  }
  const nextBit = otherBits.find((bit) => bit.startSample > range.startSample)
  return { ...range, endSample: clamp(sample, range.startSample + 1, (nextBit?.startSample ?? workspace.automatic.samples.length) - 1) }
}

export function canEditSelection(workspace: Zx81TapeWorkspace, bitIds: readonly string[]): boolean {
  if (bitIds.length !== 1) return false
  const index = workspace.effective.logicalBits.findIndex((bit) => bit.id === bitIds[0])
  return index >= workspace.effective.tapeBitStart && index < workspace.effective.tapeBitEnd
}

export function canMergeSelection(workspace: Zx81TapeWorkspace, bitIds: readonly string[]): boolean {
  if (bitIds.length < 2 || new Set(bitIds).size !== bitIds.length) return false
  const indices = bitIds.map((bitId) => workspace.effective.logicalBits.findIndex((bit) => bit.id === bitId))
  if (
    indices[0] < workspace.effective.tapeBitStart
    || indices.at(-1)! >= workspace.effective.tapeBitEnd
    || indices.some((index, position) => index < 0 || (position > 0 && index !== indices[position - 1] + 1))
  ) return false
  return true
}

export function logicalBitMatchesSelection(
  bit: Zx81TapeWorkspace['effective']['logicalBits'][number],
  selectedBitIds: readonly string[],
): boolean {
  return selectedBitIds.includes(bit.id)
}

export function logicalBitSelectionIds(bit: Zx81TapeWorkspace['effective']['logicalBits'][number]): readonly string[] {
  return [bit.id]
}

export function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

/** Leaves the source panel's header visible when sizing the tape pane. */
export function maximumTapePaneHeight(
  editorStackHeight: number,
  sourceHeaderHeight: number,
  sourcePanelVerticalChrome: number,
  editorStackGap: number,
  minimumPaneHeight: number,
): number {
  const availableHeight = Math.floor(editorStackHeight - sourceHeaderHeight - sourcePanelVerticalChrome - editorStackGap)
  return Math.max(minimumPaneHeight, availableHeight)
}

/** Centres a sample range at a scale that gives its bit block enough width to display its value. */
export function waveformViewForBit(
  bit: Pick<Zx81TapeWorkspace['effective']['logicalBits'][number], 'endSample' | 'startSample'>,
  totalSamples: number,
  drawableWidth: number,
  minimumVisibleSamples = 256,
): { readonly end: number; readonly start: number } {
  const boundedTotal = Math.max(0, Math.round(totalSamples))
  if (boundedTotal === 0) return { end: 0, start: 0 }

  const targetBitWidth = 24
  const bitLength = Math.max(1, bit.endSample - bit.startSample)
  const desiredLength = Math.round(bitLength * Math.max(1, drawableWidth) / targetBitWidth)
  const minimumLength = Math.min(boundedTotal, Math.max(1, Math.round(minimumVisibleSamples)))
  const length = clamp(desiredLength, minimumLength, boundedTotal)
  const centre = (bit.startSample + bit.endSample) / 2
  const start = clamp(Math.round(centre - length / 2), 0, boundedTotal - length)
  return { end: start + length, start }
}

/** Anchors toolbar zoom to a selected bit at its current horizontal viewport position. */
export function waveformZoomAnchorForBit(
  bit: Pick<Zx81TapeWorkspace['effective']['logicalBits'][number], 'endSample' | 'startSample'>,
  viewStart: number,
  viewEnd: number,
): { readonly ratio: number; readonly sample: number } {
  const sample = (bit.startSample + bit.endSample) / 2
  const ratio = clamp((sample - viewStart) / Math.max(1, viewEnd - viewStart), 0, 1)
  return { ratio, sample }
}
