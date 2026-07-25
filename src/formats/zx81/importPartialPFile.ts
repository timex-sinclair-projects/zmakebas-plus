import { detokenizeZx81Line, zx81LineEndByte, zx81PFileHeaderLength, zx81ProgramBaseAddress } from './importPFile'

const maximumLineAlternatives = 8
const maximumLineNumberUnknownBits = 8
const maximumDamagedPreviewBytes = 64

export type PartialPFileByte = {
  readonly knownMask: number
  readonly value: number
}

export type PartialPFileLineStatus = 'ambiguous' | 'clean' | 'damaged'

export type ImportedPartialPFileLine = {
  readonly decodedPreview?: string
  readonly pFileEnd: number
  readonly pFileStart: number
  readonly status: PartialPFileLineStatus
  readonly text: string
  readonly unknownBitCount: number
}

export type ImportedPartialPFile = {
  readonly error: string | null
  readonly lines: readonly ImportedPartialPFileLine[]
  readonly programEnd: number | null
}

/** Recovers display-only BASIC lines while preserving unknown bits as alternatives. */
export function importPartialPFile(bytes: readonly PartialPFileByte[]): ImportedPartialPFile {
  if (bytes.length < zx81PFileHeaderLength) {
    return failure('The partial P-file is too short to contain a system header.')
  }

  const dFileAddress = readKnownWord(bytes, 3)
  if (dFileAddress === null) {
    return failure('The D_FILE pointer contains unknown bits.')
  }
  const programLength = dFileAddress - zx81ProgramBaseAddress
  const programEnd = zx81PFileHeaderLength + programLength
  if (programLength < 0 || programEnd > bytes.length) {
    return failure('The D_FILE pointer does not describe an available BASIC program area.')
  }

  const lines: ImportedPartialPFileLine[] = []
  let offset = zx81PFileHeaderLength
  let previousLineNumber: number | null = null
  while (offset < programEnd) {
    if (offset + 4 > programEnd) {
      lines.push(damagedRemainder(bytes, offset, programEnd, 'truncated line header'))
      break
    }

    const lineLength = readKnownWord(bytes, offset + 2)
    if (lineLength === null) {
      lines.push(damagedRemainder(bytes, offset, programEnd, 'unknown line length'))
      break
    }
    const lineEnd = offset + 4 + lineLength
    if (lineLength === 0 || lineEnd > programEnd) {
      lines.push(damagedRemainder(bytes, offset, programEnd, 'invalid line length'))
      break
    }

    const nextLineNumber = readKnownBigEndianWord(bytes, lineEnd)
    const lineNumberCandidates = enumerateLineNumbers(bytes.slice(offset, offset + 2), previousLineNumber, nextLineNumber)
    const body = bytes.slice(offset + 4, lineEnd - 1)
    const terminator = bytes[lineEnd - 1]
    const lineUnknownBitCount = countUnknownBits(bytes.slice(offset, lineEnd))
    const terminatorKnown = terminator.knownMask === 0xff
    const terminatorValid = terminatorKnown && terminator.value === zx81LineEndByte
    const status: PartialPFileLineStatus = terminatorKnown && !terminatorValid
      ? 'damaged'
      : lineUnknownBitCount > 0 || !terminatorKnown
        ? 'ambiguous'
        : 'clean'
    const lineNumberText = formatLineNumber(lineNumberCandidates)
    const bodyText = formatLineBody(body)
    const terminatorSuffix = terminatorKnown && !terminatorValid ? ' ⟦invalid line terminator⟧' : ''
    const decodedPreview = status === 'damaged' ? decodeDamagedBytes(body) ?? '' : ''
    lines.push({
      ...(decodedPreview ? { decodedPreview } : {}),
      pFileEnd: lineEnd,
      pFileStart: offset,
      status,
      text: `${lineNumberText} ${bodyText}${terminatorSuffix}`.trimEnd(),
      unknownBitCount: lineUnknownBitCount,
    })
    previousLineNumber = lineNumberCandidates.length === 1 ? lineNumberCandidates[0] : null
    offset = lineEnd
  }

  const issueCount = lines.filter((line) => line.status !== 'clean').length
  return {
    error: issueCount === 0 ? null : `${issueCount.toLocaleString()} BASIC line${issueCount === 1 ? '' : 's'} contain ambiguous or damaged data.`,
    lines,
    programEnd,
  }
}

function failure(error: string): ImportedPartialPFile {
  return { error, lines: [], programEnd: null }
}

function damagedRemainder(
  bytes: readonly PartialPFileByte[],
  start: number,
  end: number,
  reason: string,
): ImportedPartialPFileLine {
  const decodedPreview = decodeDamagedRemainder(bytes, start, end)
  const previewText = decodedPreview ? `; current byte alignment: ${decodedPreview}` : ''
  return {
    ...(decodedPreview ? { decodedPreview } : {}),
    pFileEnd: end,
    pFileStart: start,
    status: 'damaged',
    text: `⟦damaged BASIC data: ${reason}${previewText}⟧`,
    unknownBitCount: countUnknownBits(bytes.slice(start, end)),
  }
}

function decodeDamagedRemainder(bytes: readonly PartialPFileByte[], start: number, end: number): string | null {
  return decodeDamagedBytes(bytes.slice(Math.min(end, start + 4), end))
}

function decodeDamagedBytes(bytes: readonly PartialPFileByte[]): string | null {
  const values: number[] = []
  let stoppedAtTerminator = false
  let byteIndex = 0
  for (; byteIndex < bytes.length && values.length <= maximumDamagedPreviewBytes; byteIndex += 1) {
    const byte = bytes[byteIndex]
    if (byte.knownMask !== 0xff) break
    const value = byte.value & 0xff
    if (value === zx81LineEndByte) {
      stoppedAtTerminator = true
      break
    }
    values.push(value)
  }
  if (values.length === 0) return null

  const preview = detokenizeZx81Line(Uint8Array.from(values.slice(0, maximumDamagedPreviewBytes))).trimEnd()
  if (!preview) return null
  const truncated = values.length > maximumDamagedPreviewBytes || (!stoppedAtTerminator && byteIndex < bytes.length)
  return truncated ? `${preview}…` : preview
}

function formatLineNumber(candidates: readonly number[]): string {
  if (candidates.length === 1) {
    return String(candidates[0])
  }
  return candidates.length > 1 && candidates.length <= 4 ? `⟦${candidates.join(' | ')}⟧` : '⟦unknown line⟧'
}

function formatLineBody(bytes: readonly PartialPFileByte[]): string {
  const alternatives = enumerateLineBodies(bytes)
  if (alternatives.length === 1) {
    return alternatives[0].trimEnd()
  }
  return alternatives.length > 1 ? `⟦${alternatives.map((text) => text.trimEnd()).join(' | ')}⟧` : '⟦unknown BASIC data⟧'
}

function enumerateLineBodies(bytes: readonly PartialPFileByte[]): string[] {
  if (bytes.every((byte) => byte.knownMask === 0xff)) {
    return [detokenizeZx81Line(Uint8Array.from(bytes.map((byte) => byte.value)))]
  }
  let alternatives: number[][] = [[]]
  for (const byte of bytes) {
    const candidates = enumerateByteValues(byte)
    if (alternatives.length * candidates.length > maximumLineAlternatives) {
      return []
    }
    alternatives = alternatives.flatMap((prefix) => candidates.map((candidate) => [...prefix, candidate]))
  }
  return [...new Set(alternatives.map((alternative) => detokenizeZx81Line(Uint8Array.from(alternative))))]
}

function enumerateLineNumbers(
  bytes: readonly PartialPFileByte[],
  previous: number | null,
  next: number | null,
): number[] {
  if (bytes.length < 2 || countUnknownBits(bytes) > maximumLineNumberUnknownBits) {
    return []
  }
  const candidates = enumerateByteValues(bytes[0])
    .flatMap((high) => enumerateByteValues(bytes[1]).map((low) => (high << 8) | low))
    .filter((value) => value <= 9999)
  const ordered = candidates.filter((value) => (previous === null || value > previous) && (next === null || value < next))
  return ordered.length > 0 ? ordered : candidates
}

function enumerateByteValues(byte: PartialPFileByte): number[] {
  if (byte.knownMask === 0xff) {
    return [byte.value & 0xff]
  }
  const knownValue = byte.value & byte.knownMask & 0xff
  const values: number[] = []
  for (let value = 0; value <= 0xff; value += 1) {
    if ((value & byte.knownMask) === knownValue) {
      values.push(value)
    }
  }
  return values
}

function readKnownWord(bytes: readonly PartialPFileByte[], offset: number): number | null {
  const low = readKnownByte(bytes[offset])
  const high = readKnownByte(bytes[offset + 1])
  return low === null || high === null ? null : low | (high << 8)
}

function readKnownBigEndianWord(bytes: readonly PartialPFileByte[], offset: number): number | null {
  const high = readKnownByte(bytes[offset])
  const low = readKnownByte(bytes[offset + 1])
  return high === null || low === null ? null : (high << 8) | low
}

function readKnownByte(byte: PartialPFileByte | undefined): number | null {
  return byte?.knownMask === 0xff ? byte.value : null
}

function countUnknownBits(bytes: readonly PartialPFileByte[]): number {
  return bytes.reduce((total, byte) => total + 8 - popcount(byte.knownMask & 0xff), 0)
}

function popcount(value: number): number {
  let count = 0
  for (let remaining = value; remaining !== 0; remaining &= remaining - 1) {
    count += 1
  }
  return count
}
