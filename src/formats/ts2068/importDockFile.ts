import { detokenizeBasicProgram } from '../spectrum/spectrumBasicProgram'
import { parseDockEntries, readMemoryRange, type DockFileEntry } from './dockCartridge'

export type ImportedDockProgram = {
  readonly source: string
  readonly programName: string | null
}

export function listDockFileEntries(bytes: Uint8Array): DockFileEntry[] {
  return parseDockEntries(bytes).map(({ entry }) => entry)
}

export function importDockFileEntry(bytes: Uint8Array, entryId: number): ImportedDockProgram {
  const entry = parseDockEntries(bytes).find(({ entry: candidate }) => candidate.id === entryId)
  if (!entry) throw new Error('Unable to find the selected DCK entry.')
  if (!entry.entry.loadable) {
    throw new Error(`DCK entry "${entry.entry.name ?? 'unnamed'}" is ${entry.entry.typeLabel}, not a BASIC AROS program.`)
  }

  const programBytes = readMemoryRange(entry.record, entry.programAddress, entry.programEndAddress)
  return {
    programName: null,
    source: detokenizeBasicProgram(programBytes, 'ts2068'),
  }
}

export type { DockFileEntry } from './dockCartridge'
