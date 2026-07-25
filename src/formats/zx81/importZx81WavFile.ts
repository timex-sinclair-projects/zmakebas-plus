import type { ImportedPFileSourceMapping } from './importPFile'
import { decodeWavPcm, estimateWavPcmMemoryBytes } from '../common/wavPcm'
import { assembleZx81TapeBytes } from './tape/zx81TapeBytes'
import { analyzeZx81TapeSignal, type Zx81TapeBit, type Zx81TapeEvent, type Zx81TapeSignalAnalysis, type Zx81TapeSignalProgressStage } from './tape/zx81TapeSignal'
import { candidateStartSample, compareCandidateQuality, deduplicateChannelCandidates, findProgramCandidates, type Candidate, type FoundCandidate } from './zx81WavCandidates'

const maximumProgramCandidates = 64
const maximumCandidateByteWork = 16 * 1024 * 1024
const maximumAnalyzedTapeBits = 500_000
const maximumConditionedTypedArrayBytes = 384 * 1024 * 1024

export type Zx81TapeByte = {
  readonly bitIds: readonly string[]
  readonly endSample: number
  readonly id: string
  readonly index: number
  readonly startSample: number
  readonly value: number | null
}

export type Zx81TapeSourceMapping = ImportedPFileSourceMapping & {
  readonly endSample: number
  readonly startSample: number
}

export type DecodedZx81Wav = {
  readonly bits: readonly Zx81TapeBit[]
  readonly bitsPerSample: number
  readonly bytes: readonly Zx81TapeByte[]
  readonly channelIndex: number
  readonly confidence: number
  readonly decodeError: string | null
  readonly durationSeconds: number
  readonly events: readonly Zx81TapeEvent[]
  readonly filename: string
  readonly filenameByteLength: number
  readonly pFileByteLength: number
  readonly pFileBytes: Uint8Array
  readonly programEndSample: number
  readonly programId: string
  readonly programStartSample: number
  readonly sampleRate: number
  readonly samples: Float32Array
  readonly signalCarrierRecoveryApplied: boolean
  readonly signalCarrierRecoveryEnabled: boolean
  readonly signalConditioningEnabled: boolean
  readonly signalRestorationApplied: boolean
  readonly signalRestorationEnabled: boolean
  readonly source: string | null
  readonly sourceMappings: readonly Zx81TapeSourceMapping[]
  readonly speedScale: number
  readonly tapeBitEnd: number
  readonly tapeBitStart: number
  readonly threshold: number
  readonly unknownBitCount: number
}

export interface IZx81WavImportOptions {
  readonly onProgress?: (progress: IZx81WavImportProgress) => void
  readonly signalCarrierRecoveryEnabled?: boolean
  readonly signalConditioningEnabled?: boolean
  readonly signalRestorationEnabled?: boolean
}

export interface IZx81WavImportProgress {
  readonly fraction: number
  readonly stage: Zx81WavImportProgressStage
}

export type Zx81WavImportProgressStage = 'decode-pcm' | Zx81TapeSignalProgressStage | 'decode-programs' | 'prepare-waveform'

/** Decodes the strongest structurally valid standard ZX81 program in a WAV file. */
export function importZx81WavFile(bytes: Uint8Array, options: IZx81WavImportOptions = {}): DecodedZx81Wav {
  const programs = importZx81WavPrograms(bytes, options).filter((program) => program.source !== null)
  if (programs.length === 0) {
    throw new Error('No structurally valid ZX81 program was found in the WAV file.')
  }
  return programs.reduce((best, candidate) => candidate.confidence > best.confidence ? candidate : best)
}

/** Decodes every structurally valid standard ZX81 program found in a WAV file. */
export function importZx81WavPrograms(bytes: Uint8Array, options: IZx81WavImportOptions = {}): DecodedZx81Wav[] {
  const reportProgress = createImportProgressReporter(options.onProgress)
  reportProgress('decode-pcm', 0)
  const pcm = decodeWavPcm(bytes, options.onProgress
    ? (fraction) => reportProgress('decode-pcm', fraction * 0.1)
    : undefined)
  if ((options.signalCarrierRecoveryEnabled || options.signalConditioningEnabled || options.signalRestorationEnabled)
    && estimatedAnalysisTypedArrayBytes(bytes, pcm) > maximumConditionedTypedArrayBytes) {
    throw new Error('The WAV file is too large to apply the selected signal processing within the browser memory limit. Disable optional signal-processing passes and try again.')
  }
  const found: FoundCandidate[] = []
  const errors: string[] = []
  const channelCount = pcm.channels.length
  const passes = [
    {
      signalCarrierRecoveryEnabled: false,
      signalConditioningEnabled: options.signalConditioningEnabled,
      signalRestorationEnabled: false,
    },
    ...(options.signalRestorationEnabled
      ? [{ signalCarrierRecoveryEnabled: false, signalConditioningEnabled: false, signalRestorationEnabled: true }]
      : []),
    ...(options.signalCarrierRecoveryEnabled
      ? [{ signalCarrierRecoveryEnabled: true, signalConditioningEnabled: false, signalRestorationEnabled: false }]
      : []),
  ]
  const passCount = passes.length
  const totalPasses = channelCount * passCount
  const analyzedBitLimit = Math.floor(maximumAnalyzedTapeBits / channelCount)
  const candidateAttemptLimit = analyzedBitLimit
  const candidateByteLimit = Math.floor(maximumCandidateByteWork / (channelCount * passCount))

  let completedPasses = 0
  for (let channelIndex = 0; channelIndex < pcm.channels.length; channelIndex += 1) {
    for (const pass of passes) {
      const reportPassProgress = (stage: Zx81WavImportProgressStage, fraction: number): void => {
        reportProgress(stage, 0.1 + (completedPasses + fraction) / totalPasses * 0.82)
      }
      const signalProgress = options.onProgress
        ? (progress: { readonly fraction: number; readonly stage: Zx81TapeSignalProgressStage }) => reportPassProgress(progress.stage, progress.fraction * 0.72)
        : undefined
      try {
        const analysis = analyzeZx81TapeSignal(pcm.channels[channelIndex], pcm.sampleRate, analyzedBitLimit, {
          ...pass,
          onProgress: signalProgress,
        })
        const candidates = findProgramCandidates(
          analysis,
          candidateAttemptLimit,
          candidateByteLimit,
          options.onProgress
            ? (fraction) => reportPassProgress('decode-programs', 0.72 + fraction * 0.28)
            : undefined,
        )
        for (const candidate of candidates) {
          found.push({
            analysis,
            candidate,
            channelIndex,
            signalCarrierRecoveryApplied: pass.signalCarrierRecoveryEnabled,
            signalRestorationApplied: pass.signalRestorationEnabled,
          })
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `Unable to analyze WAV channel ${channelIndex + 1}.`)
      } finally {
        completedPasses += 1
        reportProgress('decode-programs', 0.1 + completedPasses / totalPasses * 0.82)
      }
    }
  }

  if (found.length === 0) {
    throw new Error(errors[0] ?? 'No structurally valid ZX81 program was found in the WAV file.')
  }
  const eligibleFound = found.filter((item) => (
    !item.signalCarrierRecoveryApplied
    || found.some((candidate) => (
      !candidate.signalCarrierRecoveryApplied
      && candidate.channelIndex === item.channelIndex
      && Math.abs(candidateStartSample(item) - candidateStartSample(candidate)) <= pcm.sampleRate
    ))
  ))
  if (eligibleFound.length === 0) {
    throw new Error('No structurally valid ZX81 program was found in the WAV file outside the experimental carrier-recovery pass.')
  }

  reportProgress('prepare-waveform', 0.94)
  const programs = deduplicateChannelCandidates(eligibleFound, pcm.sampleRate)
    .sort((left, right) => compareCandidateQuality(left.candidate, right.candidate))
    .slice(0, maximumProgramCandidates)
    .sort((left, right) => candidateStartSample(left) - candidateStartSample(right) || left.channelIndex - right.channelIndex)
    .map(({ analysis, candidate, channelIndex, signalCarrierRecoveryApplied, signalRestorationApplied }) => (
      createDecodedProgram(
        pcm,
        analysis,
        candidate,
        channelIndex,
        options,
        signalCarrierRecoveryApplied,
        signalRestorationApplied,
      )
    ))
  reportProgress('prepare-waveform', 1)
  return programs
}

function createImportProgressReporter(
  onProgress: IZx81WavImportOptions['onProgress'],
): (stage: Zx81WavImportProgressStage, fraction: number) => void {
  let lastFraction = -1
  let lastStage: Zx81WavImportProgressStage | null = null
  return (stage, fraction) => {
    if (!onProgress) return
    const nextFraction = Math.max(lastFraction, Math.max(0, Math.min(1, fraction)))
    const percentage = Math.floor(nextFraction * 100)
    if (stage === lastStage && percentage === Math.floor(lastFraction * 100)) return
    lastFraction = nextFraction
    lastStage = stage
    onProgress({ fraction: nextFraction, stage })
  }
}

function estimatedAnalysisTypedArrayBytes(
  bytes: Uint8Array,
  pcm: ReturnType<typeof decodeWavPcm>,
): number {
  const frameCount = pcm.channels[0]?.length ?? 0
  const retainedWavBytes = estimateWavPcmMemoryBytes(bytes.byteLength, frameCount, pcm.channels.length)
  const detectorCopyBytes = pcm.channels.reduce((largest, channel) => Math.max(largest, channel.byteLength), 0)
  return retainedWavBytes + detectorCopyBytes
}

function createDecodedProgram(
  pcm: ReturnType<typeof decodeWavPcm>,
  analysis: Zx81TapeSignalAnalysis,
  candidate: Candidate,
  channelIndex: number,
  options: IZx81WavImportOptions,
  signalCarrierRecoveryApplied: boolean,
  signalRestorationApplied: boolean,
): DecodedZx81Wav {
  const tapeByteLength = candidate.filenameByteLength + candidate.pFileBytes.length
  const bytesWithRanges = assembleZx81TapeBytes(analysis.bits, candidate.bitStart, candidate.bitEnd, tapeByteLength).bytes
  return {
    bits: analysis.bits,
    bitsPerSample: pcm.bitsPerSample,
    bytes: bytesWithRanges,
    channelIndex,
    confidence: candidate.confidence,
    decodeError: candidate.decodeError,
    durationSeconds: pcm.durationSeconds,
    events: analysis.events,
    filename: candidate.filename,
    filenameByteLength: candidate.filenameByteLength,
    pFileByteLength: candidate.pFileBytes.length,
    pFileBytes: candidate.pFileBytes,
    programEndSample: analysis.bits[candidate.bitEnd - 1]?.endSample ?? 0,
    programId: `channel-${channelIndex}-bit-${candidate.bitStart}-length-${candidate.pFileBytes.length}`,
    programStartSample: analysis.bits[candidate.bitStart]?.startSample ?? 0,
    sampleRate: pcm.sampleRate,
    samples: pcm.channels[channelIndex],
    signalCarrierRecoveryApplied,
    signalCarrierRecoveryEnabled: options.signalCarrierRecoveryEnabled === true,
    signalConditioningEnabled: options.signalConditioningEnabled === true,
    signalRestorationApplied,
    signalRestorationEnabled: options.signalRestorationEnabled === true,
    source: candidate.source,
    sourceMappings: mapSourceRanges(candidate.sourceMappings, bytesWithRanges, candidate.filenameByteLength),
    speedScale: analysis.speedScale,
    tapeBitEnd: candidate.bitEnd,
    tapeBitStart: candidate.bitStart,
    threshold: analysis.threshold,
    unknownBitCount: candidate.unknownBitCount,
  }
}

function mapSourceRanges(
  mappings: readonly ImportedPFileSourceMapping[],
  bytes: readonly Zx81TapeByte[],
  filenameByteLength: number,
): Zx81TapeSourceMapping[] {
  return mappings.flatMap((mapping) => {
    const firstByte = bytes[filenameByteLength + mapping.pFileStart]
    const lastByte = bytes[filenameByteLength + mapping.pFileEnd - 1]
    return firstByte && lastByte
      ? [{ ...mapping, endSample: lastByte.endSample, startSample: firstByte.startSample }]
      : []
  })
}

