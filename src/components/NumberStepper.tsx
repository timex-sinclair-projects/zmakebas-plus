import type { KeyboardEvent } from 'react'
import Button from 'react-bootstrap/Button'
import Form from 'react-bootstrap/Form'
import InputGroup from 'react-bootstrap/InputGroup'
import { BsCaretDownFill, BsCaretUpFill } from 'react-icons/bs'

type NumberStepperProps = {
  readonly canStepDown: boolean
  readonly canStepUp: boolean
  readonly id: string
  readonly label: string
  readonly value: string
  readonly ariaHidden?: boolean
  readonly className?: string
  readonly disabled?: boolean
  readonly inputGroupClassName?: string
  readonly invalid?: boolean
  readonly labelClassName?: string
  readonly placeholder?: string
  readonly stepDownLabel: string
  readonly stepperClassName?: string
  readonly stepUpLabel: string
  readonly tabIndex?: number
  readonly onChange: (value: string) => void
  readonly onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  readonly onStepDown: () => void
  readonly onStepUp: () => void
}

export function NumberStepper({
  canStepDown,
  canStepUp,
  id,
  label,
  value,
  ariaHidden,
  className,
  disabled = false,
  inputGroupClassName,
  invalid = false,
  labelClassName,
  placeholder,
  stepDownLabel,
  stepperClassName,
  stepUpLabel,
  tabIndex,
  onChange,
  onKeyDown,
  onStepDown,
  onStepUp,
}: NumberStepperProps) {
  return (
    <div aria-hidden={ariaHidden} className={className}>
      <Form.Label className={labelClassName} htmlFor={id}>
        {label}
      </Form.Label>
      <InputGroup size="sm" className={inputGroupClassName}>
        <Form.Control
          disabled={disabled}
          id={id}
          inputMode="numeric"
          isInvalid={invalid}
          pattern="[0-9]*"
          placeholder={placeholder}
          tabIndex={tabIndex}
          type="text"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        <div className={`number-stepper-buttons${stepperClassName ? ` ${stepperClassName}` : ''}`}>
          <Button aria-label={stepUpLabel} disabled={!canStepUp} size="sm" type="button" variant="outline-secondary" onClick={onStepUp}>
            <BsCaretUpFill aria-hidden="true" />
          </Button>
          <Button aria-label={stepDownLabel} disabled={!canStepDown} size="sm" type="button" variant="outline-secondary" onClick={onStepDown}>
            <BsCaretDownFill aria-hidden="true" />
          </Button>
        </div>
      </InputGroup>
    </div>
  )
}
