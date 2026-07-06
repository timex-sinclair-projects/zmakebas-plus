import type { ChangeEvent, FormEvent } from 'react'
import Button from 'react-bootstrap/Button'
import Form from 'react-bootstrap/Form'
import InputGroup from 'react-bootstrap/InputGroup'
import { BsArrowDownSquareFill } from 'react-icons/bs'

type GoToLineControlProps = {
  readonly className: string
  readonly disabled?: boolean
  readonly id: string
  readonly min?: number
  readonly placeholder?: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onSubmit: () => void
}

export function GoToLineControl({ className, disabled = false, id, min, placeholder, value, onChange, onSubmit }: GoToLineControlProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    onSubmit()
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onChange(event.currentTarget.value)
  }

  return (
    <Form className={className} onSubmit={handleSubmit}>
      <Form.Label htmlFor={id}>Go to line</Form.Label>
      <InputGroup size="sm">
        <Form.Control
          aria-label="Go to line number"
          autoComplete="off"
          disabled={disabled}
          id={id}
          inputMode="numeric"
          min={min}
          pattern="[0-9]*"
          placeholder={placeholder}
          type="number"
          value={value}
          onChange={handleChange}
        />
        <Button disabled={disabled} title="Go to line" type="submit" variant="outline-secondary">
          <BsArrowDownSquareFill aria-hidden="true" />
        </Button>
      </InputGroup>
    </Form>
  )
}
