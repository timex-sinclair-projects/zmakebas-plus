import type { ProgramNode } from './ast'
import { tokenByteMap, zx81TokenDefinitions } from './basicTokens'
import { collectVariableStartOffsets, encodeSinclairFloatBytes, normalizeRemPayload, writeWord } from './exportCommon'
import { readZx81TextEscape } from './textEscapes'
import { commonSimpleTokenText } from './tokenText'
import type { Token } from './tokens'

const programBaseAddress = 0x407d
const noAutostartLine = 0x8000
const emptyDisplayFile = [...Array.from({ length: 25 }, () => 0x76), 0x80]

const tokenBytes = tokenByteMap(zx81TokenDefinitions)

export type PFileOptions = {
  readonly autostartLine?: number
}

export function createZx81PFile(program: ProgramNode, tokens: readonly Token[], options: PFileOptions = {}): Uint8Array {
  const { bytes: programBytes, lineOffsets } = createBasicProgramBytes(program, tokens)
  const header = createHeader(programBytes.length, lineOffsets.get(options.autostartLine ?? noAutostartLine) ?? null)
  const pFile = new Uint8Array(header.length + programBytes.length + emptyDisplayFile.length)
  pFile.set(header, 0)
  pFile.set(programBytes, header.length)
  pFile.set(emptyDisplayFile, header.length + programBytes.length)
  return pFile
}

function createBasicProgramBytes(program: ProgramNode, tokens: readonly Token[]): { readonly bytes: Uint8Array; readonly lineOffsets: ReadonlyMap<number, number> } {
  const variableOffsets = collectVariableStartOffsets(program)
  const lineOffsets = new Map<number, number>()
  const lineBytes: number[] = []
  let index = 0

  while (index < tokens.length && tokens[index].kind !== 'EOF') {
    const lineNumber = tokens[index]
    if (lineNumber.kind !== 'LINENUMBER') {
      throw new Error(`Cannot export P file: expected a line number at source line ${lineNumber.span.start.line}.`)
    }

    const lineBody: number[] = []
    const number = typeof lineNumber.value === 'number' ? lineNumber.value : Number(lineNumber.lexeme)
    lineOffsets.set(number, lineBytes.length)
    index += 1

    while (index < tokens.length && tokens[index].kind !== 'ENDOFLINE' && tokens[index].kind !== 'EOF') {
      const token = tokens[index]
      lineBody.push(...encodeToken(token, variableOffsets.has(token.span.start.offset)))
      index += 1
    }

    lineBody.push(0x76)
    lineBytes.push((number >> 8) & 0xff, number & 0xff, lineBody.length & 0xff, (lineBody.length >> 8) & 0xff, ...lineBody)

    if (tokens[index]?.kind === 'ENDOFLINE') {
      index += 1
    }
  }

  return { bytes: Uint8Array.from(lineBytes), lineOffsets }
}

function encodeToken(token: Token, isVariableToken: boolean): number[] {
  if (token.kind === 'REM') {
    return [0xea, ...encodeText(normalizeRemPayload(String(token.value ?? '')))]
  }

  if (token.kind === 'STRINGLIT') {
    return encodeStringLiteral(token.lexeme)
  }

  if (token.kind === 'VARNAME' || isVariableToken) {
    return encodeText(token.lexeme)
  }

  if (token.kind === 'NUMLIT') {
    return [...encodeText(token.lexeme), 0x7e, ...encodeNumber(Number(token.value))]
  }

  if (token.kind === 'RAWBYTE') {
    return [Number(token.value) & 0xff]
  }

  const simpleText = commonSimpleTokenText[token.kind]
  if (simpleText) {
    return encodeText(simpleText)
  }

  const tokenByte = tokenBytes[token.kind]
  if (tokenByte !== undefined) {
    return [tokenByte]
  }

  throw new Error(`Cannot export P file: unsupported ZX81 token ${token.kind} at ${token.span.start.line}:${token.span.start.column}.`)
}

function encodeText(text: string): number[] {
  const bytes: number[] = []

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char !== '\\') {
      bytes.push(encodeCharacter(char))
      continue
    }

    const escaped = readZx81TextEscape(text, index)
    bytes.push(...escaped.bytes)
    index = escaped.sourceEndIndex - 1
  }

  return bytes
}

function encodeStringLiteral(lexeme: string): number[] {
  const bytes: number[] = []

  for (let index = 0; index < lexeme.length; index += 1) {
    if (lexeme[index] === '\\' && lexeme[index + 1]) {
      const escaped = readZx81TextEscape(lexeme, index)
      bytes.push(...escaped.bytes)
      index = escaped.sourceEndIndex - 1
      continue
    }

    if (lexeme[index] === '"' && lexeme[index + 1] === '"' && index > 0 && index + 2 < lexeme.length) {
      bytes.push(0xc0)
      index += 1
      continue
    }

    bytes.push(...encodeText(lexeme[index]))
  }

  return bytes
}

function encodeCharacter(char: string): number {
  const code = char.charCodeAt(0)

  if (code >= 0x30 && code <= 0x39) {
    return code - 20
  }

  if (code >= 0x41 && code <= 0x5a) {
    return code - 27
  }

  if (code >= 0x61 && code <= 0x7a) {
    return code + 69
  }

  switch (code) {
    case 0x0d:
      return 0x76
    case 0x20:
      return 0x00
    case 0x22:
      return 0x0b
    case 0x24:
      return 0x0d
    case 0x28:
      return 0x10
    case 0x29:
      return 0x11
    case 0x2a:
      return 0x17
    case 0x2b:
      return 0x15
    case 0x2c:
      return 0x1a
    case 0x2d:
      return 0x16
    case 0x2e:
      return 0x1b
    case 0x2f:
      return 0x18
    case 0x3a:
      return 0x0e
    case 0x3b:
      return 0x19
    case 0x3c:
      return 0x13
    case 0x3d:
      return 0x14
    case 0x3e:
      return 0x12
    case 0x3f:
      return 0x0f
    case 0x60:
      return 0xc0
    default:
      return code & 0xff
  }
}

function encodeNumber(value: number): number[] {
  return encodeSinclairFloatBytes(Math.abs(value), { exportFormat: 'P file', numericRange: 'ZX81' })
}

function createHeader(programLength: number, autostartOffset: number | null): Uint8Array {
  const header = new Uint8Array(0x74)
  const dFile = programLength + 0x407d
  const vars = programLength + 0x4096
  const eLine = programLength + 0x4097
  const nextLine = autostartOffset === null ? dFile : programBaseAddress + autostartOffset

  writeWord(header, 3, dFile)
  writeWord(header, 5, programLength + 0x407e)
  writeWord(header, 7, vars)
  writeWord(header, 11, eLine)
  writeWord(header, 13, vars)
  writeWord(header, 17, eLine)
  writeWord(header, 19, eLine)
  writeWord(header, 22, 0x405d)
  header[25] = 2
  writeWord(header, 26, 1)
  header[28] = 0xff
  writeWord(header, 29, 0xffff)
  header[31] = 55
  writeWord(header, 32, nextLine)
  writeWord(header, 39, 0x0c8d)
  writeWord(header, 43, 0xffff)
  header[47] = 0xbc
  header[48] = 33
  header[49] = 24
  header[50] = 0x40

  return header
}
