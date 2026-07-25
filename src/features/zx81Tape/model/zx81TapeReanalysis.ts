import type { DecodedZx81Wav } from '../../../formats'
import type { Zx81TapeWorkspace } from './zx81TapeWorkspace'

const maximumProgramStartDriftSeconds = 5

export interface IZx81TapeReanalysisIdentity {
  readonly generation: number
  readonly sourceFileIdentity: object | null
  readonly workspace: Zx81TapeWorkspace | null
}

/** Returns whether re-analysis would discard any manual tape repairs. */
export function hasActiveZx81TapeEdits(workspace: Zx81TapeWorkspace): boolean {
  return workspace.insertions.length > 0
    || workspace.merges.length > 0
    || workspace.overrides.length > 0
    || workspace.suppressedBitIds.length > 0
}

/** Returns whether an asynchronous re-analysis still targets the open tape generation. */
export function isCurrentZx81TapeReanalysis(
  request: IZx81TapeReanalysisIdentity,
  current: IZx81TapeReanalysisIdentity,
): boolean {
  return request.generation === current.generation
    && request.sourceFileIdentity === current.sourceFileIdentity
    && request.workspace === current.workspace
}

/** Finds the same tape program after detector settings change its candidate details. */
export function matchingZx81WavProgram(
  programs: readonly DecodedZx81Wav[],
  current: DecodedZx81Wav,
): DecodedZx81Wav {
  if (programs.length === 0) {
    throw programMatchError(current)
  }

  const maximumStartDrift = Math.max(1, current.sampleRate) * maximumProgramStartDriftSeconds
  const nearbyPrograms = programs.filter((program) => sampleDistance(program, current) <= maximumStartDrift)
  if (nearbyPrograms.length === 0) {
    throw programMatchError(current)
  }
  const channelMatches = nearbyPrograms.filter((program) => program.channelIndex === current.channelIndex)
  const candidates = channelMatches.length > 0 ? channelMatches : nearbyPrograms
  return candidates.reduce((best, candidate) => (
    matchScore(candidate, current) < matchScore(best, current) ? candidate : best
  ))
}

function sampleDistance(candidate: DecodedZx81Wav, current: DecodedZx81Wav): number {
  return Math.abs(candidate.programStartSample - current.programStartSample)
}

function matchScore(candidate: DecodedZx81Wav, current: DecodedZx81Wav): number {
  const filenamePenalty = candidate.filename === current.filename ? 0 : Math.max(1, current.sampleRate) * 0.5
  return sampleDistance(candidate, current) + filenamePenalty
}

function programMatchError(current: DecodedZx81Wav): Error {
  return new Error(`Signal conditioning could not find the currently selected ZX81 program “${current.filename || 'Unnamed'}”.`)
}
