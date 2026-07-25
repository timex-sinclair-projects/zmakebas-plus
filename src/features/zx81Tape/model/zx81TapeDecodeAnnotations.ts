import type { Zx81TapeByte } from '../../../formats'
import { detokenizeZx81Line } from '../../../formats/zx81/importPFile'
import { zx81TokenDefinitions } from '../../../parser/basicTokens'
import type { Zx81TapeBasicMapping } from './zx81BasicResynchronizer'
import type { Zx81TapeLogicalBit } from './zx81TapeLogicalBits'

export type Zx81TapeDecodeAnnotation = {
  readonly bitIds: readonly string[]
  readonly endSample: number
  readonly kind: 'character' | 'data' | 'filename' | 'marker' | 'structure' | 'system' | 'token' | 'unknown'
  readonly label: string
  readonly startSample: number
}

type AnnotationByte = {
  readonly bits: readonly Zx81TapeLogicalBit[]
  readonly value: number | null
}

type HeaderField = {
  readonly length: number
  readonly name: string
  readonly offset: number
}

const pFileBaseAddress = 0x4009
const tokenLabels = new Map(zx81TokenDefinitions.map((definition) => [definition.byte, definition.text]))
const headerFields: readonly HeaderField[] = [
  { length: 1, name: 'VERSN', offset: 0 },
  { length: 2, name: 'E_PPC', offset: 1 },
  { length: 2, name: 'D_FILE', offset: 3 },
  { length: 2, name: 'DF_CC', offset: 5 },
  { length: 2, name: 'VARS', offset: 7 },
  { length: 2, name: 'DEST', offset: 9 },
  { length: 2, name: 'E_LINE', offset: 11 },
  { length: 2, name: 'CH_ADD', offset: 13 },
  { length: 2, name: 'X_PTR', offset: 15 },
  { length: 2, name: 'STKBOT', offset: 17 },
  { length: 2, name: 'STKEND', offset: 19 },
  { length: 1, name: 'BERG', offset: 21 },
  { length: 2, name: 'MEM', offset: 22 },
  { length: 1, name: 'UNUSED', offset: 24 },
  { length: 1, name: 'DF_SZ', offset: 25 },
  { length: 2, name: 'S_TOP', offset: 26 },
  { length: 2, name: 'LAST_K', offset: 28 },
  { length: 1, name: 'DEBOUN', offset: 30 },
  { length: 1, name: 'MARGIN', offset: 31 },
  { length: 2, name: 'NXTLIN', offset: 32 },
  { length: 2, name: 'OLDPPC', offset: 34 },
  { length: 1, name: 'FLAGX', offset: 36 },
  { length: 2, name: 'STRLEN', offset: 37 },
  { length: 2, name: 'T_ADDR', offset: 39 },
  { length: 2, name: 'SEED', offset: 41 },
  { length: 2, name: 'FRAMES', offset: 43 },
  { length: 2, name: 'COORDS', offset: 45 },
  { length: 1, name: 'PR_CC', offset: 47 },
  { length: 2, name: 'S_POSN', offset: 48 },
  { length: 1, name: 'CDFLAG', offset: 50 },
  ...Array.from({ length: 33 }, (_, index) => ({ length: 1, name: `PRBUFF+${hexByte(index)}`, offset: 51 + index })),
  ...Array.from({ length: 30 }, (_, index) => ({ length: 1, name: `MEMBOT+${hexByte(index)}`, offset: 84 + index })),
  { length: 2, name: 'UNUSED', offset: 114 },
]
const annotationCache = new WeakMap<readonly Zx81TapeByte[], {
  readonly annotations: readonly Zx81TapeDecodeAnnotation[]
  readonly bits: readonly Zx81TapeLogicalBit[]
  readonly filenameByteLength: number
  readonly mappings: readonly Zx81TapeBasicMapping[]
}>()

/** Creates display-only meanings for every byte in the selected ZX81 tape entry. */
export function createZx81TapeDecodeAnnotations(
  bytes: readonly Zx81TapeByte[],
  filenameByteLength: number,
  mappings: readonly Zx81TapeBasicMapping[],
  bits: readonly Zx81TapeLogicalBit[],
): readonly Zx81TapeDecodeAnnotation[] {
  const cached = annotationCache.get(bytes)
  if (cached?.bits === bits && cached.filenameByteLength === filenameByteLength && cached.mappings === mappings) {
    return cached.annotations
  }

  const bitIndexById = createBitIndex(bits)
  const basicAnnotations = mappings.flatMap((mapping) => annotationsForMapping(mapping, bits, bitIndexById))
  const basicBitIds = new Set(basicAnnotations.flatMap((annotation) => annotation.bitIds))
  const annotations = [
    ...basicAnnotations,
    ...nonBasicAnnotations(bytes, filenameByteLength, basicBitIds),
  ].sort((left, right) => left.startSample - right.startSample || left.endSample - right.endSample)

  annotationCache.set(bytes, { annotations, bits, filenameByteLength, mappings })
  return annotations
}

function createBitIndex(bits: readonly Zx81TapeLogicalBit[]): ReadonlyMap<string, number> {
  const bitIndexById = new Map<string, number>()
  for (let index = 0; index < bits.length; index += 1) {
    bitIndexById.set(bits[index].id, index)
    for (const physicalBitId of bits[index].physicalBitIds) bitIndexById.set(physicalBitId, index)
  }
  return bitIndexById
}

function nonBasicAnnotations(
  bytes: readonly Zx81TapeByte[],
  filenameByteLength: number,
  basicBitIds: ReadonlySet<string>,
): Zx81TapeDecodeAnnotation[] {
  const pFilePointers = readPFilePointers(bytes, filenameByteLength)
  const annotations: Zx81TapeDecodeAnnotation[] = []

  for (let byteIndex = 0; byteIndex < bytes.length;) {
    const byte = bytes[byteIndex]
    if (byte.bitIds.some((bitId) => basicBitIds.has(bitId))) {
      byteIndex += 1
      continue
    }
    if (byteIndex < filenameByteLength) {
      annotations.push(annotationForTapeBytes([byte], filenameLabel(byte.value), 'filename'))
      byteIndex += 1
      continue
    }

    const pFileOffset = byteIndex - filenameByteLength
    const headerField = headerFields.find((field) => field.offset === pFileOffset)
    if (headerField) {
      const fieldBytes = bytes.slice(byteIndex, byteIndex + headerField.length)
      annotations.push(annotationForTapeBytes(
        fieldBytes,
        fieldLabel(headerField.name, fieldBytes),
        'system',
      ))
      byteIndex += headerField.length
      continue
    }

    annotations.push(annotationForTapeBytes(
      [byte],
      dataLabel(pFileOffset, byte.value, pFilePointers),
      'data',
    ))
    byteIndex += 1
  }
  return annotations
}

function annotationsForMapping(
  mapping: Zx81TapeBasicMapping,
  bits: readonly Zx81TapeLogicalBit[],
  bitIndexById: ReadonlyMap<string, number>,
): readonly Zx81TapeDecodeAnnotation[] {
  const bitStart = bitIndexById.get(mapping.firstBitId)
  if (bitStart === undefined) return []

  const mappingBits: Zx81TapeLogicalBit[] = []
  for (let index = bitStart; index < bits.length && bits[index].startSample <= mapping.endSample; index += 1) {
    mappingBits.push(bits[index])
    if (bits[index].endSample >= mapping.endSample) break
  }
  const bytes = toAnnotationBytes(mappingBits)
  if (bytes.length === 0) return []

  const annotations: Zx81TapeDecodeAnnotation[] = []
  appendStructureAnnotation(annotations, bytes.slice(0, 2), 'LINE', readBigEndianWord(bytes[0], bytes[1]))
  appendStructureAnnotation(annotations, bytes.slice(2, 4), 'LEN', readLittleEndianWord(bytes[2], bytes[3]))

  let floatingPointPayloadIndex = 0
  for (const byte of bytes.slice(4)) {
    if (floatingPointPayloadIndex > 0) {
      annotations.push(createAnnotation(byte.bits, `FP${floatingPointPayloadIndex}`, 'marker'))
      floatingPointPayloadIndex = floatingPointPayloadIndex === 5 ? 0 : floatingPointPayloadIndex + 1
    } else if (byte.value === null) {
      annotations.push(createAnnotation(byte.bits, '?', 'unknown'))
    } else if (byte.value === 0x76) {
      annotations.push(createAnnotation(byte.bits, 'EOL', 'marker'))
    } else if (byte.value === 0x7e) {
      annotations.push(createAnnotation(byte.bits, 'NUM', 'marker'))
      floatingPointPayloadIndex = 1
    } else {
      const tokenLabel = tokenLabels.get(byte.value)
      annotations.push(createAnnotation(byte.bits, tokenLabel ?? characterLabel(byte.value), tokenLabel ? 'token' : 'character'))
    }
  }
  return annotations
}

function toAnnotationBytes(bits: readonly Zx81TapeLogicalBit[]): AnnotationByte[] {
  const bytes: AnnotationByte[] = []
  for (let offset = 0; offset < bits.length; offset += 8) {
    const byteBits = bits.slice(offset, offset + 8)
    if (byteBits.length === 0) break
    let value = 0
    for (const bit of byteBits) {
      if (bit.effectiveValue === null) {
        value = -1
        break
      }
      value = (value << 1) | bit.effectiveValue
    }
    bytes.push({ bits: byteBits, value: byteBits.length === 8 && value >= 0 ? value : null })
  }
  return bytes
}

function appendStructureAnnotation(
  annotations: Zx81TapeDecodeAnnotation[],
  bytes: readonly AnnotationByte[],
  label: 'LEN' | 'LINE',
  value: number | null,
): void {
  const bits = bytes.flatMap((byte) => byte.bits)
  if (bits.length === 0) return
  annotations.push(createAnnotation(bits, `${label} ${value ?? '?'}`, value === null ? 'unknown' : 'structure'))
}

function annotationForTapeBytes(
  bytes: readonly Zx81TapeByte[],
  label: string,
  kind: Zx81TapeDecodeAnnotation['kind'],
): Zx81TapeDecodeAnnotation {
  const bitIds = bytes.flatMap((byte) => byte.bitIds)
  return {
    bitIds,
    endSample: bytes.at(-1)?.endSample ?? 0,
    kind: bytes.some((byte) => byte.value === null) ? 'unknown' : kind,
    label,
    startSample: bytes[0]?.startSample ?? 0,
  }
}

function readPFilePointers(bytes: readonly Zx81TapeByte[], filenameByteLength: number): {
  readonly displayFileOffset: number | null
  readonly endOffset: number | null
  readonly variablesOffset: number | null
} {
  return {
    displayFileOffset: addressToPFileOffset(readTapeWord(bytes, filenameByteLength + 3)),
    endOffset: addressToPFileOffset(readTapeWord(bytes, filenameByteLength + 11)),
    variablesOffset: addressToPFileOffset(readTapeWord(bytes, filenameByteLength + 7)),
  }
}

function readTapeWord(bytes: readonly Zx81TapeByte[], offset: number): number | null {
  const low = bytes[offset]?.value
  const high = bytes[offset + 1]?.value
  return low === null || low === undefined || high === null || high === undefined ? null : low | (high << 8)
}

function addressToPFileOffset(address: number | null): number | null {
  return address === null || address < pFileBaseAddress ? null : address - pFileBaseAddress
}

function dataLabel(
  pFileOffset: number,
  value: number | null,
  pointers: ReturnType<typeof readPFilePointers>,
): string {
  let region = 'DATA'
  if (pointers.displayFileOffset !== null) {
    if (pFileOffset < pointers.displayFileOffset) region = 'BASIC'
    else if (pointers.variablesOffset !== null && pFileOffset < pointers.variablesOffset) region = 'DISPLAY'
    else if (pointers.endOffset !== null && pFileOffset < pointers.endOffset) region = 'VARS'
  }
  return `${region} ${value === null ? '?' : `0x${hexByte(value)}`}`
}

function filenameLabel(value: number | null): string {
  if (value === null) return 'NAME ?'
  const character = characterLabel(value & 0x7f)
  return `NAME ${character}${(value & 0x80) !== 0 ? ' END' : ''}`
}

function fieldLabel(name: string, bytes: readonly Zx81TapeByte[]): string {
  if (bytes.some((byte) => byte.value === null)) return `${name} ?`
  const value = bytes.reduce((result, byte, index) => result | ((byte.value ?? 0) << (index * 8)), 0)
  return `${name} 0x${value.toString(16).padStart(bytes.length * 2, '0').toUpperCase()}`
}

function readBigEndianWord(high: AnnotationByte | undefined, low: AnnotationByte | undefined): number | null {
  return high?.value === null || high?.value === undefined || low?.value === null || low?.value === undefined
    ? null
    : (high.value << 8) | low.value
}

function readLittleEndianWord(low: AnnotationByte | undefined, high: AnnotationByte | undefined): number | null {
  return high?.value === null || high?.value === undefined || low?.value === null || low?.value === undefined
    ? null
    : low.value | (high.value << 8)
}

function createAnnotation(
  bits: readonly Zx81TapeLogicalBit[],
  label: string,
  kind: Zx81TapeDecodeAnnotation['kind'],
): Zx81TapeDecodeAnnotation {
  return {
    bitIds: bits.map((bit) => bit.id),
    endSample: bits.at(-1)?.endSample ?? 0,
    kind,
    label,
    startSample: bits[0]?.startSample ?? 0,
  }
}

function characterLabel(value: number): string {
  if (value === 0x00) return 'SPACE'
  const label = detokenizeZx81Line(Uint8Array.of(value))
  return label.length > 0 ? label : `0x${hexByte(value)}`
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0').toUpperCase()
}
