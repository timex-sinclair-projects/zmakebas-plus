import type { BasicDialect } from '../parser'

export type ProgramExportFormat = 'tap' | 'wav' | 'plus3dos' | 'dck'

export const defaultProgramExportFormat: ProgramExportFormat = 'tap'
export const programFileMimeType = 'application/x-zx-basic'
export const wavFileMimeType = 'audio/wav'

export function programFileFormatName(dialect: BasicDialect, programExportFormat: ProgramExportFormat): string {
  if (isPlus3DosExport(dialect, programExportFormat)) {
    return '+3DOS'
  }

  if (isDockExport(dialect, programExportFormat)) {
    return 'DCK'
  }

  if (isWavExport(dialect, programExportFormat)) {
    return 'WAV'
  }

  if (dialect === 'zx81') {
    return 'P'
  }

  return 'TAP'
}

export function programFileDescription(dialect: BasicDialect, programExportFormat: ProgramExportFormat): string {
  if (isPlus3DosExport(dialect, programExportFormat)) {
    return 'ZX Spectrum +3DOS file'
  }

  if (isDockExport(dialect, programExportFormat)) {
    return 'TS2068 DCK cartridge file'
  }

  if (isWavExport(dialect, programExportFormat)) {
    if (dialect === 'zx81') {
      return 'ZX81 WAV audio file'
    }

    return dialect === 'ts2068' ? 'TS2068 WAV audio file' : 'ZX Spectrum WAV audio file'
  }

  if (dialect === 'zx81') {
    return 'ZX81 P file'
  }

  return 'ZX Spectrum TAP file'
}

export function programFileExtension(dialect: BasicDialect, programExportFormat: ProgramExportFormat): string {
  if (isPlus3DosExport(dialect, programExportFormat)) {
    return '.3dos'
  }

  if (isDockExport(dialect, programExportFormat)) {
    return '.dck'
  }

  if (isWavExport(dialect, programExportFormat)) {
    return '.wav'
  }

  return dialect === 'zx81' ? '.p' : '.tap'
}

export function programFileSaveMimeType(dialect: BasicDialect, programExportFormat: ProgramExportFormat): string {
  return isWavExport(dialect, programExportFormat) ? wavFileMimeType : programFileMimeType
}

export function isPlus3DosExport(dialect: BasicDialect, programExportFormat: ProgramExportFormat): boolean {
  return dialect === 'spectrum' && programExportFormat === 'plus3dos'
}

export function isDockExport(dialect: BasicDialect, programExportFormat: ProgramExportFormat): boolean {
  return dialect === 'ts2068' && programExportFormat === 'dck'
}

export function isWavExport(dialect: BasicDialect, programExportFormat: ProgramExportFormat): boolean {
  return (dialect === 'spectrum' || dialect === 'ts2068' || dialect === 'zx81') && programExportFormat === 'wav'
}
