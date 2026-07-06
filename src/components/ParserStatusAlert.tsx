import Button from 'react-bootstrap/Button'
import { BsBullseye, BsCheckCircleFill, BsExclamationTriangleFill } from 'react-icons/bs'
import type { BasicDialect, StatementNode } from '../parser'
import { zmakebasVersion } from '../version'
import type { ParseState, SourceCursorPosition } from './types'

type ParserStatusAlertProps = {
  readonly cursorPosition: SourceCursorPosition
  readonly dialect: BasicDialect
  readonly isSourceUnvalidated: boolean
  readonly parseState: ParseState
  readonly onGotoError: () => void
}

export function ParserStatusAlert({ cursorPosition, dialect, isSourceUnvalidated, parseState, onGotoError }: ParserStatusAlertProps) {
  if (isSourceUnvalidated) {
    return (
      <footer className="status-bar status-warning">
        <div className="status-message">
          <BsExclamationTriangleFill aria-hidden="true" />
          <span>The source has changed and has not been validated yet.</span>
          <span className="status-cursor">
            Ln {cursorPosition.line}, Col {cursorPosition.column}
          </span>
        </div>
        <div className="status-actions">
          <span className="status-count">v{zmakebasVersion}</span>
        </div>
      </footer>
    )
  }

  if (parseState.ok) {
    const lineCount = parseState.ast.lines.length
    const statementCount = countStatements(parseState.ast.lines.flatMap((line) => line.statements))
    const downloadFormatLabel = dialect === 'zx81' ? 'P file' : 'TAP file'

    return (
      <footer className="status-bar status-ok">
        <div className="status-message">
          <BsCheckCircleFill aria-hidden="true" />
          <strong>Ready</strong>
          <span>{downloadFormatLabel}</span>
          <span className="status-cursor">
            Ln {cursorPosition.line}, Col {cursorPosition.column}
          </span>
        </div>
        <div className="status-actions">
          <span className="status-count">v{zmakebasVersion}</span>
          <span className="status-count">
            {lineCount} lines
          </span>
          <span className="status-count">
            {statementCount} statements
          </span>
          <span className="status-count">
            {parseState.tokens.length} tokens
          </span>
        </div>
      </footer>
    )
  }

  const canGotoError = Boolean(parseState.line && parseState.column)

  return (
    <footer className="status-bar status-error">
      <div className="status-message">
        <BsExclamationTriangleFill aria-hidden="true" />
        <span>{parseState.message}</span>
        <span className="status-cursor">
          Ln {cursorPosition.line}, Col {cursorPosition.column}
        </span>
      </div>
      <div className="status-actions">
        <span className="status-count">v{zmakebasVersion}</span>
        <span className="status-count status-error-label">
          {parseState.title}
        </span>
        {canGotoError && (
          <span className="status-count status-error-label">
            Line {parseState.line}, Column {parseState.column}
          </span>
        )}
        {canGotoError && (
          <Button type="button" variant="outline-danger" size="sm" onClick={onGotoError}>
            <BsBullseye aria-hidden="true" />
            Go to error
          </Button>
        )}
      </div>
    </footer>
  )
}

function countStatements(statements: readonly StatementNode[]): number {
  return statements.reduce((total, statement) => {
    if (statement.type === 'IfStatement') {
      return total + 1 + countStatements(statement.thenStatements)
    }

    return total + 1
  }, 0)
}
