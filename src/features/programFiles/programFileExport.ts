import {
  createDockFile,
  createPlus3DosFile,
  createSpectrumWavFile,
  createTapFile,
  createZx81PFile,
  createZx81WavFile,
  updateDockFileProgramEntry,
  updateTapFileProgramEntry,
} from '../../formats'
import type { ProgramNode } from '../../parser/ast'
import type { BasicDialect } from '../../parser/dialects'
import type { Token } from '../../parser/tokens'
import { isDockExport, isPlus3DosExport, isWavExport, type ProgramExportFormat } from './programFile'
import type { ImportedProgramEdit } from './programFileTypes'

export interface IProgramFileExportOptions {
  readonly autostartLine: number | null
  readonly dialect: BasicDialect
  readonly downloadProgramName: string
  readonly importedProgramFileEdit: ImportedProgramEdit | null
  readonly program: ProgramNode
  readonly programExportFormat: ProgramExportFormat
  readonly storedProgramName: string
  readonly tokens: readonly Token[]
  readonly updateImportedFile: boolean
}

/** Encodes one parsed BASIC program in the selected output format. */
export function createProgramFileOutput(options: IProgramFileExportOptions): Uint8Array {
  const {
    autostartLine,
    dialect,
    downloadProgramName,
    importedProgramFileEdit,
    program,
    programExportFormat,
    storedProgramName,
    tokens,
    updateImportedFile,
  } = options
  const autostartOptions = autostartLine === null ? undefined : { autostartLine }

  if (dialect === 'zx81') {
    const pFile = createZx81PFile(program, tokens, autostartOptions)
    return isWavExport(dialect, programExportFormat) ? createZx81WavFile(pFile, downloadProgramName) : pFile
  }

  if (isWavExport(dialect, programExportFormat)) {
    return createSpectrumWavFile(createTapFile(program, tokens, tapOptions(storedProgramName, autostartLine)))
  }

  if (isPlus3DosExport(dialect, programExportFormat)) {
    return createPlus3DosFile(program, tokens, autostartOptions)
  }

  if (isDockExport(dialect, programExportFormat)) {
    if (updateImportedFile && importedProgramFileEdit?.format === 'dck') {
      return updateDockFileProgramEntry(importedProgramFileEdit.bytes, program, tokens, {
        autostart: autostartLine !== null,
        blockIndex: importedProgramFileEdit.entry.blockIndex,
      })
    }
    return createDockFile(program, tokens, { autostart: autostartLine !== null })
  }

  if (updateImportedFile && importedProgramFileEdit?.format === 'tap') {
    return updateTapFileProgramEntry(importedProgramFileEdit.bytes, program, tokens, {
      ...tapOptions(storedProgramName, autostartLine),
      blockIndex: importedProgramFileEdit.entry.blockIndex,
    })
  }
  return createTapFile(program, tokens, tapOptions(storedProgramName, autostartLine))
}

function tapOptions(filename: string, autostartLine: number | null): { readonly filename: string; readonly autostartLine?: number } {
  return autostartLine === null ? { filename } : { autostartLine, filename }
}
