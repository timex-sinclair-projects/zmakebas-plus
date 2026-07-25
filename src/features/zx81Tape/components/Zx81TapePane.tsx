import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent, type WheelEvent } from 'react'
import Button from 'react-bootstrap/Button'
import ButtonGroup from 'react-bootstrap/ButtonGroup'
import Collapse from 'react-bootstrap/Collapse'
import Form from 'react-bootstrap/Form'
import {
  BsArrowClockwise,
  BsArrowCounterclockwise,
  BsBullseye,
  BsChevronDown,
  BsChevronUp,
  BsDashCircleFill,
  BsQuestionCircleFill,
  BsSkipBackwardFill,
  BsSkipForwardFill,
  BsZoomIn,
  BsZoomOut,
} from 'react-icons/bs'
import type { Zx81TapeBitValue } from '../../../formats'
import {
  nextUnknownZx81TapeLogicalBit,
  previousUnknownZx81TapeLogicalBit,
  type Zx81TapeLogicalBit,
  type Zx81TapeLogicalGap,
  zx81TapeLogicalGapNavigation,
} from '../model/zx81TapeLogicalBits'
import { canSplitZx81TapeBit, type Zx81TapeWorkspace } from '../model/zx81TapeWorkspace'
import { drawZx81TapeCanvas, tapeCanvasLabelWidth, tapeCanvasLogicalHeight, type Zx81TapeInsertionRangeDraft } from './zx81TapeCanvas'
import { insertionBoundaryAtCanvas, insertionBoundaryForHitTarget, sampleAtClientX, tapeCanvasHitTarget } from './zx81TapeHitTesting'
import { canEditSelection, canMergeSelection, clamp, extendedLogicalBitRange, logicalBitMatchesSelection, logicalBitSelectionIds, resizedInsertionRange, waveformViewForBit, waveformZoomAnchorForBit } from './zx81TapePaneModel'
import { Zx81CarrierRecoverySwitch } from './Zx81CarrierRecoverySwitch'
import { Zx81SignalConditioningSwitch } from './Zx81SignalConditioningSwitch'
import { Zx81SignalRestorationSwitch } from './Zx81SignalRestorationSwitch'

const minimumVisibleSamples = 256
const minimumPaneHeight = 330
const maximumPaneHeight = 620

type Zx81TapePaneProps = {
  readonly canSelectProgramEntry: boolean
  readonly carrierRecoveryEnabled: boolean
  readonly signalConditioningChangePending: boolean
  readonly signalConditioningEnabled: boolean
  readonly signalRestorationEnabled: boolean
  readonly workspace: Zx81TapeWorkspace
  readonly onApplySource: () => void
  readonly onCarrierRecoveryEnabledChange: (enabled: boolean) => void
  readonly onDeleteBit: (logicalBitId: string) => void
  readonly onInsertBit: (sample: number, value: Zx81TapeBitValue) => string | null
  readonly onMergeBits: (bitIds: readonly string[]) => string | null
  readonly onRevealSourceRange: (start: number, end: number) => void
  readonly onRedo: () => void
  readonly onResizeInsertion: (insertionId: string, startSample: number, endSample: number) => void
  readonly onSetBit: (bitId: string, value: Zx81TapeBitValue | undefined) => void
  readonly onSetInsertionValue: (insertionId: string, value: Zx81TapeBitValue) => void
  readonly onSetMergeValue: (mergeId: string, value: Zx81TapeBitValue) => void
  readonly onSelectProgramEntry: () => void
  readonly onSignalConditioningEnabledChange: (enabled: boolean) => void
  readonly onSignalRestorationEnabledChange: (enabled: boolean) => void
  readonly onSplitBit: (logicalBitId: string) => void
  readonly onUndo: () => void
}

export function Zx81TapePane({ canSelectProgramEntry, carrierRecoveryEnabled, signalConditioningChangePending, signalConditioningEnabled, signalRestorationEnabled, workspace, onApplySource, onCarrierRecoveryEnabledChange, onDeleteBit, onInsertBit, onMergeBits, onRevealSourceRange, onRedo, onResizeInsertion, onSelectProgramEntry, onSetBit, onSetInsertionValue, onSetMergeValue, onSignalConditioningEnabledChange, onSignalRestorationEnabledChange, onSplitBit, onUndo }: Zx81TapePaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragRef = useRef<{ readonly clientX: number; readonly viewStart: number } | null>(null)
  const insertionRangeDraftRef = useRef<Zx81TapeInsertionRangeDraft | null>(null)
  const insertionResizeRef = useRef<{ readonly boundary: 'end' | 'start'; readonly insertionId: string } | null>(null)
  const resizeRef = useRef<{ readonly clientY: number; readonly height: number; readonly pointerId: number } | null>(null)
  const suppressCanvasClickRef = useRef(false)
  const [collapsed, setCollapsed] = useState(false)
  const [collapseTransitioning, setCollapseTransitioning] = useState(false)
  const [paneHeight, setPaneHeight] = useState(390)
  const [canvasCursor, setCanvasCursor] = useState<'insert' | 'label' | 'link' | 'pan' | 'resize'>('pan')
  const [insertionMarkerSample, setInsertionMarkerSample] = useState<number | null>(null)
  const [insertionRangeDraft, setInsertionRangeDraft] = useState<Zx81TapeInsertionRangeDraft | null>(null)
  const [selectedBitIds, setSelectedBitIds] = useState<readonly string[]>(() => {
    const firstBitId = workspace.automatic.bits[workspace.automatic.tapeBitStart]?.id
    return firstBitId ? [firstBitId] : []
  })
  const [viewStart, setViewStart] = useState(0)
  const [viewEnd, setViewEnd] = useState(workspace.automatic.samples.length)
  const [canvasSize, setCanvasSize] = useState({ height: tapeCanvasLogicalHeight, width: 800 })
  const selectedLogicalBits = workspace.effective.logicalBits.filter((bit) => selectedBitIds.includes(bit.id))
  const firstSelectedLogicalBit = selectedLogicalBits[0] ?? null
  const finalSelectedLogicalBit = selectedLogicalBits.at(-1) ?? null
  const selectedLogicalBit = selectedLogicalBits.length === 1 ? selectedLogicalBits[0] : undefined
  const hasSingleLogicalBitSelection = selectedBitIds.length === 1 && selectedLogicalBit !== undefined
  const selectedInsertion = workspace.insertions.find((insertion) => insertion.id === selectedLogicalBit?.id)
  const selectedMerge = workspace.merges.find((merge) => merge.id === selectedLogicalBit?.id)
  const selectedOverride = selectedLogicalBit?.physicalBitIds.length === 1
    ? workspace.overrides.find((override) => override.bitId === selectedLogicalBit.physicalBitIds[0])
    : undefined
  const selectedValue = selectedLogicalBit?.effectiveValue ?? null
  const { next: nextLongGap, previous: previousLongGap } = useMemo(() => zx81TapeLogicalGapNavigation(
    workspace.effective.logicalBits,
    workspace.effective.tapeBitStart,
    workspace.effective.tapeBitEnd,
    selectedBitIds,
  ), [
    selectedBitIds,
    workspace.effective.logicalBits,
    workspace.effective.tapeBitEnd,
    workspace.effective.tapeBitStart,
  ])
  const nextUnknownBit = nextUnknownZx81TapeLogicalBit(
    workspace.effective.logicalBits,
    workspace.effective.tapeBitStart,
    workspace.effective.tapeBitEnd,
    selectedBitIds,
  )
  const previousUnknownBit = previousUnknownZx81TapeLogicalBit(
    workspace.effective.logicalBits,
    workspace.effective.tapeBitStart,
    workspace.effective.tapeBitEnd,
    selectedBitIds,
  )
  const visibleLength = Math.max(1, viewEnd - viewStart)
  const maximumPanStart = Math.max(0, workspace.automatic.samples.length - visibleLength)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) {
        setCanvasSize({ height: Math.max(120, Math.round(entries[0].contentRect.height)), width: Math.max(320, Math.round(width)) })
      }
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [collapsed])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || collapsed || collapseTransitioning) {
      return
    }
    const bounds = canvas.getBoundingClientRect()
    const drawWidth = bounds.width > 0 ? Math.max(320, Math.round(bounds.width)) : canvasSize.width
    const drawHeight = bounds.height > 0 ? Math.max(120, Math.round(bounds.height)) : canvasSize.height
    drawZx81TapeCanvas(canvas, drawWidth, drawHeight, workspace, viewStart, viewEnd, selectedBitIds, insertionMarkerSample, insertionRangeDraft)
  }, [canvasSize, collapsed, collapseTransitioning, insertionMarkerSample, insertionRangeDraft, selectedBitIds, viewEnd, viewStart, workspace])

  const selectBits = useCallback((bitIds: readonly string[], extendSelection = false): void => {
    const nextBitIds = extendSelection && selectedBitIds.length > 0
      ? extendedLogicalBitRange(workspace, selectedBitIds, bitIds)
      : bitIds
    if (nextBitIds.length === 0) {
      return
    }
    setSelectedBitIds(nextBitIds)
    setInsertionMarkerSample(null)
    const selectedLogicalBits = workspace.effective.logicalBits.filter((bit) => logicalBitMatchesSelection(bit, nextBitIds))
    const firstBit = selectedLogicalBits[0]
    const finalBit = selectedLogicalBits.at(-1)
    if (!firstBit || !finalBit) return
    const mapping = workspace.effective.sourceMappings.find((candidate) => candidate.startSample <= firstBit.startSample && candidate.endSample >= finalBit.endSample)
    if (mapping) {
      onRevealSourceRange(mapping.sourceStart, mapping.sourceEnd)
    }
  }, [onRevealSourceRange, selectedBitIds, workspace])

  function zoom(ratio: number, anchorSample = (viewStart + viewEnd) / 2, anchorRatio = 0.5): void {
    const nextLength = Math.max(minimumVisibleSamples, Math.min(workspace.automatic.samples.length, Math.round(visibleLength * ratio)))
    const nextStart = clamp(Math.round(anchorSample - nextLength * anchorRatio), 0, workspace.automatic.samples.length - nextLength)
    setViewStart(nextStart)
    setViewEnd(nextStart + nextLength)
  }

  function zoomFromToolbar(ratio: number): void {
    if (!selectedLogicalBit) {
      zoom(ratio, viewStart, 0)
      return
    }
    const anchor = waveformZoomAnchorForBit(selectedLogicalBit, viewStart, viewEnd)
    zoom(ratio, anchor.sample, anchor.ratio)
  }

  function fitTape(): void {
    const firstBit = workspace.automatic.bits[workspace.automatic.tapeBitStart]
    const lastByte = workspace.effective.bytes[workspace.automatic.filenameByteLength + workspace.automatic.pFileByteLength - 1]
    if (!firstBit || !lastByte) {
      setViewStart(0)
      setViewEnd(workspace.automatic.samples.length)
      return
    }
    const padding = Math.round((lastByte.endSample - firstBit.startSample) * 0.02)
    setViewStart(Math.max(0, firstBit.startSample - padding))
    setViewEnd(Math.min(workspace.automatic.samples.length, lastByte.endSample + padding))
  }

  function handleWheel(event: WheelEvent<HTMLCanvasElement>): void {
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = clamp((event.clientX - bounds.left - tapeCanvasLabelWidth) / Math.max(1, bounds.width - tapeCanvasLabelWidth), 0, 1)
    const boundedDelta = clamp(event.deltaY, -120, 120)
    const zoomFactor = Math.exp(boundedDelta * 0.0025)
    zoom(zoomFactor, viewStart + visibleLength * ratio, ratio)
  }

  function handleCanvasClick(event: ReactMouseEvent<HTMLCanvasElement>): void {
    if (suppressCanvasClickRef.current) {
      suppressCanvasClickRef.current = false
      return
    }
    const target = tapeCanvasHitTarget(event.currentTarget, event.clientX, event.clientY, workspace, viewStart, viewEnd)
    if (!target) {
      return
    }

    if (target.kind === 'source') {
      setInsertionMarkerSample(null)
      onRevealSourceRange(target.sourceStart, target.sourceEnd)
      return
    }

    if (target.kind === 'insertion-marker') {
      setInsertionMarkerSample(target.sample)
      return
    }

    selectBits(target.bitIds, event.shiftKey)
  }

  function handlePointerMove(event: ReactMouseEvent<HTMLCanvasElement>): void {
    const insertionResize = insertionResizeRef.current
    if (insertionResize && selectedInsertion && (event.buttons & 1) !== 0) {
      const sample = sampleAtClientX(event.currentTarget, event.clientX, viewStart, viewEnd)
      const currentDraft = insertionRangeDraftRef.current ?? selectedInsertion
      const nextDraft = resizedInsertionRange(workspace, currentDraft, insertionResize.boundary, sample)
      if (
        nextDraft.startSample !== currentDraft.startSample
        || nextDraft.endSample !== currentDraft.endSample
      ) suppressCanvasClickRef.current = true
      insertionRangeDraftRef.current = nextDraft
      setInsertionRangeDraft(nextDraft)
      return
    }
    const drag = dragRef.current
    if (!drag || (event.buttons & 1) === 0) {
      return
    }
    const drawableWidth = Math.max(1, event.currentTarget.clientWidth - tapeCanvasLabelWidth)
    const deltaSamples = Math.round(((drag.clientX - event.clientX) / drawableWidth) * visibleLength)
    const nextStart = clamp(drag.viewStart + deltaSamples, 0, maximumPanStart)
    setViewStart(nextStart)
    setViewEnd(nextStart + visibleLength)
  }

  function handleCanvasMouseMove(event: ReactMouseEvent<HTMLCanvasElement>): void {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientX - bounds.left < tapeCanvasLabelWidth) {
      setCanvasCursor('label')
    } else {
      const target = tapeCanvasHitTarget(event.currentTarget, event.clientX, event.clientY, workspace, viewStart, viewEnd)
      const insertionBoundary = selectedInsertion
        ? insertionBoundaryAtCanvas(event.currentTarget, event.clientX, event.clientY, selectedInsertion, viewStart, viewEnd)
        : null
      const editableBoundary = selectedInsertion
        ? insertionBoundaryForHitTarget(insertionBoundary, selectedInsertion.id, target)
        : null
      setCanvasCursor(editableBoundary ? 'resize' : target?.kind === 'insertion-marker' ? 'insert' : target ? 'link' : 'pan')
    }
    handlePointerMove(event)
  }

  function beginCanvasMouseDown(event: ReactMouseEvent<HTMLCanvasElement>): void {
    const target = tapeCanvasHitTarget(event.currentTarget, event.clientX, event.clientY, workspace, viewStart, viewEnd)
    const insertionBoundary = selectedInsertion
      ? insertionBoundaryAtCanvas(event.currentTarget, event.clientX, event.clientY, selectedInsertion, viewStart, viewEnd)
      : null
    const editableBoundary = selectedInsertion
      ? insertionBoundaryForHitTarget(insertionBoundary, selectedInsertion.id, target)
      : null
    if (editableBoundary && selectedInsertion) {
      insertionResizeRef.current = { boundary: editableBoundary, insertionId: selectedInsertion.id }
      insertionRangeDraftRef.current = selectedInsertion
      setInsertionRangeDraft(selectedInsertion)
      return
    }
    if (target) return
    dragRef.current = { clientX: event.clientX, viewStart }
  }

  function endCanvasMouseInteraction(): void {
    const insertionResize = insertionResizeRef.current
    const rangeDraft = insertionRangeDraftRef.current
    if (insertionResize && rangeDraft) {
      onResizeInsertion(insertionResize.insertionId, rangeDraft.startSample, rangeDraft.endSample)
    }
    dragRef.current = null
    insertionRangeDraftRef.current = null
    insertionResizeRef.current = null
    setInsertionRangeDraft(null)
  }

  function cancelCanvasMouseInteraction(): void {
    dragRef.current = null
    insertionRangeDraftRef.current = null
    insertionResizeRef.current = null
    setInsertionRangeDraft(null)
    setCanvasCursor('pan')
  }

  function beginPaneResize(event: PointerEvent<HTMLButtonElement>): void {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeRef.current = { clientY: event.clientY, height: paneHeight, pointerId: event.pointerId }
  }

  function updatePaneResize(event: PointerEvent<HTMLButtonElement>): void {
    const resize = resizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) {
      return
    }
    setPaneHeight(clamp(resize.height + resize.clientY - event.clientY, minimumPaneHeight, maximumPaneHeight))
  }

  function endPaneResize(event: PointerEvent<HTMLButtonElement>): void {
    if (resizeRef.current?.pointerId === event.pointerId) {
      resizeRef.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function handleResizeKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Home') {
      event.preventDefault()
      setPaneHeight(event.key === 'Home' ? 390 : (height) => clamp(height + (event.key === 'ArrowUp' ? 16 : -16), minimumPaneHeight, maximumPaneHeight))
    }
  }

  return (
    <section
      className={`tool-panel zx81-tape-pane${collapsed ? ' is-collapsed' : ''}`}
      style={{ height: collapsed ? undefined : paneHeight }}
      aria-label="ZX81 tape analysis"
    >
      {!collapsed ? (
        <button
          type="button"
          className="tape-pane-resizer"
          role="separator"
          aria-label="Resize tape analysis pane"
          aria-orientation="horizontal"
          aria-valuemin={minimumPaneHeight}
          aria-valuemax={maximumPaneHeight}
          aria-valuenow={paneHeight}
          onDoubleClick={() => setPaneHeight(390)}
          onKeyDown={handleResizeKeyDown}
          onPointerCancel={endPaneResize}
          onPointerDown={beginPaneResize}
          onPointerMove={updatePaneResize}
          onPointerUp={endPaneResize}
        />
      ) : null}
      <div className="tape-pane-header">
        <div className="tape-file-summary">
          <div
            className="tape-file-summary-copy"
            title={`${workspace.fileName} · ${workspace.automatic.filename || 'Unnamed'} · channel ${workspace.automatic.channelIndex + 1} · ${workspace.automatic.sampleRate.toLocaleString()} Hz`}
          >
            <strong>{workspace.fileName}</strong>
            <span> · {workspace.automatic.filename || 'Unnamed'} · channel {workspace.automatic.channelIndex + 1} · {workspace.automatic.sampleRate.toLocaleString()} Hz</span>
          </div>
          {canSelectProgramEntry ? (
            <Button
              size="sm"
              variant="outline-secondary"
              disabled={signalConditioningChangePending}
              title="Choose another program from this WAV"
              aria-label="Choose another program from this WAV"
              onClick={onSelectProgramEntry}
            >Change program</Button>
          ) : null}
        </div>
        <div className="tape-signal-controls" role="group" aria-label="Tape signal processing">
          <Zx81SignalConditioningSwitch
            changePending={signalConditioningChangePending}
            enabled={signalConditioningEnabled}
            onEnabledChange={onSignalConditioningEnabledChange}
          />
          <Zx81SignalRestorationSwitch
            changePending={signalConditioningChangePending}
            enabled={signalRestorationEnabled}
            onEnabledChange={onSignalRestorationEnabledChange}
          />
          <Zx81CarrierRecoverySwitch
            changePending={signalConditioningChangePending}
            enabled={carrierRecoveryEnabled}
            onEnabledChange={onCarrierRecoveryEnabledChange}
          />
        </div>
        <div className="tape-pane-actions">
          {!collapsed ? (
            <>
              <ButtonGroup className="tape-icon-controls" size="sm" aria-label="Tape view zoom">
                <Button variant="outline-secondary" title={selectedLogicalBit ? 'Zoom out around selected bit' : 'Zoom out from left edge'} aria-label={selectedLogicalBit ? 'Zoom out around selected bit' : 'Zoom out from left edge'} onClick={() => zoomFromToolbar(1.5)}><BsZoomOut aria-hidden="true" /></Button>
                <Button variant="outline-secondary" onClick={fitTape}>Zoom to fit</Button>
                <Button variant="outline-secondary" title={selectedLogicalBit ? 'Zoom in around selected bit' : 'Zoom in from left edge'} aria-label={selectedLogicalBit ? 'Zoom in around selected bit' : 'Zoom in from left edge'} onClick={() => zoomFromToolbar(0.67)}><BsZoomIn aria-hidden="true" /></Button>
              </ButtonGroup>
              <ButtonGroup className="tape-icon-controls" size="sm" aria-label="Tape edit history">
                <Button variant="outline-secondary" disabled={workspace.undoStack.length === 0} title="Undo" aria-label="Undo edit" onClick={onUndo}><BsArrowCounterclockwise aria-hidden="true" /></Button>
                <Button variant="outline-secondary" disabled={workspace.redoStack.length === 0} title="Redo" aria-label="Redo edit" onClick={onRedo}><BsArrowClockwise aria-hidden="true" /></Button>
              </ButtonGroup>
            </>
          ) : null}
        </div>
        <Button
          className="tape-collapse-button"
          size="sm"
          variant="outline-secondary"
          aria-controls="zx81-tape-expanded-content"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand tape analysis' : 'Collapse tape analysis'}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <BsChevronUp aria-hidden="true" /> : <BsChevronDown aria-hidden="true" />}
        </Button>
      </div>
      <Collapse
        in={!collapsed}
        mountOnEnter
        unmountOnExit
        onEnter={() => setCollapseTransitioning(true)}
        onEntered={() => setCollapseTransitioning(false)}
        onExit={() => setCollapseTransitioning(true)}
        onExited={() => setCollapseTransitioning(false)}
      >
        <div id="zx81-tape-expanded-content" className="tape-pane-collapse">
          <div className="tape-pane-body">
          <div className="tape-bit-legend" aria-label="Bit colour legend">
            <span><i className="is-zero" aria-hidden="true" />0 bit</span>
            <span><i className="is-one" aria-hidden="true" />1 bit</span>
            <span><i className="is-unknown" aria-hidden="true" />Unknown</span>
            <span><i className="is-override" aria-hidden="true" />Manual override</span>
            <span><i className="is-merge" aria-hidden="true" />Merged bit</span>
            <span><i className="is-insertion" aria-hidden="true" />Inserted bit</span>
            <span><i className="is-basic-ambiguous" aria-hidden="true" />Ambiguous BASIC</span>
            <span><i className="is-basic-damaged" aria-hidden="true" />Damaged BASIC</span>
            <span>Shift-click bits to select a range</span>
          </div>
          <canvas
            ref={canvasRef}
            className={`tape-canvas is-${canvasCursor}-area`}
            onClick={handleCanvasClick}
            onMouseDown={beginCanvasMouseDown}
            onMouseLeave={cancelCanvasMouseInteraction}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={endCanvasMouseInteraction}
            onWheel={handleWheel}
          />
          <Form.Range
            className="tape-pan-control"
            aria-label="Pan tape view"
            min={0}
            max={maximumPanStart}
            step={Math.max(1, Math.floor(visibleLength / 100))}
            value={Math.min(viewStart, maximumPanStart)}
            disabled={maximumPanStart === 0}
            onChange={(event) => {
              const nextStart = Number(event.currentTarget.value)
              setViewStart(nextStart)
              setViewEnd(nextStart + visibleLength)
            }}
          />
          <div className="tape-bit-inspector">
            <div className="tape-bit-actions">
              <Form.Group className="tape-bit-picker">
                <Form.Label htmlFor="tape-bit-index">Bit selection</Form.Label>
                <div className="tape-bit-range-picker">
                  <Form.Control
                    id="tape-bit-index"
                    aria-label="First selected bit"
                    type="number"
                    size="sm"
                    min={workspace.effective.tapeBitStart}
                    max={workspace.effective.tapeBitEnd - 1}
                    value={firstSelectedLogicalBit?.index ?? ''}
                    onChange={(event) => selectLogicalBitIndex(Number.parseInt(event.currentTarget.value, 10))}
                  />
                  <span aria-hidden="true">to</span>
                  <Form.Control
                    aria-label="Last selected bit"
                    type="number"
                    size="sm"
                    min={workspace.effective.tapeBitStart}
                    max={workspace.effective.tapeBitEnd - 1}
                    value={finalSelectedLogicalBit?.index ?? ''}
                    onChange={(event) => {
                      const finalLogicalBit = workspace.effective.logicalBits[Number.parseInt(event.currentTarget.value, 10)]
                      const selectionAnchor = selectedLogicalBits[0]
                      if (finalLogicalBit && selectionAnchor) {
                        selectBits(extendedLogicalBitRange(workspace, [selectionAnchor.id], [finalLogicalBit.id]))
                      }
                    }}
                  />
                </div>
              </Form.Group>
              <Button className="tape-zoom-to-bit" size="sm" variant="outline-secondary" disabled={!selectedLogicalBit} onClick={zoomToSelectedBit}>
                <BsBullseye aria-hidden="true" />
                <span>Go to bit</span>
              </Button>
              <ButtonGroup className="tape-gap-navigation" size="sm" aria-label="Navigate long tape gaps">
                <Button
                  aria-label="Previous gap"
                  title="Previous gap"
                  variant="outline-secondary"
                  disabled={!previousLongGap}
                  onClick={() => selectLongGap(previousLongGap)}
                >
                  <BsSkipBackwardFill aria-hidden="true" />
                  <BsDashCircleFill aria-hidden="true" />
                </Button>
                <Button
                  aria-label="Next gap"
                  title="Next gap"
                  variant="outline-secondary"
                  disabled={!nextLongGap}
                  onClick={() => selectLongGap(nextLongGap)}
                >
                  <BsDashCircleFill aria-hidden="true" />
                  <BsSkipForwardFill aria-hidden="true" />
                </Button>
              </ButtonGroup>
              <ButtonGroup className="tape-unknown-navigation" size="sm" aria-label="Navigate unknown tape bits">
                <Button
                  aria-label="Previous unknown"
                  title="Previous unknown"
                  disabled={!previousUnknownBit}
                  onClick={() => selectUnknownBit(previousUnknownBit)}
                >
                  <BsSkipBackwardFill aria-hidden="true" />
                  <BsQuestionCircleFill aria-hidden="true" />
                </Button>
                <Button
                  aria-label="Next unknown"
                  title="Next unknown"
                  disabled={!nextUnknownBit}
                  onClick={() => selectUnknownBit(nextUnknownBit)}
                >
                  <BsQuestionCircleFill aria-hidden="true" />
                  <BsSkipForwardFill aria-hidden="true" />
                </Button>
              </ButtonGroup>
              {selectedBitIds.length <= 1 ? <ButtonGroup size="sm" aria-label="Set selected tape bit">
                <Button
                  aria-label="Set bit to 0"
                  title="Set bit to 0"
                  disabled={!canEditSelection(workspace, selectedBitIds)}
                  variant={hasSingleLogicalBitSelection && selectedValue === 0 ? 'primary' : 'outline-secondary'}
                  onClick={() => editSelectedBits(0)}
                >0</Button>
                <Button
                  aria-label="Set bit to 1"
                  title="Set bit to 1"
                  disabled={!canEditSelection(workspace, selectedBitIds)}
                  variant={hasSingleLogicalBitSelection && selectedValue === 1 ? 'primary' : 'outline-secondary'}
                  onClick={() => editSelectedBits(1)}
                >1</Button>
                <Button
                  aria-label="Set bit to unknown"
                  title="Set bit to unknown"
                  disabled={!canEditSelection(workspace, selectedBitIds)}
                  variant={hasSingleLogicalBitSelection && selectedValue === null ? 'primary' : 'outline-secondary'}
                  onClick={() => editSelectedBits(null)}
                >?</Button>
                {!selectedInsertion && !selectedMerge ? <Button
                  aria-label="Infer bit value from the waveform"
                  title="Infer bit value from the waveform"
                  variant="outline-secondary"
                  disabled={!selectedOverride}
                  onClick={() => {
                    if (selectedLogicalBit?.physicalBitIds[0]) onSetBit(selectedLogicalBit.physicalBitIds[0], undefined)
                  }}
                >Infer</Button> : null}
              </ButtonGroup> : null}
              <ButtonGroup size="sm" aria-label="Change selected logical tape bit structure">
                <Button
                  variant="outline-secondary"
                  disabled={insertionMarkerSample === null}
                  onClick={insertUnknownBit}
                >Insert bit</Button>
                <Button
                  variant="outline-secondary"
                  disabled={!hasSingleLogicalBitSelection || !selectedLogicalBit || !canSplitZx81TapeBit(workspace, selectedLogicalBit.id)}
                  onClick={() => {
                    if (!selectedLogicalBit) return
                    onSplitBit(selectedLogicalBit.id)
                    setSelectedBitIds([])
                  }}
                >Split bit</Button>
                <Button
                  variant="outline-secondary"
                  disabled={selectedBitIds.length < 2 || !canMergeSelection(workspace, selectedBitIds)}
                  onClick={() => {
                    const mergeId = onMergeBits(selectedBitIds)
                    if (mergeId) setSelectedBitIds([mergeId])
                  }}
                >Merge bits</Button>
                <Button
                  variant="outline-danger"
                  disabled={!hasSingleLogicalBitSelection || !selectedLogicalBit}
                  onClick={() => {
                    if (!selectedLogicalBit) return
                    onDeleteBit(selectedLogicalBit.id)
                    setSelectedBitIds([])
                  }}
                >Delete bit</Button>
              </ButtonGroup>
              <Button className="tape-apply-decode" size="sm" variant="secondary" disabled={!workspace.effective.source} onClick={onApplySource}>Update listing</Button>
            </div>
          </div>
          <div
            className={`tape-decode-warning${workspace.effective.error ? '' : ' is-empty'}`}
            role={workspace.effective.error ? 'status' : undefined}
            aria-hidden={workspace.effective.error ? undefined : true}
          >
            {workspace.effective.error || '\u00a0'}
          </div>
          </div>
        </div>
      </Collapse>
    </section>
  )

  function editSelectedBits(value: Zx81TapeBitValue): void {
    if (selectedMerge) onSetMergeValue(selectedMerge.id, value)
    else if (selectedInsertion) onSetInsertionValue(selectedInsertion.id, value)
    else if (selectedLogicalBit?.physicalBitIds[0]) onSetBit(selectedLogicalBit.physicalBitIds[0], value)
  }

  function zoomToSelectedBit(): void {
    if (!selectedLogicalBit) return
    const nextView = waveformViewForBit(
      selectedLogicalBit,
      workspace.automatic.samples.length,
      canvasSize.width - tapeCanvasLabelWidth,
      minimumVisibleSamples,
    )
    setViewStart(nextView.start)
    setViewEnd(nextView.end)
  }

  function insertUnknownBit(): void {
    if (insertionMarkerSample === null) return
    const insertionId = onInsertBit(insertionMarkerSample, null)
    if (!insertionId) return
    setSelectedBitIds([insertionId])
    setInsertionMarkerSample(null)
  }

  function selectLogicalBitIndex(bitIndex: number): void {
    const logicalBit = workspace.effective.logicalBits[bitIndex]
    if (!logicalBit) return
    selectBits([logicalBit.id])
  }

  function selectUnknownBit(unknownBit: Zx81TapeLogicalBit | null): void {
    if (!unknownBit) return
    selectBits(logicalBitSelectionIds(unknownBit))
    if (unknownBit.startSample >= viewStart && unknownBit.endSample <= viewEnd) return
    const targetCentre = (unknownBit.startSample + unknownBit.endSample) / 2
    const nextStart = clamp(Math.round(targetCentre - visibleLength / 2), 0, workspace.automatic.samples.length - visibleLength)
    setViewStart(nextStart)
    setViewEnd(nextStart + visibleLength)
  }

  function selectLongGap(gap: Zx81TapeLogicalGap | null): void {
    if (!gap) return
    selectBits(logicalBitSelectionIds(gap.beforeBit))
    if (gap.beforeBit.startSample >= viewStart && gap.endSample <= viewEnd) return
    const selectedBitCentre = (gap.beforeBit.startSample + gap.beforeBit.endSample) / 2
    const nextStart = clamp(
      Math.round(selectedBitCentre - visibleLength * 0.15),
      0,
      workspace.automatic.samples.length - visibleLength,
    )
    setViewStart(nextStart)
    setViewEnd(nextStart + visibleLength)
  }
}
