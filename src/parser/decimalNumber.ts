export interface IDecimalNumberScanOptions {
  readonly allowLoneDecimalPoint?: boolean
  readonly allowSign?: boolean
  readonly requireFinite?: boolean
  readonly requireWholeInput?: boolean
}

export interface IDecimalNumberScanResult {
  readonly lexeme: string
  readonly nextIndex: number
  readonly value: number
}

const decimalMagnitudePattern = String.raw`(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?`
const unsignedDecimalPattern = new RegExp(`^${decimalMagnitudePattern}`, 'i')
const signedDecimalPattern = new RegExp(`^[+-]?${decimalMagnitudePattern}`, 'i')

/** Scans and decodes one decimal number using caller-selected lexical rules. */
export function scanDecimalNumber(
  text: string,
  start: number,
  options: IDecimalNumberScanOptions = {},
): IDecimalNumberScanResult | null {
  const remaining = text.slice(start)
  const pattern = options.allowSign ? signedDecimalPattern : unsignedDecimalPattern
  const lexeme = pattern.exec(remaining)?.[0] ?? (options.allowLoneDecimalPoint && remaining[0] === '.' ? '.' : null)
  if (lexeme === null || (options.requireWholeInput && lexeme.length !== remaining.length)) {
    return null
  }

  const value = lexeme === '.' ? 0 : Number(lexeme)
  if (options.requireFinite && !Number.isFinite(value)) {
    return null
  }

  return {
    lexeme,
    nextIndex: start + lexeme.length,
    value,
  }
}
