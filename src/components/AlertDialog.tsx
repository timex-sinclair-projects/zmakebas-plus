import Button from 'react-bootstrap/Button'
import Modal from 'react-bootstrap/Modal'

type AlertDialogProps = {
  readonly message: string | null
  readonly title?: string
  readonly onClose: () => void
}

export function AlertDialog({ message, title = 'Something went wrong', onClose }: AlertDialogProps) {
  return (
    <Modal show={message !== null} onHide={onClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="alert-dialog-message">{message}</p>
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="primary" autoFocus onClick={onClose}>
          OK
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
