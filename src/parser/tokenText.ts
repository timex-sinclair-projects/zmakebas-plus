import type { Token, TokenKind } from './tokens'

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

const tokenKindDisplayText: Partial<Record<TokenKind, string>> = {
  APOSTROPHE: "'",
  BEGINPAR: '"("',
  COMMA: '","',
  ENDOFLINE: 'end of line',
  ENDOFSTAT: '":"',
  ENDPAR: '")"',
  EOF: 'end of file',
  EQUAL: '"="',
  EXPON: '"^"',
  GREAT: '">"',
  GREATEQ: '">="',
  LESS: '"<"',
  LESSEQ: '"<="',
  LINENUMBER: 'line number',
  MINUS: '"-"',
  MULT: '"*"',
  NOTEQ: '"<>"',
  NUMLIT: 'number',
  PLUS: '"+"',
  RAWBYTE: 'raw byte escape',
  SEMICOLON: '";"',
  STREAM: '"#"',
  STRINGLIT: 'string',
  VARNAME: 'variable name',
}

const tokenKindsWithSourceText = new Set<TokenKind>(['LINENUMBER', 'NUMLIT', 'RAWBYTE', 'STRINGLIT', 'VARNAME'])

export function tokenKindDisplayName(kind: TokenKind): string {
  return tokenKindDisplayText[kind] ?? keywordTokenDisplayName(kind)
}

export function describeToken(token: Token): string {
  if (!token.lexeme || !tokenKindsWithSourceText.has(token.kind)) {
    return tokenKindDisplayName(token.kind)
  }

  return `${tokenKindDisplayName(token.kind)} ${JSON.stringify(token.lexeme)}`
}

function tokenTextByKind(entries: readonly SingleCharacterTokenText[]): Partial<Record<TokenKind, string>> {
  return Object.fromEntries(entries.map(([text, kind]) => [kind, text])) as Partial<Record<TokenKind, string>>
}

function keywordTokenDisplayName(kind: TokenKind): string {
  return kind.startsWith('SN_') ? kind.slice(3).replaceAll('_', ' ') : kind.replaceAll('_', ' ')
}
