import type { NodeBase, ProgramNode } from './ast'

type SinclairFloatRange = {
  readonly exportFormat: string
  readonly numericRange: string
}

const spectrumDisplayControls = new Map(
  [
    ['INK', { byte: 0x10, max: 9 }],
    ['PAPER', { byte: 0x11, max: 9 }],
    ['FLASH', { byte: 0x12, max: 1 }],
    ['BRIGHT', { byte: 0x13, max: 1 }],
    ['INVERSE', { byte: 0x14, max: 1 }],
    ['OVER', { byte: 0x15, max: 1 }],
  ] satisfies Array<readonly [string, { readonly byte: number; readonly max: number }]>,
)

export function writeWord(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >> 8) & 0xff
}

export function normalizeRemPayload(text: string): string {
  return text[0] === ' ' || text[0] === '\t' ? text.slice(1) : text
}

export function collectVariableStartOffsets(program: ProgramNode): Set<number> {
  const offsets = new Set<number>()
  visitNode(program, (node) => {
    if (node.type === 'Variable') {
      offsets.add(node.span.start.offset)
    }
  })
  return offsets
}

export function parseSpectrumDisplayControlEscape(text: string): number[] | null {
  const match = text.trim().match(/^([A-Za-z]+)\s+([0-9]+)$/)
  if (!match) {
    return null
  }

  const name = match[1].toUpperCase()
  const control = spectrumDisplayControls.get(name)
  if (!control) {
    return null
  }

  const value = Number.parseInt(match[2], 10)
  if (value > control.max) {
    throw new Error(`${name} control parameter must be from 0 to ${control.max}.`)
  }

  return [control.byte, value]
}

export function parseSpectrumTextControlEscape(text: string): number[] | null {
  const displayControl = parseSpectrumDisplayControlEscape(text)
  if (displayControl) {
    return displayControl
  }

  const trimmed = text.trim()
  if (/^COMMA$/i.test(trimmed)) {
    return [0x06]
  }

  const tabMatch = trimmed.match(/^TAB\s+([0-9]+)$/i)
  if (tabMatch) {
    const value = Number.parseInt(tabMatch[1], 10)
    if (value > 31) {
      throw new Error('TAB control parameter must be from 0 to 31.')
    }
    return [0x17, value]
  }

  const atMatch = trimmed.match(/^AT\s+([0-9]+)\s*,\s*([0-9]+)$/i)
  if (atMatch) {
    const row = Number.parseInt(atMatch[1], 10)
    const column = Number.parseInt(atMatch[2], 10)
    if (row > 23) {
      throw new Error('AT row parameter must be from 0 to 23.')
    }
    if (column > 31) {
      throw new Error('AT column parameter must be from 0 to 31.')
    }
    return [0x16, row, column]
  }

  return null
}

export function formatSpectrumDisplayControlEscape(byte: number, parameter: number): string | null {
  for (const [name, control] of spectrumDisplayControls) {
    if (byte === control.byte && parameter <= control.max) {
      return `\\{${name} ${parameter}}`
    }
  }

  return null
}

export function formatSpectrumTextControlEscape(bytes: Uint8Array, index: number): { readonly consumed: number; readonly source: string } | null {
  const byte = bytes[index]
  if (byte === 0x06) {
    return { consumed: 1, source: '\\{COMMA}' }
  }

  if (byte === 0x16 && index + 2 < bytes.length) {
    const row = bytes[index + 1]
    const column = bytes[index + 2]
    if (row <= 23 && column <= 31) {
      return { consumed: 3, source: `\\{AT ${row},${column}}` }
    }
  }

  if (byte === 0x17 && index + 1 < bytes.length) {
    const value = bytes[index + 1]
    if (value <= 31) {
      return { consumed: 2, source: `\\{TAB ${value}}` }
    }
  }

  if (index + 1 < bytes.length) {
    const displayControl = formatSpectrumDisplayControlEscape(byte, bytes[index + 1])
    if (displayControl) {
      return { consumed: 2, source: displayControl }
    }
  }

  return null
}

export function visitNode(value: unknown, visit: (node: NodeBase) => void): void {
  if (!value || typeof value !== 'object') {
    return
  }

  const candidate = value as Partial<NodeBase>
  if (typeof candidate.type === 'string' && candidate.span) {
    visit(candidate as NodeBase)
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      child.forEach((item) => visitNode(item, visit))
    } else {
      visitNode(child, visit)
    }
  }
}

export function encodeSinclairFloatBytes(value: number, range: SinclairFloatRange): number[] {
  const { exponent, mantissa } = encodeSinclairFloat(value, range)
  return [exponent, (mantissa >>> 24) & 0xff, (mantissa >>> 16) & 0xff, (mantissa >>> 8) & 0xff, mantissa & 0xff]
}

function encodeSinclairFloat(value: number, range: SinclairFloatRange): { readonly exponent: number; readonly mantissa: number } {
  if (value === 0) {
    return { exponent: 0, mantissa: 0 }
  }

  let normalized = value
  let exponent = 0

  while (normalized >= 1) {
    normalized /= 2
    exponent += 1
  }

  while (normalized !== 0 && normalized < 0.5) {
    normalized *= 2
    exponent -= 1
  }

  if (exponent < -128 || exponent > 127) {
    throw new Error(`Cannot export ${range.exportFormat}: number ${value} is outside the ${range.numericRange} numeric range.`)
  }

  normalized *= 2
  let mantissa = 0
  for (let bit = 0; bit < 32; bit += 1) {
    mantissa *= 2
    if (normalized >= 1) {
      mantissa += 1
      normalized -= 1
    }
    normalized *= 2
  }

  if (normalized >= 1 && mantissa !== 0xffffffff) {
    mantissa += 1
  }

  return { exponent: 128 + exponent, mantissa: mantissa & 0x7fffffff }
}
