import { useState } from 'react'
import { isPlus3DosExport, programFileDescription, programFileExtension, type SpectrumExportFormat } from '../services/programFile'
import {
  createPlus3DosFile,
  createTapFile,
  createZx81PFile,
  importTapFileEntry,
  importPFile,
  listTapFileEntries,
  parseZxBasic,
  preprocessLabels,
  updateTapFileProgramEntry,
  type BasicDialect,
  type BasicExtension,
  type ImportedTapProgram,
  type TapFileEntry,
} from '../parser'
import { isSpectrumFamilyDialect } from '../parser/dialects'

const defaultProgramName = 'ZXBASIC'
const fallbackAutostartLine = '10'
const programFileMimeType = 'application/x-zx-basic'
const sourceMimeType = 'text/plain'

type SaveFilePickerWindow = Window & {
  readonly showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<SaveFileHandle>
}

type SaveFilePickerOptions = {
  readonly suggestedName?: string
  readonly types?: readonly {
    readonly description: string
    readonly accept: Record<string, readonly string[]>
  }[]
}

type SaveFileHandle = {
  readonly createWritable: () => Promise<WritableFile>
}

type WritableFile = {
  readonly write: (data: Blob) => Promise<void> | void
  readonly close: () => Promise<void> | void
}

type UseProgramFilesOptions = {
  readonly dialect: BasicDialect
  readonly extensions: readonly BasicExtension[]
  readonly labelIncrement: number
  readonly labelModeEnabled: boolean
  readonly labelStartLine: number
  readonly source: string
  readonly spectrumExportFormat: SpectrumExportFormat
  readonly validAutostartLines: readonly number[]
  readonly onProcessingEnd: () => void
  readonly onProcessingStart: () => void
  readonly onRequestParse: (source?: string) => void
  readonly onSourceLoaded: (source: string) => void
}

export type PendingTapSelection = {
  readonly entries: readonly TapFileEntry[]
  readonly fileName: string
}

export type ProgramFilesState = {
  readonly autostartEnabled: boolean
  readonly autostartLine: string
  readonly updateImportedTapAvailable: boolean
  readonly updateImportedTapEnabled: boolean
  readonly isExportDialogOpen: boolean
  readonly pendingTapSelection: PendingTapSelection | null
  readonly programName: string
  readonly handleAutostartEnabledChange: (enabled: boolean) => void
  readonly handleCancelTapSelection: () => void
  readonly handleConfirmExport: (programName: string, autostartLine: number | null, updateImportedTap?: boolean) => Promise<void>
  readonly handleConfirmTapSelection: (entryId: number) => Promise<void>
  readonly handleOpenExportDialog: (source?: string) => void
  readonly handleSaveSource: () => Promise<void>
  readonly handleUploadSource: (file: File) => Promise<void>
  readonly clearImportedTapEdit: () => void
  readonly setAutostartLine: (line: string) => void
  readonly setUpdateImportedTapEnabled: (enabled: boolean) => void
  readonly setIsExportDialogOpen: (isOpen: boolean) => void
  readonly setProgramName: (programName: string) => void
  readonly updateDefaultAutostartLine: (source: string) => void
}

export function useProgramFiles({
  dialect,
  extensions,
  labelIncrement,
  labelModeEnabled,
  labelStartLine,
  onProcessingEnd,
  onProcessingStart,
  onRequestParse,
  onSourceLoaded,
  source,
  spectrumExportFormat,
  validAutostartLines,
}: UseProgramFilesOptions): ProgramFilesState {
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false)
  const [programName, setProgramName] = useState(defaultProgramName)
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [autostartLine, setAutostartLine] = useState(firstBasicLineNumberText(source) ?? fallbackAutostartLine)
  const [pendingTapUpload, setPendingTapUpload] = useState<PendingTapUpload | null>(null)
  const [importedTapEdit, setImportedTapEdit] = useState<ImportedTapEdit | null>(null)
  const [updateImportedTapEnabled, setUpdateImportedTapEnabled] = useState(false)
  const defaultAutostartLine = defaultAutostartLineText(validAutostartLines, source, labelModeEnabled, labelStartLine)
  const plus3DosExport = isPlus3DosExport(dialect, spectrumExportFormat)
  const updateImportedTapAvailable = importedTapEdit !== null && isSpectrumFamilyDialect(dialect) && !plus3DosExport

  function updateDefaultAutostartLine(nextSource: string): void {
    if (autostartEnabled) {
      return
    }

    setAutostartLine(defaultAutostartLineText(validAutostartLines, nextSource, labelModeEnabled, labelStartLine))
  }

  async function handleUploadSource(file: File): Promise<void> {
    onProcessingStart()

    try {
      const uploaded = await readUploadedSource(file)
      if (!uploaded) {
        onProcessingEnd()
        return
      }

      const uploadedSource = uploaded.source
      const uploadedProgramName = normalizeUploadedProgramName(uploaded.programName ?? fileStem(file.name), dialect)
      loadUploadedSource(uploadedSource, uploadedProgramName, { updateAutostartLine: !uploaded.autostartLineInitialized })
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to load source file.')
      onProcessingEnd()
    }
  }

  async function readUploadedSource(file: File): Promise<UploadedProgram | null> {
    if (!file.name.toLowerCase().endsWith('.tap')) {
      if (file.name.toLowerCase().endsWith('.p')) {
        if (dialect !== 'zx81') {
          throw new Error('P file upload is supported in ZX81 mode.')
        }

        clearImportedTapEdit()
        const uploaded = importPFile(new Uint8Array(await file.arrayBuffer()))
        return {
          programName: null,
          source: uploaded.source,
        }
      }

      clearImportedTapEdit()
      return {
        programName: null,
        source: await file.text(),
      }
    }

    if (!isSpectrumFamilyDialect(dialect)) {
      throw new Error('TAP upload is supported in ZX Spectrum and TS2068 modes.')
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const entries = listTapFileEntries(bytes)
    if (entries.length > 1) {
      clearImportedTapEdit()
      setPendingTapUpload({ bytes, entries, fileName: file.name })
      return null
    }

    const entry = entries.find((tapEntry) => tapEntry.loadable)
    if (!entry) {
      clearImportedTapEdit()
      throw new Error('Unable to find a BASIC program in this TAP file.')
    }

    const uploaded = importTapFileEntry(bytes, dialect, entry.id)
    setImportedTapEditContext(bytes, file.name, entry)
    return { ...uploaded, autostartLineInitialized: true }
  }

  async function handleConfirmTapSelection(entryId: number): Promise<void> {
    const pendingUpload = pendingTapUpload
    if (!pendingUpload) {
      return
    }

    setPendingTapUpload(null)
    onProcessingStart()

    try {
      const uploaded = importTapFileEntry(pendingUpload.bytes, dialect, entryId)
      const entry = pendingUpload.entries.find((tapEntry) => tapEntry.id === entryId)
      if (entry) {
        setImportedTapEditContext(pendingUpload.bytes, pendingUpload.fileName, entry)
      }
      loadUploadedSource(uploaded.source, normalizeUploadedProgramName(uploaded.programName ?? fileStem(pendingUpload.fileName), dialect), { updateAutostartLine: false })
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to load TAP entry.')
      onProcessingEnd()
    }
  }

  function handleCancelTapSelection(): void {
    setPendingTapUpload(null)
  }

  function setImportedTapEditContext(bytes: Uint8Array, fileName: string, entry: TapFileEntry): void {
    setImportedTapEdit({ bytes, entry, fileName })
    setUpdateImportedTapEnabled(true)
    if (entry.autostartLine !== null) {
      setAutostartEnabled(true)
      setAutostartLine(String(entry.autostartLine))
    } else {
      setAutostartEnabled(false)
    }
  }

  function clearImportedTapEdit(): void {
    setImportedTapEdit(null)
    setUpdateImportedTapEnabled(false)
  }

  function loadUploadedSource(uploadedSource: string, uploadedProgramName: string, options: LoadUploadedSourceOptions = {}): void {
    onSourceLoaded(uploadedSource)
    setProgramName(uploadedProgramName)
    if (options.updateAutostartLine ?? true) {
      updateDefaultAutostartLine(uploadedSource)
    }
    onRequestParse(uploadedSource)
  }

  async function handleSaveSource(): Promise<void> {
    onProcessingStart()

    try {
      const blob = new Blob([source], { type: `${sourceMimeType};charset=utf-8` })
      await saveFile(blob, `${downloadBaseName(programName)}.txt`, [
        {
          description: 'ZX BASIC source file',
          accept: {
            [sourceMimeType]: ['.txt', '.bas'],
          },
        },
      ])
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to save source file.')
    } finally {
      onProcessingEnd()
    }
  }

  function handleOpenExportDialog(nextSource = source): void {
    onProcessingStart()

    try {
      const { lineNumbers } = parseProgramForExport(nextSource)

      if (!autostartEnabled) {
        setAutostartLine(defaultAutostartLineText(lineNumbers, nextSource, labelModeEnabled, labelStartLine))
      }

      onRequestParse(nextSource)
      setIsExportDialogOpen(true)
    } catch {
      onRequestParse(nextSource)
      setIsExportDialogOpen(false)
    }
  }

  function handleAutostartEnabledChange(nextAutostartEnabled: boolean): void {
    setAutostartEnabled(nextAutostartEnabled)

    if (!nextAutostartEnabled || !autostartEnabled) {
      setAutostartLine(defaultAutostartLine)
    }
  }

  async function handleConfirmExport(nextProgramName: string, selectedAutostartLine: number | null, updateImportedTap = false): Promise<void> {
    const storedTapProgramName = normalizeProgramName(nextProgramName)
    const downloadProgramName = dialect === 'zx81' || plus3DosExport ? normalizeDownloadProgramName(nextProgramName) : storedTapProgramName
    const shouldUpdateImportedTap = updateImportedTap && updateImportedTapAvailable && importedTapEdit !== null
    const downloadFileBaseName = shouldUpdateImportedTap ? fileStem(importedTapEdit.fileName) : downloadProgramName
    setIsExportDialogOpen(false)
    setProgramName(downloadProgramName)
    onProcessingStart()

    try {
      const { result } = parseProgramForExport(source)
      const output =
        dialect === 'zx81'
          ? createZx81PFile(result.ast, result.tokens, selectedAutostartLine === null ? undefined : { autostartLine: selectedAutostartLine })
          : plus3DosExport
            ? createPlus3DosFile(result.ast, result.tokens, selectedAutostartLine === null ? undefined : { autostartLine: selectedAutostartLine })
          : shouldUpdateImportedTap
            ? updateTapFileProgramEntry(
                importedTapEdit.bytes,
                result.ast,
                result.tokens,
                selectedAutostartLine === null
                  ? { blockIndex: importedTapEdit.entry.blockIndex, filename: storedTapProgramName }
                  : { autostartLine: selectedAutostartLine, blockIndex: importedTapEdit.entry.blockIndex, filename: storedTapProgramName },
              )
            : createTapFile(
                result.ast,
                result.tokens,
                selectedAutostartLine === null ? { filename: storedTapProgramName } : { filename: storedTapProgramName, autostartLine: selectedAutostartLine },
              )
      const outputBuffer = new ArrayBuffer(output.byteLength)
      new Uint8Array(outputBuffer).set(output)
      const blob = new Blob([outputBuffer], { type: programFileMimeType })
      const extension = programFileExtension(dialect, spectrumExportFormat)
      await saveFile(blob, `${downloadBaseName(downloadFileBaseName)}${extension}`, [
        {
          description: programFileDescription(dialect, spectrumExportFormat),
          accept: {
            [programFileMimeType]: [extension],
          },
        },
      ])
      onRequestParse()
    } catch (error) {
      onRequestParse()
      window.alert(error instanceof Error ? error.message : 'Unable to export program file.')
    } finally {
      onProcessingEnd()
    }
  }

  function parseProgramForExport(programSource: string) {
    const preprocessed = preprocessLabels(programSource, {
      enabled: labelModeEnabled,
      startLine: labelStartLine,
      increment: labelIncrement,
    })
    const result = parseZxBasic(preprocessed.source, { dialect, extensions })

    return {
      lineNumbers: result.ast.lines.map((line) => line.lineNumber).sort((left, right) => left - right),
      result,
    }
  }

  return {
    autostartEnabled,
    autostartLine: autostartEnabled ? autostartLine : defaultAutostartLine,
    updateImportedTapAvailable,
    updateImportedTapEnabled,
    clearImportedTapEdit,
    handleAutostartEnabledChange,
    handleCancelTapSelection,
    handleConfirmExport,
    handleConfirmTapSelection,
    handleOpenExportDialog,
    handleSaveSource,
    handleUploadSource,
    isExportDialogOpen,
    pendingTapSelection: pendingTapUpload ? { entries: pendingTapUpload.entries, fileName: pendingTapUpload.fileName } : null,
    programName,
    setAutostartLine,
    setUpdateImportedTapEnabled,
    setIsExportDialogOpen,
    setProgramName,
    updateDefaultAutostartLine,
  }
}

type PendingTapUpload = PendingTapSelection & {
  readonly bytes: Uint8Array
}

type ImportedTapEdit = {
  readonly bytes: Uint8Array
  readonly entry: TapFileEntry
  readonly fileName: string
}

type UploadedProgram = ImportedTapProgram & {
  readonly autostartLineInitialized?: boolean
}

type LoadUploadedSourceOptions = {
  readonly updateAutostartLine?: boolean
}

function normalizeProgramName(programName: string): string {
  const truncated = programName.slice(0, 10)
  return truncated.trim().length > 0 ? truncated : defaultProgramName
}

function normalizeUploadedProgramName(programName: string, dialect: BasicDialect): string {
  return dialect === 'zx81' ? normalizeDownloadProgramName(programName) : normalizeProgramName(programName)
}

function normalizeDownloadProgramName(programName: string): string {
  const trimmed = programName.trim()
  return trimmed.length > 0 ? trimmed : defaultProgramName
}

function fileStem(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.')
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName
}

function downloadBaseName(programName: string): string {
  const cleaned = programName
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '_')
    .split('')
    .filter((char) => char.charCodeAt(0) >= 32)
    .join('')

  return cleaned || 'zxbasic'
}

function firstBasicLineNumberText(source: string): string | null {
  for (const line of source.split('\n')) {
    const match = /^\s*(\d+)\b/.exec(line)
    if (match) {
      return match[1]
    }
  }

  return null
}

function defaultAutostartLineText(validAutostartLines: readonly number[], source: string, labelModeEnabled: boolean, labelStartLine: number): string {
  const firstParsedLine = validAutostartLines[0]
  if (firstParsedLine !== undefined) {
    return String(firstParsedLine)
  }

  return labelModeEnabled ? String(labelStartLine) : firstBasicLineNumberText(source) ?? fallbackAutostartLine
}

async function saveFile(blob: Blob, fileName: string, types: SaveFilePickerOptions['types']): Promise<void> {
  const showSaveFilePicker = (window as SaveFilePickerWindow).showSaveFilePicker

  if (showSaveFilePicker) {
    try {
      const handle = await showSaveFilePicker({
        suggestedName: fileName,
        types,
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
    }
  }

  downloadBlob(blob, fileName)
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
