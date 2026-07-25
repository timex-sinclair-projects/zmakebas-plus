import type { Zx81TapeBitValue } from '../../../formats'
import { createZx81TapeDecodeAnnotations, type Zx81TapeDecodeAnnotation } from '../model/zx81TapeDecodeAnnotations'
import type { Zx81TapeWorkspace } from '../model/zx81TapeWorkspace'

export const tapeCanvasLabelWidth = 72
export const tapeCanvasLogicalHeight = 264
const maximumDetailedSamplesPerPixel = 5
const waveformDisplayGainCache = new WeakMap<Float32Array, number>()

export type Zx81TapeInsertionRangeDraft = {
  readonly endSample: number
  readonly id: string
  readonly startSample: number
}

/** Draws the visible waveform and aligned ZX81 decode annotation tracks. */
export function drawZx81TapeCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  workspace: Zx81TapeWorkspace,
  viewStart: number,
  viewEnd: number,
  selectedBitIds: readonly string[],
  insertionMarkerSample: number | null = null,
  insertionRangeDraft: Zx81TapeInsertionRangeDraft | null = null,
): void {
  const pixelRatio = window.devicePixelRatio || 1
  canvas.width = Math.round(cssWidth * pixelRatio)
  canvas.height = Math.round(cssHeight * pixelRatio)
  const context = canvas.getContext('2d')
  if (!context) {
    return
  }
  const verticalScale = cssHeight / tapeCanvasLogicalHeight
  context.scale(pixelRatio, pixelRatio)
  context.scale(1, verticalScale)
  context.fillStyle = '#fbfdfb'
  context.fillRect(0, 0, cssWidth, tapeCanvasLogicalHeight)
  const waveformDisplayGain = waveformDisplayGainForSamples(workspace.automatic.samples)

  context.save()
  context.beginPath()
  context.rect(tapeCanvasLabelWidth, 0, Math.max(0, cssWidth - tapeCanvasLabelWidth), tapeCanvasLogicalHeight)
  context.clip()
  drawWaveform(context, workspace.automatic.samples, viewStart, viewEnd, cssWidth, waveformDisplayGain)
  drawEvents(context, workspace, viewStart, viewEnd, cssWidth)
  drawBits(context, workspace, viewStart, viewEnd, cssWidth, selectedBitIds, insertionRangeDraft)
  drawInsertionMarker(context, insertionMarkerSample, viewStart, viewEnd, cssWidth)
  drawBytes(context, workspace, viewStart, viewEnd, cssWidth)
  drawDecodeAnnotations(context, workspace, viewStart, viewEnd, cssWidth)
  drawSourceMappings(context, workspace, viewStart, viewEnd, cssWidth)
  drawSelectedBitMarker(context, workspace, selectedBitIds, viewStart, viewEnd, cssWidth)
  context.fillStyle = '#657268'
  context.font = '11px system-ui'
  context.fillText(`${(viewStart / workspace.automatic.sampleRate).toFixed(3)} s`, tapeCanvasLabelWidth + 4, 13)
  const endLabel = `${(viewEnd / workspace.automatic.sampleRate).toFixed(3)} s`
  context.fillText(endLabel, cssWidth - context.measureText(endLabel).width - 4, 13)
  context.restore()

}

function drawSelectedBitMarker(
  context: CanvasRenderingContext2D,
  workspace: Zx81TapeWorkspace,
  selectedBitIds: readonly string[],
  start: number,
  end: number,
  width: number,
): void {
  const range = selectedBitSampleRange(workspace.effective.logicalBits, selectedBitIds)
  if (!range || range.endSample < start || range.startSample > end) return

  const x1 = sampleToX(range.startSample, start, end, width)
  const x2 = sampleToX(range.endSample, start, end, width)
  const centreX = (x1 + x2) / 2
  const markerWidth = Math.max(3, x2 - x1)
  context.fillStyle = 'rgba(126, 34, 206, 0.08)'
  context.fillRect(centreX - markerWidth / 2, 0, markerWidth, tapeCanvasLogicalHeight)
  context.fillStyle = 'rgba(126, 34, 206, 0.32)'
  context.fillRect(Math.round(centreX), 0, 1, tapeCanvasLogicalHeight)
}

/** Returns the complete sample span represented by the current logical selection. */
export function selectedBitSampleRange(
  bits: readonly Zx81TapeWorkspace['effective']['logicalBits'][number][],
  selectedBitIds: readonly string[],
): { readonly endSample: number; readonly startSample: number } | null {
  const selectedIds = new Set(selectedBitIds)
  const selectedBits = bits.filter((bit) => (
    selectedIds.has(bit.id) || bit.physicalBitIds.some((bitId) => selectedIds.has(bitId))
  ))
  if (selectedBits.length === 0) return null
  return {
    endSample: Math.max(...selectedBits.map((bit) => bit.endSample)),
    startSample: Math.min(...selectedBits.map((bit) => bit.startSample)),
  }
}

function drawWaveform(
  context: CanvasRenderingContext2D,
  samples: Float32Array,
  viewStart: number,
  viewEnd: number,
  width: number,
  displayGain: number,
): void {
  const drawableWidth = Math.max(1, width - tapeCanvasLabelWidth)
  const visibleSampleCount = Math.max(1, viewEnd - viewStart)
  const samplesPerPixel = visibleSampleCount / drawableWidth
  const drawDetailedWaveform = shouldDrawDetailedWaveform(visibleSampleCount, drawableWidth)
  context.strokeStyle = '#276749'
  context.lineWidth = samplesPerPixel < 1 ? 1.25 : 1
  context.beginPath()

  if (drawDetailedWaveform) {
    drawExpandedWaveform(context, samples, viewStart, viewEnd, drawableWidth, displayGain)
  } else {
    drawWaveformEnvelope(context, samples, viewStart, viewEnd, drawableWidth, samplesPerPixel, displayGain)
  }

  context.stroke()
}

/** Uses connected samples before min/max envelope buckets collapse near one sample per pixel. */
export function shouldDrawDetailedWaveform(visibleSampleCount: number, drawableWidth: number): boolean {
  return Math.max(1, visibleSampleCount) / Math.max(1, drawableWidth) <= maximumDetailedSamplesPerPixel
}

function drawExpandedWaveform(
  context: CanvasRenderingContext2D,
  samples: Float32Array,
  viewStart: number,
  viewEnd: number,
  drawableWidth: number,
  displayGain: number,
): void {
  const firstSample = Math.max(0, Math.floor(viewStart))
  const lastSample = Math.min(samples.length - 1, Math.ceil(viewEnd))
  let previousY = waveformY(samples[firstSample] ?? 0, displayGain)
  context.moveTo(tapeCanvasLabelWidth, previousY)

  for (let sampleIndex = firstSample + 1; sampleIndex <= lastSample; sampleIndex += 1) {
    const x = tapeCanvasLabelWidth + ((sampleIndex - viewStart) / Math.max(1, viewEnd - viewStart)) * drawableWidth
    const y = waveformY(samples[sampleIndex], displayGain)
    context.lineTo(x, previousY)
    context.lineTo(x, y)
    previousY = y
  }
}

function drawWaveformEnvelope(
  context: CanvasRenderingContext2D,
  samples: Float32Array,
  viewStart: number,
  viewEnd: number,
  drawableWidth: number,
  samplesPerPixel: number,
  displayGain: number,
): void {
  for (let pixel = 0; pixel < drawableWidth; pixel += 1) {
    const sampleStart = Math.floor(viewStart + pixel * samplesPerPixel)
    const sampleEnd = Math.min(samples.length, Math.ceil(viewEnd), Math.max(sampleStart + 1, Math.ceil(sampleStart + samplesPerPixel)))
    if (sampleStart >= sampleEnd) {
      continue
    }
    let minimum = 1
    let maximum = -1
    const stride = Math.max(1, Math.floor((sampleEnd - sampleStart) / 32))
    for (let sampleIndex = sampleStart; sampleIndex < sampleEnd; sampleIndex += stride) {
      minimum = Math.min(minimum, samples[sampleIndex])
      maximum = Math.max(maximum, samples[sampleIndex])
    }
    const x = tapeCanvasLabelWidth + pixel + 0.5
    context.moveTo(x, waveformY(maximum, displayGain))
    context.lineTo(x, waveformY(minimum, displayGain))
  }
}

function waveformY(sample: number, displayGain: number): number {
  return 65 - clamp(sample * displayGain, -1, 1) * 42
}

/** Returns a cached display-only gain that makes quiet waveform recordings visible. */
export function waveformDisplayGainForSamples(samples: Float32Array): number {
  const cached = waveformDisplayGainCache.get(samples)
  if (cached !== undefined) return cached

  const maximumMeasurements = 20_000
  const stride = Math.max(1, Math.floor(samples.length / maximumMeasurements))
  const amplitudes: number[] = []
  for (let index = 0; index < samples.length; index += stride) {
    amplitudes.push(Math.abs(samples[index]))
  }
  amplitudes.sort((left, right) => left - right)
  const robustPeak = amplitudes[Math.min(amplitudes.length - 1, Math.round(amplitudes.length * 0.995))] ?? 0
  const gain = Math.max(1, Math.min(24, 0.9 / Math.max(robustPeak, 0.001)))
  waveformDisplayGainCache.set(samples, gain)
  return gain
}

/** Formats the waveform display gain without unnecessary decimal places. */
export function formatWaveformDisplayGain(gain: number): string {
  return String(Math.round(gain))
}

function drawEvents(context: CanvasRenderingContext2D, workspace: Zx81TapeWorkspace, start: number, end: number, width: number): void {
  for (const event of workspace.automatic.events) {
    if (event.endSample < start || event.startSample > end) continue
    const x1 = sampleToX(event.startSample, start, end, width)
    const x2 = sampleToX(event.endSample, start, end, width)
    context.fillStyle = event.kind === 'burst' ? '#90cdf4' : '#e2e8f0'
    context.fillRect(x1, 112, Math.max(1, x2 - x1), 18)
  }
}

function drawBits(
  context: CanvasRenderingContext2D,
  workspace: Zx81TapeWorkspace,
  start: number,
  end: number,
  width: number,
  selectedBitIds: readonly string[],
  insertionRangeDraft: Zx81TapeInsertionRangeDraft | null,
): void {
  context.font = '11px ui-monospace, monospace'
  context.textAlign = 'center'
  for (const bit of workspace.effective.logicalBits) {
    const displayedRange = insertionRangeDraft?.id === bit.id ? insertionRangeDraft : bit
    if (displayedRange.endSample < start || displayedRange.startSample > end) continue
    const x1 = sampleToX(displayedRange.startSample, start, end, width)
    const x2 = sampleToX(displayedRange.endSample, start, end, width)
    context.fillStyle = bitFillColor(bit.effectiveValue)
    context.fillRect(x1, 136, Math.max(1, x2 - x1), 22)
    if (bit.kind !== 'automatic') {
      context.fillStyle = bit.kind === 'insertion' ? '#0f766e' : '#f97316'
      context.fillRect(x1, 154, Math.max(1, x2 - x1), 4)
    }
    if (bit.kind === 'merge') {
      drawMergedBitDividers(context, workspace, bit.physicalBitIds, start, end, width)
      context.strokeStyle = '#7c3aed'
      context.lineWidth = 1
      context.strokeRect(x1 + 0.5, 136.5, Math.max(1, x2 - x1 - 1), 21)
    }
    if (bit.kind === 'insertion') {
      context.save()
      context.setLineDash([3, 2])
      context.strokeStyle = '#0f766e'
      context.lineWidth = 1
      context.strokeRect(x1 + 0.5, 136.5, Math.max(1, x2 - x1 - 1), 21)
      context.restore()
    }
    if (selectedBitIds.includes(bit.id) || bit.physicalBitIds.some((bitId) => selectedBitIds.includes(bitId))) {
      context.strokeStyle = '#7e22ce'
      context.lineWidth = 2
      context.strokeRect(x1 + 1, 137, Math.max(1, x2 - x1 - 2), 20)
      if (bit.kind === 'insertion') drawInsertionHandles(context, x1, x2)
    }
    if (x2 - x1 >= 9) {
      context.fillStyle = '#ffffff'
      context.fillText(formatBitValue(bit.effectiveValue), (x1 + x2) / 2, 151)
    }
  }
  context.textAlign = 'left'
}

function drawInsertionHandles(context: CanvasRenderingContext2D, startX: number, endX: number): void {
  context.fillStyle = '#7e22ce'
  for (const x of [startX, endX]) {
    context.fillRect(x - 2, 133, 4, 28)
    context.beginPath()
    context.moveTo(x - 4, 133)
    context.lineTo(x + 4, 133)
    context.lineTo(x, 137)
    context.fill()
  }
}

function drawInsertionMarker(
  context: CanvasRenderingContext2D,
  sample: number | null,
  start: number,
  end: number,
  width: number,
): void {
  if (sample === null || sample < start || sample > end) return
  const x = sampleToX(sample, start, end, width)
  context.strokeStyle = '#0f766e'
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(x, 133)
  context.lineTo(x, 161)
  context.stroke()
  context.fillStyle = '#0f766e'
  context.beginPath()
  context.moveTo(x - 5, 133)
  context.lineTo(x + 5, 133)
  context.lineTo(x, 138)
  context.fill()
}

function drawMergedBitDividers(
  context: CanvasRenderingContext2D,
  workspace: Zx81TapeWorkspace,
  physicalBitIds: readonly string[],
  start: number,
  end: number,
  width: number,
): void {
  context.save()
  context.setLineDash([2, 2])
  context.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  context.lineWidth = 1
  for (let index = 0; index + 1 < physicalBitIds.length; index += 1) {
    const currentBit = workspace.automatic.bits.find((bit) => bit.id === physicalBitIds[index])
    const nextBit = workspace.automatic.bits.find((bit) => bit.id === physicalBitIds[index + 1])
    if (!currentBit || !nextBit) continue
    const gapStartX = sampleToX(currentBit.endSample, start, end, width)
    const gapEndX = sampleToX(nextBit.startSample, start, end, width)
    context.fillStyle = 'rgba(255, 255, 255, 0.18)'
    context.fillRect(gapStartX, 137, Math.max(1, gapEndX - gapStartX), 16)
    for (const x of [gapStartX, gapEndX]) {
      context.beginPath()
      context.moveTo(x, 137)
      context.lineTo(x, 153)
      context.stroke()
    }
  }
  context.restore()
}

function drawBytes(context: CanvasRenderingContext2D, workspace: Zx81TapeWorkspace, start: number, end: number, width: number): void {
  context.font = '10px ui-monospace, monospace'
  context.textAlign = 'center'
  for (const byte of workspace.effective.bytes) {
    if (byte.endSample < start || byte.startSample > end) continue
    const x1 = sampleToX(byte.startSample, start, end, width)
    const x2 = sampleToX(byte.endSample, start, end, width)
    context.strokeStyle = '#718096'
    context.strokeRect(x1, 163, Math.max(1, x2 - x1), 22)
    if (x2 - x1 >= 22) {
      context.fillStyle = '#334155'
      context.fillText(byte.value === null ? '??' : byte.value.toString(16).padStart(2, '0').toUpperCase(), (x1 + x2) / 2, 178)
    }
  }
  context.textAlign = 'left'
}

function drawDecodeAnnotations(
  context: CanvasRenderingContext2D,
  workspace: Zx81TapeWorkspace,
  start: number,
  end: number,
  width: number,
): void {
  const annotations = createZx81TapeDecodeAnnotations(
    workspace.effective.bytes,
    workspace.automatic.filenameByteLength,
    workspace.effective.basicMappings,
    workspace.effective.logicalBits,
  )
  context.font = '10px ui-monospace, monospace'
  context.textAlign = 'center'
  for (const annotation of annotations) {
    if (annotation.endSample < start || annotation.startSample > end) continue
    const x1 = sampleToX(annotation.startSample, start, end, width)
    const x2 = sampleToX(annotation.endSample, start, end, width)
    const annotationWidth = x2 - x1
    context.fillStyle = decodeAnnotationFill(annotation.kind)
    context.fillRect(x1, 190, Math.max(1, annotationWidth), 22)
    context.strokeStyle = decodeAnnotationBorder(annotation.kind)
    context.strokeRect(x1, 190, Math.max(1, annotationWidth), 22)
    if (annotationWidth >= context.measureText(annotation.label).width + 6) {
      context.fillStyle = '#334155'
      context.fillText(annotation.label, (x1 + x2) / 2, 205)
    }
  }
  context.textAlign = 'left'
}

function decodeAnnotationFill(kind: Zx81TapeDecodeAnnotation['kind']): string {
  if (kind === 'structure') return '#e0e7ff'
  if (kind === 'token') return '#ede9fe'
  if (kind === 'marker') return '#fef3c7'
  if (kind === 'unknown') return '#fee2e2'
  if (kind === 'filename') return '#dbeafe'
  if (kind === 'system') return '#e2e8f0'
  if (kind === 'data') return '#dcfce7'
  return '#f1f5f9'
}

function decodeAnnotationBorder(kind: Zx81TapeDecodeAnnotation['kind']): string {
  if (kind === 'structure') return '#6366f1'
  if (kind === 'token') return '#8b5cf6'
  if (kind === 'marker') return '#d97706'
  if (kind === 'unknown') return '#dc2626'
  if (kind === 'filename') return '#3b82f6'
  if (kind === 'system') return '#64748b'
  if (kind === 'data') return '#16a34a'
  return '#94a3b8'
}

function drawSourceMappings(context: CanvasRenderingContext2D, workspace: Zx81TapeWorkspace, start: number, end: number, width: number): void {
  const visibleMappings = workspace.effective.basicMappings
    .filter((mapping) => mapping.endSample >= start && mapping.startSample <= end)
    .map((mapping) => {
      const x1 = sampleToX(mapping.startSample, start, end, width)
      const x2 = sampleToX(mapping.endSample, start, end, width)
      return { mapping, text: mapping.text, width: x2 - x1, x1, x2 }
    })
  if (visibleMappings.length === 0) return

  const labelMode = basicLabelMode(visibleMappings.map(({ text, width: mappingWidth }) => ({ text, width: mappingWidth })))
  context.font = '10px system-ui'

  for (let index = 0; index < visibleMappings.length; index += 1) {
    const { mapping, text, width: mappingWidth, x1, x2 } = visibleMappings[index]
    const inset = mappingWidth >= 5 ? 1.5 : 0
    context.fillStyle = basicMappingFill(mapping.status, index)
    context.fillRect(x1 + inset, 217, Math.max(1, mappingWidth - inset * 2), 30)
    context.fillStyle = basicMappingBorder(mapping.status)
    context.fillRect(x1, 217, 1, 30)

    if (labelMode === 'none') continue
    const label = labelMode === 'line-number' ? basicLineNumber(text) : text
    context.save()
    context.beginPath()
    context.rect(x1 + 2, 217, Math.max(0, x2 - x1 - 4), 30)
    context.clip()
    context.fillStyle = basicMappingText(mapping.status)
    context.fillText(label, x1 + 4, 235)
    context.restore()
  }

  const finalMapping = visibleMappings.at(-1)
  if (finalMapping) {
    context.fillStyle = basicMappingBorder(finalMapping.mapping.status)
    context.fillRect(finalMapping.x2 - 1, 217, 1, 30)
  }
}

function basicMappingFill(status: 'ambiguous' | 'clean' | 'damaged', index: number): string {
  if (status === 'ambiguous') return index % 2 === 0 ? '#fde68a' : '#fcd34d'
  if (status === 'damaged') return index % 2 === 0 ? '#fecaca' : '#fca5a5'
  return index % 2 === 0 ? '#c6f6d5' : '#a7f3d0'
}

function basicMappingBorder(status: 'ambiguous' | 'clean' | 'damaged'): string {
  return status === 'ambiguous' ? '#b45309' : status === 'damaged' ? '#b91c1c' : '#4b8065'
}

function basicMappingText(status: 'ambiguous' | 'clean' | 'damaged'): string {
  return status === 'ambiguous' ? '#78350f' : status === 'damaged' ? '#7f1d1d' : '#22543d'
}

function basicLabelMode(lines: readonly { readonly text: string; readonly width: number }[]): 'full' | 'line-number' | 'none' {
  const completeLines = lines.filter((line) => line.width > 4)
  if (completeLines.length === 0) return 'none'
  if (completeLines.every((line) => line.width >= contextFreeTextWidth(line.text) + 8)) return 'full'
  if (completeLines.every((line) => line.width >= contextFreeTextWidth(basicLineNumber(line.text)) + 8)) return 'line-number'
  return 'none'
}

function basicLineNumber(sourceLine: string): string {
  return /^\s*\d+/.exec(sourceLine)?.[0].trim() ?? '—'
}

function contextFreeTextWidth(text: string): number {
  return text.length * 6
}

function sampleToX(sample: number, start: number, end: number, width: number): number {
  return tapeCanvasLabelWidth + ((sample - start) / Math.max(1, end - start)) * Math.max(1, width - tapeCanvasLabelWidth)
}

function formatBitValue(value: Zx81TapeBitValue): string {
  return value === null ? '?' : String(value)
}

function bitFillColor(value: Zx81TapeBitValue): string {
  if (value === 0) return '#2563eb'
  if (value === 1) return '#16a34a'
  return '#d97706'
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
