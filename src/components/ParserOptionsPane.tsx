import ButtonGroup from 'react-bootstrap/ButtonGroup'
import Button from 'react-bootstrap/Button'
import Form from 'react-bootstrap/Form'
import { BsArrowClockwise } from 'react-icons/bs'
import type { SpectrumExportFormat } from '../services/programFile'
import type { BasicDialect } from '../parser'
import { NumberStepper } from './NumberStepper'
import { RadioSelection, type RadioSelectionOption } from './RadioSelection'

const labelStartLineStep = 10
const minScreenWidth = 1
const maxScreenWidth = 256
const targetDialectOptions: readonly RadioSelectionOption<BasicDialect>[] = [
  { id: 'dialect-spectrum', label: 'ZX Spectrum', value: 'spectrum' },
  { id: 'dialect-ts2068', label: 'TS2068', value: 'ts2068' },
  { id: 'dialect-zx81', label: 'ZX81', value: 'zx81' },
]
const spectrumExportFormatOptions: readonly RadioSelectionOption<SpectrumExportFormat>[] = [
  { id: 'spectrum-export-tap', label: 'TAP', value: 'tap' },
  { id: 'spectrum-export-plus3dos', label: '+3DOS', value: 'plus3dos' },
]

type ParserOptionsPaneProps = {
  readonly automaticParsingEnabled: boolean
  readonly canShowDiagnostics: boolean
  readonly dialect: BasicDialect
  readonly diagnosticsOpen: boolean
  readonly labelIncrement: number
  readonly labelModeEnabled: boolean
  readonly labelStartLine: number
  readonly screenWidth: number
  readonly screenWrapHintsEnabled: boolean
  readonly spectranetEnabled: boolean
  readonly spectrumExportFormat: SpectrumExportFormat
  readonly onAutomaticParsingEnabledChange: (enabled: boolean) => void
  readonly onDiagnosticsOpenChange: (open: boolean) => void
  readonly onDialectChange: (dialect: BasicDialect) => void
  readonly onLabelIncrementChange: (increment: number) => void
  readonly onLabelModeEnabledChange: (enabled: boolean) => void
  readonly onLabelStartLineChange: (line: number) => void
  readonly onScreenWidthChange: (width: number) => void
  readonly onScreenWrapHintsEnabledChange: (enabled: boolean) => void
  readonly onSpectranetEnabledChange: (enabled: boolean) => void
  readonly onSpectrumExportFormatChange: (format: SpectrumExportFormat) => void
  readonly onValidate: () => void
}

export function ParserOptionsPane({
  automaticParsingEnabled,
  canShowDiagnostics,
  dialect,
  diagnosticsOpen,
  labelIncrement,
  labelModeEnabled,
  labelStartLine,
  screenWidth,
  screenWrapHintsEnabled,
  spectranetEnabled,
  spectrumExportFormat,
  onAutomaticParsingEnabledChange,
  onDiagnosticsOpenChange,
  onDialectChange,
  onLabelIncrementChange,
  onLabelModeEnabledChange,
  onLabelStartLineChange,
  onScreenWidthChange,
  onScreenWrapHintsEnabledChange,
  onSpectranetEnabledChange,
  onSpectrumExportFormatChange,
  onValidate,
}: ParserOptionsPaneProps) {
  return (
    <aside className="options-pane" aria-label="BASIC options">
      <div className="options-pane-header">
        <div>
          <h2>Options</h2>
          <span>BASIC settings</span>
        </div>
      </div>
      <div className="options-pane-body">
        <section className="option-group">
          <h3>Target</h3>
          <RadioSelection ariaLabel="Target dialect" name="target-dialect" options={targetDialectOptions} value={dialect} onChange={onDialectChange} />
          <Form.Check
            className="option-check"
            type="checkbox"
            id="spectranet-enabled"
            label="Spectranet"
            checked={dialect === 'spectrum' && spectranetEnabled}
            disabled={dialect !== 'spectrum'}
            onChange={(event) => onSpectranetEnabledChange(event.currentTarget.checked)}
          />
        </section>

        {dialect === 'spectrum' ? (
          <section className="option-group">
            <h3>Export</h3>
            <RadioSelection ariaLabel="Spectrum export format" name="spectrum-export-format" options={spectrumExportFormatOptions} value={spectrumExportFormat} onChange={onSpectrumExportFormatChange} />
          </section>
        ) : null}

        <section className="option-group">
          <h3>Labels</h3>
          <Form.Check
            className="option-check"
            type="checkbox"
            id="label-mode-enabled"
            label="Label mode"
            checked={labelModeEnabled}
            onChange={(event) => onLabelModeEnabledChange(event.currentTarget.checked)}
          />
          <div className={`label-mode-settings${labelModeEnabled ? '' : ' is-hidden'}`} aria-hidden={!labelModeEnabled}>
            <NumberStepper
              canStepDown={labelStartLine > 0}
              canStepUp={labelStartLine < 9999}
              className="label-number-control"
              id="label-start-line"
              inputGroupClassName="label-number-input"
              label="Start line"
              stepDownLabel="Decrease start line"
              stepUpLabel="Increase start line"
              value={String(labelStartLine)}
              onChange={(value) => commitNumberValue(value, 0, 9999, onLabelStartLineChange)}
              onStepDown={() => onLabelStartLineChange(previousRoundedStep(labelStartLine, labelStartLineStep, 0))}
              onStepUp={() => onLabelStartLineChange(nextRoundedStep(labelStartLine, labelStartLineStep, 9999))}
            />
            <NumberStepper
              canStepDown={labelIncrement > 1}
              canStepUp={labelIncrement < 1000}
              className="label-number-control"
              id="label-increment"
              inputGroupClassName="label-number-input"
              label="Increment"
              stepDownLabel="Decrease increment"
              stepUpLabel="Increase increment"
              value={String(labelIncrement)}
              onChange={(value) => commitNumberValue(value, 1, 1000, onLabelIncrementChange)}
              onStepDown={() => commitNumberValue(String(labelIncrement - 1), 1, 1000, onLabelIncrementChange)}
              onStepUp={() => commitNumberValue(String(labelIncrement + 1), 1, 1000, onLabelIncrementChange)}
            />
          </div>
        </section>

        <section className="option-group">
          <h3>Display</h3>
          <Form.Check
            className="option-check"
            type="checkbox"
            id="screen-wrap-hints-enabled"
            label="Screen wrap hints"
            checked={screenWrapHintsEnabled}
            onChange={(event) => onScreenWrapHintsEnabledChange(event.currentTarget.checked)}
          />
          <div className={`label-mode-settings${screenWrapHintsEnabled ? '' : ' is-hidden'}`} aria-hidden={!screenWrapHintsEnabled}>
            <NumberStepper
              canStepDown={screenWidth > minScreenWidth}
              canStepUp={screenWidth < maxScreenWidth}
              className="label-number-control"
              id="screen-width"
              inputGroupClassName="label-number-input"
              label="Screen width"
              stepDownLabel="Decrease screen width"
              stepUpLabel="Increase screen width"
              value={String(screenWidth)}
              onChange={(value) => commitNumberValue(value, minScreenWidth, maxScreenWidth, onScreenWidthChange)}
              onStepDown={() => onScreenWidthChange(Math.max(minScreenWidth, screenWidth - 1))}
              onStepUp={() => onScreenWidthChange(Math.min(maxScreenWidth, screenWidth + 1))}
            />
          </div>
        </section>

        <section className="option-group">
          <h3>Validation</h3>
          <Form.Check
            className="option-check"
            type="checkbox"
            id="automatic-parsing-enabled"
            label="Auto validate"
            checked={automaticParsingEnabled}
            onChange={(event) => onAutomaticParsingEnabledChange(event.currentTarget.checked)}
          />
          {!automaticParsingEnabled ? (
            <Button type="button" variant="outline-secondary" className="validate-source-button" onClick={onValidate}>
              <BsArrowClockwise aria-hidden="true" />
              Validate
            </Button>
          ) : null}
          <ButtonGroup className="view-mode-control" aria-label="Workspace view">
            <Button type="button" variant={diagnosticsOpen ? 'outline-secondary' : 'secondary'} aria-pressed={!diagnosticsOpen} onClick={() => onDiagnosticsOpenChange(false)}>
              Editor
            </Button>
            <Button
              type="button"
              variant={diagnosticsOpen ? 'secondary' : 'outline-secondary'}
              aria-pressed={diagnosticsOpen}
              disabled={!canShowDiagnostics}
              title={canShowDiagnostics ? undefined : 'Diagnostics are available after successful validation.'}
              onClick={() => onDiagnosticsOpenChange(true)}
            >
              Diagnostics
            </Button>
          </ButtonGroup>
        </section>
      </div>
    </aside>
  )
}

function commitNumberValue(value: string, min: number, max: number, onChange: (value: number) => void): void {
  const nextValue = Number.parseInt(value, 10)
  if (!Number.isFinite(nextValue)) {
    return
  }

  onChange(Math.min(max, Math.max(min, Math.trunc(nextValue))))
}

function nextRoundedStep(value: number, step: number, max: number): number {
  return Math.min(max, Math.floor(value / step) * step + step)
}

function previousRoundedStep(value: number, step: number, min: number): number {
  return Math.max(min, Math.ceil(value / step) * step - step)
}
