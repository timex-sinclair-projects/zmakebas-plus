import { defaultSpectrumExportFormat, type SpectrumExportFormat } from './programFile'
import type { FormatKeywordCase } from './formatBasicSource'
import { defaultDialect, type BasicDialect } from '../parser/dialects'

const preferenceStorageKey = 'zmakebas.preferences'
const preferenceVersion = 1

export type OptionsPaneSectionId = 'target' | 'export' | 'labels' | 'format' | 'display' | 'validation'
export type OptionsPaneSectionCollapsedStates = Record<OptionsPaneSectionId, boolean>

export interface IPreferenceValues {
  readonly automaticParsingEnabled: boolean
  readonly dialect: BasicDialect
  readonly labelIncrement: number
  readonly labelModeEnabled: boolean
  readonly labelStartLine: number
  readonly formatterKeywordCase: FormatKeywordCase
  readonly optionsCollapsed: boolean
  readonly optionsSectionCollapsed: OptionsPaneSectionCollapsedStates
  readonly screenWidth: number
  readonly screenWrapHintsEnabled: boolean
  readonly spectranetEnabled: boolean
  readonly spectrumExportFormat: SpectrumExportFormat
}

export type PreferenceKey = keyof IPreferenceValues

export const preferenceDefaults: IPreferenceValues = {
  automaticParsingEnabled: true,
  dialect: defaultDialect,
  labelIncrement: 2,
  labelModeEnabled: true,
  labelStartLine: 10,
  formatterKeywordCase: 'upper',
  optionsCollapsed: false,
  optionsSectionCollapsed: {
    target: false,
    export: false,
    labels: true,
    format: true,
    display: true,
    validation: true,
  },
  screenWidth: 32,
  screenWrapHintsEnabled: true,
  spectranetEnabled: false,
  spectrumExportFormat: defaultSpectrumExportFormat,
}

type StoredPreferences = Partial<IPreferenceValues> & {
  readonly version?: number
}

export function loadPreferences(): IPreferenceValues {
  const storedPreferences = readStoredPreferences()

  if (!storedPreferences) {
    return preferenceDefaults
  }

  return {
    automaticParsingEnabled: readBooleanPreference(storedPreferences.automaticParsingEnabled, preferenceDefaults.automaticParsingEnabled),
    dialect: readDialectPreference(storedPreferences.dialect, preferenceDefaults.dialect),
    labelIncrement: readIntegerPreference(storedPreferences.labelIncrement, preferenceDefaults.labelIncrement, 1, 1000),
    labelModeEnabled: readBooleanPreference(storedPreferences.labelModeEnabled, preferenceDefaults.labelModeEnabled),
    labelStartLine: readIntegerPreference(storedPreferences.labelStartLine, preferenceDefaults.labelStartLine, 0, 9999),
    formatterKeywordCase: readFormatterKeywordCasePreference(storedPreferences.formatterKeywordCase, preferenceDefaults.formatterKeywordCase),
    optionsCollapsed: readBooleanPreference(storedPreferences.optionsCollapsed, preferenceDefaults.optionsCollapsed),
    optionsSectionCollapsed: readOptionsSectionCollapsedPreference(storedPreferences.optionsSectionCollapsed, preferenceDefaults.optionsSectionCollapsed),
    screenWidth: readIntegerPreference(storedPreferences.screenWidth, preferenceDefaults.screenWidth, 1, 256),
    screenWrapHintsEnabled: readBooleanPreference(storedPreferences.screenWrapHintsEnabled, preferenceDefaults.screenWrapHintsEnabled),
    spectranetEnabled: readBooleanPreference(storedPreferences.spectranetEnabled, preferenceDefaults.spectranetEnabled),
    spectrumExportFormat: readSpectrumExportFormatPreference(storedPreferences.spectrumExportFormat, preferenceDefaults.spectrumExportFormat),
  }
}

export function loadPreference<Key extends PreferenceKey>(key: Key): IPreferenceValues[Key] {
  return loadPreferences()[key]
}

export function savePreference<Key extends PreferenceKey>(key: Key, value: IPreferenceValues[Key]): void {
  savePreferences({
    ...loadPreferences(),
    [key]: value,
  })
}

function readStoredPreferences(): StoredPreferences | null {
  const localStorage = getLocalStorage()
  if (!localStorage) {
    return null
  }

  try {
    const serializedPreferences = localStorage.getItem(preferenceStorageKey)
    if (!serializedPreferences) {
      return null
    }

    const parsedPreferences: unknown = JSON.parse(serializedPreferences)
    if (!isRecord(parsedPreferences)) {
      return null
    }

    return parsedPreferences.version === preferenceVersion ? parsedPreferences : null
  } catch (error) {
    console.error('Unable to load preferences.', error)
    return null
  }
}

function savePreferences(preferences: IPreferenceValues): void {
  const localStorage = getLocalStorage()
  if (!localStorage) {
    return
  }

  try {
    localStorage.setItem(
      preferenceStorageKey,
      JSON.stringify({
        version: preferenceVersion,
        ...preferences,
      }),
    )
  } catch (error) {
    console.error('Unable to save preferences.', error)
  }
}

function getLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readBooleanPreference(value: unknown, defaultValue: boolean): boolean {
  return typeof value === 'boolean' ? value : defaultValue
}

function readIntegerPreference(value: unknown, defaultValue: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : defaultValue
}

function readDialectPreference(value: unknown, defaultValue: BasicDialect): BasicDialect {
  return value === 'spectrum' || value === 'ts2068' || value === 'zx81' ? value : defaultValue
}

function readFormatterKeywordCasePreference(value: unknown, defaultValue: FormatKeywordCase): FormatKeywordCase {
  return value === 'upper' || value === 'lower' ? value : defaultValue
}

function readOptionsSectionCollapsedPreference(value: unknown, defaultValue: OptionsPaneSectionCollapsedStates): OptionsPaneSectionCollapsedStates {
  if (!isRecord(value)) {
    return defaultValue
  }

  return {
    target: readBooleanPreference(value.target, defaultValue.target),
    export: readBooleanPreference(value.export, defaultValue.export),
    labels: readBooleanPreference(value.labels, defaultValue.labels),
    format: readBooleanPreference(value.format, defaultValue.format),
    display: readBooleanPreference(value.display, defaultValue.display),
    validation: readBooleanPreference(value.validation, defaultValue.validation),
  }
}

function readSpectrumExportFormatPreference(value: unknown, defaultValue: SpectrumExportFormat): SpectrumExportFormat {
  return value === 'tap' || value === 'plus3dos' ? value : defaultValue
}
