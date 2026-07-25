/** Returns a resolved tape source only when the BASIC editor has not diverged from its last tape source. */
export function resolvedZx81TapeSourceToApply(
  currentEditorSource: string,
  lastAppliedTapeSource: string | null,
  resolvedTapeSource: string | null,
): string | null {
  if (
    resolvedTapeSource === null
    || lastAppliedTapeSource === null
    || currentEditorSource !== lastAppliedTapeSource
    || currentEditorSource === resolvedTapeSource
  ) {
    return null
  }
  return resolvedTapeSource
}
