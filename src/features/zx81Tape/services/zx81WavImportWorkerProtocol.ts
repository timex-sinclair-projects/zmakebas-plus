import type { IZx81WavImportOptions, IZx81WavImportProgress } from '../../../formats'
import type { IZx81WavImportTransfer } from './zx81WavImportTransfer'

export type Zx81WavWorkerImportOptions = Pick<
  IZx81WavImportOptions,
  'signalCarrierRecoveryEnabled' | 'signalConditioningEnabled' | 'signalRestorationEnabled'
>

export type Zx81WavImportWorkerRequest = {
  readonly bytes: ArrayBuffer
  readonly options: Zx81WavWorkerImportOptions
  readonly type: 'import'
}

export type Zx81WavImportWorkerResponse =
  | { readonly progress: IZx81WavImportProgress; readonly type: 'progress' }
  | { readonly transfer: IZx81WavImportTransfer; readonly type: 'result' }
  | { readonly message: string; readonly type: 'error' }
