/** Returns the nearest ranked percentile from an already sorted set of values. */
export function percentile(sortedValues: readonly number[], ratio: number): number {
  if (sortedValues.length === 0) {
    return 0
  }
  return sortedValues[Math.min(sortedValues.length - 1, Math.max(0, Math.round((sortedValues.length - 1) * ratio)))]
}
