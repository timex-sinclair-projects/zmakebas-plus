import Form from 'react-bootstrap/Form'

export type RadioSelectionOption<Value extends string> = {
  readonly id: string
  readonly label: string
  readonly value: Value
  readonly disabled?: boolean
}

type RadioSelectionProps<Value extends string> = {
  readonly ariaLabel: string
  readonly name: string
  readonly options: readonly RadioSelectionOption<Value>[]
  readonly value: Value
  readonly onChange: (value: Value) => void
}

export function RadioSelection<Value extends string>({ ariaLabel, name, options, value, onChange }: RadioSelectionProps<Value>) {
  return (
    <div className="radio-selection" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <Form.Check
          checked={value === option.value}
          className="radio-selection-option"
          disabled={option.disabled}
          id={option.id}
          key={option.id}
          label={option.label}
          name={name}
          type="radio"
          onChange={() => onChange(option.value)}
        />
      ))}
    </div>
  )
}
