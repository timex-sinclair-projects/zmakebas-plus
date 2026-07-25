import type { DecodedZx81Wav, Zx81TapeBit, Zx81TapeEvent } from '../../../formats'

export interface IZx81WavPackedAnalysis {
  readonly bitConfidences: Float64Array
  readonly bitRanges: Uint32Array
  readonly bitValues: Int8Array
  readonly eventConfidences: Float64Array
  readonly eventKinds: Uint8Array
  readonly eventRanges: Uint32Array
}

export interface IZx81WavPackedProgram {
  readonly analysisIndex: number
  readonly program: Omit<DecodedZx81Wav, 'bits' | 'events'>
}

export interface IZx81WavImportTransfer {
  readonly analyses: readonly IZx81WavPackedAnalysis[]
  readonly programs: readonly IZx81WavPackedProgram[]
}

/** Packs large bit and event object graphs into transferable typed arrays. */
export function packZx81WavPrograms(
  programs: readonly DecodedZx81Wav[],
  onProgress?: (fraction: number) => void,
): IZx81WavImportTransfer {
  const analysisIndexes = new Map<readonly Zx81TapeBit[], number>()
  const analysisInputs: Array<{ readonly bits: readonly Zx81TapeBit[]; readonly events: readonly Zx81TapeEvent[] }> = []
  const packedPrograms: IZx81WavPackedProgram[] = []

  for (const decodedProgram of programs) {
    const { bits, events, ...program } = decodedProgram
    let analysisIndex = analysisIndexes.get(bits)
    if (analysisIndex === undefined) {
      analysisIndex = analysisInputs.length
      analysisIndexes.set(bits, analysisIndex)
      analysisInputs.push({ bits, events })
    }
    packedPrograms.push({ analysisIndex, program })
  }

  const itemCount = analysisInputs.reduce((count, analysis) => count + analysis.bits.length + analysis.events.length, 0)
  const progress = createTransferProgress(itemCount, onProgress)
  const analyses = analysisInputs.map(({ bits, events }) => packAnalysis(bits, events, progress))
  progress?.complete()
  return { analyses, programs: packedPrograms }
}

/** Reconstructs decoded WAV programs after their worker has released its analysis model. */
export function unpackZx81WavPrograms(transfer: IZx81WavImportTransfer): DecodedZx81Wav[] {
  const analyses = transfer.analyses.map(unpackAnalysis)
  return transfer.programs.map(({ analysisIndex, program }) => {
    const analysis = analyses[analysisIndex]
    if (!analysis) throw new Error('The ZX81 WAV worker returned an invalid analysis reference.')
    return { ...program, ...analysis }
  })
}

/** Returns each unique ArrayBuffer that should be transferred with a packed worker result. */
export function transferableZx81WavImportBuffers(transfer: IZx81WavImportTransfer): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  for (const analysis of transfer.analyses) {
    addArrayBuffer(buffers, analysis.bitConfidences.buffer)
    addArrayBuffer(buffers, analysis.bitRanges.buffer)
    addArrayBuffer(buffers, analysis.bitValues.buffer)
    addArrayBuffer(buffers, analysis.eventConfidences.buffer)
    addArrayBuffer(buffers, analysis.eventKinds.buffer)
    addArrayBuffer(buffers, analysis.eventRanges.buffer)
  }
  for (const { program } of transfer.programs) {
    addArrayBuffer(buffers, program.samples.buffer)
    addArrayBuffer(buffers, program.pFileBytes.buffer)
  }
  return [...buffers]
}

type TransferProgress = {
  readonly complete: () => void
  readonly itemCompleted: () => void
}

function packAnalysis(
  bits: readonly Zx81TapeBit[],
  events: readonly Zx81TapeEvent[],
  progress: TransferProgress | null,
): IZx81WavPackedAnalysis {
  const bitValues = new Int8Array(bits.length)
  const bitConfidences = new Float64Array(bits.length)
  const bitRanges = new Uint32Array(bits.length * 2)
  for (let index = 0; index < bits.length; index += 1) {
    const bit = bits[index]
    bitValues[index] = bit.automaticValue ?? -1
    bitConfidences[index] = bit.confidence
    bitRanges[index * 2] = bit.startSample
    bitRanges[index * 2 + 1] = bit.endSample
    progress?.itemCompleted()
  }

  const eventKinds = new Uint8Array(events.length)
  const eventConfidences = new Float64Array(events.length)
  const eventRanges = new Uint32Array(events.length * 2)
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    eventKinds[index] = event.kind === 'burst' ? 0 : 1
    eventConfidences[index] = event.confidence
    eventRanges[index * 2] = event.startSample
    eventRanges[index * 2 + 1] = event.endSample
    progress?.itemCompleted()
  }

  return { bitConfidences, bitRanges, bitValues, eventConfidences, eventKinds, eventRanges }
}

function unpackAnalysis(analysis: IZx81WavPackedAnalysis): Pick<DecodedZx81Wav, 'bits' | 'events'> {
  if (analysis.bitConfidences.length !== analysis.bitValues.length || analysis.bitRanges.length !== analysis.bitValues.length * 2) {
    throw new Error('The ZX81 WAV worker returned invalid packed bit data.')
  }
  if (analysis.eventConfidences.length !== analysis.eventKinds.length || analysis.eventRanges.length !== analysis.eventKinds.length * 2) {
    throw new Error('The ZX81 WAV worker returned invalid packed event data.')
  }

  const bits: Zx81TapeBit[] = Array.from({ length: analysis.bitValues.length }, (_, index) => {
    const packedValue = analysis.bitValues[index]
    if (packedValue !== -1 && packedValue !== 0 && packedValue !== 1) {
      throw new Error('The ZX81 WAV worker returned an invalid packed bit value.')
    }
    return {
      automaticValue: packedValue === -1 ? null : packedValue,
      confidence: analysis.bitConfidences[index],
      endSample: analysis.bitRanges[index * 2 + 1],
      eventId: `burst-${index}`,
      id: `bit-${index}`,
      index,
      startSample: analysis.bitRanges[index * 2],
    }
  })

  const events: Zx81TapeEvent[] = Array.from({ length: analysis.eventKinds.length }, (_, index) => {
    const packedKind = analysis.eventKinds[index]
    if (packedKind !== 0 && packedKind !== 1) {
      throw new Error('The ZX81 WAV worker returned an invalid packed event kind.')
    }
    const kind = packedKind === 0 ? 'burst' : 'gap'
    const eventIndex = kind === 'burst' ? Math.floor(index / 2) : Math.floor((index - 1) / 2)
    return {
      confidence: analysis.eventConfidences[index],
      endSample: analysis.eventRanges[index * 2 + 1],
      id: `${kind}-${eventIndex}`,
      kind,
      startSample: analysis.eventRanges[index * 2],
    }
  })

  return { bits, events }
}

function createTransferProgress(total: number, onProgress?: (fraction: number) => void): TransferProgress | null {
  if (!onProgress) return null
  const stride = Math.max(1, Math.floor(total / 100))
  let completed = 0
  let nextReport = stride
  return {
    complete: () => onProgress(1),
    itemCompleted: () => {
      completed += 1
      if (completed < nextReport) return
      onProgress(completed / Math.max(1, total))
      nextReport += stride
    },
  }
}

function addArrayBuffer(buffers: Set<ArrayBuffer>, buffer: ArrayBufferLike): void {
  if (buffer instanceof ArrayBuffer) buffers.add(buffer)
}
