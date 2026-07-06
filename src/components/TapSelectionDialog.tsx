import { useMemo, useState, type FormEvent } from 'react'
import Button from 'react-bootstrap/Button'
import Form from 'react-bootstrap/Form'
import Modal from 'react-bootstrap/Modal'
import type { TapFileEntry } from '../parser'

type TapSelectionDialogProps = {
  readonly entries: readonly TapFileEntry[]
  readonly fileName: string
  readonly show: boolean
  readonly onCancel: () => void
  readonly onConfirm: (entryId: number) => void
}

export function TapSelectionDialog({ entries, fileName, show, onCancel, onConfirm }: TapSelectionDialogProps) {
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
          <Modal.Title>Select TAP entry</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="tap-selection-file-name">{fileName}</div>
          <div className="tap-entry-list" role="radiogroup" aria-label="TAP entries">
            {entries.map((entry) => (
              <label
                key={entry.id}
                className={`tap-entry-option${entry.loadable ? '' : ' is-disabled'}${effectiveSelectedEntryId === entry.id ? ' is-selected' : ''}`}
                htmlFor={`tap-entry-${entry.id}`}
              >
                <Form.Check
                  checked={effectiveSelectedEntryId === entry.id}
                  className="tap-entry-input visually-hidden"
                  disabled={!entry.loadable}
                  id={`tap-entry-${entry.id}`}
                  name="tap-entry"
                  type="radio"
                  onChange={() => setSelectedEntryId(entry.id)}
                />
                <span className="tap-entry-copy">
                  <span className="tap-entry-title">
                    {entry.name || 'Unnamed'}
                    <span className="tap-entry-type">{entry.typeLabel}</span>
                  </span>
                  <span className="tap-entry-meta">
                    {entry.dataLength.toLocaleString()} bytes
                    {entry.basicLength !== null ? `, ${entry.basicLength.toLocaleString()} BASIC bytes` : ''}
                    {entry.autostartLine !== null ? `, auto-start ${entry.autostartLine}` : ''}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {loadableEntries.length === 0 ? <div className="invalid-feedback d-block mt-2">No BASIC program entries are available in this TAP file.</div> : null}
        </Modal.Body>
        <Modal.Footer>
          <Button type="button" variant="outline-secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            Load
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  )
}
