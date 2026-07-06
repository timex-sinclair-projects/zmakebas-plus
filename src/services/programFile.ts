import type { BasicDialect } from '../parser'

export type SpectrumExportFormat = 'tap' | 'plus3dos'

export const defaultSpectrumExportFormat: SpectrumExportFormat = 'tap'

export function programFileFormatName(dialect: BasicDialect, spectrumExportFormat: SpectrumExportFormat): string {
  if (dialect === 'zx81') {
    return 'P'
  }

  if (isPlus3DosExport(dialect, spectrumExportFormat)) {
    return '+3DOS'
  }

  return 'TAP'
}

export function programFileDescription(dialect: BasicDialect, spectrumExportFormat: SpectrumExportFormat): string {
  if (dialect === 'zx81') {
    return 'ZX81 P file'
  }

  if (isPlus3DosExport(dialect, spectrumExportFormat)) {
    return 'ZX Spectrum +3DOS file'
  }

  return 'ZX Spectrum TAP file'
}

export function programFileExtension(dialect: BasicDialect, spectrumExportFormat: SpectrumExportFormat): string {
  if (dialect === 'zx81') {
    return '.p'
  }

  return isPlus3DosExport(dialect, spectrumExportFormat) ? '.3dos' : '.tap'
}

export function isPlus3DosExport(dialect: BasicDialect, spectrumExportFormat: SpectrumExportFormat): boolean {
  return dialect === 'spectrum' && spectrumExportFormat === 'plus3dos'
}
