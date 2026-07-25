import type { IZx81WavImportProgress } from '../../formats'
import type { BasicDialect } from '../../parser'

export const defaultProgramName = 'ZXBASIC'
export const fallbackAutostartLine = '10'

export function normalizeProgramName(programName: string): string {
  const truncated = programName.slice(0, 10)
  return truncated.trim().length > 0 ? truncated : defaultProgramName
}

export function normalizeUploadedProgramName(programName: string, dialect: BasicDialect): string {
  return dialect === 'zx81' ? normalizeDownloadProgramName(programName) : normalizeProgramName(programName)
}

export function normalizeDownloadProgramName(programName: string): string {
  const trimmed = programName.trim()
  return trimmed.length > 0 ? trimmed : defaultProgramName
}

export function fileStem(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.')
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName
}

export function isZx81WavUpload(file: File, dialect: BasicDialect): boolean {
  return dialect === 'zx81' && file.name.toLowerCase().endsWith('.wav')
}

export function wavImportStageLabel(stage: IZx81WavImportProgress['stage']): string {
  switch (stage) {
    case 'decode-pcm': return 'Decoding WAV audio'
    case 'condition-signal': return 'Conditioning signal'
    case 'detect-bursts': return 'Finding tape pulses'
    case 'classify-bits': return 'Classifying tape bits'
    case 'decode-programs': return 'Decoding programs'
    case 'prepare-waveform': return 'Preparing waveform'
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function downloadBaseName(programName: string): string {
  const cleaned = programName
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '_')
    .split('')
    .filter((char) => char.charCodeAt(0) >= 32)
    .join('')

  return cleaned || 'zxbasic'
}

export function firstBasicLineNumberText(source: string): string | null {
  for (const line of source.split('\n')) {
    const match = /^\s*(\d+)\b/.exec(line)
    if (match) return match[1]
  }
  return null
}

export function defaultAutostartLineText(
  validAutostartLines: readonly number[],
  source: string,
  labelModeEnabled: boolean,
  labelStartLine: number,
): string {
  const firstParsedLine = validAutostartLines[0]
  if (firstParsedLine !== undefined) return String(firstParsedLine)
  return labelModeEnabled ? String(labelStartLine) : firstBasicLineNumberText(source) ?? fallbackAutostartLine
}
