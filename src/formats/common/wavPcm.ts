const maximumChannelCount = 8
const maximumSampleCount = 100_000_000
const maximumPreviewMemoryBytes = 300 * 1024 * 1024

export type WavPcmData = {
  readonly bitsPerSample: number
  readonly channels: readonly Float32Array[]
  readonly durationSeconds: number
  readonly sampleRate: number
}

export type WavPcmProgressCallback = (fraction: number) => void

type WavFormat = {
  readonly audioFormat: number
  readonly bitsPerSample: number
  readonly blockAlign: number
  readonly channelCount: number
  readonly sampleRate: number
}

/** Estimates the retained WAV input and decoded Float32 channel storage. */
export function estimateWavPcmMemoryBytes(inputByteLength: number, frameCount: number, channelCount: number): number {
  return inputByteLength + frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT
}

/** Decodes bounded uncompressed PCM or IEEE-float RIFF/WAVE data. */
export function decodeWavPcm(bytes: Uint8Array, onProgress?: WavPcmProgressCallback): WavPcmData {
  if (bytes.byteLength < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') {
    throw new Error('Invalid WAV file: expected a RIFF/WAVE header.')
  }

  const declaredRiffEnd = readUint32(bytes, 4) + 8
  if (declaredRiffEnd > bytes.byteLength || declaredRiffEnd < 12) {
    throw new Error('Invalid WAV file: RIFF length extends beyond the file.')
  }

  let format: WavFormat | null = null
  let dataOffset = -1
  let dataLength = 0
  let offset = 12

  while (offset + 8 <= declaredRiffEnd) {
    const chunkId = ascii(bytes, offset, 4)
    const chunkLength = readUint32(bytes, offset + 4)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkLength
    if (chunkEnd > declaredRiffEnd || chunkEnd < chunkStart) {
      throw new Error(`Invalid WAV file: truncated ${chunkId || 'unknown'} chunk.`)
    }

    if (chunkId === 'fmt ') {
      format = readFormat(bytes, chunkStart, chunkLength)
    } else if (chunkId === 'data' && dataOffset < 0) {
      dataOffset = chunkStart
      dataLength = chunkLength
    }

    offset = chunkEnd + (chunkLength & 1)
  }

  if (!format) {
    throw new Error('Invalid WAV file: missing fmt chunk.')
  }
  if (dataOffset < 0) {
    throw new Error('Invalid WAV file: missing data chunk.')
  }
  if (dataLength % format.blockAlign !== 0) {
    throw new Error('Invalid WAV file: sample data is not aligned to complete frames.')
  }

  const frameCount = dataLength / format.blockAlign
  if (frameCount > maximumSampleCount) {
    throw new Error(`WAV file is too large: ${frameCount.toLocaleString()} samples per channel exceeds the preview limit.`)
  }
  const estimatedMemoryBytes = estimateWavPcmMemoryBytes(bytes.byteLength, frameCount, format.channelCount)
  if (estimatedMemoryBytes > maximumPreviewMemoryBytes) {
    throw new Error(
      `WAV file is too large: decoding requires approximately ${formatMiB(estimatedMemoryBytes)}, exceeding the ${formatMiB(maximumPreviewMemoryBytes)} preview memory limit.`,
    )
  }

  const channels = Array.from({ length: format.channelCount }, () => new Float32Array(frameCount))
  onProgress?.(0)
  readSamples(bytes, dataOffset, frameCount, format, channels, onProgress)
  onProgress?.(1)

  return {
    bitsPerSample: format.bitsPerSample,
    channels,
    durationSeconds: frameCount / format.sampleRate,
    sampleRate: format.sampleRate,
  }
}

function formatMiB(byteLength: number): string {
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MiB`
}

function readFormat(bytes: Uint8Array, offset: number, length: number): WavFormat {
  if (length < 16) {
    throw new Error('Invalid WAV file: fmt chunk is too short.')
  }

  const audioFormat = readUint16(bytes, offset)
  const channelCount = readUint16(bytes, offset + 2)
  const sampleRate = readUint32(bytes, offset + 4)
  const blockAlign = readUint16(bytes, offset + 12)
  const bitsPerSample = readUint16(bytes, offset + 14)

  if (channelCount < 1 || channelCount > maximumChannelCount) {
    throw new Error(`Unsupported WAV file: channel count ${channelCount} is outside the supported range.`)
  }
  if (sampleRate < 4_000 || sampleRate > 384_000) {
    throw new Error(`Unsupported WAV file: sample rate ${sampleRate} Hz is outside the supported range.`)
  }
  if (!isSupportedSampleFormat(audioFormat, bitsPerSample)) {
    throw new Error(`Unsupported WAV file: format ${audioFormat} with ${bitsPerSample}-bit samples is not supported.`)
  }

  const bytesPerSample = bitsPerSample / 8
  if (blockAlign !== channelCount * bytesPerSample) {
    throw new Error('Unsupported WAV file: padded or inconsistent sample frames are not supported.')
  }

  return { audioFormat, bitsPerSample, blockAlign, channelCount, sampleRate }
}

function isSupportedSampleFormat(audioFormat: number, bitsPerSample: number): boolean {
  return (audioFormat === 1 && (bitsPerSample === 8 || bitsPerSample === 16 || bitsPerSample === 24 || bitsPerSample === 32)) ||
    (audioFormat === 3 && bitsPerSample === 32)
}

function readSamples(
  bytes: Uint8Array,
  dataOffset: number,
  frameCount: number,
  format: WavFormat,
  channels: Float32Array[],
  onProgress?: WavPcmProgressCallback,
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const bytesPerSample = format.bitsPerSample / 8
  const progressStride = Math.max(1, Math.floor(frameCount / 100))
  let nextProgressFrame = progressStride

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameOffset = dataOffset + frameIndex * format.blockAlign
    for (let channelIndex = 0; channelIndex < format.channelCount; channelIndex += 1) {
      const sampleOffset = frameOffset + channelIndex * bytesPerSample
      channels[channelIndex][frameIndex] = readNormalizedSample(view, sampleOffset, format)
    }
    if (onProgress && frameIndex + 1 >= nextProgressFrame) {
      onProgress?.((frameIndex + 1) / frameCount)
      nextProgressFrame += progressStride
    }
  }
}

function readNormalizedSample(view: DataView, offset: number, format: WavFormat): number {
  if (format.audioFormat === 3) {
    const value = view.getFloat32(offset, true)
    return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0
  }

  switch (format.bitsPerSample) {
    case 8:
      return (view.getUint8(offset) - 128) / 128
    case 16:
      return view.getInt16(offset, true) / 32768
    case 24: {
      const unsigned = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16)
      const signed = (unsigned & 0x800000) !== 0 ? unsigned - 0x1000000 : unsigned
      return signed / 0x800000
    }
    case 32:
      return view.getInt32(offset, true) / 0x80000000
    default:
      return 0
  }
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = ''
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(bytes[offset + index] ?? 0)
  }
  return value
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24)) >>> 0)
}
