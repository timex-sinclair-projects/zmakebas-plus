import type { BasicDialect } from '../parser'

export type ProgramExportFormat = 'tap' | 'plus3dos' | 'dck'

export const defaultProgramExportFormat: ProgramExportFormat = 'tap'

export function programFileFormatName(dialect: BasicDialect, programExportFormat: ProgramExportFormat): string {
  if (dialect === 'zx81') {
    return 'P'
  }

  if (isPlus3DosExport(dialect, programExportFormat)) {
    return '+3DOS'
  }

  if (isDockExport(dialect, programExportFormat)) {
    return 'DCK'
  }

  return 'TAP'
}

export function programFileDescription(dialect: BasicDialect, programExportFormat: ProgramExportFormat): string {
  if (dialect === 'zx81') {
    return 'ZX81 P file'
  }

  if (isPlus3DosExport(dialect, programExportFormat)) {
    return 'ZX Spectrum +3DOS file'
  }

  if (isDockExport(dialect, programExportFormat)) {
    return 'TS2068 DCK cartridge file'
  }

  return 'ZX Spectrum TAP file'
}

export function programFileExtension(dialect: BasicDialect, programExportFormat: ProgramExportFormat): string {
  if (dialect === 'zx81') {
    return '.p'
  }

  if (isPlus3DosExport(dialect, programExportFormat)) {
    return '.3dos'
  }

  return isDockExport(dialect, programExportFormat) ? '.dck' : '.tap'
}

export function isPlus3DosExport(dialect: BasicDialect, programExportFormat: ProgramExportFormat): boolean {
  return dialect === 'spectrum' && programExportFormat === 'plus3dos'
}

export function isDockExport(dialect: BasicDialect, programExportFormat: ProgramExportFormat): boolean {
  return dialect === 'ts2068' && programExportFormat === 'dck'
}
