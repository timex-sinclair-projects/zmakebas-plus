const nominalZeroBurstSeconds = 0.0012
const nominalOneBurstSeconds = 0.0027
const nominalGapSeconds = 0.0013
const minimumAnomalousGapSeconds = 0.0032
const maximumRecoveryGapSeconds = 0.05
const maximumRecoveredBurstsPerGap = 16
const maximumRecoveryGaps = 4_096
const timingContextRadius = 32
const localThresholdFractions = [0.8, 0.7, 0.6, 0.5] as const
const maximumTemplateDistance = 0.42
const minimumCycleMatchRatio = 0.6

type Zx81RecoveredBitValue = 0 | 1

export interface IZx81TapeBurstRange {
  readonly endSample: number
  readonly recovered?: boolean
  readonly recoveredConfidence?: number
  readonly recoveredValue?: Zx81RecoveredBitValue
  readonly startSample: number
}

interface IBurstTiming {
  readonly oneBurstSeconds: number
  readonly zeroBurstSeconds: number
}

interface IRecoveryTemplate extends IBurstTiming {
  readonly oneCycles: number
  readonly zeroCycles: number
}

interface IRecoveredCandidate {
  readonly confidence: number
  readonly cycleMatches: boolean
  readonly range: IZx81TapeBurstRange
  readonly value: Zx81RecoveredBitValue
}

/** Recovers timing-valid low-amplitude bursts only inside bounded anomalous gaps. */
export function recoverZx81TapeGapBursts(
  samples: Float32Array,
  bursts: readonly IZx81TapeBurstRange[],
  sampleRate: number,
  globalThreshold: number,
  speedScale: number,
  maximumBursts: number,
): readonly IZx81TapeBurstRange[] {
  const output: IZx81TapeBurstRange[] = []
  let inspectedGapCount = 0

  for (let index = 0; index < bursts.length; index += 1) {
    const previous = bursts[index]
    const next = bursts[index + 1]
    output.push(previous)
    if (!next || inspectedGapCount >= maximumRecoveryGaps) continue

    const gapSeconds = (next.startSample - previous.endSample) / sampleRate
    if (gapSeconds < minimumAnomalousGapSeconds * speedScale || gapSeconds >= maximumRecoveryGapSeconds) continue
    inspectedGapCount += 1

    const timing = estimateLocalTiming(bursts, index, sampleRate, speedScale)
    const recovered = recoverGap(samples, bursts, index, sampleRate, globalThreshold, speedScale, timing)
    if (output.length + recovered.length + bursts.length - index - 1 > maximumBursts) {
      throw new Error(`The WAV channel contains more than ${maximumBursts.toLocaleString()} detected bursts and exceeds the analysis limit.`)
    }
    output.push(...recovered)
  }

  return output
}

function recoverGap(
  samples: Float32Array,
  bursts: readonly IZx81TapeBurstRange[],
  gapIndex: number,
  sampleRate: number,
  globalThreshold: number,
  speedScale: number,
  primaryTiming: IBurstTiming,
): readonly IZx81TapeBurstRange[] {
  const previous = bursts[gapIndex]
  const next = bursts[gapIndex + 1]
  for (const thresholdFraction of localThresholdFractions) {
    const localThreshold = Math.max(0.0025, globalThreshold * thresholdFraction)
    const localRanges = findLocalActiveRanges(
      samples,
      sampleRate,
      localThreshold,
      previous.startSample,
      next.endSample,
    )
    const leftBoundaryIndex = localRanges.findIndex((range) => rangesOverlap(range, previous))
    const rightBoundaryIndex = findLastIndex(localRanges, (range) => rangesOverlap(range, next))
    if (leftBoundaryIndex < 0 || rightBoundaryIndex <= leftBoundaryIndex + 1) continue

    const candidates = localRanges.slice(leftBoundaryIndex + 1, rightBoundaryIndex)
    const template = createSameThresholdTemplate(
      samples,
      bursts,
      gapIndex,
      sampleRate,
      localThreshold,
      primaryTiming,
    )
    const classifiedCandidates = template ? classifyCandidates(samples, candidates, sampleRate, template) : null
    if (
      candidates.length > maximumRecoveredBurstsPerGap
      || !classifiedCandidates
      || classifiedCandidates.filter((candidate) => candidate.cycleMatches).length < Math.ceil(candidates.length * minimumCycleMatchRatio)
      || !hasPlausibleGaps(
        [localRanges[leftBoundaryIndex], ...candidates, localRanges[rightBoundaryIndex]],
        sampleRate,
        speedScale,
      )
    ) {
      continue
    }
    const recovered = classifiedCandidates.map(({ confidence, range, value }) => ({
      ...range,
      recovered: true,
      recoveredConfidence: confidence,
      recoveredValue: value,
    }))
    if (!rangesAreStrictlyOrdered([previous, ...recovered, next])) continue
    return recovered
  }
  return []
}

function findLocalActiveRanges(
  samples: Float32Array,
  sampleRate: number,
  threshold: number,
  startSample: number,
  endSample: number,
): readonly IZx81TapeBurstRange[] {
  const maximumBridgeSamples = Math.max(1, Math.round(sampleRate * 0.00035))
  const smoothing = Math.min(1, 1 / Math.max(1, sampleRate * 0.02))
  const preRollStart = Math.max(0, startSample - Math.round(sampleRate * 0.02))
  const ranges: IZx81TapeBurstRange[] = []
  let dc = samples[preRollStart] ?? 0
  let rangeStart = -1
  let lastActive = -1

  for (let index = preRollStart; index < Math.min(samples.length, endSample + maximumBridgeSamples + 1); index += 1) {
    const sample = samples[index]
    dc += (sample - dc) * smoothing
    if (index >= startSample && Math.abs(sample - dc) >= threshold) {
      if (rangeStart < 0) rangeStart = index
      lastActive = index
      continue
    }
    if (rangeStart >= 0 && index - lastActive > maximumBridgeSamples) {
      ranges.push({ startSample: rangeStart, endSample: lastActive + 1 })
      rangeStart = -1
      lastActive = -1
    }
  }
  if (rangeStart >= 0) ranges.push({ startSample: rangeStart, endSample: lastActive + 1 })
  return ranges
}

function estimateLocalTiming(
  bursts: readonly IZx81TapeBurstRange[],
  gapIndex: number,
  sampleRate: number,
  speedScale: number,
): IBurstTiming {
  const context = bursts.slice(
    Math.max(0, gapIndex - timingContextRadius + 1),
    Math.min(bursts.length, gapIndex + timingContextRadius + 1),
  )
  const nominalZero = nominalZeroBurstSeconds * speedScale
  const nominalOne = nominalOneBurstSeconds * speedScale
  const zeroDurations: number[] = []
  const oneDurations: number[] = []
  for (const burst of context) {
    const duration = (burst.endSample - burst.startSample) / sampleRate
    if (Math.abs(duration - nominalZero) <= Math.abs(duration - nominalOne)) zeroDurations.push(duration)
    else oneDurations.push(duration)
  }
  return {
    zeroBurstSeconds: medianOrFallback(zeroDurations, nominalZero),
    oneBurstSeconds: medianOrFallback(oneDurations, nominalOne),
  }
}

function createSameThresholdTemplate(
  samples: Float32Array,
  bursts: readonly IZx81TapeBurstRange[],
  gapIndex: number,
  sampleRate: number,
  threshold: number,
  primaryTiming: IBurstTiming,
): IRecoveryTemplate | null {
  const context = bursts.slice(
    Math.max(0, gapIndex - timingContextRadius + 1),
    Math.min(bursts.length, gapIndex + timingContextRadius + 1),
  )
  const first = context[0]
  const last = context[context.length - 1]
  if (!first || !last) return null

  const localRanges = findLocalActiveRanges(samples, sampleRate, threshold, first.startSample, last.endSample)
  const zeroDurations: number[] = []
  const oneDurations: number[] = []
  const zeroCycles: number[] = []
  const oneCycles: number[] = []
  for (const burst of context) {
    const value = classifyDuration(burst, sampleRate, primaryTiming, 0.28)
    if (value === null) continue
    const matchingRanges = localRanges.filter((range) => rangesOverlap(range, burst))
    if (matchingRanges.length !== 1) continue
    const localRange = matchingRanges[0]
    if (context.filter((candidate) => rangesOverlap(candidate, localRange)).length !== 1) continue

    const duration = (localRange.endSample - localRange.startSample) / sampleRate
    const cycles = countCarrierCycles(samples, localRange)
    if (value === 0) {
      zeroDurations.push(duration)
      zeroCycles.push(cycles)
    } else {
      oneDurations.push(duration)
      oneCycles.push(cycles)
    }
  }

  const zeroBurstSeconds = medianOrNull(zeroDurations)
  const oneBurstSeconds = medianOrNull(oneDurations)
  const medianZeroCycles = medianOrNull(zeroCycles)
  const medianOneCycles = medianOrNull(oneCycles)
  if (
    zeroBurstSeconds === null
    || oneBurstSeconds === null
    || medianZeroCycles === null
    || medianOneCycles === null
    || oneBurstSeconds < zeroBurstSeconds * 1.35
  ) {
    return null
  }
  return {
    oneBurstSeconds,
    oneCycles: medianOneCycles,
    zeroBurstSeconds,
    zeroCycles: medianZeroCycles,
  }
}

function classifyCandidates(
  samples: Float32Array,
  ranges: readonly IZx81TapeBurstRange[],
  sampleRate: number,
  template: IRecoveryTemplate,
): readonly IRecoveredCandidate[] | null {
  const classified: IRecoveredCandidate[] = []
  const separation = Math.max(0.0002, template.oneBurstSeconds - template.zeroBurstSeconds)
  for (const range of ranges) {
    const duration = (range.endSample - range.startSample) / sampleRate
    const zeroDistance = Math.abs(duration - template.zeroBurstSeconds)
    const oneDistance = Math.abs(duration - template.oneBurstSeconds)
    const distance = Math.min(zeroDistance, oneDistance) / separation
    if (distance > maximumTemplateDistance) return null
    const value: Zx81RecoveredBitValue = zeroDistance <= oneDistance ? 0 : 1
    const cycleDistance = Math.abs(countCarrierCycles(samples, range) - (value === 0 ? template.zeroCycles : template.oneCycles))
    classified.push({
      confidence: Math.max(0.1, Math.min(0.6, (1 - distance / maximumTemplateDistance) * 0.45 + (cycleDistance <= 1.5 ? 0.15 : 0))),
      cycleMatches: cycleDistance <= 1.5,
      range,
      value,
    })
  }
  return classified
}

function classifyDuration(
  range: IZx81TapeBurstRange,
  sampleRate: number,
  timing: IBurstTiming,
  maximumDistance: number,
): Zx81RecoveredBitValue | null {
  const duration = (range.endSample - range.startSample) / sampleRate
  const zeroDistance = Math.abs(duration - timing.zeroBurstSeconds)
  const oneDistance = Math.abs(duration - timing.oneBurstSeconds)
  const separation = Math.max(0.0002, timing.oneBurstSeconds - timing.zeroBurstSeconds)
  return Math.min(zeroDistance, oneDistance) / separation <= maximumDistance
    ? zeroDistance <= oneDistance ? 0 : 1
    : null
}

function hasPlausibleGaps(
  ranges: readonly IZx81TapeBurstRange[],
  sampleRate: number,
  speedScale: number,
): boolean {
  const expectedGap = nominalGapSeconds * speedScale
  for (let index = 1; index < ranges.length; index += 1) {
    const gap = (ranges[index].startSample - ranges[index - 1].endSample) / sampleRate
    if (gap < expectedGap * 0.3 || gap > expectedGap * 2.2) return false
  }
  return true
}

function rangesOverlap(left: IZx81TapeBurstRange, right: IZx81TapeBurstRange): boolean {
  return left.startSample < right.endSample && right.startSample < left.endSample
}

function rangesAreStrictlyOrdered(ranges: readonly IZx81TapeBurstRange[]): boolean {
  return ranges.every((range, index) => index === 0 || ranges[index - 1].endSample < range.startSample)
}

function findLastIndex<T>(values: readonly T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index])) return index
  }
  return -1
}

function countCarrierCycles(samples: Float32Array, range: IZx81TapeBurstRange): number {
  let mean = 0
  for (let index = range.startSample; index < range.endSample; index += 1) mean += samples[index]
  mean /= Math.max(1, range.endSample - range.startSample)

  let crossings = 0
  let previous = (samples[range.startSample] ?? 0) - mean
  for (let index = range.startSample + 1; index < range.endSample; index += 1) {
    const current = samples[index] - mean
    if ((current >= 0) !== (previous >= 0)) crossings += 1
    previous = current
  }
  return crossings / 2
}

function medianOrFallback(values: number[], fallback: number): number {
  if (values.length < 4) return fallback
  values.sort((left, right) => left - right)
  return values[Math.floor(values.length / 2)]
}

function medianOrNull(values: number[]): number | null {
  if (values.length < 4) return null
  values.sort((left, right) => left - right)
  return values[Math.floor(values.length / 2)]
}
