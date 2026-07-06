export const spectrumBlockGraphicPatterns = ["  ", " '", "' ", "''", ' .', ' :', "'.", "':", '. ', ".'", ': ', ":'", '..', '.:', ':.', '::'] as const

export const spectrumBlockGraphicBytes = new Map<string, number>(spectrumBlockGraphicPatterns.map((pattern, index) => [pattern, 0x80 + index]))

export function spectrumBlockGraphicSource(byte: number): string | null {
  const pattern = spectrumBlockGraphicPatterns[byte - 0x80]
  return pattern === undefined ? null : `\\${pattern}`
}

export const zx81BlockGraphicPatterns = [
  "  ",
  "' ",
  " '",
  "''",
  '. ',
  ': ',
  ".'",
  ":'",
  '::',
  '.:',
  ':.',
  '..',
  "':",
  ' :',
  "'.",
  ' .',
  '!:',
  '!.',
  "!'",
  '|:',
  '|.',
  "|'",
] as const

export const zx81BlockGraphicBytes = new Map<string, number>(zx81BlockGraphicPatterns.map((pattern, index) => [pattern, zx81BlockGraphicByte(index)]))

export const zx81BlockGraphicSources = new Map<number, string>(zx81BlockGraphicPatterns.map((pattern, index) => [zx81BlockGraphicByte(index), `\\${pattern}`]))

const zx81InverseCharacterEntries = [
  ['"', 0x8b],
  ['@', 0x8c],
  ['$', 0x8d],
  [':', 0x8e],
  ['?', 0x8f],
  ['(', 0x90],
  [')', 0x91],
  ['>', 0x92],
  ['<', 0x93],
  ['=', 0x94],
  ['+', 0x95],
  ['-', 0x96],
  ['*', 0x97],
  ['/', 0x98],
  [';', 0x99],
  [',', 0x9a],
  ['.', 0x9b],
] as const

export const zx81InverseCharacterBytes = new Map<string, number>(zx81InverseCharacterEntries)

export const zx81InverseCharacterSources = new Map<number, string>(zx81InverseCharacterEntries.map(([char, byte]) => [byte, `\\${char}`]))

export const zx81SingleCharacterEscapes = new Set<string>([...zx81InverseCharacterBytes.keys(), '\\', '`'])

function zx81BlockGraphicByte(index: number): number {
  if (index < 8) {
    return index
  }
  if (index < 16) {
    return index + 0x78
  }
  if (index < 19) {
    return index - 8
  }
  return index + 117
}
