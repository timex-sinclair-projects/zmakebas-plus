import { BsCheckCircleFill, BsExclamationTriangleFill } from 'react-icons/bs'
import type { BasicDialect, StatementNode } from '../parser'
import { programFileFormatName, type SpectrumExportFormat } from '../services/programFile'
import { zmakebasVersion } from '../version'
import type { ParseState, SourceCursorPosition } from './types'

type ParserStatusAlertProps = {
  readonly cursorPosition: SourceCursorPosition
  readonly dialect: BasicDialect
  readonly isSourceUnvalidated: boolean
  readonly parseState: ParseState
  readonly spectrumExportFormat: SpectrumExportFormat
}

export function ParserStatusAlert({ cursorPosition, dialect, isSourceUnvalidated, parseState, spectrumExportFormat }: ParserStatusAlertProps) {
  if (isSourceUnvalidated) {
    return (
      <footer className="status-bar status-warning">
        <div className="status-message">
          <BsExclamationTriangleFill aria-hidden="true" />
          <span>The source has changed and has not been validated yet.</span>
        </div>
        <div className="status-actions">
          <span className="status-count status-cursor">
            Ln {cursorPosition.line}, Col {cursorPosition.column}
          </span>
          <span className="status-count">v{zmakebasVersion}</span>
        </div>
      </footer>
    )
  }

  if (parseState.ok) {
    const lineCount = parseState.ast.lines.length
    const statementCount = countStatements(parseState.ast.lines.flatMap((line) => line.statements))
    const downloadFormatLabel = `${programFileFormatName(dialect, spectrumExportFormat)} file`

    return (
      <footer className="status-bar status-ok">
        <div className="status-message">
          <BsCheckCircleFill aria-hidden="true" />
          <strong>Validated</strong>
          <span>{downloadFormatLabel} is ready</span>
        </div>
        <div className="status-actions">
          <span className="status-count">
            {lineCount} lines
          </span>
          <span className="status-count">
            {statementCount} statements
          </span>
          <span className="status-count">
            {parseState.tokens.length} tokens
          </span>
          <span className="status-count status-cursor">
            Ln {cursorPosition.line}, Col {cursorPosition.column}
          </span>
          <span className="status-count">v{zmakebasVersion}</span>
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
      </div>
      <div className="status-actions">
        <span className="status-count status-error-label">
          {parseState.title}
        </span>
        {canGotoError && (
          <span className="status-count status-error-label">
            Line {parseState.line}, Column {parseState.column}
          </span>
        )}
        <span className="status-count status-cursor">
          Ln {cursorPosition.line}, Col {cursorPosition.column}
        </span>
        <span className="status-count">v{zmakebasVersion}</span>
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
