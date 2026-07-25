type SaveFilePickerWindow = Window & {
  readonly showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<SaveFileHandle>
}

export type SaveFilePickerOptions = {
  readonly suggestedName?: string
  readonly types?: readonly {
    readonly description: string
    readonly accept: Record<string, readonly string[]>
  }[]
}

type SaveFileHandle = {
  readonly createWritable: () => Promise<WritableFile>
}

type WritableFile = {
  readonly write: (data: Blob) => Promise<void> | void
  readonly close: () => Promise<void> | void
}

/** Saves through the browser picker when available and falls back to a download. */
export async function saveFile(blob: Blob, fileName: string, types: SaveFilePickerOptions['types']): Promise<void> {
  const showSaveFilePicker = (window as SaveFilePickerWindow).showSaveFilePicker

  if (showSaveFilePicker) {
    try {
      const handle = await showSaveFilePicker({ suggestedName: fileName, types })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }

  downloadBlob(blob, fileName)
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
