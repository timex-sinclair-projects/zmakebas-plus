import type { IZx81TapeBurstRange } from './zx81TapeGapRecovery'
import { percentile } from './zx81TapeMath'

type SampleRange = IZx81TapeBurstRange

/** Estimates an amplitude threshold for a raw or conditioned tape signal. */
export function estimateSignalThreshold(samples: Float32Array, sampleRate: number): number {
  const maximumMeasurements = 20_000
  const stride = Math.max(1, Math.floor(samples.length / maximumMeasurements))
  const amplitudes: number[] = []
  const smoothing = dcSmoothing(sampleRate)
  let dc = samples[0] ?? 0
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]
    dc += (sample - dc) * smoothing
    if (index % stride === 0) {
      amplitudes.push(Math.abs(sample - dc))
    }
  }
  amplitudes.sort((left, right) => left - right)

  const noiseFloor = percentile(amplitudes, 0.2)
  let signalLevel = percentile(amplitudes, 0.98)
  if (signalLevel < 0.005) {
    const activeMeasurements = amplitudes.filter((amplitude) => amplitude >= 0.005)
    if (activeMeasurements.length >= 8) {
      signalLevel = percentile(activeMeasurements, 0.8)
    }
  }
  if (signalLevel < 0.005 || signalLevel < noiseFloor * 1.4) {
    throw new Error('The selected WAV channel does not contain a distinct tape-level signal.')
  }

  return Math.max(0.0025, noiseFloor + (signalLevel - noiseFloor) * 0.22)
}

/** Attempts to estimate a raw-signal threshold without making recovery depend on its success. */
export function tryEstimateSignalThreshold(samples: Float32Array, sampleRate: number): number | null {
  try {
    return estimateSignalThreshold(samples, sampleRate)
  } catch {
    return null
  }
}

/** Estimates an amplitude threshold for a recovered carrier envelope. */
export function estimateEnvelopeThreshold(samples: Float32Array): number {
  const amplitudes = sampledSortedAmplitudes(samples)
  const noiseFloor = percentile(amplitudes, 0.2)
  const signalLevel = percentile(amplitudes, 0.98)
  if (signalLevel < 0.003 || signalLevel < noiseFloor * 1.6) {
    throw new Error('The selected WAV channel does not contain a distinct tape-level signal.')
  }
  return Math.max(0.0015, noiseFloor + (signalLevel - noiseFloor) * 0.22)
}

function sampledSortedAmplitudes(samples: Float32Array): number[] {
  const maximumMeasurements = 20_000
  const stride = Math.max(1, Math.floor(samples.length / maximumMeasurements))
  const amplitudes: number[] = []
  for (let index = 0; index < samples.length; index += stride) amplitudes.push(Math.abs(samples[index]))
  return amplitudes.sort((left, right) => left - right)
}

/** Finds carrier bursts in a raw or conditioned tape signal. */
export function findActiveBursts(
  samples: Float32Array,
  sampleRate: number,
  threshold: number,
  maximumBursts: number,
  onProgress?: (fraction: number) => void,
): SampleRange[] {
  const maximumBridgeSamples = Math.max(1, Math.round(sampleRate * 0.00035))
  const smoothing = dcSmoothing(sampleRate)
  const rawRanges: SampleRange[] = []
  let dc = samples[0] ?? 0
  let rangeStart = -1
  let lastActive = -1
  const progressStride = Math.max(1, Math.floor(samples.length / 100))
  let nextProgressSample = progressStride

  for (let index = 0; index < samples.length; index += 1) {
    if (onProgress && index + 1 >= nextProgressSample) {
      onProgress((index + 1) / samples.length)
      nextProgressSample += progressStride
    }
    const sample = samples[index]
    dc += (sample - dc) * smoothing
    if (Math.abs(sample - dc) >= threshold) {
      if (rangeStart < 0) {
        rangeStart = index
      }
      lastActive = index
      continue
    }

    if (rangeStart >= 0 && index - lastActive > maximumBridgeSamples) {
      rawRanges.push({ startSample: rangeStart, endSample: lastActive + 1 })
      assertBurstLimit(rawRanges, maximumBursts)
      rangeStart = -1
      lastActive = -1
    }
  }

  if (rangeStart >= 0) {
    rawRanges.push({ startSample: rangeStart, endSample: lastActive + 1 })
    assertBurstLimit(rawRanges, maximumBursts)
  }

  onProgress?.(1)
  return rawRanges
}

/** Finds carrier bursts in a recovered carrier envelope. */
export function findEnvelopeBursts(
  samples: Float32Array,
  sampleRate: number,
  threshold: number,
  maximumBursts: number,
  releaseCompensationSeconds = 0.0004,
  onProgress?: (fraction: number) => void,
): SampleRange[] {
  const rawRanges: SampleRange[] = []
  const maximumBridgeSamples = Math.max(1, Math.round(sampleRate * 0.00035))
  const releaseCompensationSamples = Math.max(0, Math.round(sampleRate * releaseCompensationSeconds))
  let rangeStart = -1
  let lastActive = -1
  const progressStride = Math.max(1, Math.floor(samples.length / 100))
  let nextProgressSample = progressStride
  for (let index = 0; index <= samples.length; index += 1) {
    if (onProgress && index < samples.length && index + 1 >= nextProgressSample) {
      onProgress((index + 1) / samples.length)
      nextProgressSample += progressStride
    }
    if (index < samples.length && samples[index] >= threshold) {
      if (rangeStart < 0) rangeStart = index
      lastActive = index
      continue
    }
    if (rangeStart < 0 || (index < samples.length && index - lastActive <= maximumBridgeSamples)) continue
    rawRanges.push({
      startSample: rangeStart,
      endSample: Math.max(rangeStart + 1, lastActive + 1 - releaseCompensationSamples),
    })
    assertBurstLimit(rawRanges, maximumBursts)
    rangeStart = -1
    lastActive = -1
  }
  onProgress?.(1)
  return rawRanges
}

/** Estimates tape speed from the median plausible inter-burst gap. */
export function estimateSpeedScale(
  bursts: readonly SampleRange[],
  sampleRate: number,
  nominalGapSeconds: number,
): number {
  const plausibleGaps: number[] = []
  for (let index = 1; index < bursts.length; index += 1) {
    const gapSeconds = (bursts[index].startSample - bursts[index - 1].endSample) / sampleRate
    if (gapSeconds >= 0.00065 && gapSeconds <= 0.0022) {
      plausibleGaps.push(gapSeconds)
    }
  }

  if (plausibleGaps.length === 0) {
    return 1
  }

  plausibleGaps.sort((left, right) => left - right)
  return Math.max(0.65, Math.min(1.5, percentile(plausibleGaps, 0.5) / nominalGapSeconds))
}

/** Reports whether a burst duration can participate in gap recovery. */
export function isRecoverableBurst(burst: SampleRange, sampleRate: number, speedScale: number): boolean {
  const duration = (burst.endSample - burst.startSample) / sampleRate
  return duration >= 0.00045 * speedScale && duration <= 0.006 * speedScale
}

function dcSmoothing(sampleRate: number): number {
  return Math.min(1, 1 / Math.max(1, sampleRate * 0.02))
}

function assertBurstLimit(ranges: readonly SampleRange[], maximumBursts: number): void {
  if (ranges.length > maximumBursts) {
    throw new Error(`The WAV channel contains more than ${maximumBursts.toLocaleString()} detected bursts and exceeds the analysis limit.`)
  }
}
