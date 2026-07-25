import type { DecodedZx81Wav, ProgramFileEntry } from '../../formats'
import type { Zx81TapeWorkspace } from '../zx81Tape/model/zx81TapeWorkspace'

export type ImportedProgramFormat = 'tap' | 'dck'

export type PendingProgramFileSelection = {
  readonly confirmLabel?: string
  readonly entries: readonly ProgramFileEntry[]
  readonly formatName: string
  readonly fileName: string
  readonly initialSelectedEntryId?: number
  readonly showFileName?: boolean
  readonly warningMessage?: string
}

export type PendingProgramFileUpload = PendingProgramFileSelection & (
  | { readonly bytes: Uint8Array; readonly format: ImportedProgramFormat }
  | { readonly format: 'wav'; readonly programs: readonly DecodedZx81Wav[]; readonly sourceFile: File }
)

export type ImportedZx81WavProgramSelection = PendingProgramFileUpload & {
  readonly format: 'wav'
  readonly selectedEntryId: number
}

export type ImportedProgramEdit = {
  readonly bytes: Uint8Array
  readonly entry: ProgramFileEntry
  readonly format: ImportedProgramFormat
  readonly fileName: string
}

export type UploadedProgram = {
  readonly autostartLineInitialized?: boolean
  readonly programName: string | null
  readonly source: string
  readonly tapeWorkspace?: Zx81TapeWorkspace
}

export type WavImportProgress = {
  readonly fileName: string
  readonly label: string
  readonly percent: number
}
