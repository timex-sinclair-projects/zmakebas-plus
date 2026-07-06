import type { ProgramNode, Token } from '../parser'

export type ParseState =
  | {
      readonly ok: true
      readonly ast: ProgramNode
      readonly generatedSource: string
      readonly tokens: readonly Token[]
    }
  | {
      readonly ok: false
      readonly title: string
      readonly message: string
      readonly line?: number
      readonly column?: number
      readonly endColumn?: number
      readonly tokens: readonly Token[]
    }

export type SourceNavigationRequest = {
  readonly id: number
  readonly line: number
  readonly column: number
  readonly endColumn?: number
}

export type SourceDiagnostic = {
  readonly title: string
  readonly message: string
  readonly line: number
  readonly column: number
  readonly endColumn?: number
}

export type SourceCursorPosition = {
  readonly line: number
  readonly column: number
}

export type LineNavigationRequest = {
  readonly id: number
  readonly line: number
}
