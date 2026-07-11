import { useEffect, useMemo, useRef, useState } from 'react'
import Collapse from 'react-bootstrap/Collapse'
import Container from 'react-bootstrap/Container'
import './App.scss'
import { AlertDialog } from './components/AlertDialog'
import { ExportDialog } from './components/ExportDialog'
import { ParserHeader } from './components/ParserHeader'
import { ParserOptionsPane } from './components/ParserOptionsPane'
import { ParserResults } from './components/ParserResults'
import { ParserStatusAlert } from './components/ParserStatusAlert'
import { ReplaceSourceDialog, type ReplaceSourceAction } from './components/ReplaceSourceDialog'
import { SourcePanel } from './components/SourcePanel'
import { TapSelectionDialog } from './components/TapSelectionDialog'
import type { LineNavigationRequest, ParseState, SourceCursorPosition, SourceDiagnostic, SourceNavigationRequest } from './components/types'
import { useBusyIndicator } from './hooks/useBusyIndicator'
import { usePreference } from './hooks/usePreference'
import { useProgramFiles } from './hooks/useProgramFiles'
import { useZxBasicParser } from './hooks/useZxBasicParser'
import type { BasicDialect, BasicExtension, LabelSourceMap } from './parser'
import { formatBasicSource } from './services/formatBasicSource'
import { sampleProgram } from './services/sampleProgram'

function App() {
  const { isProcessing, startProcessing, stopProcessing } = useBusyIndicator()
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
    onProcessingEnd: stopProcessing,
    onProcessingStart: startProcessing,
  })
  const sourceDraftRef = useRef(source)
  const [hasUnparsedDraft, setHasUnparsedDraft] = useState(false)
  const [sourceNavigation, setSourceNavigation] = useState<SourceNavigationRequest | null>(null)
  const [resultsNavigation, setResultsNavigation] = useState<LineNavigationRequest | null>(null)
  const [showResults, setShowResults] = useState(false)
  const [optionsCollapsed, setOptionsCollapsed] = usePreference('optionsCollapsed')
  const [cursorPosition, setCursorPosition] = useState<SourceCursorPosition>({ line: 1, column: 1 })
  const [pendingReplaceSourceAction, setPendingReplaceSourceAction] = useState<ReplaceSourceAction | null>(null)
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null)
  const [screenWrapHintsEnabled, setScreenWrapHintsEnabled] = usePreference('screenWrapHintsEnabled')
  const [screenWidth, setScreenWidth] = usePreference('screenWidth')
  const [spectrumExportFormat, setSpectrumExportFormat] = usePreference('spectrumExportFormat')
  const [formatterKeywordCase, setFormatterKeywordCase] = usePreference('formatterKeywordCase')
  const [optionsSectionCollapsed, setOptionsSectionCollapsed] = usePreference('optionsSectionCollapsed')
  const [alertMessage, setAlertMessage] = useState<string | null>(null)
  const extensions = useMemo<readonly BasicExtension[]>(() => (dialect === 'spectrum' && spectranetEnabled ? ['spectranet'] : []), [dialect, spectranetEnabled])
  const sourceDiagnostic = useMemo(() => (source === parsedSource ? parseStateToSourceDiagnostic(parseState) : null), [parseState, parsedSource, source])
  const diagnosticsVisible = showResults && parseState.ok
  const programFiles = useProgramFiles({
    dialect,
    extensions,
    labelIncrement,
    labelModeEnabled,
    labelStartLine,
    source,
    spectrumExportFormat,
    validAutostartLines,
    onProcessingEnd: stopProcessing,
    onProcessingStart: startProcessing,
    onError: setAlertMessage,
    onRequestParse: requestParse,
    onSpectrumExportFormatChange: setSpectrumExportFormat,
    onSourceLoaded: (nextSource) => {
      commitSource(nextSource, {
        clearNavigationAfterCommit: true,
        markDraftParsed: true,
        updateAutostartLine: false,
      })
    },
  })

  useEffect(() => {
    if (sourceDraftRef.current === parsedSource) {
      setHasUnparsedDraft(false)
    }
  }, [parsedSource])

  function clearNavigation(): void {
    setSourceNavigation(null)
    setResultsNavigation(null)
  }

  function handleSourceChange(nextSource: string): void {
    commitSource(nextSource, { clearNavigationAfterCommit: true })
  }

  function handleReplaceSource(nextSource: string): void {
    programFiles.clearImportedTapEdit()
    commitSource(nextSource, {
      clearNavigationAfterCommit: true,
      requestParseAfterCommit: true,
      startProcessingBeforeCommit: true,
    })
  }

  function handleRequestReplaceSource(action: ReplaceSourceAction): void {
    if (!shouldWarnBeforeReplacingSource(sourceDraftRef.current)) {
      replaceSourceWithoutWarning(action)
      return
    }

    setPendingReplaceSourceAction(action)
  }

  function handleRequestUploadSource(file: File): void {
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
    setPendingReplaceSourceAction(null)
    setPendingUploadFile(null)

    replaceSourceWithoutWarning(action, uploadFile)
  }

  function handleCancelReplaceSource(): void {
    setPendingReplaceSourceAction(null)
    setPendingUploadFile(null)
  }

  function replaceSourceWithoutWarning(action: ReplaceSourceAction | null, uploadFile: File | null = null): void {
    if (action === 'sample') {
      handleReplaceSource(sampleProgram)
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

    if (automaticParsingEnabled) {
      startProcessing()
    }
    programFiles.clearImportedTapEdit()
    if ((nextDialect === 'spectrum' && spectrumExportFormat === 'dck') || (nextDialect === 'ts2068' && spectrumExportFormat === 'plus3dos')) {
      setSpectrumExportFormat('tap')
    }
    setDialect(nextDialect)
    clearNavigation()
  }

  function handleLabelModeEnabledChange(nextEnabled: boolean): void {
    if (automaticParsingEnabled) {
      startProcessing()
    }
    setLabelModeEnabled(nextEnabled)
    clearNavigation()
  }

  function handleLabelStartLineChange(nextStartLine: number): void {
    if (automaticParsingEnabled) {
      startProcessing()
    }
    setLabelStartLine(nextStartLine)
    clearNavigation()
  }

  function handleLabelIncrementChange(nextIncrement: number): void {
    if (automaticParsingEnabled) {
      startProcessing()
    }
    setLabelIncrement(nextIncrement)
    clearNavigation()
  }

  function handleSpectranetEnabledChange(nextEnabled: boolean): void {
    if (automaticParsingEnabled) {
      startProcessing()
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
      startProcessing()
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
          spectrumExportFormat={spectrumExportFormat}
          onOptionsToggle={() => setOptionsCollapsed(!optionsCollapsed)}
          onLoadSample={() => handleRequestReplaceSource('sample')}
          onClear={() => handleRequestReplaceSource('clear')}
          onUploadSource={handleRequestUploadSource}
          onSaveSource={() => {
            void programFiles.handleSaveSource()
          }}
          onDownloadProgram={handleOpenExportDialog}
        />
        <ReplaceSourceDialog
          action={pendingReplaceSourceAction}
          onCancel={handleCancelReplaceSource}
          onConfirm={handleConfirmReplaceSource}
        />
        <AlertDialog message={alertMessage} onClose={() => setAlertMessage(null)} />
        <ExportDialog
          autostartEnabled={programFiles.autostartEnabled}
          autostartLine={programFiles.autostartLine}
          dialect={dialect}
          programName={programFiles.programName}
          show={programFiles.isExportDialogOpen}
          spectrumExportFormat={spectrumExportFormat}
          updateImportedFileAvailable={programFiles.updateImportedFileAvailable}
          updateImportedFileEnabled={programFiles.updateImportedFileEnabled}
          updateImportedFileFormatName={programFiles.updateImportedFileFormatName}
          validAutostartLines={validAutostartLines}
          onCancel={() => programFiles.setIsExportDialogOpen(false)}
          onAutostartEnabledChange={programFiles.handleAutostartEnabledChange}
          onAutostartLineChange={programFiles.setAutostartLine}
          onProgramNameChange={programFiles.setProgramName}
          onUpdateImportedTapEnabledChange={programFiles.setUpdateImportedTapEnabled}
          onConfirm={(programName, autostartLine, updateImportedTap) => {
            void programFiles.handleConfirmExport(programName, autostartLine, updateImportedTap)
          }}
        />
        {programFiles.pendingTapSelection ? (
          <TapSelectionDialog
            entries={programFiles.pendingTapSelection.entries}
            formatName={programFiles.pendingTapSelection.formatName}
            fileName={programFiles.pendingTapSelection.fileName}
            show
            onCancel={programFiles.handleCancelTapSelection}
            onConfirm={(entryId) => {
              void programFiles.handleConfirmTapSelection(entryId)
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
                  spectrumExportFormat={spectrumExportFormat}
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
                  onSpectrumExportFormatChange={setSpectrumExportFormat}
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
                  onProcessingStart={startProcessing}
                  onProcessingEnd={stopProcessing}
                />
              </div>
            ) : (
              <SourcePanel
                source={source}
                dialect={dialect}
                extensions={extensions}
                diagnostic={sourceDiagnostic}
                gotoLineMode={labelModeEnabled ? 'source' : 'basic'}
                navigationRequest={sourceNavigation}
                screenWidth={screenWidth}
                screenWrapHintsEnabled={screenWrapHintsEnabled}
                showLineNumbers={labelModeEnabled}
                onSourceDraftChange={(nextSource) => {
                  sourceDraftRef.current = nextSource
                  setHasUnparsedDraft(nextSource !== parsedSource)
                }}
                onSourceChange={handleSourceChange}
                onCursorChange={setCursorPosition}
                onFormatSource={handleFormatSource}
                onGotoError={handleGotoError}
                onGotoLine={handleSourceGotoLine}
                onError={setAlertMessage}
              />
            )}
          </div>
        </div>
      </Container>
      <ParserStatusAlert
        cursorPosition={cursorPosition}
        dialect={dialect}
        isSourceUnvalidated={!automaticParsingEnabled && hasUnparsedDraft}
        parseState={parseState}
        spectrumExportFormat={spectrumExportFormat}
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
  const normalizedSource = normalizeSourceForReplacementWarning(source)
  return normalizedSource.length > 0 && normalizedSource !== normalizeSourceForReplacementWarning(sampleProgram)
}

function normalizeSourceForReplacementWarning(source: string): string {
  return source.replace(/\r\n?/g, '\n').trim()
}

export default App

type SourceCommitOptions = {
  readonly clearNavigationAfterCommit?: boolean
  readonly markDraftParsed?: boolean
  readonly requestParseAfterCommit?: boolean
  readonly startProcessingBeforeCommit?: boolean
  readonly updateAutostartLine?: boolean
}
