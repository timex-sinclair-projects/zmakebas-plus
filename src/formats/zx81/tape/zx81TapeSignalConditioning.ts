const rmsWindowSeconds = 0.1
const rmsAnchorSeconds = 0.05
const targetRms = 0.25
const minimumNormalizableRms = 0.008
const minimumGain = 0.25
const maximumGain = 8
const nominalHighPassHz = 1_200
const nominalLowPassHz = 3_800
const envelopeAttackSeconds = 0.00005
const envelopeReleaseSeconds = 0.00024
const noiseFloorBlockSeconds = 0.1
const noiseFloorPercentile = 0.2
const minimumRestorationGain = 0.08
const carrierRecoveryCentreHz = 3_266
const carrierRecoveryLowPassHz = 1_400

export type Zx81TapeEnvelopeSignal = {
  readonly envelopeSamples: Float32Array
}

export type Zx81TapeConditioningProgress = (fraction: number) => void

/** Returns a detector-only, level-normalized and carrier-band-passed copy of raw tape samples. */
export function conditionZx81TapeSignal(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: Zx81TapeConditioningProgress,
): Float32Array {
  const conditioned = samples.slice()
  onProgress?.(0.02)
  normalizeLocalRms(conditioned, sampleRate, mapProgress(onProgress, 0.02, 0.68))
  applyCarrierBandPass(conditioned, sampleRate, mapProgress(onProgress, 0.68, 1))
  onProgress?.(1)
  return conditioned
}

/** Returns one detector-only filter-first, noise-reduced carrier-envelope copy of raw tape samples. */
export function restoreZx81TapeSignal(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: Zx81TapeConditioningProgress,
): Zx81TapeEnvelopeSignal {
  const envelopeSamples = samples.slice()
  onProgress?.(0.02)
  applyCarrierBandPass(envelopeSamples, sampleRate, mapProgress(onProgress, 0.02, 0.25))
  normalizeLocalRms(envelopeSamples, sampleRate, mapProgress(onProgress, 0.25, 0.65))
  // This is safe in place because the follower reads each carrier sample before replacing that same index.
  updateCarrierEnvelope(envelopeSamples, envelopeSamples, sampleRate, mapProgress(onProgress, 0.65, 0.82))
  suppressCarrierEnvelopeNoiseFloor(envelopeSamples, sampleRate, mapProgress(onProgress, 0.82, 1))
  onProgress?.(1)
  return { envelopeSamples }
}

/** Returns a detector-only quadrature carrier-energy envelope without modifying the raw samples. */
export function recoverZx81TapeCarrierEnergy(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: Zx81TapeConditioningProgress,
): Zx81TapeEnvelopeSignal {
  const envelopeSamples = new Float32Array(samples.length)
  const centreHz = Math.min(carrierRecoveryCentreHz, sampleRate * 0.42)
  const lowPassHz = Math.min(carrierRecoveryLowPassHz, centreHz * 0.4)
  const radiansPerSample = Math.PI * 2 * centreHz / sampleRate
  const oscillatorStepCosine = Math.cos(radiansPerSample)
  const oscillatorStepSine = Math.sin(radiansPerSample)
  const lowPassAlpha = 1 - Math.exp(-Math.PI * 2 * lowPassHz / sampleRate)
  let oscillatorCosine = 1
  let oscillatorSine = 0
  let inPhaseLow1 = 0
  let inPhaseLow2 = 0
  let quadratureLow1 = 0
  let quadratureLow2 = 0
  const recoveryProgress = createLoopProgress(samples.length, mapProgress(onProgress, 0, 0.48))

  for (let index = 0; index < samples.length; index += 1) {
    const sample = finiteSample(samples[index])
    const inPhase = sample * oscillatorCosine
    const quadrature = sample * oscillatorSine
    inPhaseLow1 += (inPhase - inPhaseLow1) * lowPassAlpha
    inPhaseLow2 += (inPhaseLow1 - inPhaseLow2) * lowPassAlpha
    quadratureLow1 += (quadrature - quadratureLow1) * lowPassAlpha
    quadratureLow2 += (quadratureLow1 - quadratureLow2) * lowPassAlpha
    envelopeSamples[index] = clampSample(Math.sqrt(
      inPhaseLow2 * inPhaseLow2 + quadratureLow2 * quadratureLow2,
    ) * 2)

    const nextCosine = oscillatorCosine * oscillatorStepCosine - oscillatorSine * oscillatorStepSine
    oscillatorSine = oscillatorSine * oscillatorStepCosine + oscillatorCosine * oscillatorStepSine
    oscillatorCosine = nextCosine
    if ((index & 0xfff) === 0xfff) {
      const magnitude = Math.hypot(oscillatorCosine, oscillatorSine)
      oscillatorCosine /= magnitude
      oscillatorSine /= magnitude
    }
    recoveryProgress?.report(index + 1)
  }

  recoveryProgress?.complete()
  normalizeLocalRms(envelopeSamples, sampleRate, mapProgress(onProgress, 0.48, 0.8))
  suppressCarrierEnvelopeNoiseFloor(envelopeSamples, sampleRate, mapProgress(onProgress, 0.8, 1))
  onProgress?.(1)
  return { envelopeSamples }
}

function normalizeLocalRms(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: Zx81TapeConditioningProgress,
): void {
  const windowSamples = Math.max(1, Math.round(sampleRate * rmsWindowSeconds))
  const anchorSamples = Math.max(1, Math.round(sampleRate * rmsAnchorSeconds))
  const halfWindow = Math.floor(windowSamples / 2)
  const anchorCount = Math.max(1, Math.ceil(samples.length / anchorSamples) + 1)
  const gains = new Float32Array(anchorCount)
  const anchorProgress = createLoopProgress(anchorCount, mapProgress(onProgress, 0, 0.67))
  for (let anchorIndex = 0; anchorIndex < anchorCount; anchorIndex += 1) {
    const center = Math.min(samples.length, anchorIndex * anchorSamples)
    const start = Math.max(0, center - halfWindow)
    const end = Math.min(samples.length, center + halfWindow)
    let energy = 0
    for (let index = start; index < end; index += 1) {
      const sample = finiteSample(samples[index])
      energy += sample * sample
    }
    const rms = Math.sqrt(energy / Math.max(1, end - start))
    gains[anchorIndex] = rms < minimumNormalizableRms
      ? 1
      : Math.max(minimumGain, Math.min(maximumGain, targetRms / rms))
    anchorProgress?.report(anchorIndex + 1)
  }
  anchorProgress?.complete()

  const sampleProgress = createLoopProgress(samples.length, mapProgress(onProgress, 0.67, 1))
  for (let index = 0; index < samples.length; index += 1) {
    const leftAnchor = Math.min(gains.length - 1, Math.floor(index / anchorSamples))
    const rightAnchor = Math.min(gains.length - 1, leftAnchor + 1)
    const ratio = (index - leftAnchor * anchorSamples) / anchorSamples
    const gain = gains[leftAnchor] + (gains[rightAnchor] - gains[leftAnchor]) * ratio
    samples[index] = clampSample(finiteSample(samples[index]) * gain)
    sampleProgress?.report(index + 1)
  }
  sampleProgress?.complete()
  onProgress?.(1)
}

function applyCarrierBandPass(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: Zx81TapeConditioningProgress,
): void {
  const nyquist = sampleRate / 2
  const lowPassHz = Math.min(nominalLowPassHz, nyquist * 0.84)
  const highPassHz = Math.min(nominalHighPassHz, lowPassHz * 0.5)
  const sampleSeconds = 1 / sampleRate
  const highPassAlpha = filterRc(highPassHz) / (filterRc(highPassHz) + sampleSeconds)
  const lowPassAlpha = sampleSeconds / (filterRc(lowPassHz) + sampleSeconds)
  let previousInput1 = samples[0] ?? 0
  let previousHigh1 = 0
  let previousInput2 = 0
  let previousHigh2 = 0
  let previousLow1 = 0
  let previousLow2 = 0
  const progress = createLoopProgress(samples.length, onProgress)

  for (let index = 0; index < samples.length; index += 1) {
    const input = finiteSample(samples[index])
    const high1 = highPassAlpha * (previousHigh1 + input - previousInput1)
    previousInput1 = input
    previousHigh1 = high1
    const high2 = highPassAlpha * (previousHigh2 + high1 - previousInput2)
    previousInput2 = high1
    previousHigh2 = high2
    const low1 = previousLow1 + lowPassAlpha * (high2 - previousLow1)
    previousLow1 = low1
    const low2 = previousLow2 + lowPassAlpha * (low1 - previousLow2)
    previousLow2 = low2
    samples[index] = clampSample(low2)
    progress?.report(index + 1)
  }
  progress?.complete()
}

function updateCarrierEnvelope(
  envelope: Float32Array,
  samples: Float32Array,
  sampleRate: number,
  onProgress?: Zx81TapeConditioningProgress,
): void {
  const attack = smoothingCoefficient(sampleRate, envelopeAttackSeconds)
  const release = smoothingCoefficient(sampleRate, envelopeReleaseSeconds)
  let level = 0
  const progress = createLoopProgress(samples.length, onProgress)
  for (let index = 0; index < samples.length; index += 1) {
    const magnitude = Math.abs(finiteSample(samples[index]))
    level += (magnitude - level) * (magnitude >= level ? attack : release)
    envelope[index] = clampSample(level)
    progress?.report(index + 1)
  }
  progress?.complete()
}

function suppressCarrierEnvelopeNoiseFloor(
  envelopeSamples: Float32Array,
  sampleRate: number,
  onProgress?: Zx81TapeConditioningProgress,
): void {
  const blockSamples = Math.max(1, Math.round(sampleRate * noiseFloorBlockSeconds))
  const blockCount = Math.max(1, Math.ceil(envelopeSamples.length / blockSamples))
  const noiseFloors = new Float32Array(blockCount)
  const blockProgress = createLoopProgress(blockCount, mapProgress(onProgress, 0, 0.25))

  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const start = blockIndex * blockSamples
    const end = Math.min(envelopeSamples.length, start + blockSamples)
    const stride = Math.max(1, Math.floor((end - start) / 512))
    const measurements: number[] = []
    for (let index = start; index < end; index += stride) measurements.push(envelopeSamples[index])
    measurements.sort((left, right) => left - right)
    noiseFloors[blockIndex] = percentile(measurements, noiseFloorPercentile)
    blockProgress?.report(blockIndex + 1)
  }
  blockProgress?.complete()

  const sampleProgress = createLoopProgress(envelopeSamples.length, mapProgress(onProgress, 0.25, 1))
  for (let index = 0; index < envelopeSamples.length; index += 1) {
    const blockPosition = index / blockSamples
    const leftBlock = Math.min(noiseFloors.length - 1, Math.floor(blockPosition))
    const rightBlock = Math.min(noiseFloors.length - 1, leftBlock + 1)
    const ratio = blockPosition - leftBlock
    const noiseFloor = noiseFloors[leftBlock] + (noiseFloors[rightBlock] - noiseFloors[leftBlock]) * ratio
    const kneeStart = noiseFloor * 0.9
    const kneeWidth = Math.max(0.001, noiseFloor * 1.1)
    const kneeRatio = Math.max(0, Math.min(1, (envelopeSamples[index] - kneeStart) / kneeWidth))
    const smoothRatio = kneeRatio * kneeRatio * (3 - 2 * kneeRatio)
    const gain = minimumRestorationGain + (1 - minimumRestorationGain) * smoothRatio
    envelopeSamples[index] = clampSample(envelopeSamples[index] * gain)
    sampleProgress?.report(index + 1)
  }
  sampleProgress?.complete()
  onProgress?.(1)
}

type LoopProgress = {
  readonly complete: () => void
  readonly report: (completed: number) => void
}

function createLoopProgress(total: number, onProgress?: Zx81TapeConditioningProgress): LoopProgress | null {
  if (!onProgress) return null
  const stride = Math.max(1, Math.floor(total / 100))
  let nextCompleted = stride
  return {
    complete: () => onProgress(1),
    report: (completed) => {
      if (completed < nextCompleted) return
      onProgress(completed / Math.max(1, total))
      nextCompleted += stride
    },
  }
}

function mapProgress(
  onProgress: Zx81TapeConditioningProgress | undefined,
  start: number,
  end: number,
): Zx81TapeConditioningProgress | undefined {
  if (!onProgress) return undefined
  return (fraction) => onProgress(start + Math.max(0, Math.min(1, fraction)) * (end - start))
}

function smoothingCoefficient(sampleRate: number, seconds: number): number {
  return 1 - Math.exp(-1 / Math.max(1, sampleRate * seconds))
}

function percentile(sortedValues: readonly number[], ratio: number): number {
  if (sortedValues.length === 0) return 0
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.round((sortedValues.length - 1) * ratio)))
  return sortedValues[index]
}

function filterRc(frequency: number): number {
  return 1 / (Math.PI * 2 * Math.max(1, frequency))
}

function finiteSample(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0
}

function clampSample(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0))
}
