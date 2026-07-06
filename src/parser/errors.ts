import type { SourceSpan, Token, TokenKind } from './tokens'

export class ZxBasicSyntaxError extends Error {
  readonly token: Token
  readonly expected?: readonly TokenKind[] | string
  readonly span: SourceSpan

  constructor(message: string, token: Token, expected?: readonly TokenKind[] | string) {
    super(message)
    this.name = 'ZxBasicSyntaxError'
    this.token = token
    this.expected = expected
    this.span = token.span
  }
}

export class ZxBasicLexError extends Error {
  readonly span: SourceSpan

  constructor(message: string, span: SourceSpan) {
    super(message)
    this.name = 'ZxBasicLexError'
    this.span = span
  }
}
