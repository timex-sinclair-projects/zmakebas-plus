import type { NodeBase, ProgramNode } from '../../parser/ast'

type SinclairFloatRange = {
  readonly exportFormat: string
  readonly numericRange: string
}

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
