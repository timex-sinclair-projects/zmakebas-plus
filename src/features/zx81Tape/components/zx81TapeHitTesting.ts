import { createZx81TapeDecodeAnnotations } from '../model/zx81TapeDecodeAnnotations'
import type { Zx81TapeBitInsertion, Zx81TapeLogicalBit, Zx81TapeWorkspace } from '../model/zx81TapeWorkspace'
import { tapeCanvasLabelWidth, tapeCanvasLogicalHeight } from './zx81TapeCanvas'
import { clamp, logicalBitSelectionIds } from './zx81TapePaneModel'

export type TapeCanvasHitTarget =
  | { readonly bitIds: readonly string[]; readonly kind: 'bit' }
  | { readonly kind: 'insertion-marker'; readonly sample: number }
  | { readonly kind: 'source'; readonly sourceEnd: number; readonly sourceStart: number }

export function sampleAtClientX(canvas: HTMLCanvasElement, clientX: number, start: number, end: number): number {
  const bounds = canvas.getBoundingClientRect()
  const ratio = clamp((clientX - bounds.left - tapeCanvasLabelWidth) / Math.max(1, bounds.width - tapeCanvasLabelWidth), 0, 1)
  return Math.round(start + ratio * (end - start))
}

export function tapeCanvasHitTarget(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  workspace: Zx81TapeWorkspace,
  viewStart: number,
  viewEnd: number,
): TapeCanvasHitTarget | null {
  const bounds = canvas.getBoundingClientRect()
  if (clientX - bounds.left < tapeCanvasLabelWidth) return null

  const logicalY = canvasLogicalY(canvas, clientY)
  const sample = sampleAtClientX(canvas, clientX, viewStart, viewEnd)
  if (logicalY >= 217 && logicalY <= 247) return sourceTrackHitTarget(workspace, sample)

  if (logicalY >= 136 && logicalY <= 158) {
    const bit = logicalBitAtSample(workspace.effective.logicalBits, sample)
    if (bit) return { bitIds: logicalBitSelectionIds(bit), kind: 'bit' }
    const firstTapeBit = workspace.effective.logicalBits[workspace.effective.tapeBitStart]
    const finalTapeBit = workspace.effective.logicalBits[workspace.effective.tapeBitEnd - 1]
    return firstTapeBit && finalTapeBit && sample > firstTapeBit.endSample && sample < finalTapeBit.startSample
      ? { kind: 'insertion-marker', sample }
      : null
  }

  if (logicalY >= 163 && logicalY <= 185) {
    const byte = workspace.effective.bytes.find((candidate) => candidate.startSample <= sample && candidate.endSample >= sample)
    if (!byte) return null
    const matchingBit = workspace.effective.logicalBits.findLast((bit) => byte.bitIds.includes(bit.id) && bit.startSample <= sample && bit.endSample >= sample)
    const logicalBit = matchingBit ?? workspace.effective.logicalBits.find((bit) => bit.id === byte.bitIds[0])
    return logicalBit ? { bitIds: logicalBitSelectionIds(logicalBit), kind: 'bit' } : null
  }
  if (logicalY >= 190 && logicalY <= 212) {
    const annotation = createZx81TapeDecodeAnnotations(
      workspace.effective.bytes,
      workspace.automatic.filenameByteLength,
      workspace.effective.basicMappings,
      workspace.effective.logicalBits,
    ).find((candidate) => candidate.startSample <= sample && candidate.endSample >= sample)
    if (!annotation) return null
    const matchingBit = workspace.effective.logicalBits.findLast((bit) => (
      annotation.bitIds.includes(bit.id) && bit.startSample <= sample && bit.endSample >= sample
    ))
    const logicalBit = matchingBit ?? workspace.effective.logicalBits.find((bit) => bit.id === annotation.bitIds[0])
    return logicalBit ? { bitIds: logicalBitSelectionIds(logicalBit), kind: 'bit' } : null
  }
  return null
}

export function insertionBoundaryAtCanvas(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  insertion: Zx81TapeBitInsertion,
  viewStart: number,
  viewEnd: number,
): 'end' | 'start' | null {
  const logicalY = canvasLogicalY(canvas, clientY)
  if (logicalY < 131 || logicalY > 163) return null
  const sample = sampleAtClientX(canvas, clientX, viewStart, viewEnd)
  const drawableWidth = Math.max(1, canvas.clientWidth - tapeCanvasLabelWidth)
  const tolerance = Math.max(1, Math.round(((viewEnd - viewStart) / drawableWidth) * 6))
  const startDistance = Math.abs(sample - insertion.startSample)
  const endDistance = Math.abs(sample - insertion.endSample)
  if (startDistance <= tolerance || endDistance <= tolerance) return startDistance <= endDistance ? 'start' : 'end'
  return null
}

/** Resolves shared boundaries to the later logical bit, keeping adjacent split halves selectable. */
export function logicalBitAtSample(bits: readonly Zx81TapeLogicalBit[], sample: number): Zx81TapeLogicalBit | null {
  return bits.findLast((bit) => bit.startSample <= sample && bit.endSample >= sample) ?? null
}

/** Prevents an insertion resize handle from capturing a different logical bit under the pointer. */
export function insertionBoundaryForHitTarget(
  boundary: 'end' | 'start' | null,
  insertionId: string,
  target: TapeCanvasHitTarget | null,
): 'end' | 'start' | null {
  if (target?.kind === 'bit' && !target.bitIds.includes(insertionId)) return null
  return boundary
}

function canvasLogicalY(canvas: HTMLCanvasElement, clientY: number): number {
  const bounds = canvas.getBoundingClientRect()
  return ((clientY - bounds.top) / Math.max(1, bounds.height)) * tapeCanvasLogicalHeight
}

function sourceTrackHitTarget(workspace: Zx81TapeWorkspace, sample: number): TapeCanvasHitTarget | null {
  const mapping = workspace.effective.sourceMappings.find((candidate) => candidate.startSample <= sample && candidate.endSample >= sample)
  if (mapping) return { kind: 'source', sourceEnd: mapping.sourceEnd, sourceStart: mapping.sourceStart }
  const basicMapping = workspace.effective.basicMappings.find((candidate) => candidate.startSample <= sample && candidate.endSample >= sample)
  const bitId = basicMapping?.unknownBitIds[0] ?? basicMapping?.firstBitId
  const logicalBit = bitId
    ? workspace.effective.logicalBits.find((candidate) => candidate.id === bitId || candidate.physicalBitIds.includes(bitId))
    : undefined
  return logicalBit ? { bitIds: logicalBitSelectionIds(logicalBit), kind: 'bit' } : null
}
