import { useMemo, useState, type FormEvent } from 'react'
import Button from 'react-bootstrap/Button'
import Form from 'react-bootstrap/Form'
import Modal from 'react-bootstrap/Modal'
import { BsExclamationTriangleFill } from 'react-icons/bs'
import type { ProgramFileEntry } from '../parser'

type ProgramFileSelectionDialogProps = {
  readonly confirmLabel?: string
  readonly entries: readonly ProgramFileEntry[]
  readonly formatName?: string
  readonly fileName: string
  readonly showFileName?: boolean
  readonly show: boolean
  readonly warningMessage?: string
  readonly onCancel: () => void
  readonly onConfirm: (entryId: number) => void
}

export function ProgramFileSelectionDialog({
  confirmLabel = 'Load',
  entries,
  fileName,
  formatName = 'program file',
  showFileName = true,
  show,
  warningMessage,
  onCancel,
  onConfirm,
}: ProgramFileSelectionDialogProps) {
  const loadableEntries = useMemo(() => entries.filter((entry) => entry.loadable), [entries])
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null)
  const effectiveSelectedEntryId = loadableEntries.some((entry) => entry.id === selectedEntryId) ? selectedEntryId : loadableEntries[0]?.id ?? null
  const canSubmit = effectiveSelectedEntryId !== null

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    if (effectiveSelectedEntryId === null) {
      return
    }

    onConfirm(effectiveSelectedEntryId)
  }

  return (
    <Modal show={show} onHide={onCancel} centered>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title>Select {formatName} entry</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {showFileName ? <div className="program-file-selection-file-name">{fileName}</div> : null}
          <div className="program-file-entry-list" role="radiogroup" aria-label={`${formatName} entries`}>
            {entries.map((entry) => (
              <label
                key={entry.id}
                className={`program-file-entry-option${entry.loadable ? '' : ' is-disabled'}${effectiveSelectedEntryId === entry.id ? ' is-selected' : ''}`}
                htmlFor={`program-file-entry-${entry.id}`}
              >
                <Form.Check
                  checked={effectiveSelectedEntryId === entry.id}
                  className="program-file-entry-input visually-hidden"
                  disabled={!entry.loadable}
                  id={`program-file-entry-${entry.id}`}
                  name="program-file-entry"
                  type="radio"
                  onChange={() => setSelectedEntryId(entry.id)}
                />
                <span className="program-file-entry-copy">
                  <span className="program-file-entry-title">
                    {entry.name || 'Unnamed'}
                    <span className="program-file-entry-type">{entry.typeLabel}</span>
                    {entry.metaOnTitleLine ? <span className="program-file-entry-type">{entry.dataLength.toLocaleString()} bytes</span> : null}
                  </span>
                  {!entry.metaOnTitleLine ? (
                    <span className="program-file-entry-meta">
                      {entry.dataLength.toLocaleString()} bytes
                      {entry.basicLength !== null ? `, ${entry.basicLength.toLocaleString()} BASIC bytes` : ''}
                      {entry.autostartLine !== null ? `, auto-start ${entry.autostartLine}` : ''}
                      {entry.autostartLine === null && entry.autostart ? ', auto-start' : ''}
                    </span>
                  ) : null}
                  {entry.details?.map((detail) => (
                    <span key={detail} className="program-file-entry-meta">
                      {detail}
                    </span>
                  ))}
                </span>
              </label>
            ))}
          </div>
          {warningMessage ? (
            <div className="alert alert-warning d-flex align-items-center gap-2 mt-3 mb-0" role="alert">
              <BsExclamationTriangleFill aria-hidden="true" className="program-file-entry-warning-icon flex-shrink-0" />
              <span>{warningMessage}</span>
            </div>
          ) : loadableEntries.length === 0 ? (
            <div className="invalid-feedback d-block mt-2">No BASIC program entries are available in this {formatName} file.</div>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button type="button" variant="outline-secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {confirmLabel}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  )
}
