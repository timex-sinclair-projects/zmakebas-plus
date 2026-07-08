import { useRef, type ChangeEvent } from 'react'
import Button from 'react-bootstrap/Button'
import ButtonGroup from 'react-bootstrap/ButtonGroup'
import { BsDownload, BsEraserFill, BsFileEarmarkCodeFill, BsList, BsUpload } from 'react-icons/bs'
import { programFileFormatName, type SpectrumExportFormat } from '../services/programFile'
import type { BasicDialect } from '../parser'
import { dialectLabel } from '../parser/dialects'

type ParserHeaderProps = {
  readonly canDownloadProgram: boolean
  readonly dialect: BasicDialect
  readonly optionsCollapsed: boolean
  readonly spectrumExportFormat: SpectrumExportFormat
  readonly onOptionsToggle: () => void
  readonly onLoadSample: () => void
  readonly onClear: () => void
  readonly onUploadSource: (file: File) => void
  readonly onSaveSource: () => void
  readonly onDownloadProgram: () => void
}

export function ParserHeader({
  canDownloadProgram,
  dialect,
  optionsCollapsed,
  spectrumExportFormat,
  onOptionsToggle,
  onLoadSample,
  onClear,
  onUploadSource,
  onSaveSource,
  onDownloadProgram,
}: ParserHeaderProps) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const exportLabel = `${programFileFormatName(dialect, spectrumExportFormat)} file`

  function handleUploadChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''

    if (file) {
      onUploadSource(file)
    }
  }

  return (
    <header className="app-header">
      <div className="header-brand">
        <Button
          type="button"
          variant="outline-secondary"
          className="options-toggle"
          aria-label={optionsCollapsed ? 'Show options' : 'Hide options'}
          aria-pressed={!optionsCollapsed}
          onClick={onOptionsToggle}
        >
          <BsList aria-hidden="true" />
        </Button>
        <div className="brand-copy">
          <h1>zmakebas+</h1>
          <span>{dialectLabel(dialect)}</span>
        </div>
      </div>
      <div className="header-action-groups">
        <ButtonGroup className="source-actions" aria-label="Source file actions">
          <Button variant="outline-secondary" onClick={() => uploadInputRef.current?.click()}>
            <BsUpload aria-hidden="true" />
            Upload
          </Button>
          <input ref={uploadInputRef} type="file" accept=".bas,.txt,.tap,.p,text/plain" className="visually-hidden" onChange={handleUploadChange} />
          <Button variant="outline-secondary" onClick={onSaveSource}>
            <BsDownload aria-hidden="true" />
            Download
          </Button>
        </ButtonGroup>
        <ButtonGroup className="secondary-actions" aria-label="Source editing actions">
          <Button variant="outline-secondary" onClick={onLoadSample}>
            <BsFileEarmarkCodeFill aria-hidden="true" />
            Sample
          </Button>
          <Button variant="outline-secondary" onClick={onClear}>
            <BsEraserFill aria-hidden="true" />
            Clear
          </Button>
        </ButtonGroup>
        <Button className="export-format-button" variant="secondary" onClick={onDownloadProgram} disabled={!canDownloadProgram}>
          <BsDownload aria-hidden="true" />
          {exportLabel}
        </Button>
      </div>
    </header>
  )
}
