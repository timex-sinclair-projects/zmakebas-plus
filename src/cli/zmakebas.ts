#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import {
  createBasicProgramBytes,
  createPlus3DosFile,
  createTapFile,
  createZx81PFile,
  parseZxBasic,
  preprocessLabels,
  type BasicDialect,
  type BasicExtension,
  type ProgramNode,
  type Token,
} from '../parser'
import { zmakebasVersion } from '../version'

type OutputFormat = 'tap' | 'raw' | 'plus3' | 'p'

type CliOptions = {
  readonly autostartLabel: string | null
  readonly autostartLine: number | null
  readonly dialect: BasicDialect
  readonly extensions: readonly BasicExtension[]
  readonly inputFile: string | null
  readonly labelIncrement: number
  readonly labelMode: boolean
  readonly labelStartLine: number
  readonly outputFile: string | null
  readonly outputFormat: OutputFormat
  readonly speccyFilename: string
}

type ParsedArgs = CliOptions | { readonly kind: 'help' } | { readonly kind: 'version' }

const cliVersion = zmakebasVersion
const defaultSpectrumOutput = 'out.tap'
const defaultZx81Output = 'out.p'

async function main(): Promise<void> {
  const parsed = parseCommandLine(process.argv.slice(2))

  if ('kind' in parsed) {
    if (parsed.kind === 'help') {
      process.stdout.write(helpText())
      return
    }

    process.stdout.write(`${cliVersion}\n`)
    return
  }

  const source = normalizeNumberedSource(await readInput(parsed.inputFile), parsed.labelMode)
  const preprocessed = preprocessLabels(source, {
    enabled: parsed.labelMode,
    increment: parsed.labelIncrement,
    startLine: parsed.labelStartLine,
  })
  const autostartLine = resolveAutostartLine(parsed, preprocessed.sourceMap?.labelDefinitions ?? null)
  const result = parseZxBasic(preprocessed.source, { dialect: parsed.dialect, extensions: parsed.extensions })
  const output = createOutput(parsed, result.ast, result.tokens, autostartLine)
  await writeOutput(resolveOutputFile(parsed), output)
}

function parseCommandLine(argv: readonly string[]): ParsedArgs {
  const options = mutableDefaultOptions()
  let index = 0
  let positional: string | null = null

  while (index < argv.length) {
    const arg = argv[index]

    if (arg === '--') {
      index += 1
      break
    }

    if (arg === '--help') {
      return { kind: 'help' }
    }

    if (arg === '--version') {
      return { kind: 'version' }
    }

    if (!arg.startsWith('-') || arg === '-') {
      positional = readPositional(positional, arg)
      index += 1
      continue
    }

    for (let optionIndex = 1; optionIndex < arg.length; optionIndex += 1) {
      const option = arg[optionIndex]
      switch (option) {
        case 'h':
          return { kind: 'help' }
        case 'v':
          return { kind: 'version' }
        case 'l':
          options.labelMode = true
          break
        case 'p':
          options.dialect = 'zx81'
          options.outputFormat = 'p'
          break
        case 'r':
          options.outputFormat = 'raw'
          break
        case '3':
          options.outputFormat = 'plus3'
          break
        case 'a':
          index += 1
          parseAutostart(readOptionArgument(argv, index, 'a'), options)
          optionIndex = arg.length
          break
        case 'i':
          index += 1
          options.labelIncrement = parseIntegerOption(readOptionArgument(argv, index, 'i'), 'Label line incr.', 1, 1000)
          optionIndex = arg.length
          break
        case 'n':
          index += 1
          options.speccyFilename = readOptionArgument(argv, index, 'n').slice(0, 10)
          optionIndex = arg.length
          break
        case 'o':
          index += 1
          options.outputFile = readOptionArgument(argv, index, 'o')
          optionIndex = arg.length
          break
        case 's':
          index += 1
          options.labelStartLine = parseIntegerOption(readOptionArgument(argv, index, 's'), 'Label start line', 0, 9999)
          optionIndex = arg.length
          break
        default:
          throw new Error(`Option \`${option}\` not recognised.`)
      }
    }

    index += 1
  }

  while (index < argv.length) {
    positional = readPositional(positional, argv[index])
    index += 1
  }

  validateOptions(options)
  return {
    autostartLabel: options.autostartLabel,
    autostartLine: options.autostartLine,
    dialect: options.dialect,
    extensions: options.dialect === 'zx81' ? [] : ['spectranet'],
    inputFile: positional,
    labelIncrement: options.labelIncrement,
    labelMode: options.labelMode,
    labelStartLine: options.labelStartLine,
    outputFile: options.outputFile,
    outputFormat: options.outputFormat,
    speccyFilename: options.speccyFilename,
  }
}

function mutableDefaultOptions(): {
  autostartLabel: string | null
  autostartLine: number | null
  dialect: BasicDialect
  labelIncrement: number
  labelMode: boolean
  labelStartLine: number
  outputFile: string | null
  outputFormat: OutputFormat
  speccyFilename: string
} {
  return {
    autostartLabel: null,
    autostartLine: null,
    dialect: 'ts2068',
    labelIncrement: 2,
    labelMode: false,
    labelStartLine: 10,
    outputFile: null,
    outputFormat: 'tap',
    speccyFilename: '',
  }
}

function parseAutostart(value: string, options: ReturnType<typeof mutableDefaultOptions>): void {
  if (value.startsWith('@')) {
    options.autostartLabel = value.slice(1)
    options.autostartLine = null
    if (options.autostartLabel.length === 0) {
      throw new Error('Auto-start label must not be empty.')
    }
    return
  }

  options.autostartLine = parseIntegerOption(value, 'Auto-start line', 0, 9999)
  options.autostartLabel = null
}

function validateOptions(options: ReturnType<typeof mutableDefaultOptions>): void {
  if (options.autostartLabel !== null && !options.labelMode) {
    throw new Error('Auto-start label specified, but not using labels.')
  }

  if (options.dialect === 'zx81' && options.outputFormat !== 'p') {
    throw new Error('ZX81 mode only supports .p output.')
  }
}

function resolveAutostartLine(options: CliOptions, labels: ReadonlyMap<string, number> | null): number | null {
  if (options.autostartLabel === null) {
    return options.autostartLine
  }

  const line = labels?.get(options.autostartLabel)
  if (line === undefined) {
    throw new Error('Auto-start label is undefined.')
  }

  return line
}

function createOutput(
  options: CliOptions,
  ast: ProgramNode,
  tokens: readonly Token[],
  autostartLine: number | null,
): Uint8Array {
  switch (options.outputFormat) {
    case 'p':
      return createZx81PFile(ast, tokens, autostartLine === null ? undefined : { autostartLine })
    case 'raw':
      return createBasicProgramBytes(ast, tokens)
    case 'plus3':
      return createPlus3DosFile(ast, tokens, autostartLine === null ? { filename: options.speccyFilename } : { autostartLine, filename: options.speccyFilename })
    case 'tap':
      return createTapFile(ast, tokens, autostartLine === null ? { filename: options.speccyFilename } : { autostartLine, filename: options.speccyFilename })
  }
}

function readOptionArgument(argv: readonly string[], index: number, option: string): string {
  const value = argv[index]
  if (value === undefined) {
    throw new Error(`The \`${option}\` option takes an argument.`)
  }

  return value
}

function parseIntegerOption(value: string, label: string, minimum: number, maximum: number): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label} must be in the range ${minimum} to ${maximum}.`)
  }

  const parsed = Number.parseInt(value, 10)
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be in the range ${minimum} to ${maximum}.`)
  }

  return parsed
}

function readPositional(current: string | null, value: string): string {
  if (current !== null) {
    throw new Error('Only one input file can be specified.')
  }

  return value
}

async function readInput(inputFile: string | null): Promise<string> {
  if (inputFile === null || inputFile === '-') {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  return readFile(inputFile, 'utf8')
}

function normalizeNumberedSource(source: string, labelMode: boolean): string {
  if (labelMode) {
    return source
  }

  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const logicalLines: string[] = []
  let currentLine = ''

  lines.forEach((line, index) => {
    if (index === lines.length - 1 && line.length === 0) {
      return
    }

    const continuationIndex = findContinuationIndex(line)
    const segment = continuationIndex === null ? line : line.slice(0, continuationIndex)

    if (currentLine.length === 0 && isIgnoredSourceLine(segment)) {
      return
    }

    currentLine += segment

    if (continuationIndex !== null) {
      return
    }

    if (!isIgnoredSourceLine(currentLine)) {
      logicalLines.push(currentLine)
    }
    currentLine = ''
  })

  if (currentLine.length > 0 && !isIgnoredSourceLine(currentLine)) {
    logicalLines.push(currentLine)
  }

  return logicalLines.join('\n')
}

function isIgnoredSourceLine(line: string): boolean {
  const trimmed = line.trimStart()
  return trimmed.length === 0 || trimmed.startsWith('#')
}

function findContinuationIndex(line: string): number | null {
  let index = line.length - 1

  while (line[index] === ' ' || line[index] === '\t') {
    index -= 1
  }

  return line[index] === '\\' ? index : null
}

async function writeOutput(outputFile: string, bytes: Uint8Array): Promise<void> {
  const buffer = Buffer.from(bytes)
  if (outputFile === '-') {
    process.stdout.write(buffer)
    return
  }

  await writeFile(outputFile, buffer)
}

function resolveOutputFile(options: CliOptions): string {
  if (options.outputFile !== null) {
    return options.outputFile
  }

  return options.outputFormat === 'p' ? defaultZx81Output : defaultSpectrumOutput
}

function helpText(): string {
  return `zmakebas+ CLI

usage: zmakebas [-hlp3rv] [-a line] [-i incr] [-n speccy_filename]
                [-o output_file] [-s line] [input_file]

        -v      output version number.
        -a      set auto-start line of BASIC file (default none).
                In labels mode, this can be @label.
        -h      give this usage help.
        -i      in labels mode, set line number incr. (default 2).
        -l      use labels rather than line numbers.
        -n      set Spectrum filename (to be given in tape header).
        -o      specify output file (default \`out.tap\`, or \`out.p\` with -p).
                Use - as the filename to output on stdout.
        -p      output .p instead (set ZX81 mode).
        -r      output raw headerless Spectrum BASIC file.
        -3      output a +3DOS compatible Spectrum BASIC file.
        -s      in labels mode, set starting line number (default 10).

Default non-ZX81 mode accepts ZX Spectrum, Spectranet, and TS2068 syntax.
`
}

main().catch((error: unknown) => {
  process.stderr.write(`zmakebas: ${formatCliError(error)}\n`)
  process.exitCode = 1
})

function formatCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const position = spanStart(error)

  return position ? `line ${position.line}, column ${position.column}: ${message}` : message
}

function spanStart(error: unknown): { readonly line: number; readonly column: number } | null {
  if (!error || typeof error !== 'object' || !('span' in error)) {
    return null
  }

  const span = (error as { readonly span?: unknown }).span
  if (!span || typeof span !== 'object' || !('start' in span)) {
    return null
  }

  const start = (span as { readonly start?: unknown }).start
  if (!start || typeof start !== 'object') {
    return null
  }

  const { column, line } = start as { readonly column?: unknown; readonly line?: unknown }
  return typeof line === 'number' && typeof column === 'number' ? { column, line } : null
}
