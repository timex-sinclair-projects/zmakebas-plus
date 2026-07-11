export type ProgramFileEntryType = 'program' | 'number-array' | 'character-array' | 'code' | 'unknown'

export type ProgramFileEntry = {
  readonly id: number
  readonly blockIndex: number
  readonly name: string | null
  readonly type: ProgramFileEntryType
  readonly typeLabel: string
  readonly dataLength: number
  readonly details?: readonly string[]
  readonly loadable: boolean
  readonly metaOnTitleLine?: boolean
  readonly autostart: boolean
  readonly autostartLine: number | null
  readonly basicLength: number | null
}
