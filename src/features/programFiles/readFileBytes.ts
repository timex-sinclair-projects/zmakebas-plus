export type ArrayBufferFileReaderFactory = () => FileReader

/** Reads a browser File or Blob while reporting byte progress and honoring cancellation. */
export function readFileBytes(
  file: Blob,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
  createReader: ArrayBufferFileReaderFactory = () => new FileReader(),
): Promise<Uint8Array> {
  if (signal.aborted) return Promise.reject(createAbortError())

  return new Promise((resolve, reject) => {
    const reader = createReader()
    let settled = false

    const cleanup = (): void => {
      signal.removeEventListener('abort', handleSignalAbort)
      reader.onabort = null
      reader.onerror = null
      reader.onload = null
      reader.onprogress = null
    }
    const settle = (action: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      action()
    }
    const handleSignalAbort = (): void => reader.abort()

    reader.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total)
    }
    reader.onload = () => {
      const result = reader.result
      if (!(result instanceof ArrayBuffer)) {
        settle(() => reject(new Error('Unable to read the WAV file as binary data.')))
        return
      }
      onProgress(1)
      settle(() => resolve(new Uint8Array(result)))
    }
    reader.onerror = () => settle(() => reject(reader.error ?? new Error('Unable to read the WAV file.')))
    reader.onabort = () => settle(() => reject(createAbortError()))
    signal.addEventListener('abort', handleSignalAbort, { once: true })
    try {
      reader.readAsArrayBuffer(file)
    } catch (error) {
      settle(() => reject(error))
    }
  })
}

function createAbortError(): DOMException {
  return new DOMException('ZX81 WAV import was cancelled.', 'AbortError')
}
