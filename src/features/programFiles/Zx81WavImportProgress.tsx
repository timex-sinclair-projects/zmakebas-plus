import type { ReactNode } from 'react'
import Button from 'react-bootstrap/Button'
import Modal from 'react-bootstrap/Modal'
import ProgressBar from 'react-bootstrap/ProgressBar'
import type { WavImportProgress } from './useProgramFiles'

export interface IZx81WavImportProgressProps {
  readonly progress: WavImportProgress
  readonly onCancel: () => void
}

/** Shows staged, cancellable progress while a ZX81 WAV is read and decoded. */
export function Zx81WavImportProgress({ progress, onCancel }: IZx81WavImportProgressProps): ReactNode {
  return (
    <Modal
      backdrop="static"
      className="wav-import-progress-modal"
      keyboard={false}
      show
      centered
    >
      <Modal.Header>
        <Modal.Title>Importing ZX81 WAV</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="wav-import-progress-copy">
          <strong className="wav-import-progress-file-name" title={progress.fileName}>{progress.fileName}</strong>
          <span className="wav-import-progress-status" aria-live="polite">{progress.label}</span>
        </div>
        <div className="wav-import-progress-meter">
          <ProgressBar
            animated
            striped
            now={progress.percent}
            aria-label="ZX81 WAV import"
            aria-valuetext={`${progress.label}, ${progress.percent}%`}
          />
          <output>{progress.percent}%</output>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="outline-secondary" autoFocus onClick={onCancel}>
          Cancel
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
