import type { PartialPFileByte } from '../importPartialPFile'
import type { Zx81TapeByte } from '../importZx81WavFile'
import type { Zx81TapeBit, Zx81TapeBitValue } from './zx81TapeSignal'

export type AssembledZx81TapeBytes = {
  readonly bytes: Zx81TapeByte[]
  readonly partialBytes: PartialPFileByte[]
}

type Zx81TapeAssemblyBit = Pick<Zx81TapeBit, 'automaticValue' | 'endSample' | 'id' | 'startSample'> & {
  readonly effectiveValue?: Zx81TapeBitValue
}

/** Assembles physical tape bits into declared bytes while preserving unavailable tail bits as unknown. */
export function assembleZx81TapeBytes(
  bits: readonly Zx81TapeAssemblyBit[],
  bitStart: number,
  bitEnd: number,
  byteLength: number,
  overrideValues?: ReadonlyMap<string, Zx81TapeBitValue>,
): AssembledZx81TapeBytes {
  const bytes: Zx81TapeByte[] = []
  const partialBytes: PartialPFileByte[] = []
  for (let byteIndex = 0; byteIndex < byteLength; byteIndex += 1) {
    const offset = bitStart + byteIndex * 8
    const byteBits = bits.slice(offset, Math.min(offset + 8, bitEnd))
    if (byteBits.length === 0) {
      break
    }

    let value = 0
    let knownMask = 0
    for (let bitOffset = 0; bitOffset < 8; bitOffset += 1) {
      value <<= 1
      knownMask <<= 1
      const bit = byteBits[bitOffset]
      if (!bit) {
        continue
      }
      const bitValue = overrideValues?.has(bit.id)
        ? overrideValues.get(bit.id) ?? null
        : bit.effectiveValue === undefined ? bit.automaticValue : bit.effectiveValue
      if (bitValue !== null) {
        knownMask |= 1
        value |= bitValue
      }
    }

    const index = bytes.length
    const finalBit = byteBits[byteBits.length - 1]
    partialBytes.push({ knownMask, value })
    bytes.push({
      bitIds: byteBits.map((bit) => bit.id),
      endSample: finalBit.endSample,
      id: `byte-${index}`,
      index,
      startSample: byteBits[0].startSample,
      value: knownMask === 0xff ? value : null,
    })
  }
  return { bytes, partialBytes }
}
