import type { ReactNode } from 'react'
import Form from 'react-bootstrap/Form'

type Zx81CarrierRecoverySwitchProps = {
  readonly changePending: boolean
  readonly enabled: boolean
  readonly onEnabledChange: (enabled: boolean) => void
}

/** Renders the shared ZX81 carrier-recovery control. */
export function Zx81CarrierRecoverySwitch({ changePending, enabled, onEnabledChange }: Zx81CarrierRecoverySwitchProps): ReactNode {
  return (
    <Form.Check
      className="tape-signal-conditioning"
      type="switch"
      id="zx81-carrier-recovery-enabled"
      label="Carrier recovery"
      checked={enabled}
      disabled={changePending}
      onChange={(event) => onEnabledChange(event.currentTarget.checked)}
    />
  )
}
