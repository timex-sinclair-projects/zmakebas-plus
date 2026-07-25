import {
  importDockFileEntry,
  importPFile,
  importTapFileEntry,
  listDockFileEntries,
  listTapFileEntries,
  type DecodedZx81Wav,
  type IZx81WavImportProgress,
} from '../../formats'
import type { BasicDialect } from '../../parser'
import { isSpectrumFamilyDialect } from '../../parser/dialects'
import { createZx81TapeWorkspace, editorSourceForZx81WavProgram } from '../zx81Tape/model/zx81TapeWorkspace'
import { importZx81WavProgramsInWorker } from '../zx81Tape/services/zx81WavImportWorkerClient'
import { createZx81WavProgramCatalog } from '../zx81Tape/services/zx81WavProgramSelection'
import { readFileBytes } from './readFileBytes'
import type { ImportedProgramEdit, PendingProgramFileUpload, UploadedProgram } from './programFileTypes'

export interface IProgramFileImportOptions {
  readonly dialect: BasicDialect
  readonly onDecodeProgress: (progress: IZx81WavImportProgress) => void
  readonly onProgramExportFormatChange: (format: 'tap' | 'dck') => void
  readonly onReadProgress: (fraction: number) => void
  readonly signalCarrierRecoveryEnabled: boolean
  readonly signalConditioningEnabled: boolean
  readonly signalRestorationEnabled: boolean
  readonly wavImportSignal?: AbortSignal
}

export type ProgramFileImportResult =
  | {
      readonly clearImportedEdit: boolean
      readonly importedEdit?: ImportedProgramEdit
      readonly kind: 'loaded'
      readonly program: UploadedProgram
    }
  | {
      readonly clearImportedEdit: true
      readonly kind: 'selection'
      readonly selection: PendingProgramFileUpload
    }

/** Imports one browser file or returns a program-entry selection request. */
export async function importProgramFile(file: File, options: IProgramFileImportOptions): Promise<ProgramFileImportResult> {
  const lowerFileName = file.name.toLowerCase()
  if (lowerFileName.endsWith('.tap')) return importTap(file, options)
  if (lowerFileName.endsWith('.dck')) return importDock(file, options)
  if (lowerFileName.endsWith('.p')) return importP(file, options)
  if (lowerFileName.endsWith('.wav')) return importWav(file, options)

  return {
    clearImportedEdit: true,
    kind: 'loaded',
    program: { programName: null, source: await file.text() },
  }
}

/** Builds the editable workspace and source for one decoded ZX81 WAV program. */
export function uploadedZx81WavProgram(decoded: DecodedZx81Wav, fileName: string): UploadedProgram {
  const tapeWorkspace = createZx81TapeWorkspace(decoded, fileName)
  return {
    programName: decoded.filename,
    source: editorSourceForZx81WavProgram(tapeWorkspace),
    tapeWorkspace,
  }
}

async function importDock(file: File, options: IProgramFileImportOptions): Promise<ProgramFileImportResult> {
  if (options.dialect !== 'ts2068') throw new Error('DCK upload is supported in TS2068 mode.')

  options.onProgramExportFormatChange('dck')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const entries = listDockFileEntries(bytes)
  const entry = entries.find((candidate) => candidate.loadable)
  if (entries.length > 1 || !entry) {
    return {
      clearImportedEdit: true,
      kind: 'selection',
      selection: {
        bytes,
        confirmLabel: entry ? undefined : 'OK',
        entries,
        fileName: file.name,
        format: 'dck',
        formatName: 'DCK',
        showFileName: entry !== undefined,
        warningMessage: entry ? undefined : 'This DCK file does not include a BASIC AROS program.',
      },
    }
  }

  const program = importDockFileEntry(bytes, entry.id)
  return {
    clearImportedEdit: false,
    importedEdit: { bytes, entry, fileName: file.name, format: 'dck' },
    kind: 'loaded',
    program: { ...program, autostartLineInitialized: true },
  }
}

async function importP(file: File, options: IProgramFileImportOptions): Promise<ProgramFileImportResult> {
  if (options.dialect !== 'zx81') throw new Error('P file upload is supported in ZX81 mode.')
  const program = importPFile(new Uint8Array(await file.arrayBuffer()))
  return {
    clearImportedEdit: true,
    kind: 'loaded',
    program: { programName: null, source: program.source },
  }
}

async function importWav(file: File, options: IProgramFileImportOptions): Promise<ProgramFileImportResult> {
  if (options.dialect !== 'zx81') throw new Error('ZX81 WAV upload is supported in ZX81 mode.')
  if (!options.wavImportSignal) throw new Error('ZX81 WAV import was not initialized.')

  const wavBytes = await readFileBytes(file, options.onReadProgress, options.wavImportSignal)
  const programs = await importZx81WavProgramsInWorker(
    wavBytes,
    {
      signalCarrierRecoveryEnabled: options.signalCarrierRecoveryEnabled,
      signalConditioningEnabled: options.signalConditioningEnabled,
      signalRestorationEnabled: options.signalRestorationEnabled,
    },
    options.onDecodeProgress,
    options.wavImportSignal,
  )
  const catalog = createZx81WavProgramCatalog(programs)
  if (catalog.programs.length > 1) {
    return {
      clearImportedEdit: true,
      kind: 'selection',
      selection: {
        entries: catalog.entries,
        fileName: file.name,
        format: 'wav',
        formatName: 'ZX81 WAV',
        programs: catalog.programs,
        sourceFile: file,
      },
    }
  }

  return {
    clearImportedEdit: true,
    kind: 'loaded',
    program: uploadedZx81WavProgram(catalog.programs[0], file.name),
  }
}

async function importTap(file: File, options: IProgramFileImportOptions): Promise<ProgramFileImportResult> {
  if (!isSpectrumFamilyDialect(options.dialect)) {
    throw new Error('TAP upload is supported in ZX Spectrum and TS2068 modes.')
  }

  options.onProgramExportFormatChange('tap')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const entries = listTapFileEntries(bytes)
  const entry = entries.find((candidate) => candidate.loadable)
  if (entries.length > 1 || !entry) {
    return {
      clearImportedEdit: true,
      kind: 'selection',
      selection: {
        bytes,
        confirmLabel: entry ? undefined : 'OK',
        entries,
        fileName: file.name,
        format: 'tap',
        formatName: 'TAP',
        showFileName: entry !== undefined,
        warningMessage: entry ? undefined : 'This TAP file does not include a BASIC program.',
      },
    }
  }

  const program = importTapFileEntry(bytes, options.dialect, entry.id)
  return {
    clearImportedEdit: false,
    importedEdit: { bytes, entry, fileName: file.name, format: 'tap' },
    kind: 'loaded',
    program: { ...program, autostartLineInitialized: true },
  }
}
