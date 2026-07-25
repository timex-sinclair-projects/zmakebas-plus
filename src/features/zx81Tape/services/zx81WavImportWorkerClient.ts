import type { DecodedZx81Wav, IZx81WavImportProgress } from '../../../formats'
import type { Zx81WavImportWorkerRequest, Zx81WavImportWorkerResponse, Zx81WavWorkerImportOptions } from './zx81WavImportWorkerProtocol'
import { unpackZx81WavPrograms } from './zx81WavImportTransfer'

export interface IZx81WavImportWorker {
  onerror: ((event: ErrorEvent) => void) | null
  onmessage: ((event: MessageEvent<Zx81WavImportWorkerResponse>) => void) | null
  postMessage(message: Zx81WavImportWorkerRequest, transfer: Transferable[]): void
  terminate(): void
}

export type Zx81WavImportWorkerFactory = (url: URL, options: WorkerOptions) => IZx81WavImportWorker

/** Runs ZX81 WAV analysis in a disposable worker and reports progress until completion. */
export function importZx81WavProgramsInWorker(
  bytes: Uint8Array,
  options: Zx81WavWorkerImportOptions,
  onProgress: (progress: IZx81WavImportProgress) => void,
  signal: AbortSignal,
  createWorker?: Zx81WavImportWorkerFactory,
): Promise<DecodedZx81Wav[]> {
  if (signal.aborted) return Promise.reject(createAbortError())

  let worker: IZx81WavImportWorker
  try {
    worker = createWorker
      ? createWorker(new URL('../../../workers/zx81WavImport.worker.ts', import.meta.url), { type: 'module' })
      : new Worker(new URL('../../../workers/zx81WavImport.worker.ts', import.meta.url), { type: 'module' })
  } catch (error) {
    return Promise.reject(error)
  }
  const transferableBuffer = transferableArrayBuffer(bytes)

  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = (): void => {
      signal.removeEventListener('abort', handleAbort)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }
    const settle = (action: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      action()
    }
    const handleAbort = (): void => settle(() => reject(createAbortError()))

    worker.onmessage = (event: MessageEvent<Zx81WavImportWorkerResponse>) => {
      const response = event.data
      if (response.type === 'progress') {
        onProgress(response.progress)
        return
      }
      if (response.type === 'result') {
        settle(() => {
          try {
            resolve(unpackZx81WavPrograms(response.transfer))
          } catch (error) {
            reject(error)
          }
        })
        return
      }
      settle(() => reject(new Error(response.message)))
    }
    worker.onerror = (event: ErrorEvent) => {
      settle(() => reject(new Error(event.message || 'The ZX81 WAV analysis worker failed.')))
    }
    signal.addEventListener('abort', handleAbort, { once: true })

    const request: Zx81WavImportWorkerRequest = {
      bytes: transferableBuffer,
      options,
      type: 'import',
    }
    try {
      worker.postMessage(request, [transferableBuffer])
    } catch (error) {
      settle(() => reject(error))
    }
  })
}

function transferableArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer
  }
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function createAbortError(): DOMException {
  return new DOMException('ZX81 WAV import was cancelled.', 'AbortError')
}
