import { memo, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import Nav from 'react-bootstrap/Nav'
import Tab from 'react-bootstrap/Tab'
import { BsClipboard } from 'react-icons/bs'
import { AstTree } from './AstTree'
import { GeneratedSource } from './GeneratedSource'
import { GoToLineControl } from './GoToLineControl'
import { TokenTable } from './TokenTable'
import type { LineNavigationRequest, ParseState } from './types'

type ParserResultsProps = {
  readonly labelModeEnabled: boolean
  readonly navigationRequest: LineNavigationRequest | null
  readonly parseState: ParseState
  readonly onProcessingStart: () => void
  readonly onProcessingEnd: () => void
}

export const ParserResults = memo(function ParserResults({ labelModeEnabled, navigationRequest, parseState, onProcessingStart, onProcessingEnd }: ParserResultsProps) {
  const [activeTab, setActiveTab] = useState(labelModeEnabled ? 'generated' : 'tree')
  const [diagnosticsLineInput, setDiagnosticsLineInput] = useState('')
  const [diagnosticsNavigationRequest, setDiagnosticsNavigationRequest] = useState<LineNavigationRequest | null>(null)
  const basicLineNumbers = useMemo(
    () => (parseState.ok ? Array.from(new Set(parseState.ast.lines.map((line) => line.lineNumber))).sort((left, right) => left - right) : []),
    [parseState],
  )
  const effectiveNavigationRequest = getLatestNavigationRequest(navigationRequest, diagnosticsNavigationRequest)
  const diagnosticsGotoDisabled = basicLineNumbers.length === 0

  useEffect(() => {
    if (!labelModeEnabled && activeTab === 'generated') {
      setActiveTab('tree')
    }
  }, [activeTab, labelModeEnabled])

  function handleTabSelect(eventKey: string | null): void {
    if (!eventKey || eventKey === activeTab) {
      return
    }

    onProcessingStart()
    window.requestAnimationFrame(() => {
      setActiveTab(eventKey)
      window.requestAnimationFrame(onProcessingEnd)
    })
  }

  function handleCopyGenerated(event: MouseEvent<HTMLElement>): void {
    event.preventDefault()
    event.stopPropagation()

    if (parseState.ok) {
      void navigator.clipboard.writeText(parseState.generatedSource)
    }
  }

  function handleCopyGeneratedKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    if (parseState.ok) {
      void navigator.clipboard.writeText(parseState.generatedSource)
    }
  }

  function handleDiagnosticsGoto(): void {
    const requestedLine = Number.parseInt(diagnosticsLineInput.trim(), 10)
    if (!Number.isFinite(requestedLine) || diagnosticsGotoDisabled) {
      return
    }

    const targetLine = findClosestBasicLineNumber(basicLineNumbers, requestedLine)
    if (targetLine === null) {
      return
    }

    setDiagnosticsLineInput(String(targetLine))
    setDiagnosticsNavigationRequest({
      id: Date.now(),
      line: targetLine,
    })
  }

  function handleTabPointerDown(event: MouseEvent<HTMLElement>): void {
    if (event.target instanceof Element && event.target.closest('.generated-tab-copy')) {
      return
    }

    if (event.target instanceof Element && event.target.closest('[role="tab"]')) {
      onProcessingStart()
    }
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.target instanceof Element && event.target.closest('.generated-tab-copy')) {
      return
    }

    if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element && event.target.closest('[role="tab"]')) {
      onProcessingStart()
    }
  }

  return (
    <section className="tool-panel result-panel" onMouseDownCapture={handleTabPointerDown} onKeyDownCapture={handleTabKeyDown}>
      <Tab.Container activeKey={activeTab} onSelect={handleTabSelect} mountOnEnter unmountOnExit>
        <div className="result-tabs-row">
          <Nav variant="tabs" className="result-tabs">
            {labelModeEnabled ? (
              <Nav.Item>
                <Nav.Link eventKey="generated">
                  <span className="generated-tab-title">
                    Expanded
                    <span
                      aria-disabled={!parseState.ok}
                      aria-label="Copy generated source"
                      className={`generated-tab-copy${parseState.ok ? '' : ' is-disabled'}`}
                      onClick={handleCopyGenerated}
                      onKeyDown={handleCopyGeneratedKeyDown}
                      role="button"
                      tabIndex={parseState.ok ? 0 : -1}
                      title="Copy all"
                    >
                      <BsClipboard aria-hidden="true" />
                    </span>
                  </span>
                </Nav.Link>
              </Nav.Item>
            ) : null}
            <Nav.Item>
              <Nav.Link eventKey="tree">Syntax tree</Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link eventKey="tokens">Tokens</Nav.Link>
            </Nav.Item>
          </Nav>
          <GoToLineControl
            className="diagnostics-goto-line-control"
            disabled={diagnosticsGotoDisabled}
            id="diagnostics-goto-line"
            min={basicLineNumbers[0] ?? 0}
            placeholder={basicLineNumbers.length > 0 ? String(basicLineNumbers[0]) : ''}
            value={diagnosticsLineInput}
            onChange={setDiagnosticsLineInput}
            onSubmit={handleDiagnosticsGoto}
          />
        </div>
        <Tab.Content>
          {labelModeEnabled ? (
            <Tab.Pane eventKey="generated">
              {activeTab === 'generated' ? (
                parseState.ok ? (
                  <GeneratedSource navigationRequest={effectiveNavigationRequest} source={parseState.generatedSource} />
                ) : (
                  <div className="empty-tree">Validate failed</div>
                )
              ) : null}
            </Tab.Pane>
          ) : null}
          <Tab.Pane eventKey="tree">
            {activeTab === 'tree' ? parseState.ok ? <AstTree ast={parseState.ast} navigationRequest={effectiveNavigationRequest} /> : <div className="empty-tree">Validate failed</div> : null}
          </Tab.Pane>
          <Tab.Pane eventKey="tokens">
            {activeTab === 'tokens' ? <TokenTable tokens={parseState.tokens} navigationRequest={effectiveNavigationRequest} /> : null}
          </Tab.Pane>
        </Tab.Content>
      </Tab.Container>
    </section>
  )
})

function findClosestBasicLineNumber(lineNumbers: readonly number[], requestedLine: number): number | null {
  let closestLineNumber: number | null = null
  let closestDistance = Number.POSITIVE_INFINITY

  for (const lineNumber of lineNumbers) {
    const distance = Math.abs(lineNumber - requestedLine)
    if (distance < closestDistance || (distance === closestDistance && (closestLineNumber === null || lineNumber < closestLineNumber))) {
      closestLineNumber = lineNumber
      closestDistance = distance
    }
  }

  return closestLineNumber
}

function getLatestNavigationRequest(
  sourceNavigationRequest: LineNavigationRequest | null,
  diagnosticsNavigationRequest: LineNavigationRequest | null,
): LineNavigationRequest | null {
  if (!sourceNavigationRequest) {
    return diagnosticsNavigationRequest
  }

  if (!diagnosticsNavigationRequest) {
    return sourceNavigationRequest
  }

  return diagnosticsNavigationRequest.id >= sourceNavigationRequest.id ? diagnosticsNavigationRequest : sourceNavigationRequest
}
