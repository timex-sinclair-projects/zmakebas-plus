import {
  estimateSignalThreshold,
  findActiveBursts,
} from './zx81TapeBurstDetection'
import type {
  IZx81TapeBurstTiming,
  IZx81TapeNominalTiming,
} from './zx81TapeBurstTiming'
import type { IZx81TapeBurstRange } from './zx81TapeGapRecovery'
import { conditionZx81TapeSignal } from './zx81TapeSignalConditioning'

const timingContextRadius = 128
const timingContextStride = 64
const localContextSeconds = 0.1
const boundaryToleranceSeconds = 0.00035
const minimumGapRatio = 0.65
const maximumGapRatio = 1.6
const inspectionGapRatio = 0.65
const maximumComponentTimingDistance = 0.28
const maximumInspections = 256
const maximumLocalBursts = 512
const maximumRecoveredConfidence = 0.55
const localThresholdMultipliers = [1, 1.5, 2, 2.5, 3, 4] as const

type BurstTimingEstimator = (bursts: readonly IZx81TapeBurstRange[]) => IZx81TapeBurstTiming

type ClassifiedComponent = {
  readonly distance: number
  readonly range: IZx81TapeBurstRange
  readonly value: 0 | 1
}

/**
 * Rechecks oversized carrier-envelope bursts against a bounded conditioned
 * window, replacing only bursts with two independently timing-valid parts.
 */
export function recoverZx81CarrierMergedBursts(
  samples: Float32Array,
  bursts: readonly IZx81TapeBurstRange[],
  sampleRate: number,
  speedScale: number,
  nominalTiming: IZx81TapeNominalTiming,
  estimateTiming: BurstTimingEstimator,
): readonly IZx81TapeBurstRange[] {
  const output: IZx81TapeBurstRange[] = []
  const timingCache = new Map<number, IZx81TapeBurstTiming>()
  let inspectionCount = 0

  for (let index = 0; index < bursts.length; index += 1) {
    const burst = bursts[index]
    const timing = localTiming(bursts, index, sampleRate, timingCache, estimateTiming)
    const durationSeconds = (burst.endSample - burst.startSample) / sampleRate
    const inspectionThreshold = timing.oneBurstSeconds
      + nominalTiming.gapSeconds * speedScale * inspectionGapRatio
    if (durationSeconds <= inspectionThreshold || inspectionCount >= maximumInspections) {
      output.push(burst)
      continue
    }

    inspectionCount += 1
    const recovered = recoverMergedBurst(
      samples,
      bursts,
      index,
      sampleRate,
      speedScale,
      nominalTiming,
      timing,
    )
    output.push(...(recovered ?? [burst]))
  }
  return output
}

function recoverMergedBurst(
  samples: Float32Array,
  bursts: readonly IZx81TapeBurstRange[],
  index: number,
  sampleRate: number,
  speedScale: number,
  nominalTiming: IZx81TapeNominalTiming,
  timing: IZx81TapeBurstTiming,
): readonly IZx81TapeBurstRange[] | null {
  const burst = bursts[index]
  const contextSamples = Math.round(sampleRate * localContextSeconds)
  const windowStart = Math.max(0, burst.startSample - contextSamples)
  const windowEnd = Math.min(samples.length, burst.endSample + contextSamples)
  const conditioned = conditionZx81TapeSignal(samples.subarray(windowStart, windowEnd), sampleRate)

  let threshold: number
  try {
    threshold = estimateSignalThreshold(conditioned, sampleRate)
  } catch {
    return null
  }

  const toleranceSamples = Math.round(sampleRate * boundaryToleranceSeconds)
  for (const thresholdMultiplier of localThresholdMultipliers) {
    const recovered = tryRecoverAtThreshold(
      conditioned,
      windowStart,
      burst,
      bursts[index - 1],
      bursts[index + 1],
      sampleRate,
      threshold * thresholdMultiplier,
      toleranceSamples,
      speedScale,
      nominalTiming,
      timing,
    )
    if (recovered) return recovered
  }
  return null
}

function tryRecoverAtThreshold(
  conditioned: Float32Array,
  windowStart: number,
  burst: IZx81TapeBurstRange,
  previous: IZx81TapeBurstRange | undefined,
  next: IZx81TapeBurstRange | undefined,
  sampleRate: number,
  threshold: number,
  toleranceSamples: number,
  speedScale: number,
  nominalTiming: IZx81TapeNominalTiming,
  timing: IZx81TapeBurstTiming,
): readonly IZx81TapeBurstRange[] | null {
  const components = findActiveBursts(conditioned, sampleRate, threshold, maximumLocalBursts)
    .map((range) => ({
      endSample: range.endSample + windowStart,
      startSample: range.startSample + windowStart,
    }))
    .filter((range) => (
      range.startSample < burst.endSample + toleranceSamples
      && range.endSample > burst.startSample - toleranceSamples
    ))
  if (
    components.length !== 2
    || components[0].startSample > burst.startSample + toleranceSamples
    || components[1].endSample < burst.endSample - toleranceSamples
  ) {
    return null
  }

  const validComponents = components.map((range) => classifyComponent(range, sampleRate, timing))
  if (!validComponents.every((component): component is ClassifiedComponent => component !== null)) return null
  const gapSeconds = (validComponents[1].range.startSample - validComponents[0].range.endSample) / sampleRate
  const expectedGapSeconds = nominalTiming.gapSeconds * speedScale
  if (gapSeconds < expectedGapSeconds * minimumGapRatio || gapSeconds > expectedGapSeconds * maximumGapRatio) {
    return null
  }

  const recovered = validComponents.map(({ distance, range, value }) => ({
    ...range,
    recovered: true,
    recoveredConfidence: Math.max(
      0.1,
      maximumRecoveredConfidence * (1 - distance / maximumComponentTimingDistance),
    ),
    recoveredValue: value,
  }))
  if (
    (previous && previous.endSample >= recovered[0].startSample)
    || recovered[0].endSample >= recovered[1].startSample
    || (next && recovered[1].endSample >= next.startSample)
  ) {
    return null
  }
  return recovered
}

function localTiming(
  bursts: readonly IZx81TapeBurstRange[],
  index: number,
  sampleRate: number,
  cache: Map<number, IZx81TapeBurstTiming>,
  estimateTiming: BurstTimingEstimator,
): IZx81TapeBurstTiming {
  const bucket = Math.floor(index / timingContextStride)
  const cached = cache.get(bucket)
  if (cached) return cached

  const center = bucket * timingContextStride + Math.floor(timingContextStride / 2)
  const contextStart = Math.max(0, center - timingContextRadius)
  const contextEnd = Math.min(bursts.length, center + timingContextRadius + 1)
  const context = bursts.slice(contextStart, contextEnd)
  const timing = estimateObservedTiming(context, sampleRate) ?? estimateTiming(context)
  cache.set(bucket, timing)
  return timing
}

function estimateObservedTiming(
  bursts: readonly IZx81TapeBurstRange[],
  sampleRate: number,
): IZx81TapeBurstTiming | null {
  const durations = bursts
    .map((burst) => (burst.endSample - burst.startSample) / sampleRate)
    .filter((duration) => Number.isFinite(duration) && duration > 0)
    .sort((left, right) => left - right)
  if (durations.length < 16) return null

  let splitIndex = -1
  let largestGap = 0
  for (let index = 4; index <= durations.length - 4; index += 1) {
    const gap = durations[index] - durations[index - 1]
    if (gap > largestGap) {
      largestGap = gap
      splitIndex = index
    }
  }
  if (splitIndex < 0) return null

  let zeroBurstSeconds = median(durations.slice(0, splitIndex))
  let oneBurstSeconds = median(durations.slice(splitIndex))
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const zeroDurations: number[] = []
    const oneDurations: number[] = []
    for (const duration of durations) {
      if (Math.abs(duration - zeroBurstSeconds) <= Math.abs(duration - oneBurstSeconds)) {
        zeroDurations.push(duration)
      } else {
        oneDurations.push(duration)
      }
    }
    if (zeroDurations.length < 4 || oneDurations.length < 4) return null
    zeroBurstSeconds = median(zeroDurations)
    oneBurstSeconds = median(oneDurations)
  }
  return oneBurstSeconds >= zeroBurstSeconds * 1.35
    ? { oneBurstSeconds, zeroBurstSeconds }
    : null
}

function median(sortedValues: readonly number[]): number {
  const middle = Math.floor(sortedValues.length / 2)
  return sortedValues.length % 2 === 0
    ? (sortedValues[middle - 1] + sortedValues[middle]) / 2
    : sortedValues[middle]
}

function classifyComponent(
  range: IZx81TapeBurstRange,
  sampleRate: number,
  timing: IZx81TapeBurstTiming,
): ClassifiedComponent | null {
  const durationSeconds = (range.endSample - range.startSample) / sampleRate
  const zeroDistance = Math.abs(durationSeconds - timing.zeroBurstSeconds)
  const oneDistance = Math.abs(durationSeconds - timing.oneBurstSeconds)
  const separation = Math.max(0.0002, timing.oneBurstSeconds - timing.zeroBurstSeconds)
  const distance = Math.min(zeroDistance, oneDistance) / separation
  if (distance > maximumComponentTimingDistance) return null
  return {
    distance,
    range,
    value: zeroDistance <= oneDistance ? 0 : 1,
  }
}
