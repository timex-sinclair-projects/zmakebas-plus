import type { ReactNode } from 'react'
import Form from 'react-bootstrap/Form'

type Zx81SignalConditioningSwitchProps = {
  readonly changePending: boolean
  readonly enabled: boolean
  readonly onEnabledChange: (enabled: boolean) => void
}

/** Renders the shared ZX81 detector-conditioning control. */
export function Zx81SignalConditioningSwitch({ changePending, enabled, onEnabledChange }: Zx81SignalConditioningSwitchProps): ReactNode {
  return (
    <Form.Check
      className="tape-signal-conditioning"
      type="switch"
      id="zx81-signal-conditioning-enabled"
      label="Signal conditioning"
      checked={enabled}
      disabled={changePending}
      onChange={(event) => onEnabledChange(event.currentTarget.checked)}
    />
  )
}
