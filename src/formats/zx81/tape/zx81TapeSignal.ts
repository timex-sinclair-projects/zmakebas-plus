import {
  consolidateZx81SplitBursts,
  type IZx81TapeBurstTiming,
  type IZx81TapeNominalTiming,
} from './zx81TapeBurstTiming'
import {
  estimateEnvelopeThreshold,
  estimateSignalThreshold,
  estimateSpeedScale,
  findActiveBursts,
  findEnvelopeBursts,
  isRecoverableBurst,
  tryEstimateSignalThreshold,
} from './zx81TapeBurstDetection'
import { recoverZx81TapeGapBursts, type IZx81TapeBurstRange } from './zx81TapeGapRecovery'
import { percentile } from './zx81TapeMath'
import { recoverZx81CarrierMergedBursts } from './zx81TapeMergedBurstRecovery'
import {
  conditionZx81TapeSignal,
  recoverZx81TapeCarrierEnergy,
  restoreZx81TapeSignal,
} from './zx81TapeSignalConditioning'

const nominalTapeTiming = {
  gapSeconds: 0.0013,
  oneBurstSeconds: 0.0027,
  zeroBurstSeconds: 0.0012,
} as const satisfies IZx81TapeNominalTiming
const nominalZeroBurstSeconds = nominalTapeTiming.zeroBurstSeconds
const nominalOneBurstSeconds = nominalTapeTiming.oneBurstSeconds
const nominalGapSeconds = nominalTapeTiming.gapSeconds
const maximumDetectedBursts = 500_000
const localTimingWindowRadius = 128
const localTimingAnchorStride = 64
const minimumLocalTimingRegionBursts = 128
const maximumAnchorTimingChangeRatio = 0.2

type BurstTiming = IZx81TapeBurstTiming

export type Zx81TapeEventKind = 'burst' | 'gap'
export type Zx81TapeBitValue = 0 | 1 | null

export type Zx81TapeEvent = {
  readonly confidence: number
  readonly endSample: number
  readonly id: string
  readonly kind: Zx81TapeEventKind
  readonly startSample: number
}

export type Zx81TapeBit = {
  readonly automaticValue: Zx81TapeBitValue
  readonly confidence: number
  readonly endSample: number
  readonly eventId: string
  readonly id: string
  readonly index: number
  readonly startSample: number
}

export type Zx81TapeSignalAnalysis = {
  readonly bits: readonly Zx81TapeBit[]
  readonly events: readonly Zx81TapeEvent[]
  readonly regions: readonly Zx81TapeSignalRegion[]
  readonly speedScale: number
  readonly threshold: number
}

export type Zx81TapeSignalRegion = {
  readonly bitEnd: number
  readonly bitStart: number
  readonly endSample: number
  readonly oneBurstSeconds: number
  readonly startSample: number
  readonly zeroBurstSeconds: number
}

export interface IZx81TapeSignalOptions {
  readonly onProgress?: (progress: IZx81TapeSignalProgress) => void
  readonly signalCarrierRecoveryEnabled?: boolean
  readonly signalConditioningEnabled?: boolean
  readonly signalRestorationEnabled?: boolean
}

export interface IZx81TapeSignalProgress {
  readonly fraction: number
  readonly stage: Zx81TapeSignalProgressStage
}

export type Zx81TapeSignalProgressStage = 'condition-signal' | 'detect-bursts' | 'classify-bits'

type SampleRange = IZx81TapeBurstRange

/** Extracts gap-delimited ZX81 carrier bursts and confidence-scored bits. */
export function analyzeZx81TapeSignal(
  samples: Float32Array,
  sampleRate: number,
  maximumBursts = maximumDetectedBursts,
  options: IZx81TapeSignalOptions = {},
): Zx81TapeSignalAnalysis {
  if (samples.length === 0) {
    throw new Error('The WAV file contains no audio samples.')
  }

  reportSignalProgress(options, 'condition-signal', 0)
  const conditioningProgress = options.onProgress
    ? (fraction: number) => reportSignalProgress(options, 'condition-signal', fraction * 0.25)
    : undefined
  const carrierRecovered = options.signalCarrierRecoveryEnabled
    ? recoverZx81TapeCarrierEnergy(samples, sampleRate, conditioningProgress)
    : null
  const restored = !carrierRecovered && options.signalRestorationEnabled
    ? restoreZx81TapeSignal(samples, sampleRate, conditioningProgress)
    : null
  const envelopeSignal = carrierRecovered ?? restored
  const detectorSamples = !envelopeSignal && options.signalConditioningEnabled
    ? conditionZx81TapeSignal(samples, sampleRate, conditioningProgress)
    : samples
  reportSignalProgress(options, 'condition-signal', 0.25)
  const thresholdSamples = envelopeSignal?.envelopeSamples ?? detectorSamples
  const threshold = envelopeSignal
    ? estimateEnvelopeThreshold(thresholdSamples)
    : estimateSignalThreshold(thresholdSamples, sampleRate)
  reportSignalProgress(options, 'detect-bursts', 0.35)
  const bursts = envelopeSignal
    ? findEnvelopeBursts(
        thresholdSamples,
        sampleRate,
        threshold,
        maximumBursts,
        carrierRecovered ? 0 : undefined,
        (fraction) => reportSignalProgress(options, 'detect-bursts', 0.35 + fraction * 0.25),
      )
    : findActiveBursts(
        thresholdSamples,
        sampleRate,
        threshold,
        maximumBursts,
        (fraction) => reportSignalProgress(options, 'detect-bursts', 0.35 + fraction * 0.25),
      )
  if (bursts.length < 8) {
    throw new Error('No plausible ZX81 tape signal was found in this channel.')
  }

  const speedScale = estimateSpeedScale(bursts, sampleRate, nominalGapSeconds)
  const consolidatedBursts = consolidateZx81SplitBursts(
    bursts,
    sampleRate,
    speedScale,
    nominalTapeTiming,
    (contextBursts) => estimateBurstTiming(contextBursts, sampleRate, speedScale),
  )
  const consolidatedRecoverableBursts = consolidatedBursts.filter(
    (burst) => isRecoverableBurst(burst, sampleRate, speedScale),
  )
  const mergedBurstTiming = carrierRecovered
    ? estimateBurstTiming(consolidatedRecoverableBursts, sampleRate, speedScale)
    : null
  const mergedBurstRecovered = carrierRecovered
    ? recoverZx81CarrierMergedBursts(
        samples,
        consolidatedRecoverableBursts,
        sampleRate,
        speedScale,
        nominalTapeTiming,
        (contextBursts) => estimateBurstTiming(
          contextBursts,
          sampleRate,
          speedScale,
          mergedBurstTiming ?? undefined,
        ),
      )
    : consolidatedRecoverableBursts
  reportSignalProgress(options, 'classify-bits', 0.72)
  const primaryBursts = mergedBurstRecovered.filter((burst) => isRecoverableBurst(burst, sampleRate, speedScale))
  const rawRecoveryThreshold = envelopeSignal ? tryEstimateSignalThreshold(samples, sampleRate) : threshold
  const recoverableBursts = rawRecoveryThreshold === null
    ? primaryBursts
    : recoverZx81TapeGapBursts(
        envelopeSignal ? samples : detectorSamples,
        primaryBursts,
        sampleRate,
        rawRecoveryThreshold,
        speedScale,
        maximumBursts,
      )
  reportSignalProgress(options, 'classify-bits', 0.84)
  const { bits, regions } = classifySignalRegions(recoverableBursts, sampleRate, speedScale)
  reportSignalProgress(options, 'classify-bits', 0.96)
  const events = createEvents(recoverableBursts, bits, sampleRate, speedScale)
  reportSignalProgress(options, 'classify-bits', 1)

  return { bits, events, regions, speedScale, threshold }
}

function reportSignalProgress(options: IZx81TapeSignalOptions, stage: Zx81TapeSignalProgressStage, fraction: number): void {
  options.onProgress?.({ fraction: Math.max(0, Math.min(1, fraction)), stage })
}

function classifySignalRegions(
  bursts: readonly SampleRange[],
  sampleRate: number,
  speedScale: number,
): Pick<Zx81TapeSignalAnalysis, 'bits' | 'regions'> {
  const bits: Zx81TapeBit[] = []
  const regions: Zx81TapeSignalRegion[] = []
  const maximumIntraRegionGapSeconds = 0.05
  let regionStart = 0

  for (let index = 1; index <= bursts.length; index += 1) {
    const previous = bursts[index - 1]
    const next = bursts[index]
    const gapSeconds = previous && next ? (next.startSample - previous.endSample) / sampleRate : Number.POSITIVE_INFINITY
    if (index < bursts.length && gapSeconds <= maximumIntraRegionGapSeconds) {
      continue
    }

    const regionBursts = bursts.slice(regionStart, index)
    const timing = estimateBurstTiming(regionBursts, sampleRate, speedScale)
    const timingAnchors = createLocalTimingAnchors(regionBursts, sampleRate, speedScale, timing)
    const bitStart = bits.length
    let timingAnchorIndex = 0
    for (let localIndex = 0; localIndex < regionBursts.length; localIndex += 1) {
      while (timingAnchorIndex + 1 < timingAnchors.length - 1 && timingAnchors[timingAnchorIndex + 1].index < localIndex) {
        timingAnchorIndex += 1
      }
      const localTiming = interpolateTiming(timingAnchors[timingAnchorIndex], timingAnchors[timingAnchorIndex + 1], localIndex)
      const localClassification = classifyBurst(regionBursts[localIndex], bits.length, sampleRate, localTiming)
      bits.push(localClassification.automaticValue === null
        ? classifyBurst(regionBursts[localIndex], bits.length, sampleRate, timing)
        : localClassification)
    }
    if (previous && regionBursts[0]) {
      regions.push({
        bitEnd: bits.length,
        bitStart,
        endSample: previous.endSample,
        oneBurstSeconds: timing.oneBurstSeconds,
        startSample: regionBursts[0].startSample,
        zeroBurstSeconds: timing.zeroBurstSeconds,
      })
    }
    regionStart = index
  }

  return { bits, regions }
}

type BurstTimingAnchor = BurstTiming & {
  readonly index: number
}

function estimateBurstTiming(
  bursts: readonly SampleRange[],
  sampleRate: number,
  speedScale: number,
  fallback?: BurstTiming,
): BurstTiming {
  const durations = bursts.map((burst) => (burst.endSample - burst.startSample) / sampleRate)
  let zeroBurstSeconds = fallback?.zeroBurstSeconds ?? nominalZeroBurstSeconds * speedScale
  let oneBurstSeconds = fallback?.oneBurstSeconds ?? nominalOneBurstSeconds * speedScale

  for (let iteration = 0; iteration < 6; iteration += 1) {
    const zeroDurations: number[] = []
    const oneDurations: number[] = []
    for (const duration of durations) {
      const zeroDistance = Math.abs(duration - zeroBurstSeconds)
      const oneDistance = Math.abs(duration - oneBurstSeconds)
      if (zeroDistance <= oneDistance) {
        zeroDurations.push(duration)
      } else {
        oneDurations.push(duration)
      }
    }

    if (zeroDurations.length < 4 || oneDurations.length < 4) {
      break
    }
    zeroDurations.sort((left, right) => left - right)
    oneDurations.sort((left, right) => left - right)
    zeroBurstSeconds = percentile(zeroDurations, 0.5)
    oneBurstSeconds = percentile(oneDurations, 0.5)
  }

  if (oneBurstSeconds < zeroBurstSeconds * 1.35) {
    return fallback ?? {
      oneBurstSeconds: nominalOneBurstSeconds * speedScale,
      zeroBurstSeconds: nominalZeroBurstSeconds * speedScale,
    }
  }
  return { oneBurstSeconds, zeroBurstSeconds }
}

function createLocalTimingAnchors(
  bursts: readonly SampleRange[],
  sampleRate: number,
  speedScale: number,
  regionTiming: BurstTiming,
): BurstTimingAnchor[] {
  if (bursts.length < minimumLocalTimingRegionBursts) {
    return [
      { ...regionTiming, index: 0 },
      { ...regionTiming, index: Math.max(0, bursts.length - 1) },
    ]
  }

  const anchors: BurstTimingAnchor[] = []
  for (let center = 0; center < bursts.length; center += localTimingAnchorStride) {
    const windowStart = Math.max(0, center - localTimingWindowRadius)
    const windowEnd = Math.min(bursts.length, center + localTimingWindowRadius + 1)
    const fitted = estimateBurstTiming(bursts.slice(windowStart, windowEnd), sampleRate, speedScale, regionTiming)
    const timing = anchors.length === 0 ? fitted : constrainTimingChange(anchors[anchors.length - 1], fitted)
    anchors.push({ ...timing, index: center })
  }

  const lastIndex = bursts.length - 1
  if (anchors[anchors.length - 1].index !== lastIndex) {
    const windowStart = Math.max(0, lastIndex - localTimingWindowRadius)
    const fitted = estimateBurstTiming(bursts.slice(windowStart), sampleRate, speedScale, regionTiming)
    anchors.push({ ...constrainTimingChange(anchors[anchors.length - 1], fitted), index: lastIndex })
  }
  return anchors
}

function constrainTimingChange(previous: BurstTiming, next: BurstTiming): BurstTiming {
  return {
    oneBurstSeconds: clampRatioChange(previous.oneBurstSeconds, next.oneBurstSeconds),
    zeroBurstSeconds: clampRatioChange(previous.zeroBurstSeconds, next.zeroBurstSeconds),
  }
}

function clampRatioChange(previous: number, next: number): number {
  return Math.max(previous * (1 - maximumAnchorTimingChangeRatio), Math.min(previous * (1 + maximumAnchorTimingChangeRatio), next))
}

function interpolateTiming(left: BurstTimingAnchor, right: BurstTimingAnchor | undefined, index: number): BurstTiming {
  if (!right || right.index === left.index) {
    return left
  }
  const ratio = Math.max(0, Math.min(1, (index - left.index) / (right.index - left.index)))
  return {
    oneBurstSeconds: left.oneBurstSeconds + (right.oneBurstSeconds - left.oneBurstSeconds) * ratio,
    zeroBurstSeconds: left.zeroBurstSeconds + (right.zeroBurstSeconds - left.zeroBurstSeconds) * ratio,
  }
}

function classifyBurst(burst: SampleRange, index: number, sampleRate: number, timing: BurstTiming): Zx81TapeBit {
  const duration = (burst.endSample - burst.startSample) / sampleRate
  const zeroDistance = Math.abs(duration - timing.zeroBurstSeconds)
  const oneDistance = Math.abs(duration - timing.oneBurstSeconds)
  const clusterSeparation = Math.max(0.0002, timing.oneBurstSeconds - timing.zeroBurstSeconds)
  const bestDistance = Math.min(zeroDistance, oneDistance)
  const normalizedDistance = bestDistance / clusterSeparation
  const automaticValue: Zx81TapeBitValue = burst.recoveredValue ?? (normalizedDistance <= 0.28 ? (zeroDistance <= oneDistance ? 0 : 1) : null)
  const classifiedConfidence = automaticValue === null ? Math.max(0, 0.35 - normalizedDistance) : Math.max(0.05, Math.min(1, 1 - normalizedDistance * 2))
  const confidence = burst.recoveredConfidence ?? (burst.recovered ? classifiedConfidence * 0.6 : classifiedConfidence)

  return {
    automaticValue,
    confidence,
    endSample: burst.endSample,
    eventId: `burst-${index}`,
    id: `bit-${index}`,
    index,
    startSample: burst.startSample,
  }
}

function createEvents(
  bursts: readonly SampleRange[],
  bits: readonly Zx81TapeBit[],
  sampleRate: number,
  speedScale: number,
): Zx81TapeEvent[] {
  const events: Zx81TapeEvent[] = []
  for (let index = 0; index < bursts.length; index += 1) {
    events.push({
      confidence: bits[index].confidence,
      endSample: bursts[index].endSample,
      id: `burst-${index}`,
      kind: 'burst',
      startSample: bursts[index].startSample,
    })

    const nextBurst = bursts[index + 1]
    if (!nextBurst) {
      continue
    }
    const gapSeconds = (nextBurst.startSample - bursts[index].endSample) / sampleRate
    const confidence = Math.max(0, Math.min(1, 1 - relativeError(gapSeconds, nominalGapSeconds * speedScale)))
    events.push({
      confidence,
      endSample: nextBurst.startSample,
      id: `gap-${index}`,
      kind: 'gap',
      startSample: bursts[index].endSample,
    })
  }
  return events
}

function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / expected
}
