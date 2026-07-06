type VersionImportMeta = ImportMeta & {
  readonly env?: {
    readonly VITE_ZMAKEBAS_VERSION?: string
  }
}

export const zmakebasVersion = (import.meta as VersionImportMeta).env?.VITE_ZMAKEBAS_VERSION ?? '0.0.0-dev'
