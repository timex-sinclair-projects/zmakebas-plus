import type { ReactNode } from 'react'
import ButtonGroup from 'react-bootstrap/ButtonGroup'
import Button from 'react-bootstrap/Button'
import Collapse from 'react-bootstrap/Collapse'
import Form from 'react-bootstrap/Form'
import { BsArrowClockwise, BsChevronDown } from 'react-icons/bs'
import type { FormatKeywordCase } from '../services/formatBasicSource'
import type { OptionsPaneSectionCollapsedStates, OptionsPaneSectionId } from '../services/preferences'
import type { ProgramExportFormat } from '../services/programFile'
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
const spectrumProgramExportFormatOptions: readonly RadioSelectionOption<ProgramExportFormat>[] = [
  { id: 'spectrum-export-tap', label: 'TAP file', value: 'tap' },
  { id: 'spectrum-export-wav', label: 'WAV file', value: 'wav' },
  { id: 'spectrum-export-plus3dos', label: '+3DOS file', value: 'plus3dos' },
]
const ts2068ExportFormatOptions: readonly RadioSelectionOption<ProgramExportFormat>[] = [
  { id: 'ts2068-export-tap', label: 'TAP file', value: 'tap' },
  { id: 'ts2068-export-dck', label: 'DCK file', value: 'dck' },
  { id: 'ts2068-export-wav', label: 'WAV file', value: 'wav' },
]
const zx81ExportFormatOptions: readonly RadioSelectionOption<ProgramExportFormat>[] = [
  { id: 'zx81-export-p', label: 'P file', value: 'tap' },
  { id: 'zx81-export-wav', label: 'WAV file', value: 'wav' },
]
const formatterKeywordCaseOptions: readonly RadioSelectionOption<FormatKeywordCase>[] = [
  { id: 'formatter-keyword-case-upper', label: 'UPPERCASE keywords', value: 'upper' },
  { id: 'formatter-keyword-case-lower', label: 'lowercase keywords', value: 'lower' },
]

type ParserOptionsPaneProps = {
  readonly automaticParsingEnabled: boolean
  readonly canShowDiagnostics: boolean
  readonly dialect: BasicDialect
  readonly diagnosticsOpen: boolean
  readonly formatterKeywordCase: FormatKeywordCase
  readonly labelIncrement: number
  readonly labelModeEnabled: boolean
  readonly labelStartLine: number
  readonly optionsSectionCollapsed: OptionsPaneSectionCollapsedStates
  readonly screenWidth: number
  readonly screenWrapHintsEnabled: boolean
  readonly spectranetEnabled: boolean
  readonly programExportFormat: ProgramExportFormat
  readonly onAutomaticParsingEnabledChange: (enabled: boolean) => void
  readonly onDiagnosticsOpenChange: (open: boolean) => void
  readonly onDialectChange: (dialect: BasicDialect) => void
  readonly onFormatterKeywordCaseChange: (keywordCase: FormatKeywordCase) => void
  readonly onLabelIncrementChange: (increment: number) => void
  readonly onLabelModeEnabledChange: (enabled: boolean) => void
  readonly onLabelStartLineChange: (line: number) => void
  readonly onOptionsSectionCollapsedChange: (collapsedStates: OptionsPaneSectionCollapsedStates) => void
  readonly onScreenWidthChange: (width: number) => void
  readonly onScreenWrapHintsEnabledChange: (enabled: boolean) => void
  readonly onSpectranetEnabledChange: (enabled: boolean) => void
  readonly onProgramExportFormatChange: (format: ProgramExportFormat) => void
  readonly onValidate: () => void
}

export function ParserOptionsPane({
  automaticParsingEnabled,
  canShowDiagnostics,
  dialect,
  diagnosticsOpen,
  formatterKeywordCase,
  labelIncrement,
  labelModeEnabled,
  labelStartLine,
  optionsSectionCollapsed,
  screenWidth,
  screenWrapHintsEnabled,
  spectranetEnabled,
  programExportFormat,
  onAutomaticParsingEnabledChange,
  onDiagnosticsOpenChange,
  onDialectChange,
  onFormatterKeywordCaseChange,
  onLabelIncrementChange,
  onLabelModeEnabledChange,
  onLabelStartLineChange,
  onOptionsSectionCollapsedChange,
  onScreenWidthChange,
  onScreenWrapHintsEnabledChange,
  onSpectranetEnabledChange,
  onProgramExportFormatChange,
  onValidate,
}: ParserOptionsPaneProps) {
  function isSectionOpen(sectionId: OptionsPaneSectionId): boolean {
    return !optionsSectionCollapsed[sectionId]
  }

  function toggleSection(sectionId: OptionsPaneSectionId): void {
    onOptionsSectionCollapsedChange({
      ...optionsSectionCollapsed,
      [sectionId]: !optionsSectionCollapsed[sectionId],
    })
  }

  function sectionProps(sectionId: OptionsPaneSectionId): Pick<CollapsibleOptionGroupProps, 'id' | 'open' | 'onToggle'> {
    return {
      id: `${sectionId}-options`,
      open: isSectionOpen(sectionId),
      onToggle: () => toggleSection(sectionId),
    }
  }

  return (
    <aside className="options-pane" aria-label="BASIC options">
      <div className="options-pane-header">
        <div>
          <h2>Options</h2>
          <span>BASIC settings</span>
        </div>
      </div>
      <div className="options-pane-body">
        <CollapsibleOptionGroup title="Target" {...sectionProps('target')}>
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
        </CollapsibleOptionGroup>

        {dialect === 'spectrum' ? (
          <CollapsibleOptionGroup title="Export" {...sectionProps('export')}>
            <RadioSelection ariaLabel="Spectrum export format" name="spectrum-export-format" options={spectrumProgramExportFormatOptions} value={programExportFormat} onChange={onProgramExportFormatChange} />
          </CollapsibleOptionGroup>
        ) : null}

        {dialect === 'ts2068' ? (
          <CollapsibleOptionGroup title="Export" {...sectionProps('export')}>
            <RadioSelection ariaLabel="TS2068 export format" name="ts2068-export-format" options={ts2068ExportFormatOptions} value={programExportFormat} onChange={onProgramExportFormatChange} />
          </CollapsibleOptionGroup>
        ) : null}

        {dialect === 'zx81' ? (
          <CollapsibleOptionGroup title="Export" {...sectionProps('export')}>
            <RadioSelection ariaLabel="ZX81 export format" name="zx81-export-format" options={zx81ExportFormatOptions} value={programExportFormat} onChange={onProgramExportFormatChange} />
          </CollapsibleOptionGroup>
        ) : null}

        <CollapsibleOptionGroup title="Labels" {...sectionProps('labels')}>
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
        </CollapsibleOptionGroup>

        <CollapsibleOptionGroup title="Format" {...sectionProps('format')}>
          <RadioSelection
            ariaLabel="Formatter keyword case"
            name="formatter-keyword-case"
            options={formatterKeywordCaseOptions}
            value={formatterKeywordCase}
            onChange={onFormatterKeywordCaseChange}
          />
        </CollapsibleOptionGroup>

        <CollapsibleOptionGroup title="Display" {...sectionProps('display')}>
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
        </CollapsibleOptionGroup>

        <CollapsibleOptionGroup title="Validation" {...sectionProps('validation')}>
          <Form.Check
            className="option-check"
            type="checkbox"
            id="automatic-parsing-enabled"
            label="Auto validate"
            checked={automaticParsingEnabled}
            onChange={(event) => onAutomaticParsingEnabledChange(event.currentTarget.checked)}
          />
          {!automaticParsingEnabled ? (
            <Button type="button" variant="outline-secondary" className="option-action-button" onClick={onValidate}>
              <BsArrowClockwise aria-hidden="true" />
              Validate
            </Button>
          ) : null}
        </CollapsibleOptionGroup>
      </div>
      <div className="options-pane-footer">
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
      </div>
    </aside>
  )
}

type CollapsibleOptionGroupProps = {
  readonly children: ReactNode
  readonly id: string
  readonly open: boolean
  readonly title: string
  readonly onToggle: () => void
}

function CollapsibleOptionGroup({
  children,
  id,
  open,
  title,
  onToggle,
}: CollapsibleOptionGroupProps) {
  return (
    <section className={`option-group${open ? ' is-open' : ''}`}>
      <h3>
        <button type="button" className="option-group-toggle" aria-controls={id} aria-expanded={open} onClick={onToggle}>
          <span>{title}</span>
          <BsChevronDown aria-hidden="true" />
        </button>
      </h3>
      <Collapse in={open}>
        <div id={id}>
          <div className="option-group-content">{children}</div>
        </div>
      </Collapse>
    </section>
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
