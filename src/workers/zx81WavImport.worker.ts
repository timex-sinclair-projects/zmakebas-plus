import { importZx81WavPrograms } from '../formats'
import type { Zx81WavImportWorkerRequest, Zx81WavImportWorkerResponse } from '../features/zx81Tape/services/zx81WavImportWorkerProtocol'
import { packZx81WavPrograms, transferableZx81WavImportBuffers } from '../features/zx81Tape/services/zx81WavImportTransfer'

type Zx81WavWorkerScope = {
  onmessage: ((event: MessageEvent<Zx81WavImportWorkerRequest>) => void) | null
  postMessage: (message: Zx81WavImportWorkerResponse, transfer?: Transferable[]) => void
}

const workerScope = self as unknown as Zx81WavWorkerScope

workerScope.onmessage = (event) => {
  try {
    const programs = importZx81WavPrograms(new Uint8Array(event.data.bytes), {
      ...event.data.options,
      onProgress: (progress) => workerScope.postMessage({
        progress: { ...progress, fraction: progress.fraction * 0.97 },
        type: 'progress',
      }),
    })
    const transfer = packZx81WavPrograms(programs, (fraction) => workerScope.postMessage({
      progress: { fraction: 0.97 + fraction * 0.03, stage: 'prepare-waveform' },
      type: 'progress',
    }))
    workerScope.postMessage({ transfer, type: 'result' }, transferableZx81WavImportBuffers(transfer))
  } catch (error) {
    workerScope.postMessage({
      message: error instanceof Error ? error.message : 'Unable to decode the ZX81 WAV file.',
      type: 'error',
    })
  }
}
