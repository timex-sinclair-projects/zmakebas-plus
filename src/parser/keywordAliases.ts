import type { TokenKind } from './tokens'

export type BasicKeywordAlias = {
  readonly text: string
  readonly kind: TokenKind
}

export const basicKeywordAliases = [
  { text: 'RANDOMISE', kind: 'RANDOMIZE' },
] satisfies readonly BasicKeywordAlias[]
