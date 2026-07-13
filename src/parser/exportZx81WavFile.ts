const defaultSampleRate = 44100
const pulseMicros = 150
const bitGapMicros = 1300
const leadInGapCount = 10
const leadOutGapCount = 4
const zeroBitPulseCount = 4
const oneBitPulseCount = 9

const wavHeaderLength = 44
const highLevel = 0x7fff
const lowLevel = -0x8000
const silenceLevel = 0

export type Zx81WavFileOptions = {
  readonly sampleRate?: number
}

export function createZx81WavFile(pFileBytes: Uint8Array, filename: string, options: Zx81WavFileOptions = {}): Uint8Array {
  const sampleRate = options.sampleRate ?? defaultSampleRate
  validateSampleRate(sampleRate)

  const tapeBytes = createZx81TapeBytes(pFileBytes, filename)
  const sampleLength = measureTapeSamples(tapeBytes, sampleRate)
  const dataLength = sampleLength * 2
  const output = new Uint8Array(wavHeaderLength + dataLength)
  writeWavHeader(output, sampleRate, dataLength)
  writeTapeSamples(output, wavHeaderLength, tapeBytes, sampleRate)
  return output
}

export function createZx81TapeBytes(pFileBytes: Uint8Array, filename: string): Uint8Array {
  const nameBytes = encodeZx81TapeFilename(filename)
  const tapeBytes = new Uint8Array(nameBytes.length + pFileBytes.length)
  tapeBytes.set(nameBytes, 0)
  tapeBytes.set(pFileBytes, nameBytes.length)
  return tapeBytes
}

function validateSampleRate(sampleRate: number): void {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error('ZX81 WAV sample rate must be a positive integer.')
  }
}

function encodeZx81TapeFilename(filename: string): Uint8Array {
  const trimmed = filename.trim()
  const normalized = trimmed.length > 0 ? trimmed : 'ZXBASIC'
  const bytes = new Uint8Array(normalized.length)

  for (let index = 0; index < normalized.length; index += 1) {
    bytes[index] = encodeZx81FilenameCharacter(normalized[index])
  }

  bytes[bytes.length - 1] |= 0x80
  return bytes
}

function encodeZx81FilenameCharacter(char: string): number {
  const code = char.charCodeAt(0)

  if (code >= 0x30 && code <= 0x39) {
    return code - 20
  }

  if (code >= 0x41 && code <= 0x5a) {
    return code - 27
  }

  if (code >= 0x61 && code <= 0x7a) {
    return code - 59
  }

  return 0x16
}

function measureTapeSamples(bytes: Uint8Array, sampleRate: number): number {
  const clock = new MicrosecondSampleClock(sampleRate)
  let sampleCount = clock.measure(leadInGapCount * bitGapMicros)

  for (const byte of bytes) {
    sampleCount += measureByteSamples(byte, clock)
  }

  return sampleCount + clock.measure(leadOutGapCount * bitGapMicros)
}

function measureByteSamples(byte: number, clock: MicrosecondSampleClock): number {
  let sampleCount = 0

  for (let mask = 0x80; mask !== 0; mask >>= 1) {
    sampleCount += measureBitSamples((byte & mask) !== 0, clock)
  }

  return sampleCount
}

function measureBitSamples(bitSet: boolean, clock: MicrosecondSampleClock): number {
  let sampleCount = 0
  const pulseCount = bitSet ? oneBitPulseCount : zeroBitPulseCount

  for (let index = 0; index < pulseCount; index += 1) {
    sampleCount += clock.measure(pulseMicros)
    sampleCount += clock.measure(pulseMicros)
  }

  return sampleCount + clock.measure(bitGapMicros)
}

function writeTapeSamples(output: Uint8Array, offset: number, bytes: Uint8Array, sampleRate: number): void {
  const writer = new Zx81TapeSampleWriter(output, offset, sampleRate)
  writer.writeSilence(leadInGapCount * bitGapMicros)

  for (const byte of bytes) {
    writer.writeByte(byte)
  }

  writer.writeSilence(leadOutGapCount * bitGapMicros)
}

function writeWavHeader(output: Uint8Array, sampleRate: number, dataLength: number): void {
  writeAscii(output, 0, 'RIFF')
  writeUint32(output, 4, 36 + dataLength)
  writeAscii(output, 8, 'WAVE')
  writeAscii(output, 12, 'fmt ')
  writeUint32(output, 16, 16)
  writeUint16(output, 20, 1)
  writeUint16(output, 22, 1)
  writeUint32(output, 24, sampleRate)
  writeUint32(output, 28, sampleRate * 2)
  writeUint16(output, 32, 2)
  writeUint16(output, 34, 16)
  writeAscii(output, 36, 'data')
  writeUint32(output, 40, dataLength)
}

function writeAscii(output: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    output[offset + index] = value.charCodeAt(index)
  }
}

function writeUint16(output: Uint8Array, offset: number, value: number): void {
  output[offset] = value & 0xff
  output[offset + 1] = (value >> 8) & 0xff
}

function writeUint32(output: Uint8Array, offset: number, value: number): void {
  output[offset] = value & 0xff
  output[offset + 1] = (value >> 8) & 0xff
  output[offset + 2] = (value >> 16) & 0xff
  output[offset + 3] = (value >> 24) & 0xff
}

function writeInt16(output: Uint8Array, offset: number, value: number): void {
  output[offset] = value & 0xff
  output[offset + 1] = (value >> 8) & 0xff
}

class MicrosecondSampleClock {
  private elapsedMicros = 0
  private emittedSamples = 0
  private readonly sampleRate: number

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
  }

  measure(micros: number): number {
    this.elapsedMicros += micros
    const nextEmittedSamples = Math.round((this.elapsedMicros * this.sampleRate) / 1000000)
    const sampleCount = nextEmittedSamples - this.emittedSamples
    this.emittedSamples = nextEmittedSamples
    return sampleCount
  }
}

class Zx81TapeSampleWriter {
  private readonly clock: MicrosecondSampleClock
  private readonly output: Uint8Array
  private offset: number

  constructor(output: Uint8Array, offset: number, sampleRate: number) {
    this.clock = new MicrosecondSampleClock(sampleRate)
    this.output = output
    this.offset = offset
  }

  writeByte(byte: number): void {
    for (let mask = 0x80; mask !== 0; mask >>= 1) {
      this.writeBit((byte & mask) !== 0)
    }
  }

  writeSilence(micros: number): void {
    this.writeSamples(this.clock.measure(micros), silenceLevel)
  }

  private writeBit(bitSet: boolean): void {
    const pulseCount = bitSet ? oneBitPulseCount : zeroBitPulseCount

    for (let index = 0; index < pulseCount; index += 1) {
      this.writeSamples(this.clock.measure(pulseMicros), highLevel)
      this.writeSamples(this.clock.measure(pulseMicros), lowLevel)
    }

    this.writeSilence(bitGapMicros)
  }

  private writeSamples(count: number, level: number): void {
    for (let index = 0; index < count; index += 1) {
      writeInt16(this.output, this.offset, level)
      this.offset += 2
    }
  }
}
