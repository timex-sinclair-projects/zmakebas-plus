import type { TokenKind } from './tokens'

export type BasicDialect = 'spectrum' | 'ts2068' | 'zx81'
export type BasicExtension = 'spectranet'

export const defaultDialect: BasicDialect = 'spectrum'

export const ts2068OnlyStatementKinds = new Set<TokenKind>(['DELETE', 'ONERR', 'RESET', 'SOUND'])
export const ts2068OnlyExpressionKeywordKinds = new Set<TokenKind>(['STICK', 'FREE'])
export const ts2068OnlyKeywordKinds = new Set<TokenKind>([...ts2068OnlyStatementKinds, ...ts2068OnlyExpressionKeywordKinds])

export const zx81OnlyStatementKinds = new Set<TokenKind>(['UNPLOT', 'SCROLL', 'FAST', 'SLOW'])
export const spectranetStatementKinds = new Set<TokenKind>([
  'SN_ACCEPT',
  'SN_ALOAD',
  'SN_CAT',
  'SN_CD',
  'SN_CLOSE',
  'SN_CONNECT',
  'SN_CONTROL',
  'SN_CP',
  'SN_FSCONFIG',
  'SN_FOPEN',
  'SN_FS',
  'SN_IFCONFIG',
  'SN_INFO',
  'SN_LISTEN',
  'SN_LOAD',
  'SN_LOADSNAP',
  'SN_MKDIR',
  'SN_MOUNT',
  'SN_MV',
  'SN_ONEOF',
  'SN_OPEN',
  'SN_OPENDIR',
  'SN_RECLAIM',
  'SN_RM',
  'SN_RMDIR',
  'SN_SAVE',
  'SN_ASAVE',
  'SN_TAPEIN',
  'SN_UMOUNT',
])

export function isSpectrumFamilyDialect(dialect: BasicDialect): boolean {
  return dialect === 'spectrum' || dialect === 'ts2068'
}

export function isBasicExtensionEnabled(extensions: readonly BasicExtension[] | undefined, extension: BasicExtension): boolean {
  return extensions?.includes(extension) ?? false
}

export function isSpectranetEnabled(dialect: BasicDialect, extensions: readonly BasicExtension[] | undefined): boolean {
  return isSpectrumFamilyDialect(dialect) && isBasicExtensionEnabled(extensions, 'spectranet')
}

export function dialectLabel(dialect: BasicDialect): string {
  switch (dialect) {
    case 'spectrum':
      return 'ZX Spectrum'
    case 'ts2068':
      return 'Timex/Sinclair 2068'
    case 'zx81':
      return 'ZX81'
  }
}
