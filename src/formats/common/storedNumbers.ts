import type { BasicDialect } from '../../parser/dialects'
import { formatStoredNumberBytesAnnotation, storedNumberBytesEqual } from '../../parser/storedNumber'
import type { StoredNumberBytes } from '../../parser/tokens'

export type ImportedNumericLiteral = {
  readonly binary: boolean
  readonly lexeme: string
  readonly value: number
}

/** Returns a lossless annotation when imported storage differs from the visible literal's canonical bytes. */
export function importedStoredNumberAnnotation(
  source: string,
  bytes: StoredNumberBytes,
  dialect: BasicDialect,
  encodeCanonical: (literal: ImportedNumericLiteral) => readonly number[],
): string {
  const literal = trailingNumericLiteral(source, dialect)
  if (!literal) {
    return ''
  }

  try {
    return storedNumberBytesEqual(bytes, encodeCanonical(literal)) ? '' : formatStoredNumberBytesAnnotation(bytes)
  } catch {
    return formatStoredNumberBytesAnnotation(bytes)
  }
}

function trailingNumericLiteral(source: string, dialect: BasicDialect): ImportedNumericLiteral | null {
  const pattern = dialect === 'zx81' ? /^(?:\d+(?:\.\d*)?|\.\d*)(?:E[+-]?\d+)?$/i : /^(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?$/i
  const candidate = trailingNumericSource(source)
  const match = pattern.exec(candidate)
  if (!match) {
    return null
  }

  const lexeme = match[0]
  const prefix = source.slice(0, source.length - candidate.length)
  if (/[A-Z0-9_$]$/i.test(prefix)) {
    return null
  }

  const binary = dialect !== 'zx81' && /\bBIN\s*$/i.test(prefix)
  if (binary && !/^[01]+$/.test(lexeme)) {
    return null
  }

  return {
    binary,
    lexeme,
    value: binary ? Number.parseInt(lexeme, 2) : Number(lexeme.startsWith('.') ? `0${lexeme}` : lexeme),
  }
}

function trailingNumericSource(source: string): string {
  let start = source.length

  while (start > 0) {
    const char = source[start - 1]
    if (/[0-9.e]/i.test(char)) {
      start -= 1
      continue
    }

    if ((char === '+' || char === '-') && start > 1 && source[start - 2].toUpperCase() === 'E') {
      start -= 1
      continue
    }

    break
  }

  return source.slice(start)
}
