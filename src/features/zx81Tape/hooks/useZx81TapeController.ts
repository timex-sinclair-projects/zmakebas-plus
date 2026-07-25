import { useRef, useState, type RefObject } from 'react'
import { importZx81WavPrograms, type DecodedZx81Wav, type Zx81TapeBitValue } from '../../../formats'
import { usePreference } from '../../../hooks/usePreference'
import { waitForBrowserPaint } from '../../../services/waitForBrowserPaint'
import {
  createZx81TapeWorkspace,
  deleteZx81TapeBit,
  editorSourceForZx81WavProgram,
  insertZx81TapeBit,
  mergeZx81TapeBits,
  redoZx81TapeEdit,
  resizeZx81TapeBitInsertion,
  setZx81TapeBitInsertionValue,
  setZx81TapeBitMergeValue,
  setZx81TapeBitOverride,
  splitZx81TapeBit,
  undoZx81TapeEdit,
  type Zx81TapeWorkspace,
} from '../model/zx81TapeWorkspace'
import { hasActiveZx81TapeEdits, isCurrentZx81TapeReanalysis, matchingZx81WavProgram } from '../model/zx81TapeReanalysis'
import { resolvedZx81TapeSourceToApply } from '../model/zx81TapeSourceSync'

interface IUseZx81TapeControllerOptions {
  readonly onApplySourceToEditor: (source: string) => void
  readonly onError: (message: string) => void
  readonly onProcessingEnd: () => void
  readonly onProcessingStart: () => void
  readonly onRefreshProgramSelection: (programs: readonly DecodedZx81Wav[], selectedProgramId: string) => void
  readonly sourceDraftRef: RefObject<string>
}

export interface IZx81TapeController {
  readonly carrierRecoveryEnabled: boolean
  readonly signalConditioningChangePending: boolean
  readonly signalConditioningEnabled: boolean
  readonly signalRestorationEnabled: boolean
  readonly workspace: Zx81TapeWorkspace | null
  readonly applyWorkspaceSourceToEditor: () => void
  readonly deleteBit: (logicalBitId: string) => void
  readonly handleCarrierRecoveryEnabledChange: (enabled: boolean) => void
  readonly handleSignalConditioningEnabledChange: (enabled: boolean) => void
  readonly handleSignalRestorationEnabledChange: (enabled: boolean) => void
  readonly insertBit: (sample: number, value: Zx81TapeBitValue) => string | null
  readonly loadWorkspace: (workspace: Zx81TapeWorkspace | null, sourceFile?: File | null) => void
  readonly mergeBits: (bitIds: readonly string[]) => string | null
  readonly redo: () => void
  readonly rejectActionDuringRedecode: () => boolean
  readonly resizeInsertion: (insertionId: string, startSample: number, endSample: number) => void
  readonly setBit: (bitId: string, value: Zx81TapeBitValue | undefined) => void
  readonly setInsertionValue: (insertionId: string, value: Zx81TapeBitValue) => void
  readonly setMergeValue: (mergeId: string, value: Zx81TapeBitValue) => void
  readonly splitBit: (logicalBitId: string) => void
  readonly undo: () => void
}

/** Owns editable ZX81 tape state and coordinates signal-option reanalysis. */
export function useZx81TapeController({
  onApplySourceToEditor,
  onError,
  onProcessingEnd,
  onProcessingStart,
  onRefreshProgramSelection,
  sourceDraftRef,
}: IUseZx81TapeControllerOptions): IZx81TapeController {
  const lastAppliedTapeSourceRef = useRef<string | null>(null)
  const workspaceRef = useRef<Zx81TapeWorkspace | null>(null)
  const wavFileRef = useRef<File | null>(null)
  const workspaceGenerationRef = useRef(0)
  const redecodeInProgressRef = useRef(false)
  const [workspace, setWorkspace] = useState<Zx81TapeWorkspace | null>(null)
  const [signalConditioningChangePending, setSignalConditioningChangePending] = useState(false)
  const [carrierRecoveryEnabled, setCarrierRecoveryEnabled] = usePreference('zx81CarrierRecoveryEnabled')
  const [signalConditioningEnabled, setSignalConditioningEnabled] = usePreference('zx81SignalConditioningEnabled')
  const [signalRestorationEnabled, setSignalRestorationEnabled] = usePreference('zx81SignalRestorationEnabled')

  function replaceWorkspace(nextWorkspace: Zx81TapeWorkspace | null): void {
    workspaceRef.current = nextWorkspace
    workspaceGenerationRef.current += 1
    setWorkspace(nextWorkspace)
  }

  function loadWorkspace(nextWorkspace: Zx81TapeWorkspace | null, sourceFile: File | null = null): void {
    lastAppliedTapeSourceRef.current = nextWorkspace ? nextWorkspace.effective.source ?? '' : null
    wavFileRef.current = sourceFile
    replaceWorkspace(nextWorkspace)
  }

  function rejectActionDuringRedecode(): boolean {
    if (!redecodeInProgressRef.current) return false
    onError('Wait for the current tape re-decode to finish before replacing the source or changing target.')
    return true
  }

  async function handleSignalProcessingChange(
    nextConditioningEnabled: boolean,
    nextRestorationEnabled: boolean,
    nextCarrierRecoveryEnabled: boolean,
  ): Promise<void> {
    if (redecodeInProgressRef.current) return
    if (
      nextConditioningEnabled === signalConditioningEnabled
      && nextRestorationEnabled === signalRestorationEnabled
      && nextCarrierRecoveryEnabled === carrierRecoveryEnabled
    ) return
    const currentWorkspace = workspaceRef.current
    const sourceFile = wavFileRef.current
    if (currentWorkspace && hasActiveZx81TapeEdits(currentWorkspace)) {
      onError('Undo or remove the current tape bit edits before changing signal processing; re-decoding changes automatic bit geometry.')
      return
    }
    if (!currentWorkspace || !sourceFile) {
      setCarrierRecoveryEnabled(nextCarrierRecoveryEnabled)
      setSignalConditioningEnabled(nextConditioningEnabled)
      setSignalRestorationEnabled(nextRestorationEnabled)
      return
    }

    const requestIdentity = {
      generation: workspaceGenerationRef.current,
      sourceFileIdentity: sourceFile,
      workspace: currentWorkspace,
    }
    redecodeInProgressRef.current = true
    setSignalConditioningChangePending(true)
    onProcessingStart()
    try {
      await waitForBrowserPaint()
      const programs = importZx81WavPrograms(
        new Uint8Array(await sourceFile.arrayBuffer()),
        {
          signalCarrierRecoveryEnabled: nextCarrierRecoveryEnabled,
          signalConditioningEnabled: nextConditioningEnabled,
          signalRestorationEnabled: nextRestorationEnabled,
        },
      )
      if (!isCurrentZx81TapeReanalysis(requestIdentity, {
        generation: workspaceGenerationRef.current,
        sourceFileIdentity: wavFileRef.current,
        workspace: workspaceRef.current,
      })) {
        return
      }
      const decoded = matchingZx81WavProgram(programs, currentWorkspace.automatic)
      const nextWorkspace = createZx81TapeWorkspace(decoded, currentWorkspace.fileName)
      const editorWasSynchronized = lastAppliedTapeSourceRef.current !== null
        && sourceDraftRef.current === lastAppliedTapeSourceRef.current
      setCarrierRecoveryEnabled(nextCarrierRecoveryEnabled)
      setSignalConditioningEnabled(nextConditioningEnabled)
      setSignalRestorationEnabled(nextRestorationEnabled)
      onRefreshProgramSelection(programs, decoded.programId)
      replaceWorkspace(nextWorkspace)
      if (editorWasSynchronized) {
        const nextSource = editorSourceForZx81WavProgram(nextWorkspace)
        if (sourceDraftRef.current === nextSource) {
          lastAppliedTapeSourceRef.current = nextSource
        } else {
          applySourceToEditor(nextSource)
        }
      }
    } catch (error) {
      if (workspaceGenerationRef.current === requestIdentity.generation) {
        onError(error instanceof Error ? error.message : 'Unable to re-decode the ZX81 WAV with the selected signal processing.')
      }
    } finally {
      redecodeInProgressRef.current = false
      setSignalConditioningChangePending(false)
      onProcessingEnd()
    }
  }

  function editWorkspace(edit: (current: Zx81TapeWorkspace) => Zx81TapeWorkspace): Zx81TapeWorkspace | null {
    if (!workspace) return null
    const nextWorkspace = edit(workspace)
    replaceWorkspace(nextWorkspace)
    applyResolvedSource(nextWorkspace.effective.source)
    return nextWorkspace
  }

  function applyResolvedSource(resolvedTapeSource: string | null): void {
    const sourceToApply = resolvedZx81TapeSourceToApply(
      sourceDraftRef.current,
      lastAppliedTapeSourceRef.current,
      resolvedTapeSource,
    )
    if (sourceToApply !== null) applySourceToEditor(sourceToApply)
  }

  function applySourceToEditor(tapeSource: string): void {
    lastAppliedTapeSourceRef.current = tapeSource
    onApplySourceToEditor(tapeSource)
  }

  function insertBit(sample: number, value: Zx81TapeBitValue): string | null {
    if (!workspace) return null
    const existingIds = new Set(workspace.insertions.map((insertion) => insertion.id))
    const nextWorkspace = editWorkspace((current) => insertZx81TapeBit(current, sample, value))
    return nextWorkspace?.insertions.find((insertion) => !existingIds.has(insertion.id))?.id ?? null
  }

  function mergeBits(bitIds: readonly string[]): string | null {
    if (!workspace) return null
    const existingIds = new Set(workspace.merges.map((merge) => merge.id))
    const nextWorkspace = editWorkspace((current) => mergeZx81TapeBits(current, bitIds))
    return nextWorkspace?.merges.find((merge) => !existingIds.has(merge.id))?.id ?? null
  }

  return {
    applyWorkspaceSourceToEditor: () => {
      if (workspace?.effective.source !== null && workspace?.effective.source !== undefined) {
        applySourceToEditor(workspace.effective.source)
      }
    },
    carrierRecoveryEnabled,
    deleteBit: (logicalBitId) => { editWorkspace((current) => deleteZx81TapeBit(current, logicalBitId)) },
    handleCarrierRecoveryEnabledChange: (enabled) => {
      void handleSignalProcessingChange(signalConditioningEnabled, signalRestorationEnabled, enabled)
    },
    handleSignalConditioningEnabledChange: (enabled) => {
      void handleSignalProcessingChange(enabled, signalRestorationEnabled, carrierRecoveryEnabled)
    },
    handleSignalRestorationEnabledChange: (enabled) => {
      void handleSignalProcessingChange(signalConditioningEnabled, enabled, carrierRecoveryEnabled)
    },
    insertBit,
    loadWorkspace,
    mergeBits,
    redo: () => { editWorkspace(redoZx81TapeEdit) },
    rejectActionDuringRedecode,
    resizeInsertion: (insertionId, startSample, endSample) => {
      editWorkspace((current) => resizeZx81TapeBitInsertion(current, insertionId, startSample, endSample))
    },
    setBit: (bitId, value) => { editWorkspace((current) => setZx81TapeBitOverride(current, bitId, value)) },
    setInsertionValue: (insertionId, value) => {
      editWorkspace((current) => setZx81TapeBitInsertionValue(current, insertionId, value))
    },
    setMergeValue: (mergeId, value) => { editWorkspace((current) => setZx81TapeBitMergeValue(current, mergeId, value)) },
    signalConditioningChangePending,
    signalConditioningEnabled,
    signalRestorationEnabled,
    splitBit: (logicalBitId) => { editWorkspace((current) => splitZx81TapeBit(current, logicalBitId)) },
    undo: () => { editWorkspace(undoZx81TapeEdit) },
    workspace,
  }
}
