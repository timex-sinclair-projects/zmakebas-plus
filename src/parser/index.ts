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
export { createPlus3DosFile, createTapFile, updateTapFileProgramEntry } from './exportTapFile'
export type { TapEntryUpdateOptions, TapOptions } from './exportTapFile'
export { importTapFile, importTapFileEntry, listTapFileEntries } from './importTapFile'
export type { ImportedTapProgram, TapFileEntry, TapFileEntryType } from './importTapFile'
export { createDockFile, importDockFileEntry, listDockFileEntries, updateDockFileProgramEntry } from './dockCartridgeFile'
export type { DockEntryUpdateOptions, DockFileEntry, DockOptions, ImportedDockProgram } from './dockCartridgeFile'
export { createBasicProgramBytes, detokenizeBasicProgram } from './spectrumBasicProgram'
export { createZx81PFile } from './exportPFile'
export type { PFileOptions } from './exportPFile'
export { importPFile } from './importPFile'
export type { ImportedPFile } from './importPFile'
export type { ProgramFileEntry, ProgramFileEntryType } from './programFileEntry'
export { mapGeneratedPosition, preprocessLabels, ZxBasicPreprocessError } from './labels'
export type { LabelModeOptions, LabelPreprocessResult, LabelSourceMap } from './labels'
export type * from './ast'
export type { Token, TokenKind } from './tokens'
export { ZxBasicLexError, ZxBasicSyntaxError } from './errors'
