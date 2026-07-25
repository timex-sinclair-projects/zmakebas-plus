import type { DecodedZx81Wav, ProgramFileEntry } from '../../../formats'

export interface IZx81WavProgramCatalog {
  readonly entries: readonly ProgramFileEntry[]
  readonly programs: readonly DecodedZx81Wav[]
}

/** Creates a recording-ordered catalog for selecting decoded ZX81 WAV programs. */
export function createZx81WavProgramCatalog(programs: readonly DecodedZx81Wav[]): IZx81WavProgramCatalog {
  const orderedPrograms = [...programs].sort((left, right) => (
    left.programStartSample - right.programStartSample
    || left.channelIndex - right.channelIndex
    || left.tapeBitStart - right.tapeBitStart
  ))
  return {
    entries: orderedPrograms.map(zx81WavProgramEntry),
    programs: orderedPrograms,
  }
}

/** Finds the entry ID assigned to a decoded program in a WAV catalog. */
export function zx81WavProgramEntryId(catalog: IZx81WavProgramCatalog, programId: string): number | null {
  const entryId = catalog.programs.findIndex((program) => program.programId === programId)
  return entryId >= 0 ? entryId : null
}

function zx81WavProgramEntry(decoded: DecodedZx81Wav, id: number): ProgramFileEntry {
  return {
    autostart: false,
    autostartLine: null,
    basicLength: null,
    blockIndex: id,
    dataLength: decoded.pFileByteLength,
    details: [
      `${formatTapeTime(decoded.programStartSample / decoded.sampleRate)} into recording`,
      `Channel ${decoded.channelIndex + 1} · ${Math.round(decoded.confidence * 100)}% signal confidence`,
      ...(decoded.unknownBitCount > 0 ? [`${decoded.unknownBitCount.toLocaleString()} unknown bits`] : []),
      ...(decoded.decodeError ? [`Repair needed · ${decoded.decodeError}`] : []),
    ],
    id,
    loadable: true,
    name: decoded.filename || 'Unnamed',
    type: 'program',
    typeLabel: decoded.decodeError ? 'ZX81 BASIC · damaged' : 'ZX81 BASIC',
  }
}

function formatTapeTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}
