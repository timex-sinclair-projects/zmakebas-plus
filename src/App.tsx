import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Collapse from 'react-bootstrap/Collapse'
import Container from 'react-bootstrap/Container'
import './App.scss'
import { AlertDialog } from './components/AlertDialog'
import { ParserHeader } from './components/ParserHeader'
import { ParserOptionsPane } from './components/ParserOptionsPane'
import { ParserResults } from './components/ParserResults'
import { ParserStatusAlert } from './components/ParserStatusAlert'
import { ReplaceSourceDialog, type ReplaceSourceAction } from './components/ReplaceSourceDialog'
import { SourcePanel } from './components/SourcePanel'
import { formatBasicSource } from './editor/formatBasicSource'
import { renumberBasicSource } from './editor/renumberBasicSource'
import type { LineNavigationRequest, ParseState, SourceCursorPosition, SourceDiagnostic, SourceNavigationRequest, SourceRangeNavigationRequest } from './editor/types'
import { useBusyIndicator } from './hooks/useBusyIndicator'
import { usePreference } from './hooks/usePreference'
import { ExportDialog } from './features/programFiles/ExportDialog'
import { ProgramFileSelectionDialog } from './features/programFiles/ProgramFileSelectionDialog'
import { useProgramFiles, type ProgramFilesState } from './features/programFiles/useProgramFiles'
import { Zx81WavImportProgress } from './features/programFiles/Zx81WavImportProgress'
import { Zx81TapePane } from './features/zx81Tape/components/Zx81TapePane'
import { useZx81TapeController } from './features/zx81Tape/hooks/useZx81TapeController'
import { useZxBasicParser } from './hooks/useZxBasicParser'
import type { BasicDialect, BasicExtension, LabelSourceMap, Token } from './parser'
import { isBuiltInSampleProgram, normalizeSampleSource, sampleProgramForDialect } from './services/sampleProgram'

const noTokens: readonly Token[] = []

function App() {
  const { isProcessing, startProcessing, stopProcessing } = useBusyIndicator()
  const startParserProcessing = useCallback(() => startProcessing('parser'), [startProcessing])
  const stopParserProcessing = useCallback(() => stopProcessing('parser'), [stopProcessing])
  const startProgramFileProcessing = useCallback(() => startProcessing('program-file'), [startProcessing])
  const stopProgramFileProcessing = useCallback(() => stopProcessing('program-file'), [stopProcessing])
  const startResultsProcessing = useCallback(() => startProcessing('results'), [startProcessing])
  const stopResultsProcessing = useCallback(() => stopProcessing('results'), [stopProcessing])
  const startTapeRedecodeProcessing = useCallback(() => startProcessing('tape-redecode'), [startProcessing])
  const stopTapeRedecodeProcessing = useCallback(() => stopProcessing('tape-redecode'), [stopProcessing])
  const {
    automaticParsingEnabled,
    dialect,
    labelIncrement,
    labelModeEnabled,
    labelStartLine,
    parseState,
    parsedSource,
    requestParse,
    setAutomaticParsingEnabled,
    setDialect,
    setSpectranetEnabled,
    setLabelIncrement,
    setLabelModeEnabled,
    setLabelStartLine,
    setSource,
    source,
    sourceMap,
    spectranetEnabled,
    validAutostartLines,
  } = useZxBasicParser({
    isProcessing,
    onProcessingEnd: stopParserProcessing,
    onProcessingStart: startParserProcessing,
  })
  const sourceDraftRef = useRef(source)
  const [hasUnparsedDraft, setHasUnparsedDraft] = useState(false)
  const [sourceNavigation, setSourceNavigation] = useState<SourceNavigationRequest | null>(null)
  const [sourceRangeNavigation, setSourceRangeNavigation] = useState<SourceRangeNavigationRequest | null>(null)
  const [resultsNavigation, setResultsNavigation] = useState<LineNavigationRequest | null>(null)
  const [showResults, setShowResults] = useState(false)
  const [optionsCollapsed, setOptionsCollapsed] = usePreference('optionsCollapsed')
  const [cursorPosition, setCursorPosition] = useState<SourceCursorPosition>({ line: 1, column: 1 })
  const [pendingReplaceSourceAction, setPendingReplaceSourceAction] = useState<ReplaceSourceAction | null>(null)
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null)
  const confirmedReplaceSourceRef = useRef<{ readonly action: ReplaceSourceAction; readonly uploadFile: File | null } | null>(null)
  const [screenWrapHintsEnabled, setScreenWrapHintsEnabled] = usePreference('screenWrapHintsEnabled')
  const [screenWidth, setScreenWidth] = usePreference('screenWidth')
  const [programExportFormat, setProgramExportFormat] = usePreference('programExportFormat')
  const [formatterKeywordCase, setFormatterKeywordCase] = usePreference('formatterKeywordCase')
  const [optionsSectionCollapsed, setOptionsSectionCollapsed] = usePreference('optionsSectionCollapsed')
  const [alertMessage, setAlertMessage] = useState<string | null>(null)
  const extensions = useMemo<readonly BasicExtension[]>(() => (dialect === 'spectrum' && spectranetEnabled ? ['spectranet'] : []), [dialect, spectranetEnabled])
  const sourceDiagnostic = useMemo(() => (source === parsedSource ? parseStateToSourceDiagnostic(parseState) : null), [parseState, parsedSource, source])
  const diagnosticsVisible = showResults && parseState.ok
  const programFilesRef = useRef<ProgramFilesState | null>(null)
  const tapeController = useZx81TapeController({
    sourceDraftRef,
    onApplySourceToEditor: (tapeSource) => {
      commitSource(tapeSource, {
        clearNavigationAfterCommit: true,
        requestParseAfterCommit: true,
        startProcessingBeforeCommit: true,
      })
    },
    onError: setAlertMessage,
    onProcessingEnd: stopTapeRedecodeProcessing,
    onProcessingStart: startTapeRedecodeProcessing,
    onRefreshProgramSelection: (programs, selectedProgramId) => {
      programFilesRef.current?.refreshZx81WavProgramSelection(programs, selectedProgramId)
    },
  })
  const programFiles = useProgramFiles({
    dialect,
    extensions,
    labelIncrement,
    labelModeEnabled,
    labelStartLine,
    source,
    programExportFormat,
    validAutostartLines,
    zx81CarrierRecoveryEnabled: tapeController.carrierRecoveryEnabled,
    zx81SignalConditioningEnabled: tapeController.signalConditioningEnabled,
    zx81SignalRestorationEnabled: tapeController.signalRestorationEnabled,
    onProcessingEnd: stopProgramFileProcessing,
    onProcessingStart: startProgramFileProcessing,
    onError: setAlertMessage,
    onRequestParse: requestParse,
    onProgramExportFormatChange: setProgramExportFormat,
    onSourceLoadStarted: () => {
      commitSource('', {
        clearNavigationAfterCommit: true,
        updateAutostartLine: false,
      })
    },
    onSourceLoaded: (nextSource) => {
      commitSource(nextSource, {
        clearNavigationAfterCommit: true,
        markDraftParsed: true,
        updateAutostartLine: false,
      })
    },
    onZx81TapeWorkspaceLoaded: tapeController.loadWorkspace,
  })

  useEffect(() => {
    programFilesRef.current = programFiles
  }, [programFiles])

  useEffect(() => {
    if (sourceDraftRef.current === parsedSource) {
      setHasUnparsedDraft(false)
    }
  }, [parsedSource])

  function clearNavigation(): void {
    setSourceNavigation(null)
    setSourceRangeNavigation(null)
    setResultsNavigation(null)
  }

  function handleSourceChange(nextSource: string): void {
    commitSource(nextSource, { clearNavigationAfterCommit: true })
  }

  function handleReplaceSource(nextSource: string): void {
    programFiles.clearImportedProgramFileEdit()
    tapeController.loadWorkspace(null)
    commitSource(nextSource, {
      clearNavigationAfterCommit: true,
      requestParseAfterCommit: true,
      startProcessingBeforeCommit: true,
    })
  }

  function handleRequestReplaceSource(action: ReplaceSourceAction): void {
    if (tapeController.rejectActionDuringRedecode()) return
    if (!shouldWarnBeforeReplacingSource(sourceDraftRef.current)) {
      replaceSourceWithoutWarning(action)
      return
    }

    setPendingReplaceSourceAction(action)
  }

  function handleRequestUploadSource(file: File): void {
    if (tapeController.rejectActionDuringRedecode()) return
    if (!shouldWarnBeforeReplacingSource(sourceDraftRef.current)) {
      void programFiles.handleUploadSource(file)
      return
    }

    setPendingUploadFile(file)
    setPendingReplaceSourceAction('upload')
  }

  function handleConfirmReplaceSource(): void {
    const action = pendingReplaceSourceAction
    const uploadFile = pendingUploadFile
    if (action === null) {
      return
    }
    confirmedReplaceSourceRef.current = { action, uploadFile }
    setPendingReplaceSourceAction(null)
    setPendingUploadFile(null)
  }

  function handleCancelReplaceSource(): void {
    confirmedReplaceSourceRef.current = null
    setPendingReplaceSourceAction(null)
    setPendingUploadFile(null)
  }

  function handleReplaceSourceDialogExited(): void {
    const confirmedAction = confirmedReplaceSourceRef.current
    confirmedReplaceSourceRef.current = null
    if (confirmedAction) {
      replaceSourceWithoutWarning(confirmedAction.action, confirmedAction.uploadFile)
    }
  }

  function replaceSourceWithoutWarning(action: ReplaceSourceAction | null, uploadFile: File | null = null): void {
    if (action === 'sample') {
      handleReplaceSource(sampleProgramForDialect(dialect))
    }

    if (action === 'clear') {
      handleReplaceSource('')
    }

    if (action === 'upload' && uploadFile) {
      void programFiles.handleUploadSource(uploadFile)
    }
  }

  function handleRefreshParse(nextSource = source): void {
    commitSource(nextSource, {
      requestParseAfterCommit: true,
      startProcessingBeforeCommit: true,
    })
  }

  function handleFormatSource(): void {
    const formattedSource = formatBasicSource(sourceDraftRef.current, { dialect, extensions, keywordCase: formatterKeywordCase })
    commitSource(formattedSource, {
      clearNavigationAfterCommit: true,
      requestParseAfterCommit: true,
      startProcessingBeforeCommit: true,
    })
  }

  function handleRenumberSource(): void {
    if (!parseState.ok || hasUnparsedDraft) {
      return
    }

    try {
      const renumberedSource = renumberBasicSource(sourceDraftRef.current, {
        ast: parseState.ast,
        labelIncrement,
        labelStartLine,
        sourceMap,
      })
      commitSource(renumberedSource, {
        clearNavigationAfterCommit: true,
        requestParseAfterCommit: true,
        startProcessingBeforeCommit: true,
      })
    } catch (error) {
      setAlertMessage(error instanceof Error ? error.message : 'Unable to renumber source.')
    }
  }

  function handleOpenExportDialog(): void {
    const nextSource = sourceDraftRef.current
    commitSource(nextSource, {
      markDraftParsed: true,
      updateAutostartLine: false,
    })
    programFiles.handleOpenExportDialog(nextSource)
  }

  function handleGotoError(): void {
    if (!parseState.ok && parseState.line && parseState.column) {
      setSourceNavigation({
        id: Date.now(),
        line: parseState.line,
        column: parseState.column,
        endColumn: parseState.endColumn,
      })
    }
  }

  function handleSourceGotoLine(lineNumber: number): void {
    if (!diagnosticsVisible || !parseState.ok) {
      return
    }

    const targetLine = labelModeEnabled ? findClosestGeneratedLineForOriginalLine(sourceMap, lineNumber) : lineNumber
    if (targetLine === null) {
      return
    }

    setResultsNavigation({
      id: Date.now(),
      line: targetLine,
    })
  }

  function handleShowResultsChange(nextShowResults: boolean): void {
    setShowResults(nextShowResults && parseState.ok)

    if (!nextShowResults) {
      setResultsNavigation(null)
    }
  }

  function handleAutomaticParsingEnabledChange(nextEnabled: boolean): void {
    setAutomaticParsingEnabled(nextEnabled)

    if (!nextEnabled) {
      return
    }

    const nextSource = sourceDraftRef.current
    commitSource(nextSource, {
      requestParseAfterCommit: true,
      startProcessingBeforeCommit: true,
    })
  }

  function handleDialectChange(nextDialect: BasicDialect): void {
    if (nextDialect === dialect) {
      return
    }
    if (tapeController.rejectActionDuringRedecode()) return

    if (automaticParsingEnabled) {
      startParserProcessing()
    }
    programFiles.clearImportedProgramFileEdit()
    tapeController.loadWorkspace(null)
    if (
      (nextDialect === 'spectrum' && programExportFormat === 'dck') ||
      (nextDialect === 'ts2068' && programExportFormat === 'plus3dos') ||
      (nextDialect === 'zx81' && (programExportFormat === 'plus3dos' || programExportFormat === 'dck'))
    ) {
      setProgramExportFormat('tap')
    }
    if (isBuiltInSampleProgram(sourceDraftRef.current)) {
      commitSource(sampleProgramForDialect(nextDialect), { clearNavigationAfterCommit: true })
    }
    setDialect(nextDialect)
    clearNavigation()
  }

  function handleLabelModeEnabledChange(nextEnabled: boolean): void {
    if (automaticParsingEnabled) {
      startParserProcessing()
    }
    setLabelModeEnabled(nextEnabled)
    clearNavigation()
  }

  function handleLabelStartLineChange(nextStartLine: number): void {
    if (automaticParsingEnabled) {
      startParserProcessing()
    }
    setLabelStartLine(nextStartLine)
    clearNavigation()
  }

  function handleLabelIncrementChange(nextIncrement: number): void {
    if (automaticParsingEnabled) {
      startParserProcessing()
    }
    setLabelIncrement(nextIncrement)
    clearNavigation()
  }

  function handleSpectranetEnabledChange(nextEnabled: boolean): void {
    if (automaticParsingEnabled) {
      startParserProcessing()
    }
    setSpectranetEnabled(nextEnabled)
    clearNavigation()
  }

  function commitSource(nextSource: string, options: SourceCommitOptions = {}): void {
    const {
      clearNavigationAfterCommit = false,
      markDraftParsed = false,
      requestParseAfterCommit = false,
      startProcessingBeforeCommit = false,
      updateAutostartLine = true,
    } = options

    sourceDraftRef.current = nextSource
    setHasUnparsedDraft(markDraftParsed || requestParseAfterCommit ? false : nextSource !== parsedSource)

    if (startProcessingBeforeCommit) {
      startParserProcessing()
    }

    setSource(nextSource)

    if (clearNavigationAfterCommit) {
      clearNavigation()
    }

    if (updateAutostartLine) {
      programFiles.updateDefaultAutostartLine(nextSource)
    }

    if (requestParseAfterCommit) {
      requestParse(nextSource)
    }
  }

  return (
    <main className={`app-shell${isProcessing ? ' is-processing' : ''}`} aria-busy={isProcessing}>
      <Container fluid className="workspace">
        <ParserHeader
          dialect={dialect}
          canDownloadProgram={parseState.ok && !hasUnparsedDraft}
          optionsCollapsed={optionsCollapsed}
          programExportFormat={programExportFormat}
          onOptionsToggle={() => setOptionsCollapsed(!optionsCollapsed)}
          onLoadSample={() => handleRequestReplaceSource('sample')}
          onClear={() => handleRequestReplaceSource('clear')}
          onUploadSource={handleRequestUploadSource}
          onSaveSource={() => {
            void programFiles.handleSaveSource()
          }}
          onDownloadProgram={handleOpenExportDialog}
        />
        {programFiles.wavImportProgress ? (
          <Zx81WavImportProgress
            progress={programFiles.wavImportProgress}
            onCancel={programFiles.cancelWavImport}
          />
        ) : null}
        <ReplaceSourceDialog
          action={pendingReplaceSourceAction}
          onCancel={handleCancelReplaceSource}
          onConfirm={handleConfirmReplaceSource}
          onExited={handleReplaceSourceDialogExited}
        />
        <AlertDialog message={alertMessage} onClose={() => setAlertMessage(null)} />
        <ExportDialog
          autostartEnabled={programFiles.autostartEnabled}
          autostartLine={programFiles.autostartLine}
          dialect={dialect}
          programName={programFiles.programName}
          show={programFiles.isExportDialogOpen}
          programExportFormat={programExportFormat}
          updateImportedFileAvailable={programFiles.updateImportedFileAvailable}
          updateImportedFileEnabled={programFiles.updateImportedFileEnabled}
          updateImportedFileFormatName={programFiles.updateImportedFileFormatName}
          validAutostartLines={validAutostartLines}
          onCancel={() => programFiles.setIsExportDialogOpen(false)}
          onAutostartEnabledChange={programFiles.handleAutostartEnabledChange}
          onAutostartLineChange={programFiles.setAutostartLine}
          onProgramNameChange={programFiles.setProgramName}
          onUpdateImportedFileEnabledChange={programFiles.setUpdateImportedProgramFileEnabled}
          onConfirm={(programName, autostartLine, updateImportedFile) => {
            void programFiles.handleConfirmExport(programName, autostartLine, updateImportedFile)
          }}
        />
        {programFiles.pendingProgramFileSelection ? (
          <ProgramFileSelectionDialog
            confirmLabel={programFiles.pendingProgramFileSelection.confirmLabel}
            entries={programFiles.pendingProgramFileSelection.entries}
            formatName={programFiles.pendingProgramFileSelection.formatName}
            fileName={programFiles.pendingProgramFileSelection.fileName}
            initialSelectedEntryId={programFiles.pendingProgramFileSelection.initialSelectedEntryId}
            showFileName={programFiles.pendingProgramFileSelection.showFileName}
            show
            warningMessage={programFiles.pendingProgramFileSelection.warningMessage}
            onCancel={programFiles.handleCancelProgramFileSelection}
            onConfirm={(entryId) => {
              void programFiles.handleConfirmProgramFileSelection(entryId)
            }}
          />
        ) : null}

        <div className={`editor-shell${optionsCollapsed ? ' options-collapsed' : ''}${diagnosticsVisible ? ' diagnostics-open' : ''}`}>
          <div className="options-pane-slot">
            <Collapse in={!optionsCollapsed} dimension="width" mountOnEnter unmountOnExit>
              <div className="options-pane-collapse">
                <ParserOptionsPane
                  automaticParsingEnabled={automaticParsingEnabled}
                  canShowDiagnostics={parseState.ok}
                  dialect={dialect}
                  diagnosticsOpen={diagnosticsVisible}
                  formatterKeywordCase={formatterKeywordCase}
                  labelIncrement={labelIncrement}
                  labelModeEnabled={labelModeEnabled}
                  labelStartLine={labelStartLine}
                  optionsSectionCollapsed={optionsSectionCollapsed}
                  screenWidth={screenWidth}
                  screenWrapHintsEnabled={screenWrapHintsEnabled}
                  spectranetEnabled={spectranetEnabled}
                  programExportFormat={programExportFormat}
                  onAutomaticParsingEnabledChange={handleAutomaticParsingEnabledChange}
                  onDiagnosticsOpenChange={handleShowResultsChange}
                  onDialectChange={handleDialectChange}
                  onFormatterKeywordCaseChange={setFormatterKeywordCase}
                  onLabelIncrementChange={handleLabelIncrementChange}
                  onLabelModeEnabledChange={handleLabelModeEnabledChange}
                  onLabelStartLineChange={handleLabelStartLineChange}
                  onOptionsSectionCollapsedChange={setOptionsSectionCollapsed}
                  onScreenWidthChange={setScreenWidth}
                  onScreenWrapHintsEnabledChange={setScreenWrapHintsEnabled}
                  onSpectranetEnabledChange={handleSpectranetEnabledChange}
                  onProgramExportFormatChange={setProgramExportFormat}
                  onValidate={() => handleRefreshParse(sourceDraftRef.current)}
                />
              </div>
            </Collapse>
          </div>
          <div className="editor-stack">
            {diagnosticsVisible ? (
              <div className="diagnostics-workspace" aria-label="Diagnostics">
                <ParserResults
                  labelModeEnabled={labelModeEnabled}
                  navigationRequest={parseState.ok ? resultsNavigation : null}
                  parseState={parseState}
                  onProcessingStart={startResultsProcessing}
                  onProcessingEnd={stopResultsProcessing}
                />
              </div>
            ) : (
              <>
                <SourcePanel
                  source={source}
                  dialect={dialect}
                  extensions={extensions}
                  sourceMap={source === parsedSource && parseState.ok ? sourceMap : null}
                  tokens={source === parsedSource && parseState.ok ? parseState.tokens : noTokens}
                  diagnostic={sourceDiagnostic}
                  gotoLineMode={labelModeEnabled ? 'source' : 'basic'}
                  navigationRequest={sourceNavigation}
                  rangeNavigationRequest={sourceRangeNavigation}
                  screenWidth={screenWidth}
                  screenWrapHintsEnabled={screenWrapHintsEnabled}
                  showLineNumbers={labelModeEnabled}
                  canRenumberSource={parseState.ok && !hasUnparsedDraft}
                  onSourceDraftChange={(nextSource) => {
                    sourceDraftRef.current = nextSource
                    setHasUnparsedDraft(nextSource !== parsedSource)
                  }}
                  onSourceChange={handleSourceChange}
                  onCursorChange={setCursorPosition}
                  onFormatSource={handleFormatSource}
                  onRenumberSource={handleRenumberSource}
                  onGotoError={handleGotoError}
                  onGotoLine={handleSourceGotoLine}
                  onError={setAlertMessage}
                />
                {tapeController.workspace ? (
                  <Zx81TapePane
                    key={tapeController.workspace.id}
                    canSelectProgramEntry={programFiles.canSelectAnotherZx81WavProgram}
                    carrierRecoveryEnabled={tapeController.carrierRecoveryEnabled}
                    signalConditioningChangePending={tapeController.signalConditioningChangePending}
                    signalConditioningEnabled={tapeController.signalConditioningEnabled}
                    signalRestorationEnabled={tapeController.signalRestorationEnabled}
                    workspace={tapeController.workspace}
                    onApplySource={tapeController.applyWorkspaceSourceToEditor}
                    onCarrierRecoveryEnabledChange={tapeController.handleCarrierRecoveryEnabledChange}
                    onDeleteBit={tapeController.deleteBit}
                    onInsertBit={tapeController.insertBit}
                    onMergeBits={tapeController.mergeBits}
                    onRevealSourceRange={(start, end) => setSourceRangeNavigation({ id: Date.now(), start, end })}
                    onRedo={tapeController.redo}
                    onSelectProgramEntry={() => {
                      if (!tapeController.rejectActionDuringRedecode()) programFiles.handleOpenZx81WavProgramSelection()
                    }}
                    onSetBit={tapeController.setBit}
                    onSetInsertionValue={tapeController.setInsertionValue}
                    onSetMergeValue={tapeController.setMergeValue}
                    onSignalConditioningEnabledChange={tapeController.handleSignalConditioningEnabledChange}
                    onSignalRestorationEnabledChange={tapeController.handleSignalRestorationEnabledChange}
                    onSplitBit={tapeController.splitBit}
                    onResizeInsertion={tapeController.resizeInsertion}
                    onUndo={tapeController.undo}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
      </Container>
      <ParserStatusAlert
        cursorPosition={cursorPosition}
        dialect={dialect}
        isSourceUnvalidated={!automaticParsingEnabled && hasUnparsedDraft}
        parseState={parseState}
        programExportFormat={programExportFormat}
      />
    </main>
  )
}

function parseStateToSourceDiagnostic(parseState: ParseState): SourceDiagnostic | null {
  if (parseState.ok || parseState.line === undefined || parseState.column === undefined) {
    return null
  }

  return {
    title: parseState.title,
    message: parseState.message,
    line: parseState.line,
    column: parseState.column,
    endColumn: parseState.endColumn,
  }
}

function findClosestGeneratedLineForOriginalLine(sourceMap: LabelSourceMap | null, originalLine: number): number | null {
  if (!sourceMap || sourceMap.originalLineToGeneratedBasicLine.size === 0) {
    return null
  }

  const exact = sourceMap.originalLineToGeneratedBasicLine.get(originalLine)
  if (exact !== undefined) {
    return exact
  }

  let closest: { readonly originalLine: number; readonly generatedLine: number; readonly distance: number } | null = null
  for (const [mappedOriginalLine, generatedLine] of sourceMap.originalLineToGeneratedBasicLine) {
    const distance = Math.abs(mappedOriginalLine - originalLine)
    if (!closest || distance < closest.distance || (distance === closest.distance && mappedOriginalLine < closest.originalLine)) {
      closest = { originalLine: mappedOriginalLine, generatedLine, distance }
    }
  }

  return closest?.generatedLine ?? null
}

function shouldWarnBeforeReplacingSource(source: string): boolean {
  const normalizedSource = normalizeSampleSource(source)
  return normalizedSource.length > 0 && !isBuiltInSampleProgram(source)
}

export default App

type SourceCommitOptions = {
  readonly clearNavigationAfterCommit?: boolean
  readonly markDraftParsed?: boolean
  readonly requestParseAfterCommit?: boolean
  readonly startProcessingBeforeCommit?: boolean
  readonly updateAutostartLine?: boolean
}
