import type { ReactNode } from 'react'
import Form from 'react-bootstrap/Form'

type Zx81SignalRestorationSwitchProps = {
  readonly changePending: boolean
  readonly enabled: boolean
  readonly onEnabledChange: (enabled: boolean) => void
}

/** Renders the shared ZX81 detector noise-reduction control. */
export function Zx81SignalRestorationSwitch({ changePending, enabled, onEnabledChange }: Zx81SignalRestorationSwitchProps): ReactNode {
  return (
    <Form.Check
      className="tape-signal-conditioning"
      type="switch"
      id="zx81-signal-restoration-enabled"
      label="Noise reduction"
      checked={enabled}
      disabled={changePending}
      onChange={(event) => onEnabledChange(event.currentTarget.checked)}
    />
  )
}
