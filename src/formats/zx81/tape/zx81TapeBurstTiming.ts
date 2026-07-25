import type { IZx81TapeBurstRange } from './zx81TapeGapRecovery'

const splitBurstTimingRadius = 128
const splitBurstTimingStride = 64
const splitBurstGapRadius = 16
const splitBurstGapStride = 8
const minimumLocalGapRatio = 0.65
const maximumLocalGapRatio = 1.6
const baselineMaximumSplitGapRatio = 0.5
const maximumSplitGapRatio = 0.55
const maximumSplitTimingDistance = 0.28
const maximumStrongSplitComponentTimingDistance = 0.1
const minimumSplitDurationRatio = 0.55
const maximumSplitDurationRatio = 1.6

export interface IZx81TapeBurstTiming {
  readonly oneBurstSeconds: number
  readonly zeroBurstSeconds: number
}

export interface IZx81TapeNominalTiming extends IZx81TapeBurstTiming {
  readonly gapSeconds: number
}

interface ISplitBurstContext {
  readonly interBitGapSeconds: number
  readonly timing: IZx81TapeBurstTiming
}

type BurstTimingEstimator = (bursts: readonly IZx81TapeBurstRange[]) => IZx81TapeBurstTiming

/** Consolidates threshold fragments whose timing and local gap geometry support one ZX81 burst. */
export function consolidateZx81SplitBursts(
  bursts: readonly IZx81TapeBurstRange[],
  sampleRate: number,
  speedScale: number,
  nominalTiming: IZx81TapeNominalTiming,
  estimateTiming: BurstTimingEstimator,
): readonly IZx81TapeBurstRange[] {
  const consolidated: IZx81TapeBurstRange[] = []
  const baselineMaximumSplitGap = nominalTiming.gapSeconds * speedScale * baselineMaximumSplitGapRatio
  const timingCache = new Map<number, IZx81TapeBurstTiming>()
  const gapCache = new Map<number, number>()

  for (let index = 0; index < bursts.length; index += 1) {
    consolidated.push(bursts[index])
    const context = {
      interBitGapSeconds: splitBurstInterBitGap(bursts, index, sampleRate, speedScale, nominalTiming, gapCache),
      timing: splitBurstTiming(bursts, index, timingCache, estimateTiming),
    }
    while (consolidated.length >= 2) {
      const current = consolidated.at(-1)
      const previous = consolidated.at(-2)
      if (!current || !previous) break
      const combined = combineSplitBursts(
        previous,
        current,
        sampleRate,
        speedScale,
        nominalTiming,
        baselineMaximumSplitGap,
        context,
      )
      if (!combined) break
      consolidated.splice(consolidated.length - 2, 2, combined)
    }
  }
  return consolidated
}

function combineSplitBursts(
  previous: IZx81TapeBurstRange,
  current: IZx81TapeBurstRange,
  sampleRate: number,
  speedScale: number,
  nominalTiming: IZx81TapeNominalTiming,
  baselineMaximumSplitGap: number,
  context: ISplitBurstContext,
): IZx81TapeBurstRange | null {
  const gapSeconds = (current.startSample - previous.endSample) / sampleRate
  const maximumSplitGap = Math.max(baselineMaximumSplitGap, context.interBitGapSeconds * maximumSplitGapRatio)
  if (gapSeconds < 0 || gapSeconds > maximumSplitGap) return null

  const combined = { endSample: current.endSample, recovered: true, startSample: previous.startSample }
  const combinedDuration = (combined.endSample - combined.startSample) / sampleRate
  if (
    combinedDuration < nominalTiming.zeroBurstSeconds * speedScale * minimumSplitDurationRatio
    || combinedDuration > nominalTiming.oneBurstSeconds * speedScale * maximumSplitDurationRatio
  ) {
    return null
  }

  const previousDistance = burstTimingDistance(previous, sampleRate, context.timing)
  const currentDistance = burstTimingDistance(current, sampleRate, context.timing)
  if (burstTimingDistance(combined, sampleRate, context.timing) > maximumSplitTimingDistance) return null
  if (
    previousDistance <= maximumSplitTimingDistance
    && currentDistance <= maximumSplitTimingDistance
    && (
      gapSeconds <= baselineMaximumSplitGap
      || !isMarginalZeroPairFormingOne(previous, current, combined, sampleRate, context.timing, previousDistance, currentDistance)
    )
  ) {
    return null
  }
  return combined
}

function isMarginalZeroPairFormingOne(
  previous: IZx81TapeBurstRange,
  current: IZx81TapeBurstRange,
  combined: IZx81TapeBurstRange,
  sampleRate: number,
  timing: IZx81TapeBurstTiming,
  previousDistance: number,
  currentDistance: number,
): boolean {
  if (Math.max(previousDistance, currentDistance) <= maximumStrongSplitComponentTimingDistance) return false
  return nearestBurstValue(previous, sampleRate, timing) === 0
    && nearestBurstValue(current, sampleRate, timing) === 0
    && nearestBurstValue(combined, sampleRate, timing) === 1
}

function nearestBurstValue(
  burst: IZx81TapeBurstRange,
  sampleRate: number,
  timing: IZx81TapeBurstTiming,
): 0 | 1 {
  const duration = (burst.endSample - burst.startSample) / sampleRate
  return Math.abs(duration - timing.zeroBurstSeconds) <= Math.abs(duration - timing.oneBurstSeconds) ? 0 : 1
}

function splitBurstTiming(
  bursts: readonly IZx81TapeBurstRange[],
  index: number,
  cache: Map<number, IZx81TapeBurstTiming>,
  estimateTiming: BurstTimingEstimator,
): IZx81TapeBurstTiming {
  const bucket = Math.floor(index / splitBurstTimingStride)
  const cached = cache.get(bucket)
  if (cached) return cached

  const center = bucket * splitBurstTimingStride + Math.floor(splitBurstTimingStride / 2)
  const contextStart = Math.max(0, center - splitBurstTimingRadius)
  const contextEnd = Math.min(bursts.length, center + splitBurstTimingRadius + 1)
  const timing = estimateTiming(bursts.slice(contextStart, contextEnd))
  cache.set(bucket, timing)
  return timing
}

function splitBurstInterBitGap(
  bursts: readonly IZx81TapeBurstRange[],
  index: number,
  sampleRate: number,
  speedScale: number,
  nominalTiming: IZx81TapeNominalTiming,
  cache: Map<number, number>,
): number {
  const bucket = Math.floor(index / splitBurstGapStride)
  const cached = cache.get(bucket)
  if (cached !== undefined) return cached

  const center = bucket * splitBurstGapStride + Math.floor(splitBurstGapStride / 2)
  const contextStart = Math.max(0, center - splitBurstGapRadius)
  const contextEnd = Math.min(bursts.length, center + splitBurstGapRadius + 1)
  const gap = estimateLocalInterBitGap(bursts.slice(contextStart, contextEnd), sampleRate, speedScale, nominalTiming)
  cache.set(bucket, gap)
  return gap
}

function estimateLocalInterBitGap(
  bursts: readonly IZx81TapeBurstRange[],
  sampleRate: number,
  speedScale: number,
  nominalTiming: IZx81TapeNominalTiming,
): number {
  const minimumGap = nominalTiming.gapSeconds * speedScale * minimumLocalGapRatio
  const maximumGap = nominalTiming.gapSeconds * speedScale * maximumLocalGapRatio
  const gaps: number[] = []
  for (let index = 1; index < bursts.length; index += 1) {
    const gap = (bursts[index].startSample - bursts[index - 1].endSample) / sampleRate
    if (gap >= minimumGap && gap <= maximumGap) gaps.push(gap)
  }
  if (gaps.length < 4) return nominalTiming.gapSeconds * speedScale
  gaps.sort((left, right) => left - right)
  return median(gaps)
}

function median(values: readonly number[]): number {
  const middle = Math.floor(values.length / 2)
  return values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle]
}

function burstTimingDistance(
  burst: IZx81TapeBurstRange,
  sampleRate: number,
  timing: IZx81TapeBurstTiming,
): number {
  const duration = (burst.endSample - burst.startSample) / sampleRate
  const separation = Math.max(0.0002, timing.oneBurstSeconds - timing.zeroBurstSeconds)
  return Math.min(
    Math.abs(duration - timing.zeroBurstSeconds),
    Math.abs(duration - timing.oneBurstSeconds),
  ) / separation
}
