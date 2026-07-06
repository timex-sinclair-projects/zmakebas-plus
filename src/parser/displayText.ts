import type { BasicDialect } from './dialects'
import { readSpectrumDisplayTextEscape, readZx81DisplayTextEscape } from './textEscapes'
import type { DisplayTextEscape } from './textEscapes'

export type StringLiteralDisplayItem = DisplayTextEscape

export function scanStringLiteralDisplayItems(lexeme: string, dialect: BasicDialect): readonly StringLiteralDisplayItem[] {
  const items: StringLiteralDisplayItem[] = []
  let lexemeIndex = 1

  while (lexemeIndex < lexeme.length - 1) {
    const item = readStringLiteralDisplayItem(lexeme, dialect, lexemeIndex)
    items.push(item)
    lexemeIndex = item.sourceEndIndex
  }

  return items
}

function readStringLiteralDisplayItem(lexeme: string, dialect: BasicDialect, index: number): StringLiteralDisplayItem {
  if (lexeme[index] === '\\') {
    return dialect === 'zx81' ? readZx81DisplayTextEscape(lexeme, index) : readSpectrumDisplayTextEscape(lexeme, index)
  }

  if (lexeme[index] === '"' && lexeme[index + 1] === '"') {
    return displayItem(index + 2)
  }

  return displayItem(index + 1)
}

function displayItem(sourceEndIndex: number): StringLiteralDisplayItem {
  return { displayColumns: 1, kind: 'display', sourceEndIndex }
}
