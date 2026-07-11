import type { FormEvent, KeyboardEvent } from 'react'
import Button from 'react-bootstrap/Button'
import Form from 'react-bootstrap/Form'
import Modal from 'react-bootstrap/Modal'
import { isDockExport, isPlus3DosExport, programFileFormatName, type ProgramExportFormat } from '../services/programFile'
import type { BasicDialect } from '../parser'
import { NumberStepper } from './NumberStepper'

type ExportDialogProps = {
  readonly autostartEnabled: boolean
  readonly autostartLine: string
  readonly dialect: BasicDialect
  readonly programName: string
  readonly programExportFormat: ProgramExportFormat
  readonly updateImportedFileAvailable: boolean
  readonly updateImportedFileEnabled: boolean
  readonly updateImportedFileFormatName: string
  readonly show: boolean
  readonly validAutostartLines: readonly number[]
  readonly onCancel: () => void
  readonly onAutostartEnabledChange: (enabled: boolean) => void
  readonly onAutostartLineChange: (line: string) => void
  readonly onProgramNameChange: (programName: string) => void
  readonly onUpdateImportedFileEnabledChange: (enabled: boolean) => void
  readonly onConfirm: (programName: string, autostartLine: number | null, updateImportedFile: boolean) => void
}

export function ExportDialog({
  autostartEnabled,
  autostartLine,
  dialect,
  programName,
  programExportFormat,
  updateImportedFileAvailable,
  updateImportedFileEnabled,
  updateImportedFileFormatName,
  show,
  validAutostartLines,
  onCancel,
  onAutostartEnabledChange,
  onAutostartLineChange,
  onProgramNameChange,
  onUpdateImportedFileEnabledChange,
  onConfirm,
}: ExportDialogProps) {
  const formatName = programFileFormatName(dialect, programExportFormat)
  const fileNameOnlyFormat = dialect === 'zx81' || isPlus3DosExport(dialect, programExportFormat) || isDockExport(dialect, programExportFormat)
  const parsedAutostartLine = parseAutostartLine(autostartLine)
  const resolvedAutostartLine = parsedAutostartLine === null ? null : resolveAutostartLine(parsedAutostartLine, validAutostartLines)
  const hasAutostartError = autostartEnabled && resolvedAutostartLine === null
  const canSubmit = !autostartEnabled || resolvedAutostartLine !== null
  const previousValidLine = parsedAutostartLine === null ? validAutostartLines.at(-1) ?? null : previousAutostartLine(parsedAutostartLine, validAutostartLines)
  const nextValidLine = parsedAutostartLine === null ? validAutostartLines[0] ?? null : nextAutostartLine(parsedAutostartLine, validAutostartLines)
  const autostartErrorMessage = parsedAutostartLine === null ? 'Enter a line number from 0 to 9999.' : 'No BASIC lines are available to auto-start.'
  const programNameMaxLength = fileNameOnlyFormat ? 255 : 10
  const autostartHintMessage =
    autostartEnabled && parsedAutostartLine !== null && resolvedAutostartLine !== null && resolvedAutostartLine !== parsedAutostartLine
      ? resolvedAutostartLine > parsedAutostartLine
        ? `Will auto-start at the next valid line number ${resolvedAutostartLine}.`
        : `Will auto-start at the last valid line number ${resolvedAutostartLine}.`
      : ''
  const autostartMessage = hasAutostartError ? autostartErrorMessage : autostartHintMessage

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    if (!canSubmit) {
      return
    }

    onConfirm(programName, autostartEnabled ? resolvedAutostartLine : null, updateImportedFileAvailable && updateImportedFileEnabled)
  }

  function handleAutostartKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (nextValidLine !== null) {
        onAutostartLineChange(String(nextValidLine))
      }
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (previousValidLine !== null) {
        onAutostartLineChange(String(previousValidLine))
      }
    }
  }

  return (
    <Modal show={show} onHide={onCancel} centered>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title>Save {formatName} file</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group controlId="program-name">
            <Form.Label>{fileNameOnlyFormat ? 'File name' : 'Program name'}</Form.Label>
            <Form.Control
              value={programName}
              maxLength={programNameMaxLength}
              autoFocus
              onChange={(event) => onProgramNameChange(event.target.value.slice(0, programNameMaxLength))}
            />
            <Form.Text muted>
              {fileNameOnlyFormat ? `${formatName} files do not store a program name; this is used for the file name.` : 'Spectrum program names are stored as the first 10 characters.'}
            </Form.Text>
          </Form.Group>
          <Form.Group className="mt-3">
            <div className="export-autostart-row">
              <Form.Check
                checked={autostartEnabled}
                id="autostart-enabled"
                label="Auto-start"
                onChange={(event) => onAutostartEnabledChange(event.currentTarget.checked)}
              />
              <NumberStepper
                ariaHidden={!autostartEnabled}
                canStepDown={autostartEnabled && previousValidLine !== null}
                canStepUp={autostartEnabled && nextValidLine !== null}
                className={`export-autostart-line-number${autostartEnabled ? '' : ' is-hidden'}`}
                disabled={!autostartEnabled}
                id="autostart-line"
                inputGroupClassName={`export-autostart-line-control has-validation${hasAutostartError ? ' is-invalid' : ''}`}
                invalid={hasAutostartError}
                label="Line number"
                labelClassName="export-autostart-line-label"
                placeholder="Line number"
                stepDownLabel="Previous valid auto-start line"
                stepperClassName="export-autostart-stepper"
                stepUpLabel="Next valid auto-start line"
                tabIndex={autostartEnabled ? undefined : -1}
                value={autostartLine}
                onChange={onAutostartLineChange}
                onKeyDown={handleAutostartKeyDown}
                onStepDown={() => {
                  if (previousValidLine !== null) {
                    onAutostartLineChange(String(previousValidLine))
                  }
                }}
                onStepUp={() => {
                  if (nextValidLine !== null) {
                    onAutostartLineChange(String(nextValidLine))
                  }
                }}
              />
            </div>
            <div aria-hidden={!autostartMessage} aria-live="polite" className={`export-autostart-message${autostartMessage ? '' : ' is-empty'}`}>
              <span className={hasAutostartError ? 'invalid-feedback d-block' : 'form-text text-muted'}>{autostartMessage || '\u00a0'}</span>
            </div>
          </Form.Group>
          {updateImportedFileAvailable ? (
            <Form.Group className="mt-3">
              <Form.Check
                checked={updateImportedFileEnabled}
                id="update-imported-file"
                label={`Update imported ${updateImportedFileFormatName} entry`}
                onChange={(event) => onUpdateImportedFileEnabledChange(event.currentTarget.checked)}
              />
              <Form.Text muted>Preserve the imported {updateImportedFileFormatName} file and replace only the selected BASIC program entry.</Form.Text>
            </Form.Group>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button type="button" variant="outline-secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            Save
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  )
}

function parseAutostartLine(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null
  }

  const line = Number.parseInt(value, 10)
  return line >= 0 && line <= 9999 ? line : null
}

function resolveAutostartLine(line: number, validLines: readonly number[]): number | null {
  if (validLines.length === 0) {
    return null
  }

  return validLines.find((validLine) => validLine >= line) ?? validLines.at(-1) ?? null
}

function previousAutostartLine(line: number, validLines: readonly number[]): number | null {
  let previousLine: number | null = null

  for (const validLine of validLines) {
    if (validLine >= line) {
      break
    }

    previousLine = validLine
  }

  return previousLine
}

function nextAutostartLine(line: number, validLines: readonly number[]): number | null {
  return validLines.find((validLine) => validLine > line) ?? null
}
