import { parseSpectrumTextControlEscape } from './exportCommon'
import { spectrumBlockGraphicBytes, zx81BlockGraphicBytes, zx81InverseCharacterBytes, zx81SingleCharacterEscapes } from './graphicEscapes'

export type TextEscapeDisplayEffect =
  | {
      readonly displayColumns: 0
      readonly kind: 'control'
    }
  | {
      readonly displayColumns: 1
      readonly kind: 'display'
    }
  | {
      readonly displayColumns: 0
      readonly kind: 'comma'
    }
  | {
      readonly column: number
      readonly displayColumns: 0
      readonly kind: 'at' | 'tab'
    }

export type TextEscape = TextEscapeDisplayEffect & {
  readonly bytes: readonly number[]
  readonly sourceEndIndex: number
}

export type DisplayTextEscape = TextEscapeDisplayEffect & {
  readonly sourceEndIndex: number
}

export function readSpectrumTextEscape(text: string, slashIndex: number): TextEscape {
  const escape = text[slashIndex + 1]
  if (!escape) {
    return encodedEscape([text.charCodeAt(slashIndex)], slashIndex + 1, displayEffect())
  }

  if (escape === '{') {
    const end = text.indexOf('}', slashIndex + 2)
    if (end !== -1) {
      const rawValue = text.slice(slashIndex + 2, end)
      const textControl = parseSpectrumTextControlEscape(rawValue)
      if (textControl) {
        return encodedEscape(textControl, end + 1, spectrumTextControlDisplayEffect(textControl))
      }

      if (!isStrictRawByteValue(rawValue)) {
        throw new Error(`Cannot export TAP: invalid raw byte escape "\\{${rawValue}}".`)
      }

      const value = parseSpectrumRawByteValue(rawValue)
      if (value < 0 || value > 0xff) {
        throw new Error(`Cannot export TAP: raw byte escape "\\{${rawValue}}" is outside the byte range.`)
      }

      return encodedEscape([value], end + 1, displayEffect())
    }
  }

  const block = spectrumBlockGraphicBytes.get(text.slice(slashIndex + 1, slashIndex + 3))
  if (block !== undefined) {
    return encodedEscape([block], slashIndex + 3, displayEffect())
  }

  if (isSpectrumUdgEscape(escape)) {
    return encodedEscape([0x90 + escape.toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0)], slashIndex + 2, displayEffect())
  }

  if (escape === '*') {
    return encodedEscape([0x7f], slashIndex + 2, displayEffect())
  }

  if (escape === '\\' || escape === '@') {
    return encodedEscape([escape.charCodeAt(0)], slashIndex + 2, displayEffect())
  }

  return encodedEscape([escape.charCodeAt(0) & 0xff], slashIndex + 2, displayEffect())
}

export function readSpectrumDisplayTextEscape(text: string, slashIndex: number): DisplayTextEscape {
  const escape = text[slashIndex + 1]
  if (!escape) {
    return displayEscape(slashIndex + 1)
  }

  if (escape === '{') {
    const end = text.indexOf('}', slashIndex + 2)
    if (end !== -1) {
      const rawValue = text.slice(slashIndex + 2, end)
      const textControl = parseSpectrumDisplayTextControlEscape(rawValue, end + 1)
      if (textControl) {
        return textControl
      }

      if (isLenientRawByteValue(rawValue)) {
        return displayEscape(end + 1)
      }
    }
  }

  const block = spectrumBlockGraphicBytes.get(text.slice(slashIndex + 1, slashIndex + 3))
  if (block !== undefined) {
    return displayEscape(slashIndex + 3)
  }

  return displayEscape(slashIndex + 2)
}

export function readZx81TextEscape(text: string, slashIndex: number): TextEscape {
  const escape = text[slashIndex + 1]
  if (!escape) {
    return encodedEscape([text.charCodeAt(slashIndex)], slashIndex + 1, displayEffect())
  }

  const block = zx81BlockGraphicBytes.get(text.slice(slashIndex + 1, slashIndex + 3))

  if (/[A-Za-z]/.test(escape)) {
    return encodedEscape([0xa6 + escape.toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0)], slashIndex + 2, displayEffect())
  }

  switch (escape) {
    case '0':
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
    case '6':
    case '7':
    case '8':
    case '9':
      return encodedEscape([escape.charCodeAt(0) + 108], slashIndex + 2, displayEffect())
    case '\\':
      return encodedEscape([0x0c], slashIndex + 2, displayEffect())
    case '`':
      return encodedEscape([0x0c], slashIndex + 2, displayEffect())
    case ':':
    case '.':
      return encodedEscape([block ?? zx81InverseCharacterByte(escape)], block === undefined ? slashIndex + 2 : slashIndex + 3, displayEffect())
    case "'":
    case '!':
    case '|':
    case ' ':
      if (block === undefined) {
        throw new Error(`Cannot export P file: invalid ZX81 block graphic escape ${JSON.stringify(text.slice(slashIndex, slashIndex + 3))}.`)
      }
      return encodedEscape([block], slashIndex + 3, displayEffect())
    case '{': {
      const end = text.indexOf('}', slashIndex + 2)
      if (end === -1) {
        throw new Error('Cannot export P file: unclosed ZX81 byte escape.')
      }

      const byte = parseZx81IntegerLiteral(text.slice(slashIndex + 2, end))
      if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
        throw new Error(`Cannot export P file: ZX81 byte escape ${JSON.stringify(text.slice(slashIndex, end + 1))} is out of range.`)
      }

      return encodedEscape([byte], end + 1, displayEffect())
    }
    default:
      {
        const inverseCharacter = zx81InverseCharacterBytes.get(escape)
        if (inverseCharacter !== undefined) {
          return encodedEscape([inverseCharacter], slashIndex + 2, displayEffect())
        }
      }
      return encodedEscape([escape.charCodeAt(0) & 0xff], slashIndex + 2, displayEffect())
  }
}

export function readZx81DisplayTextEscape(text: string, slashIndex: number): DisplayTextEscape {
  const escape = text[slashIndex + 1]
  if (!escape) {
    return displayEscape(slashIndex + 1)
  }

  if (escape === '{') {
    const end = text.indexOf('}', slashIndex + 2)
    if (end !== -1 && isLenientRawByteValue(text.slice(slashIndex + 2, end))) {
      return displayEscape(end + 1)
    }
  }

  const block = zx81BlockGraphicBytes.get(text.slice(slashIndex + 1, slashIndex + 3))
  if (block !== undefined) {
    return displayEscape(slashIndex + 3)
  }

  if (isZx81UdgEscape(escape) || isZx81DigitEscape(escape) || zx81SingleCharacterEscapes.has(escape)) {
    return displayEscape(slashIndex + 2)
  }

  return displayEscape(slashIndex + 2)
}

function encodedEscape(bytes: readonly number[], sourceEndIndex: number, effect: TextEscapeDisplayEffect): TextEscape {
  return { ...effect, bytes, sourceEndIndex }
}

function displayEscape(sourceEndIndex: number): DisplayTextEscape {
  return { ...displayEffect(), sourceEndIndex }
}

function displayEffect(): TextEscapeDisplayEffect {
  return { displayColumns: 1, kind: 'display' }
}

function spectrumTextControlDisplayEffect(bytes: readonly number[]): TextEscapeDisplayEffect {
  if (bytes[0] === 0x06) {
    return { displayColumns: 0, kind: 'comma' }
  }

  if (bytes[0] === 0x16) {
    return { column: bytes[2] ?? 0, displayColumns: 0, kind: 'at' }
  }

  if (bytes[0] === 0x17) {
    return { column: bytes[1] ?? 0, displayColumns: 0, kind: 'tab' }
  }

  return { displayColumns: 0, kind: 'control' }
}

function parseSpectrumDisplayTextControlEscape(rawValue: string, sourceEndIndex: number): DisplayTextEscape | null {
  const trimmed = rawValue.trim()
  const displayControlMatch = trimmed.match(/^(INK|PAPER|FLASH|BRIGHT|INVERSE|OVER)\s+([0-9]+)$/i)
  if (displayControlMatch) {
    return { displayColumns: 0, kind: 'control', sourceEndIndex }
  }

  if (/^COMMA$/i.test(trimmed)) {
    return { displayColumns: 0, kind: 'comma', sourceEndIndex }
  }

  const tabMatch = trimmed.match(/^TAB\s+([0-9]+)$/i)
  if (tabMatch) {
    return { column: Number.parseInt(tabMatch[1], 10), displayColumns: 0, kind: 'tab', sourceEndIndex }
  }

  const atMatch = trimmed.match(/^AT\s+([0-9]+)\s*,\s*([0-9]+)$/i)
  if (atMatch) {
    return { column: Number.parseInt(atMatch[2], 10), displayColumns: 0, kind: 'at', sourceEndIndex }
  }

  return null
}

function isSpectrumUdgEscape(escape: string): boolean {
  return /^[A-Za-z]$/.test(escape) && !/[V-Zv-z]/.test(escape)
}

function isZx81UdgEscape(escape: string): boolean {
  return /^[A-Za-z]$/.test(escape)
}

function isZx81DigitEscape(escape: string): boolean {
  return /^[0-9]$/.test(escape)
}

function isStrictRawByteValue(rawValue: string): boolean {
  return /^(?:0x[0-9a-fA-F]+|\d+)$/.test(rawValue)
}

function isLenientRawByteValue(rawValue: string): boolean {
  return parseLenientRawByteValue(rawValue) !== null
}

function parseLenientRawByteValue(rawValue: string): number | null {
  const trimmed = rawValue.trim()
  if (!/^(?:0x[0-9a-fA-F]+|\d+)$/.test(trimmed)) {
    return null
  }

  const value = parseSpectrumRawByteValue(trimmed)
  return value >= 0 && value <= 0xff ? value : null
}

function parseSpectrumRawByteValue(text: string): number {
  return Number.parseInt(text, text.toLowerCase().startsWith('0x') ? 16 : 10)
}

function parseZx81IntegerLiteral(text: string): number {
  const trimmed = text.trimStart()
  if (trimmed.startsWith('-')) {
    return Number.POSITIVE_INFINITY
  }

  const unsigned = trimmed.startsWith('+') ? trimmed.slice(1) : trimmed
  if (/^0x[0-9a-f]/i.test(unsigned)) {
    return Number.parseInt(unsigned, 16)
  }

  if (unsigned.startsWith('0')) {
    const octal = unsigned.match(/^0[0-7]*/)
    return Number.parseInt(octal?.[0] ?? '0', 8)
  }

  return Number.parseInt(unsigned, 10)
}

function zx81InverseCharacterByte(char: string): number {
  const byte = zx81InverseCharacterBytes.get(char)
  if (byte === undefined) {
    throw new Error(`Internal error: missing ZX81 inverse character byte for ${JSON.stringify(char)}.`)
  }
  return byte
}
