import type { TokenKind } from './tokens'

type SingleCharacterTokenText = readonly [text: string, kind: TokenKind]

export const commonSingleCharacterTokenText = [
  ['(', 'BEGINPAR'],
  [')', 'ENDPAR'],
  [',', 'COMMA'],
  [';', 'SEMICOLON'],
  [':', 'ENDOFSTAT'],
  ["'", 'APOSTROPHE'],
  ['#', 'STREAM'],
  ['+', 'PLUS'],
  ['-', 'MINUS'],
  ['*', 'MULT'],
  ['/', 'DIV'],
  ['<', 'LESS'],
  ['>', 'GREAT'],
  ['=', 'EQUAL'],
] satisfies readonly SingleCharacterTokenText[]

export const lexerSimpleTokenText = [
  ...commonSingleCharacterTokenText.filter(([, kind]) => kind !== 'LESS' && kind !== 'GREAT'),
  ['^', 'EXPON'],
] satisfies readonly SingleCharacterTokenText[]

export const commonSimpleTokenText = tokenTextByKind(commonSingleCharacterTokenText)

export const spectrumSimpleTokenText: Partial<Record<TokenKind, string>> = {
  ...commonSimpleTokenText,
  EXPON: '^',
}

function tokenTextByKind(entries: readonly SingleCharacterTokenText[]): Partial<Record<TokenKind, string>> {
  return Object.fromEntries(entries.map(([text, kind]) => [kind, text])) as Partial<Record<TokenKind, string>>
}
