import type { ProgramNode } from './ast'
import { lex } from './lexer'
import type { BasicDialect, BasicExtension } from './dialects'
import { Parser, type ParserOptions } from './parser'
import type { Token } from './tokens'

export type ParseResult = {
  readonly ast: ProgramNode
  readonly tokens: readonly Token[]
}

export function parseZxBasic(source: string, options: ParserOptions = {}): ParseResult {
  const tokens = lex(source, { dialect: options.dialect, extensions: options.extensions })
  const ast = new Parser(tokens, options).parseProgram()
  return { ast, tokens }
}

export { lex, Parser }
export type { BasicDialect, BasicExtension, ParserOptions }
export { scanStringLiteralDisplayItems } from './displayText'
export type { StringLiteralDisplayItem } from './displayText'
export { mapGeneratedEndPosition, mapGeneratedPosition, preprocessLabels, ZxBasicPreprocessError } from './labels'
export type { LabelModeOptions, LabelPreprocessResult, LabelSourceMap } from './labels'
export { decodeStoredNumberBytes, formatStoredNumberAnnotation, formatStoredNumberBytesAnnotation } from './storedNumber'
export type * from './ast'
export type { StoredNumber, StoredNumberBytes, Token, TokenKind } from './tokens'
export { ZxBasicLexError, ZxBasicSyntaxError } from './errors'
