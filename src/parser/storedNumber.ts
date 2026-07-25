import { ZxBasicLexError } from './errors'
import { scanDecimalNumber } from './decimalNumber'
import type { SourcePosition, StoredNumberBytes } from './tokens'

export const storedNumberAnnotationPrefix = '\\{NUMBER'

type StoredNumberContent =
  | { readonly kind: 'bytes'; readonly bytes: StoredNumberBytes }
  | { readonly kind: 'value'; readonly value: number }

/** Decodes a five-byte Sinclair numeric storage record. */
export function decodeStoredNumberBytes(bytes: StoredNumberBytes): number {
  if (bytes[0] === 0) {
    const encodedInteger = bytes[2] | (bytes[3] << 8)
    return (bytes[1] & 0x80) !== 0 ? encodedInteger - 0x10000 : encodedInteger
  }

  const negative = (bytes[1] & 0x80) !== 0
  const fraction = (bytes[1] & 0x7f) * 0x1000000 + bytes[2] * 0x10000 + bytes[3] * 0x100 + bytes[4]
  const value = (1 + fraction / 0x80000000) * 2 ** (bytes[0] - 129)
  return negative ? -value : value
}

/** Formats a stored numeric value or exact Sinclair storage bytes as a source annotation. */
export function formatStoredNumberAnnotation(storedNumber: StoredNumberContent): string {
  if (storedNumber.kind === 'bytes') {
    const hex = storedNumber.bytes.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join('')
    return `${storedNumberAnnotationPrefix} 0x${hex}}`
  }

  return `${storedNumberAnnotationPrefix} ${formatStoredNumberValue(storedNumber.value)}}`
}

/** Formats exact Sinclair numeric storage bytes as a source annotation. */
export function formatStoredNumberBytesAnnotation(bytes: StoredNumberBytes): string {
  return formatStoredNumberAnnotation({ kind: 'bytes', bytes })
}

/** Parses the ten hexadecimal digits used by an exact stored-number annotation. */
export function parseStoredNumberHex(text: string): StoredNumberBytes | null {
  if (!/^[0-9a-fA-F]{10}$/.test(text)) {
    return null
  }

  return [
    Number.parseInt(text.slice(0, 2), 16),
    Number.parseInt(text.slice(2, 4), 16),
    Number.parseInt(text.slice(4, 6), 16),
    Number.parseInt(text.slice(6, 8), 16),
    Number.parseInt(text.slice(8, 10), 16),
  ]
}

/** Reads an optional stored-number annotation beginning at a numeric literal's end. */
export function readStoredNumberAnnotation(
  lineText: string,
  positionAt: (index: number) => SourcePosition,
  start: number,
): ({ readonly annotation: string; readonly nextIndex: number } & StoredNumberContent) | null {
  if (lineText.slice(start, start + storedNumberAnnotationPrefix.length).toUpperCase() !== storedNumberAnnotationPrefix) {
    return null
  }

  const contentStart = start + storedNumberAnnotationPrefix.length
  const nextCharacter = lineText[contentStart]
  if (nextCharacter !== ' ' && nextCharacter !== '\t') {
    return null
  }

  const end = lineText.indexOf('}', contentStart)
  if (end === -1) {
    throw new ZxBasicLexError('Unterminated stored-number annotation.', {
      start: positionAt(start),
      end: positionAt(lineText.length),
    })
  }

  const content = lineText.slice(contentStart, end).trim()
  const decimalNumber = scanDecimalNumber(content, 0, {
    allowSign: true,
    requireFinite: true,
    requireWholeInput: true,
  })
  if (!decimalNumber && scanDecimalNumber(content, 0, { allowSign: true, requireWholeInput: true })) {
    throw new ZxBasicLexError('Stored-number decimal value must be finite.', {
      start: positionAt(start),
      end: positionAt(end + 1),
    })
  }

  const storedNumber = parseStoredNumberContent(content, decimalNumber?.value)
  if (!storedNumber) {
    throw new ZxBasicLexError(
      'Invalid stored-number annotation; expected a decimal number or exactly five bytes as 0x followed by ten hexadecimal digits.',
      {
        start: positionAt(start),
        end: positionAt(end + 1),
      },
    )
  }

  return {
    annotation: lineText.slice(start, end + 1),
    ...storedNumber,
    nextIndex: end + 1,
  }
}

function parseStoredNumberContent(content: string, decimalValue: number | undefined): StoredNumberContent | null {
  if (/^0x/i.test(content)) {
    const bytes = parseStoredNumberHex(content.slice(2))
    return bytes ? { kind: 'bytes', bytes } : null
  }

  return decimalValue === undefined ? null : { kind: 'value', value: decimalValue }
}

function formatStoredNumberValue(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error('Cannot format a non-finite stored-number value.')
  }

  if (Object.is(value, -0)) {
    return '0'
  }

  return String(value).replace('e', 'E')
}

/** Reports whether two Sinclair numeric storage records contain identical bytes. */
export function storedNumberBytesEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === 5 && right.length === 5 && left.every((byte, index) => byte === right[index])
}
