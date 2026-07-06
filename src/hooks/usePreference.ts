import { useCallback, useState } from 'react'

import { loadPreference, savePreference, type IPreferenceValues, type PreferenceKey } from '../services/preferences'

export function usePreference<Key extends PreferenceKey>(key: Key): readonly [IPreferenceValues[Key], (value: IPreferenceValues[Key]) => void] {
  const [value, setValue] = useState<IPreferenceValues[Key]>(() => loadPreference(key))

  const updateValue = useCallback(
    (nextValue: IPreferenceValues[Key]): void => {
      setValue(nextValue)
      savePreference(key, nextValue)
    },
    [key],
  )

  return [value, updateValue] as const
}
