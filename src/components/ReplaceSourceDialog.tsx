import Button from 'react-bootstrap/Button'
import Modal from 'react-bootstrap/Modal'

export type ReplaceSourceAction = 'clear' | 'sample' | 'upload'

type ReplaceSourceDialogProps = {
  readonly action: ReplaceSourceAction | null
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

export function ReplaceSourceDialog({ action, onCancel, onConfirm }: ReplaceSourceDialogProps) {
  const show = action !== null
  const title = action === 'upload' ? 'Upload program?' : action === 'sample' ? 'Load sample program?' : 'Clear program?'
  const confirmLabel = action === 'upload' ? 'Upload' : action === 'sample' ? 'Load sample' : 'Clear'

  return (
    <Modal show={show} onHide={onCancel} centered>
      <Modal.Header closeButton>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>The current program will be lost.</Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="outline-secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="danger" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
