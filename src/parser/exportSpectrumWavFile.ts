const spectrumClockHz = 3500000
const defaultSampleRate = 44100
const defaultLeadInSeconds = 1
const defaultBlockGapSeconds = 1
const defaultLeadOutSeconds = 1

const pilotPulseTStates = 2168
const syncFirstPulseTStates = 667
const syncSecondPulseTStates = 735
const blockEndPulseTStates = 954
const zeroBitPulseTStates = 855
const oneBitPulseTStates = 1710
const headerPilotPulseCount = 8063
const dataPilotPulseCount = 3223

const wavHeaderLength = 44
const silenceLevel = 0x80
const highLevel = 0xc0
const lowLevel = 0x40

export type WavFileOptions = {
  readonly blockGapSeconds?: number
  readonly leadInSeconds?: number
  readonly leadOutSeconds?: number
  readonly sampleRate?: number
}

export function createSpectrumWavFile(tapBytes: Uint8Array, options: WavFileOptions = {}): Uint8Array {
  const sampleRate = options.sampleRate ?? defaultSampleRate
  const leadInSeconds = options.leadInSeconds ?? defaultLeadInSeconds
  const blockGapSeconds = options.blockGapSeconds ?? defaultBlockGapSeconds
  const leadOutSeconds = options.leadOutSeconds ?? defaultLeadOutSeconds
  validateWavOptions(sampleRate, leadInSeconds, blockGapSeconds, leadOutSeconds)

  const blocks = parseTapBlocks(tapBytes)
  const audioLength = measureTapeAudioLength(blocks, sampleRate, leadInSeconds, blockGapSeconds, leadOutSeconds)
  const output = new Uint8Array(wavHeaderLength + audioLength)
  writeWavHeader(output, sampleRate, audioLength)
  writeTapeAudio(output, wavHeaderLength, blocks, sampleRate, leadInSeconds, blockGapSeconds, leadOutSeconds)
  return output
}

function validateWavOptions(sampleRate: number, leadInSeconds: number, blockGapSeconds: number, leadOutSeconds: number): void {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error('WAV sample rate must be a positive integer.')
  }

  for (const [label, value] of [
    ['lead-in', leadInSeconds],
    ['block gap', blockGapSeconds],
    ['lead-out', leadOutSeconds],
  ] satisfies Array<readonly [string, number]>) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`WAV ${label} must be a non-negative integer number of seconds.`)
    }
  }
}

function parseTapBlocks(tapBytes: Uint8Array): Uint8Array[] {
  const blocks: Uint8Array[] = []
  let offset = 0

  while (offset < tapBytes.length) {
    if (offset + 2 > tapBytes.length) {
      throw new Error('Cannot export WAV file: truncated TAP block length.')
    }

    const blockLength = tapBytes[offset] | (tapBytes[offset + 1] << 8)
    offset += 2

    if (blockLength < 2 || offset + blockLength > tapBytes.length) {
      throw new Error('Cannot export WAV file: truncated TAP block data.')
    }

    blocks.push(tapBytes.slice(offset, offset + blockLength))
    offset += blockLength
  }

  return blocks
}

function measureTapeAudioLength(blocks: readonly Uint8Array[], sampleRate: number, leadInSeconds: number, blockGapSeconds: number, leadOutSeconds: number): number {
  let sampleCount = sampleRate * leadInSeconds

  blocks.forEach((block, index) => {
    if (index > 0 && blockGapSeconds > 0) {
      sampleCount += sampleRate * blockGapSeconds
    }

    const clock = new PulseSampleClock(sampleRate)
    sampleCount += measureBlockAudioLength(block, clock)
  })

  return sampleCount + sampleRate * leadOutSeconds
}

function measureBlockAudioLength(block: Uint8Array, clock: PulseSampleClock): number {
  let sampleCount = 0
  const pilotPulseCount = block[0] < 0x80 ? headerPilotPulseCount : dataPilotPulseCount

  for (let index = 0; index < pilotPulseCount; index += 1) {
    sampleCount += clock.measurePulse(pilotPulseTStates)
  }

  if (pilotPulseCount % 2 !== 0) {
    sampleCount += clock.measurePulse(pilotPulseTStates)
  }

  sampleCount += clock.measurePulse(syncFirstPulseTStates)
  sampleCount += clock.measurePulse(syncSecondPulseTStates)

  for (const byte of block) {
    sampleCount += measureByteAudioLength(byte, clock)
  }

  return sampleCount + clock.measurePulse(blockEndPulseTStates)
}

function measureByteAudioLength(byte: number, clock: PulseSampleClock): number {
  let sampleCount = 0

  for (let mask = 0x80; mask !== 0; mask >>= 1) {
    const pulseTStates = (byte & mask) === 0 ? zeroBitPulseTStates : oneBitPulseTStates
    sampleCount += clock.measurePulse(pulseTStates)
    sampleCount += clock.measurePulse(pulseTStates)
  }

  return sampleCount
}

function writeTapeAudio(output: Uint8Array, offset: number, blocks: readonly Uint8Array[], sampleRate: number, leadInSeconds: number, blockGapSeconds: number, leadOutSeconds: number): void {
  let writeOffset = writeSamples(output, offset, sampleRate * leadInSeconds, silenceLevel)

  blocks.forEach((block, index) => {
    if (index > 0 && blockGapSeconds > 0) {
      writeOffset = writeSamples(output, writeOffset, sampleRate * blockGapSeconds, silenceLevel)
    }

    const writer = new TapeSignalWriter(output, writeOffset, sampleRate)
    writer.writeBlock(block)
    writeOffset = writer.offset
  })

  writeSamples(output, writeOffset, sampleRate * leadOutSeconds, silenceLevel)
}

function writeWavHeader(output: Uint8Array, sampleRate: number, audioLength: number): void {
  writeAscii(output, 0, 'RIFF')
  writeUint32(output, 4, 36 + audioLength)
  writeAscii(output, 8, 'WAVE')
  writeAscii(output, 12, 'fmt ')
  writeUint32(output, 16, 16)
  writeUint16(output, 20, 1)
  writeUint16(output, 22, 1)
  writeUint32(output, 24, sampleRate)
  writeUint32(output, 28, sampleRate)
  writeUint16(output, 32, 1)
  writeUint16(output, 34, 8)
  writeAscii(output, 36, 'data')
  writeUint32(output, 40, audioLength)
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

function writeSamples(output: Uint8Array, offset: number, count: number, level: number): number {
  output.fill(level, offset, offset + count)
  return offset + count
}

class PulseSampleClock {
  private elapsedTStates = 0
  private emittedSamples = 0
  private readonly sampleRate: number

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
  }

  measurePulse(tStates: number): number {
    this.elapsedTStates += tStates
    const nextEmittedSamples = Math.round((this.elapsedTStates * this.sampleRate) / spectrumClockHz)
    const sampleCount = nextEmittedSamples - this.emittedSamples
    this.emittedSamples = nextEmittedSamples
    return sampleCount
  }
}

class TapeSignalWriter {
  private readonly clock: PulseSampleClock
  private readonly output: Uint8Array
  private level = highLevel
  public offset: number

  constructor(output: Uint8Array, offset: number, sampleRate: number) {
    this.output = output
    this.offset = offset
    this.clock = new PulseSampleClock(sampleRate)
  }

  writeBlock(block: Uint8Array): void {
    const pilotPulseCount = block[0] < 0x80 ? headerPilotPulseCount : dataPilotPulseCount

    for (let index = 0; index < pilotPulseCount; index += 1) {
      this.writePulse(pilotPulseTStates)
    }

    if (pilotPulseCount % 2 !== 0) {
      this.writePulse(pilotPulseTStates)
    }

    this.writePulse(syncFirstPulseTStates)
    this.writePulse(syncSecondPulseTStates)

    for (const byte of block) {
      this.writeByte(byte)
    }

    this.writePulse(blockEndPulseTStates)
  }

  private writeByte(byte: number): void {
    for (let mask = 0x80; mask !== 0; mask >>= 1) {
      const pulseTStates = (byte & mask) === 0 ? zeroBitPulseTStates : oneBitPulseTStates
      this.writePulse(pulseTStates)
      this.writePulse(pulseTStates)
    }
  }

  private writePulse(tStates: number): void {
    this.offset = writeSamples(this.output, this.offset, this.clock.measurePulse(tStates), this.level)
    this.level = this.level === highLevel ? lowLevel : highLevel
  }
}
