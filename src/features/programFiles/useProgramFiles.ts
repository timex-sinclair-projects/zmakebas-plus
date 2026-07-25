import { useEffect, useRef, useState } from 'react'
import {
  importDockFileEntry,
  importTapFileEntry,
  type DecodedZx81Wav,
  type IZx81WavImportProgress,
  type ProgramFileEntry,
} from '../../formats'
import { waitForBrowserPaint } from '../../services/waitForBrowserPaint'
import {
  parseZxBasic,
  preprocessLabels,
  type BasicDialect,
  type BasicExtension,
} from '../../parser'
import { isSpectrumFamilyDialect } from '../../parser/dialects'
import type { Zx81TapeWorkspace } from '../zx81Tape/model/zx81TapeWorkspace'
import { createZx81WavProgramCatalog, zx81WavProgramEntryId } from '../zx81Tape/services/zx81WavProgramSelection'
import { saveFile } from './browserFileSave'
import { isDockExport, isPlus3DosExport, isWavExport, programFileDescription, programFileExtension, programFileSaveMimeType, type ProgramExportFormat } from './programFile'
import { createProgramFileOutput } from './programFileExport'
import { importProgramFile, uploadedZx81WavProgram } from './programFileImport'
import { defaultAutostartLineText, defaultProgramName, downloadBaseName, fallbackAutostartLine, fileStem, firstBasicLineNumberText, isAbortError, isZx81WavUpload, normalizeDownloadProgramName, normalizeProgramName, normalizeUploadedProgramName, wavImportStageLabel } from './programFileNames'
import type { ImportedProgramEdit, ImportedProgramFormat, ImportedZx81WavProgramSelection, PendingProgramFileSelection, PendingProgramFileUpload, UploadedProgram, WavImportProgress } from './programFileTypes'

export type { PendingProgramFileSelection, WavImportProgress } from './programFileTypes'

const sourceMimeType = 'text/plain'
const maximumWavUploadBytes = 128 * 1024 * 1024

type UseProgramFilesOptions = {
  readonly dialect: BasicDialect
  readonly extensions: readonly BasicExtension[]
  readonly labelIncrement: number
  readonly labelModeEnabled: boolean
  readonly labelStartLine: number
  readonly source: string
  readonly programExportFormat: ProgramExportFormat
  readonly validAutostartLines: readonly number[]
  readonly zx81CarrierRecoveryEnabled: boolean
  readonly zx81SignalConditioningEnabled: boolean
  readonly zx81SignalRestorationEnabled: boolean
  readonly onProcessingEnd: () => void
  readonly onProcessingStart: () => void
  readonly onError: (message: string) => void
  readonly onRequestParse: (source?: string) => void
  readonly onProgramExportFormatChange: (format: ProgramExportFormat) => void
  readonly onSourceLoadStarted: () => void
  readonly onSourceLoaded: (source: string) => void
  readonly onZx81TapeWorkspaceLoaded: (workspace: Zx81TapeWorkspace | null, sourceFile?: File | null) => void
}

type LoadUploadedSourceOptions = {
  readonly updateAutostartLine?: boolean
}

export type ProgramFilesState = {
  readonly autostartEnabled: boolean
  readonly autostartLine: string
  readonly canSelectAnotherZx81WavProgram: boolean
  readonly updateImportedFileAvailable: boolean
  readonly updateImportedFileEnabled: boolean
  readonly updateImportedFileFormatName: string
  readonly isExportDialogOpen: boolean
  readonly pendingProgramFileSelection: PendingProgramFileSelection | null
  readonly programName: string
  readonly wavImportProgress: WavImportProgress | null
  readonly cancelWavImport: () => void
  readonly handleAutostartEnabledChange: (enabled: boolean) => void
  readonly handleCancelProgramFileSelection: () => void
  readonly handleConfirmExport: (programName: string, autostartLine: number | null, updateImportedFile?: boolean) => Promise<void>
  readonly handleConfirmProgramFileSelection: (entryId: number) => Promise<void>
  readonly handleOpenExportDialog: (source?: string) => void
  readonly handleOpenZx81WavProgramSelection: () => void
  readonly handleSaveSource: () => Promise<void>
  readonly handleUploadSource: (file: File) => Promise<void>
  readonly clearImportedProgramFileEdit: () => void
  readonly setAutostartLine: (line: string) => void
  readonly setUpdateImportedProgramFileEnabled: (enabled: boolean) => void
  readonly setIsExportDialogOpen: (isOpen: boolean) => void
  readonly setProgramName: (programName: string) => void
  readonly refreshZx81WavProgramSelection: (programs: readonly DecodedZx81Wav[], selectedProgramId: string) => void
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
  onSourceLoadStarted,
  onSourceLoaded,
  onZx81TapeWorkspaceLoaded,
  source,
  programExportFormat,
  validAutostartLines,
  zx81CarrierRecoveryEnabled,
  zx81SignalConditioningEnabled,
  zx81SignalRestorationEnabled,
}: UseProgramFilesOptions): ProgramFilesState {
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false)
  const [programName, setProgramName] = useState(defaultProgramName)
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [autostartLine, setAutostartLine] = useState(firstBasicLineNumberText(source) ?? fallbackAutostartLine)
  const [pendingProgramFileUpload, setPendingProgramFileUpload] = useState<PendingProgramFileUpload | null>(null)
  const [importedProgramFileEdit, setImportedProgramFileEdit] = useState<ImportedProgramEdit | null>(null)
  const [importedZx81WavProgramSelection, setImportedZx81WavProgramSelection] = useState<ImportedZx81WavProgramSelection | null>(null)
  const [updateImportedProgramFileEnabled, setUpdateImportedProgramFileEnabled] = useState(false)
  const [wavImportProgress, setWavImportProgress] = useState<WavImportProgress | null>(null)
  const activeWavImport = useRef<AbortController | null>(null)
  const uploadInProgress = useRef(false)
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

  useEffect(() => () => activeWavImport.current?.abort(), [])

  function updateDefaultAutostartLine(nextSource: string): void {
    if (autostartEnabled) {
      return
    }

    setAutostartLine(defaultAutostartLineText(validAutostartLines, nextSource, labelModeEnabled, labelStartLine))
  }

  async function handleUploadSource(file: File): Promise<void> {
    if (uploadInProgress.current) {
      onError('A program file is already being loaded.')
      return
    }
    if (isZx81WavUpload(file, dialect) && file.size > maximumWavUploadBytes) {
      onError('ZX81 WAV upload is limited to 128 MB to protect browser memory.')
      return
    }

    const wavUpload = isZx81WavUpload(file, dialect)
    const wavImportController = wavUpload ? new AbortController() : null
    if (wavImportController) {
      activeWavImport.current = wavImportController
      updateWavImportProgress(file.name, 'Reading WAV', 0)
    }
    uploadInProgress.current = true
    onProcessingStart()

    try {
      onSourceLoadStarted()
      if (wavUpload) {
        // A decoded WAV retains the PCM samples and a large event/bit model. Release
        // the previous tape pane before allocating its replacement.
        onZx81TapeWorkspaceLoaded(null)
      }
      // Let React clear the old listing and paint the busy state before file I/O or
      // synchronous decoding starts, regardless of the imported program format.
      await waitForBrowserPaint()

      const uploaded = await readUploadedSource(file, wavImportController?.signal)
      if (!uploaded) {
        return
      }

      const uploadedProgramName = normalizeUploadedProgramName(uploaded.programName ?? fileStem(file.name), dialect)
      onZx81TapeWorkspaceLoaded(uploaded.tapeWorkspace ?? null, uploaded.tapeWorkspace ? file : null)
      loadUploadedSource(uploaded.source, uploadedProgramName, { updateAutostartLine: !uploaded.autostartLineInitialized })
    } catch (error) {
      if (!isAbortError(error)) {
        onError(error instanceof Error ? error.message : 'Unable to load source file.')
      }
    } finally {
      if (activeWavImport.current === wavImportController) {
        activeWavImport.current = null
        setWavImportProgress(null)
      }
      uploadInProgress.current = false
      onProcessingEnd()
    }
  }

  async function readUploadedSource(file: File, wavImportSignal?: AbortSignal): Promise<UploadedProgram | null> {
    const result = await importProgramFile(file, {
      dialect,
      onDecodeProgress: (progress) => updateWavDecodeProgress(file.name, progress),
      onProgramExportFormatChange,
      onReadProgress: (fraction) => updateWavImportProgress(file.name, 'Reading WAV', fraction * 10),
      signalCarrierRecoveryEnabled: zx81CarrierRecoveryEnabled,
      signalConditioningEnabled: zx81SignalConditioningEnabled,
      signalRestorationEnabled: zx81SignalRestorationEnabled,
      wavImportSignal,
    })

    if (result.kind === 'selection') {
      clearImportedProgramFileEdit()
      setPendingProgramFileUpload(result.selection)
      return null
    }

    if (result.importedEdit) {
      setImportedProgramFileEditContext(
        result.importedEdit.bytes,
        result.importedEdit.fileName,
        result.importedEdit.entry,
        result.importedEdit.format,
        result.program.source,
      )
    } else if (result.clearImportedEdit) {
      clearImportedProgramFileEdit()
    }
    return result.program
  }

  async function handleConfirmProgramFileSelection(entryId: number): Promise<void> {
    const pendingUpload = pendingProgramFileUpload
    if (!pendingUpload) {
      return
    }

    setPendingProgramFileUpload(null)
    if (pendingUpload.format === 'wav' && pendingUpload.initialSelectedEntryId === entryId) {
      return
    }
    onProcessingStart()

    try {
      onSourceLoadStarted()
      await waitForBrowserPaint()
      if (pendingUpload.format === 'wav') {
        const decoded = pendingUpload.programs[entryId]
        if (!decoded) {
          throw new Error('Unable to find the selected ZX81 WAV program.')
        }
        const uploaded = uploadedZx81WavProgram(decoded, pendingUpload.fileName)
        setImportedZx81WavProgramSelection({ ...pendingUpload, selectedEntryId: entryId })
        onZx81TapeWorkspaceLoaded(uploaded.tapeWorkspace ?? null, pendingUpload.sourceFile)
        const uploadedProgramName = normalizeUploadedProgramName(uploaded.programName ?? fileStem(pendingUpload.fileName), dialect)
        loadUploadedSource(uploaded.source, uploadedProgramName)
        return
      }

      const uploaded = pendingUpload.format === 'dck' ? importDockFileEntry(pendingUpload.bytes, entryId) : importTapFileEntry(pendingUpload.bytes, dialect, entryId)
      const entry = pendingUpload.entries.find((programFileEntry) => programFileEntry.id === entryId)
      if (entry) {
        setImportedProgramFileEditContext(pendingUpload.bytes, pendingUpload.fileName, entry, pendingUpload.format, uploaded.source)
      }
      loadUploadedSource(uploaded.source, normalizeUploadedProgramName(uploaded.programName ?? fileStem(pendingUpload.fileName), dialect), { updateAutostartLine: false })
    } catch (error) {
      onError(error instanceof Error ? error.message : `Unable to load ${pendingUpload.formatName} entry.`)
    } finally {
      onProcessingEnd()
    }
  }

  function handleCancelProgramFileSelection(): void {
    setPendingProgramFileUpload(null)
  }

  function cancelWavImport(): void {
    activeWavImport.current?.abort()
  }

  function updateWavDecodeProgress(fileName: string, progress: IZx81WavImportProgress): void {
    updateWavImportProgress(fileName, wavImportStageLabel(progress.stage), 10 + progress.fraction * 90)
  }

  function updateWavImportProgress(fileName: string, label: string, percent: number): void {
    const roundedPercent = Math.max(0, Math.min(100, Math.round(percent)))
    setWavImportProgress((current) => (
      current?.fileName === fileName && current.label === label && current.percent === roundedPercent
        ? current
        : { fileName, label, percent: roundedPercent }
    ))
  }

  function handleOpenZx81WavProgramSelection(): void {
    if (!importedZx81WavProgramSelection) return
    setPendingProgramFileUpload({
      ...importedZx81WavProgramSelection,
      initialSelectedEntryId: importedZx81WavProgramSelection.selectedEntryId,
      warningMessage: 'Loading a different entry replaces the current BASIC source and waveform edits.',
    })
  }

  function refreshZx81WavProgramSelection(programs: readonly DecodedZx81Wav[], selectedProgramId: string): void {
    setImportedZx81WavProgramSelection((currentSelection) => {
      if (!currentSelection) return null
      const catalog = createZx81WavProgramCatalog(programs)
      const selectedEntryId = zx81WavProgramEntryId(catalog, selectedProgramId)
      if (catalog.programs.length < 2 || selectedEntryId === null) return null
      return {
        ...currentSelection,
        entries: catalog.entries,
        programs: catalog.programs,
        selectedEntryId,
      }
    })
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
    setImportedZx81WavProgramSelection(null)
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
      const output = createProgramFileOutput({
        autostartLine: selectedAutostartLine,
        dialect,
        downloadProgramName,
        importedProgramFileEdit,
        program: result.ast,
        programExportFormat,
        storedProgramName,
        tokens: result.tokens,
        updateImportedFile: shouldUpdateImportedFile,
      })
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
    cancelWavImport,
    canSelectAnotherZx81WavProgram: importedZx81WavProgramSelection !== null,
    updateImportedFileAvailable,
    updateImportedFileEnabled: updateImportedProgramFileEnabled,
    updateImportedFileFormatName,
    clearImportedProgramFileEdit,
    handleAutostartEnabledChange,
    handleCancelProgramFileSelection,
    handleConfirmExport,
    handleConfirmProgramFileSelection,
    handleOpenExportDialog,
    handleOpenZx81WavProgramSelection,
    handleSaveSource,
    handleUploadSource,
    isExportDialogOpen,
    pendingProgramFileSelection: pendingProgramFileUpload
      ? {
          confirmLabel: pendingProgramFileUpload.confirmLabel,
          entries: pendingProgramFileUpload.entries,
          fileName: pendingProgramFileUpload.fileName,
          formatName: pendingProgramFileUpload.formatName,
          initialSelectedEntryId: pendingProgramFileUpload.initialSelectedEntryId,
          showFileName: pendingProgramFileUpload.showFileName,
          warningMessage: pendingProgramFileUpload.warningMessage,
        }
      : null,
    programName,
    refreshZx81WavProgramSelection,
    setAutostartLine,
    setUpdateImportedProgramFileEnabled,
    setIsExportDialogOpen,
    setProgramName,
    updateDefaultAutostartLine,
    wavImportProgress,
  }
}

