import { useState } from 'react'
import { isDockExport, isPlus3DosExport, isWavExport, programFileDescription, programFileExtension, programFileSaveMimeType, type ProgramExportFormat } from '../services/programFile'
import {
  createDockFile,
  createPlus3DosFile,
  createSpectrumWavFile,
  createTapFile,
  createZx81PFile,
  createZx81WavFile,
  importDockFileEntry,
  importTapFileEntry,
  importPFile,
  listDockFileEntries,
  listTapFileEntries,
  parseZxBasic,
  preprocessLabels,
  updateDockFileProgramEntry,
  updateTapFileProgramEntry,
  type BasicDialect,
  type BasicExtension,
  type ProgramFileEntry,
} from '../parser'
import { isSpectrumFamilyDialect } from '../parser/dialects'

const defaultProgramName = 'ZXBASIC'
const fallbackAutostartLine = '10'
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
  readonly programExportFormat: ProgramExportFormat
  readonly validAutostartLines: readonly number[]
  readonly onProcessingEnd: () => void
  readonly onProcessingStart: () => void
  readonly onError: (message: string) => void
  readonly onRequestParse: (source?: string) => void
  readonly onProgramExportFormatChange: (format: ProgramExportFormat) => void
  readonly onSourceLoaded: (source: string) => void
}

export type PendingProgramFileSelection = {
  readonly confirmLabel?: string
  readonly entries: readonly ProgramFileEntry[]
  readonly formatName: string
  readonly fileName: string
  readonly showFileName?: boolean
  readonly warningMessage?: string
}

export type ProgramFilesState = {
  readonly autostartEnabled: boolean
  readonly autostartLine: string
  readonly updateImportedFileAvailable: boolean
  readonly updateImportedFileEnabled: boolean
  readonly updateImportedFileFormatName: string
  readonly isExportDialogOpen: boolean
  readonly pendingProgramFileSelection: PendingProgramFileSelection | null
  readonly programName: string
  readonly handleAutostartEnabledChange: (enabled: boolean) => void
  readonly handleCancelProgramFileSelection: () => void
  readonly handleConfirmExport: (programName: string, autostartLine: number | null, updateImportedFile?: boolean) => Promise<void>
  readonly handleConfirmProgramFileSelection: (entryId: number) => Promise<void>
  readonly handleOpenExportDialog: (source?: string) => void
  readonly handleSaveSource: () => Promise<void>
  readonly handleUploadSource: (file: File) => Promise<void>
  readonly clearImportedProgramFileEdit: () => void
  readonly setAutostartLine: (line: string) => void
  readonly setUpdateImportedProgramFileEnabled: (enabled: boolean) => void
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
  onError,
  onRequestParse,
  onProgramExportFormatChange,
  onSourceLoaded,
  source,
  programExportFormat,
  validAutostartLines,
}: UseProgramFilesOptions): ProgramFilesState {
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false)
  const [programName, setProgramName] = useState(defaultProgramName)
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [autostartLine, setAutostartLine] = useState(firstBasicLineNumberText(source) ?? fallbackAutostartLine)
  const [pendingProgramFileUpload, setPendingProgramFileUpload] = useState<PendingProgramFileUpload | null>(null)
  const [importedProgramFileEdit, setImportedProgramFileEdit] = useState<ImportedProgramEdit | null>(null)
  const [updateImportedProgramFileEnabled, setUpdateImportedProgramFileEnabled] = useState(false)
  const defaultAutostartLine = defaultAutostartLineText(validAutostartLines, source, labelModeEnabled, labelStartLine)
  const plus3DosExport = isPlus3DosExport(dialect, programExportFormat)
  const dockExport = isDockExport(dialect, programExportFormat)
  const wavExport = isWavExport(dialect, programExportFormat)
  const updateImportedFileAvailable =
    importedProgramFileEdit !== null &&
    isSpectrumFamilyDialect(dialect) &&
    !plus3DosExport &&
    !wavExport &&
    ((importedProgramFileEdit.format === 'tap' && !dockExport) || (importedProgramFileEdit.format === 'dck' && dockExport))
  const updateImportedFileFormatName = importedProgramFileEdit?.format === 'dck' ? 'DCK' : 'TAP'

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
      onError(error instanceof Error ? error.message : 'Unable to load source file.')
      onProcessingEnd()
    }
  }

  async function readUploadedSource(file: File): Promise<UploadedProgram | null> {
    const lowerFileName = file.name.toLowerCase()
    if (!lowerFileName.endsWith('.tap')) {
      if (lowerFileName.endsWith('.dck')) {
        if (dialect !== 'ts2068') {
          throw new Error('DCK upload is supported in TS2068 mode.')
        }

        onProgramExportFormatChange('dck')
        const bytes = new Uint8Array(await file.arrayBuffer())
        const entries = listDockFileEntries(bytes)
        const entry = entries.find((programFileEntry) => programFileEntry.loadable)
        if (entries.length > 1 || !entry) {
          clearImportedProgramFileEdit()
          setPendingProgramFileUpload({
            bytes,
            confirmLabel: entry ? undefined : 'OK',
            entries,
            fileName: file.name,
            format: 'dck',
            formatName: 'DCK',
            showFileName: entry !== undefined,
            warningMessage: entry ? undefined : 'This DCK file does not include a BASIC AROS program.',
          })
          return null
        }

        const uploaded = importDockFileEntry(bytes, entry.id)
        setImportedProgramFileEditContext(bytes, file.name, entry, 'dck', uploaded.source)
        return { ...uploaded, autostartLineInitialized: true }
      }

      if (lowerFileName.endsWith('.p')) {
        if (dialect !== 'zx81') {
          throw new Error('P file upload is supported in ZX81 mode.')
        }

        clearImportedProgramFileEdit()
        const uploaded = importPFile(new Uint8Array(await file.arrayBuffer()))
        return {
          programName: null,
          source: uploaded.source,
        }
      }

      clearImportedProgramFileEdit()
      return {
        programName: null,
        source: await file.text(),
      }
    }

    if (!isSpectrumFamilyDialect(dialect)) {
      throw new Error('TAP upload is supported in ZX Spectrum and TS2068 modes.')
    }

    onProgramExportFormatChange('tap')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const entries = listTapFileEntries(bytes)
    const entry = entries.find((programFileEntry) => programFileEntry.loadable)
    if (entries.length > 1 || !entry) {
      clearImportedProgramFileEdit()
      setPendingProgramFileUpload({
        bytes,
        confirmLabel: entry ? undefined : 'OK',
        entries,
        fileName: file.name,
        format: 'tap',
        formatName: 'TAP',
        showFileName: entry !== undefined,
        warningMessage: entry ? undefined : 'This TAP file does not include a BASIC program.',
      })
      return null
    }

    const uploaded = importTapFileEntry(bytes, dialect, entry.id)
    setImportedProgramFileEditContext(bytes, file.name, entry, 'tap', uploaded.source)
    return { ...uploaded, autostartLineInitialized: true }
  }

  async function handleConfirmProgramFileSelection(entryId: number): Promise<void> {
    const pendingUpload = pendingProgramFileUpload
    if (!pendingUpload) {
      return
    }

    setPendingProgramFileUpload(null)
    onProcessingStart()

    try {
      const uploaded = pendingUpload.format === 'dck' ? importDockFileEntry(pendingUpload.bytes, entryId) : importTapFileEntry(pendingUpload.bytes, dialect, entryId)
      const entry = pendingUpload.entries.find((programFileEntry) => programFileEntry.id === entryId)
      if (entry) {
        setImportedProgramFileEditContext(pendingUpload.bytes, pendingUpload.fileName, entry, pendingUpload.format, uploaded.source)
      }
      loadUploadedSource(uploaded.source, normalizeUploadedProgramName(uploaded.programName ?? fileStem(pendingUpload.fileName), dialect), { updateAutostartLine: false })
    } catch (error) {
      onError(error instanceof Error ? error.message : `Unable to load ${pendingUpload.formatName} entry.`)
      onProcessingEnd()
    }
  }

  function handleCancelProgramFileSelection(): void {
    setPendingProgramFileUpload(null)
  }

  function setImportedProgramFileEditContext(bytes: Uint8Array, fileName: string, entry: ProgramFileEntry, format: ImportedProgramFormat, uploadedSource: string): void {
    setImportedProgramFileEdit({ bytes, entry, fileName, format })
    setUpdateImportedProgramFileEnabled(true)
    if (entry.autostartLine !== null) {
      setAutostartEnabled(true)
      setAutostartLine(String(entry.autostartLine))
    } else if (entry.autostart) {
      setAutostartEnabled(true)
      setAutostartLine(firstBasicLineNumberText(uploadedSource) ?? fallbackAutostartLine)
    } else {
      setAutostartEnabled(false)
    }
  }

  function clearImportedProgramFileEdit(): void {
    setImportedProgramFileEdit(null)
    setUpdateImportedProgramFileEnabled(false)
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
      onError(error instanceof Error ? error.message : 'Unable to save source file.')
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

  async function handleConfirmExport(nextProgramName: string, selectedAutostartLine: number | null, updateImportedFile = false): Promise<void> {
    const storedProgramName = normalizeProgramName(nextProgramName)
    const downloadProgramName = dialect === 'zx81' || plus3DosExport || dockExport ? normalizeDownloadProgramName(nextProgramName) : storedProgramName
    const shouldUpdateImportedFile = updateImportedFile && updateImportedFileAvailable && importedProgramFileEdit !== null
    const downloadFileBaseName = shouldUpdateImportedFile ? fileStem(importedProgramFileEdit.fileName) : downloadProgramName
    setIsExportDialogOpen(false)
    setProgramName(downloadProgramName)
    onProcessingStart()

    try {
      const { result } = parseProgramForExport(source)
      const output =
        dialect === 'zx81'
          ? wavExport
            ? createZx81WavFile(createZx81PFile(result.ast, result.tokens, selectedAutostartLine === null ? undefined : { autostartLine: selectedAutostartLine }), downloadProgramName)
            : createZx81PFile(result.ast, result.tokens, selectedAutostartLine === null ? undefined : { autostartLine: selectedAutostartLine })
          : wavExport
            ? createSpectrumWavFile(
                createTapFile(
                  result.ast,
                  result.tokens,
                  selectedAutostartLine === null ? { filename: storedProgramName } : { filename: storedProgramName, autostartLine: selectedAutostartLine },
                ),
              )
          : plus3DosExport
            ? createPlus3DosFile(result.ast, result.tokens, selectedAutostartLine === null ? undefined : { autostartLine: selectedAutostartLine })
          : dockExport
            ? shouldUpdateImportedFile && importedProgramFileEdit.format === 'dck'
              ? updateDockFileProgramEntry(importedProgramFileEdit.bytes, result.ast, result.tokens, { autostart: selectedAutostartLine !== null, blockIndex: importedProgramFileEdit.entry.blockIndex })
              : createDockFile(result.ast, result.tokens, { autostart: selectedAutostartLine !== null })
          : shouldUpdateImportedFile
            ? updateTapFileProgramEntry(
                importedProgramFileEdit.bytes,
                result.ast,
                result.tokens,
                selectedAutostartLine === null
                  ? { blockIndex: importedProgramFileEdit.entry.blockIndex, filename: storedProgramName }
                  : { autostartLine: selectedAutostartLine, blockIndex: importedProgramFileEdit.entry.blockIndex, filename: storedProgramName },
              )
            : createTapFile(
                result.ast,
                result.tokens,
                selectedAutostartLine === null ? { filename: storedProgramName } : { filename: storedProgramName, autostartLine: selectedAutostartLine },
              )
      const outputBuffer = new ArrayBuffer(output.byteLength)
      new Uint8Array(outputBuffer).set(output)
      const mimeType = programFileSaveMimeType(dialect, programExportFormat)
      const blob = new Blob([outputBuffer], { type: mimeType })
      const extension = programFileExtension(dialect, programExportFormat)
      await saveFile(blob, `${downloadBaseName(downloadFileBaseName)}${extension}`, [
        {
          description: programFileDescription(dialect, programExportFormat),
          accept: {
            [mimeType]: [extension],
          },
        },
      ])
      onRequestParse()
    } catch (error) {
      onRequestParse()
      onError(error instanceof Error ? error.message : 'Unable to export program file.')
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
    updateImportedFileAvailable,
    updateImportedFileEnabled: updateImportedProgramFileEnabled,
    updateImportedFileFormatName,
    clearImportedProgramFileEdit,
    handleAutostartEnabledChange,
    handleCancelProgramFileSelection,
    handleConfirmExport,
    handleConfirmProgramFileSelection,
    handleOpenExportDialog,
    handleSaveSource,
    handleUploadSource,
    isExportDialogOpen,
    pendingProgramFileSelection: pendingProgramFileUpload
      ? {
          confirmLabel: pendingProgramFileUpload.confirmLabel,
          entries: pendingProgramFileUpload.entries,
          fileName: pendingProgramFileUpload.fileName,
          formatName: pendingProgramFileUpload.formatName,
          showFileName: pendingProgramFileUpload.showFileName,
          warningMessage: pendingProgramFileUpload.warningMessage,
        }
      : null,
    programName,
    setAutostartLine,
    setUpdateImportedProgramFileEnabled,
    setIsExportDialogOpen,
    setProgramName,
    updateDefaultAutostartLine,
  }
}

type ImportedProgramFormat = 'tap' | 'dck'

type PendingProgramFileUpload = PendingProgramFileSelection & {
  readonly bytes: Uint8Array
  readonly format: ImportedProgramFormat
}

type ImportedProgramEdit = {
  readonly bytes: Uint8Array
  readonly entry: ProgramFileEntry
  readonly format: ImportedProgramFormat
  readonly fileName: string
}

type UploadedProgram = {
  readonly autostartLineInitialized?: boolean
  readonly programName: string | null
  readonly source: string
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
