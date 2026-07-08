import type {
  BinaryCommandStatementNode,
  BinaryExpressionNode,
  TapeStatementNode,
  DataStatementNode,
  DefFnStatementNode,
  DeleteStatementNode,
  DimStatementNode,
  ExpressionCommandStatementNode,
  ExpressionNode,
  FileSpecExtraNode,
  ForStatementNode,
  GroupedExpressionNode,
  IfStatementNode,
  IndexGroupNode,
  IndexNode,
  InputItemNode,
  InputStatementNode,
  LetStatementNode,
  LineNode,
  NextStatementNode,
  OnErrStatementNode,
  StorageItemNode,
  StorageStatementNode,
  PlotStatementNode,
  PrintControlNode,
  PrintItemNode,
  PrintStatementNode,
  ProgramNode,
  ReadStatementNode,
  RemStatementNode,
  SoundRegisterPairNode,
  SoundStatementNode,
  StatementNode,
  StringLiteralNode,
  SpectranetItemNode,
  SpectranetStatementNode,
  SystemFunctionCallNode,
  UserFunctionCallNode,
  VariableNode,
} from './ast'
import {
  defaultDialect,
  dialectLabel,
  isSpectranetEnabled,
  isSpectrumFamilyDialect,
  spectranetStatementKinds,
  ts2068OnlyExpressionKeywordKinds,
  ts2068OnlyStatementKinds,
  zx81OnlyStatementKinds,
  type BasicDialect,
  type BasicExtension,
} from './dialects'
import { ZxBasicSyntaxError } from './errors'
import { describeToken, tokenKindDisplayName } from './tokenText'
import {
  expressionStarters,
  nonVariableExpressionStarters,
  statementStarters,
  type SourceSpan,
  type Token,
  type TokenKind,
} from './tokens'

export type ParserOptions = {
  readonly dialect?: BasicDialect
  readonly extensions?: readonly BasicExtension[]
}

type ParseVariableOptions = {
  readonly allowSpacedNumericName?: boolean
}

type IndexGroupKind = 'numericVariable' | 'stringVariable' | 'stringSlicer'
type ExpressionValueType = 'numeric' | 'string'

const bareCommands = new Set<TokenKind>(['COPY', 'STOP', 'NEW', 'CONTINUE', 'CLS', 'RETURN', 'RESET', 'SCROLL', 'FAST', 'SLOW'])
const optionalExpressionCommands = new Set<TokenKind>(['LLIST', 'LIST', 'RUN', 'RANDOMIZE', 'RESTORE', 'CLEAR'])
const requiredExpressionCommands = new Set<TokenKind>([
  'MERGE',
  'INK',
  'PAPER',
  'FLASH',
  'BRIGHT',
  'INVERSE',
  'OVER',
  'BORDER',
  'GOTO',
  'GOSUB',
  'PAUSE',
  'CLOSE',
])
const binaryExpressionCommands = new Set<TokenKind>(['BEEP', 'OUT', 'POKE', 'OPEN'])
const attributeControls = new Set<TokenKind>(['PAPER', 'INK', 'BRIGHT', 'FLASH', 'INVERSE', 'OVER'])
const binaryOperators = new Set<TokenKind>([
  'EXPON',
  'MULT',
  'DIV',
  'PLUS',
  'MINUS',
  'EQUAL',
  'GREAT',
  'LESS',
  'GREATEQ',
  'LESSEQ',
  'NOTEQ',
  'AND',
  'OR',
])
const systemFunctionOperandStoppers = new Set<TokenKind>([
  'COMMA',
  'SEMICOLON',
  'APOSTROPHE',
  'ENDPAR',
  'ENDOFSTAT',
  'ENDOFLINE',
  'EOF',
  'THEN',
  'STEP',
  'TO',
])
const noArgumentFunctions = new Set<TokenKind>(['RND', 'PI', 'INKEY', 'FREE'])
const stringSystemFunctions = new Set<TokenKind>(['INKEY', 'SCREEN', 'STR', 'CHR', 'VAL_STR'])
const stringOperandFunctions = new Set<TokenKind>(['CODE', 'LEN', 'VAL', 'VAL_STR'])
const numericOperandFunctions = new Set<TokenKind>([
  'SIN',
  'COS',
  'TAN',
  'ASN',
  'ACS',
  'ATN',
  'LN',
  'EXP',
  'INT',
  'SQR',
  'SGN',
  'ABS',
  'PEEK',
  'IN',
  'STR',
  'CHR',
  'NOT',
])
const comparisonOperators = new Set<TokenKind>(['EQUAL', 'GREAT', 'LESS', 'GREATEQ', 'LESSEQ', 'NOTEQ'])
const unarySystemFunctions = new Set<TokenKind>([
  'CODE',
  'VAL',
  'LEN',
  'SIN',
  'COS',
  'TAN',
  'ASN',
  'ACS',
  'ATN',
  'LN',
  'EXP',
  'INT',
  'SQR',
  'SGN',
  'ABS',
  'PEEK',
  'IN',
  'USR',
  'STR',
  'CHR',
  'VAL_STR',
  'NOT',
])
const contextualVariableNameKinds = new Set<TokenKind>([
  'DEFFN',
  'MERGE',
  'VERIFY',
  'BEEP',
  'CIRCLE',
  'OUT',
  'LPRINT',
  'LLIST',
  'STOP',
  'READ',
  'RESTORE',
  'NEW',
  'BORDER',
  'CONTINUE',
  'DIM',
  'REM',
  'FOR',
  'GOTO',
  'GOSUB',
  'INPUT',
  'LOAD',
  'LIST',
  'LET',
  'PAUSE',
  'NEXT',
  'POKE',
  'PRINT',
  'PLOT',
  'UNPLOT',
  'RUN',
  'SAVE',
  'RANDOMIZE',
  'IF',
  'CLS',
  'DRAW',
  'CLEAR',
  'RETURN',
  'COPY',
  'SCROLL',
  'FAST',
  'SLOW',
  'OPEN',
  'CLOSE',
  'CAT',
  'ERASE',
  'FORMAT',
  'MOVE',
  'DELETE',
  'ONERR',
  'RESET',
  'SOUND',
  'STICK',
  'FREE',
  'LINE',
  'THEN',
  'STEP',
  'AT',
  'TAB',
  'RND',
  'INKEY',
  'PI',
  'FN',
  'POINT',
  'ATTR',
  'STICK',
  'FREE',
  'VAL_STR',
  'VAL',
  'LEN',
  'SIN',
  'COS',
  'TAN',
  'ASN',
  'ACS',
  'ATN',
  'LN',
  'EXP',
  'INT',
  'SQR',
  'SGN',
  'ABS',
  'PEEK',
  'IN',
  'USR',
  'STR',
  'CHR',
  'NOT',
  'BIN',
  'OR',
  'AND',
  'TO',
  'SCREEN',
  'DATA',
  'CODE',
  'INK',
  'PAPER',
  'FLASH',
  'BRIGHT',
  'INVERSE',
  'OVER',
])
const expressionKeywordMeanings = new Set<TokenKind>([
  'FN',
  'RND',
  'INKEY',
  'PI',
  'POINT',
  'ATTR',
  'STICK',
  'FREE',
  'VAL_STR',
  'VAL',
  'LEN',
  'SIN',
  'COS',
  'TAN',
  'ASN',
  'ACS',
  'ATN',
  'LN',
  'EXP',
  'INT',
  'SQR',
  'SGN',
  'ABS',
  'PEEK',
  'IN',
  'USR',
  'STR',
  'CHR',
  'NOT',
  'BIN',
  'SCREEN',
  'CODE',
])
const zx81ExpressionKeywordMeanings = new Set<TokenKind>([
  'RND',
  'INKEY',
  'PI',
  'VAL',
  'LEN',
  'SIN',
  'COS',
  'TAN',
  'ASN',
  'ACS',
  'ATN',
  'LN',
  'EXP',
  'INT',
  'SQR',
  'SGN',
  'ABS',
  'PEEK',
  'USR',
  'STR',
  'CHR',
  'NOT',
  'CODE',
])
const zx81StatementKinds = new Set<TokenKind>([
  'COPY',
  'RETURN',
  'CLEAR',
  'UNPLOT',
  'CLS',
  'IF',
  'RANDOMIZE',
  'SAVE',
  'RUN',
  'PLOT',
  'PRINT',
  'POKE',
  'NEXT',
  'PAUSE',
  'LET',
  'LIST',
  'LOAD',
  'INPUT',
  'GOSUB',
  'GOTO',
  'FOR',
  'REM',
  'DIM',
  'CONTINUE',
  'SCROLL',
  'NEW',
  'FAST',
  'SLOW',
  'STOP',
  'LLIST',
  'LPRINT',
])
export class Parser {
  private cursor = 0
  private readonly dialect: BasicDialect
  private readonly extensions: readonly BasicExtension[]
  private readonly tokens: readonly Token[]

  constructor(tokens: readonly Token[], options: ParserOptions = {}) {
    this.tokens = tokens
    this.dialect = options.dialect ?? defaultDialect
    this.extensions = options.extensions ?? []
  }

  parseProgram(): ProgramNode {
    const start = this.current().span.start
    const lines: LineNode[] = []

    while (!this.at('EOF')) {
      if (this.match('ENDOFLINE')) {
        continue
      }
      lines.push(this.parseLine())
    }

    return {
      type: 'Program',
      lines,
      span: { start, end: this.previous().span.end },
    }
  }

  parseLine(): LineNode {
    const lineNumberToken = this.expect('LINENUMBER')
    const statements = this.parseStatementSequence(new Set<TokenKind>(['ENDOFLINE', 'EOF']))
    const end = this.expect('ENDOFLINE')

    return {
      type: 'Line',
      lineNumber: numberValue(lineNumberToken),
      statements,
      span: joinSpans(lineNumberToken.span, end.span),
    }
  }

  private parseStatementSequence(stopKinds: ReadonlySet<TokenKind>): StatementNode[] {
    const statements: StatementNode[] = []

    while (!this.atAny(stopKinds) && !this.at('EOF')) {
      if (this.dialect === 'zx81' && this.at('ENDOFSTAT')) {
        throw this.error('ZX81 BASIC does not support ":" statement separators.', ['ENDOFLINE'])
      }

      if (this.match('ENDOFSTAT')) {
        statements.push({ type: 'EmptyStatement', span: this.previous().span })
        continue
      }

      if (this.at('RAWBYTE')) {
        this.consumeRawDisplayControlSequences()
        continue
      }

      if (!statementStarters.has(this.current().kind)) {
        throw this.error(`Expected a statement but found ${this.describeCurrent()}.`, 'statement')
      }

      if (!this.isStatementSupported(this.current().kind)) {
        throw this.error(`${tokenKindDisplayName(this.current().kind)} is not supported by the ${this.dialectLabel()} dialect.`, 'statement')
      }

      statements.push(this.parseStatement())
      this.consumeRawDisplayControlSequences()

      if (this.dialect === 'zx81' && this.at('ENDOFSTAT')) {
        throw this.error('ZX81 BASIC does not support ":" statement separators.', ['ENDOFLINE'])
      }

      if (this.at('ENDOFSTAT')) {
        this.advance()
        if (this.atAny(stopKinds) || this.at('EOF')) {
          statements.push({ type: 'EmptyStatement', span: this.previous().span })
        }
        continue
      }

      if (!this.atAny(stopKinds) && !this.at('EOF')) {
        throw this.error(`Expected ":" or end of line but found ${this.describeCurrent()}.`, ['ENDOFSTAT', 'ENDOFLINE'])
      }
    }

    return statements
  }

  private parseStatement(): StatementNode {
    const current = this.current()

    if (this.dialect === 'zx81' && current.kind === 'CLEAR') {
      const command = this.advance()
      return { type: 'BareCommandStatement', command: command.kind, span: command.span }
    }

    if (bareCommands.has(current.kind)) {
      const command = this.advance()
      return { type: 'BareCommandStatement', command: command.kind, span: command.span }
    }

    if (this.at('REM')) {
      return this.parseRem()
    }

    if (optionalExpressionCommands.has(current.kind)) {
      return this.parseExpressionCommand(true)
    }

    if (requiredExpressionCommands.has(current.kind)) {
      return this.parseExpressionCommand(false)
    }

    if (binaryExpressionCommands.has(current.kind)) {
      return this.parseBinaryExpressionCommand()
    }

    switch (current.kind) {
      case 'PRINT':
      case 'LPRINT':
        return this.parsePrint()
      case 'INPUT':
        return this.parseInput()
      case 'PLOT':
      case 'UNPLOT':
      case 'CIRCLE':
      case 'DRAW':
        return this.parsePlot()
      case 'VERIFY':
      case 'LOAD':
      case 'SAVE':
        return this.parseTape()
      case 'DIM':
        return this.parseDim()
      case 'LET':
        return this.parseLet()
      case 'READ':
        return this.parseRead()
      case 'FOR':
        return this.parseFor()
      case 'NEXT':
        return this.parseNext()
      case 'IF':
        return this.parseIf()
      case 'DEFFN':
        return this.parseDefFn()
      case 'DATA':
        return this.parseData()
      case 'DELETE':
        return this.parseDelete()
      case 'ONERR':
        return this.parseOnErr()
      case 'SOUND':
        return this.parseSound()
      case 'CAT':
      case 'ERASE':
      case 'FORMAT':
      case 'MOVE':
        return this.parseStorage()
      default:
        if (spectranetStatementKinds.has(current.kind)) {
          return this.parseSpectranet()
        }
        throw this.error(`Unsupported statement ${this.describeCurrent()}.`, 'statement')
    }
  }

  private parseRem(): RemStatementNode {
    const token = this.expect('REM')
    return {
      type: 'RemStatement',
      comment: String(token.value ?? ''),
      span: token.span,
    }
  }

  private parseExpressionCommand(optional: boolean): ExpressionCommandStatementNode {
    const command = this.advance()
    let expression: ExpressionNode | null = null

    if (!optional || this.canStartExpression(this.current().kind)) {
      expression = this.parseExpression()
      this.expectExpressionType(expression, command.kind === 'MERGE' ? 'string' : 'numeric')
    }

    return {
      type: 'ExpressionCommandStatement',
      command: command.kind,
      expression,
      span: expression ? joinSpans(command.span, expression.span) : command.span,
    }
  }

  private parseBinaryExpressionCommand(): BinaryCommandStatementNode {
    const command = this.advance()
    const left = this.parseExpression()
    this.expectExpressionType(left, 'numeric')
    this.expect('COMMA')
    const right = this.parseExpression()
    this.expectExpressionType(right, command.kind === 'OPEN' ? 'string' : 'numeric')

    return {
      type: 'BinaryCommandStatement',
      command: command.kind,
      left,
      right,
      span: joinSpans(command.span, right.span),
    }
  }

  private parsePrint(): PrintStatementNode {
    const command = this.advance()
    const items = this.parsePrintItems()

    return {
      type: 'PrintStatement',
      command: command.kind === 'LPRINT' ? 'LPRINT' : 'PRINT',
      items,
      span: spanThroughChildren(command.span, items),
    }
  }

  private parsePrintItems(): PrintItemNode[] {
    const items: PrintItemNode[] = []
    let needsSeparator = false

    while (!this.atStatementBoundary()) {
      if (this.isPrintSeparator(this.current().kind)) {
        const token = this.advance()
        items.push({ type: 'PrintSeparator', separator: token.kind, span: token.span })
        needsSeparator = false
        continue
      }

      if (needsSeparator) {
        throw this.error(`Expected a PRINT separator but found ${this.describeCurrent()}.`, ['COMMA', 'SEMICOLON', 'APOSTROPHE'])
      }

      if (this.isPrintControlStart(this.current().kind)) {
        const control = this.parsePrintControl()
        items.push({ type: 'PrintControl', control, span: control.span })
        needsSeparator = true
        continue
      }

      const expression = this.parseExpression()
      items.push({ type: 'PrintExpression', expression, span: expression.span })
      needsSeparator = true
    }

    return items
  }

  private parseInput(): InputStatementNode {
    if (this.dialect === 'zx81') {
      return this.parseZx81Input()
    }

    const command = this.expect('INPUT')
    const items: InputItemNode[] = []
    let needsSeparator = false

    while (!this.atStatementBoundary()) {
      if (this.isPrintSeparator(this.current().kind)) {
        const token = this.advance()
        items.push({ type: 'InputSeparator', separator: token.kind, span: token.span })
        needsSeparator = false
        continue
      }

      if (needsSeparator) {
        throw this.error(`Expected an INPUT separator but found ${this.describeCurrent()}.`, ['COMMA', 'SEMICOLON', 'APOSTROPHE'])
      }

      if (this.isPrintControlStart(this.current().kind)) {
        const control = this.parsePrintControl()
        items.push({ type: 'InputControl', control, span: control.span })
        needsSeparator = true
        continue
      }

      if (this.match('LINE')) {
        const lineToken = this.previous()
        const targetToken = this.current()
        const variable = this.parseVariable({ allowSpacedNumericName: true })
        if (!isStringVariable(variable)) {
          throw new ZxBasicSyntaxError('INPUT LINE target must be a string variable.', targetToken, 'string variable')
        }
        items.push({ type: 'InputTarget', variable, lineInput: true, span: joinSpans(lineToken.span, variable.span) })
        needsSeparator = true
        continue
      }

      if (this.isVariableNameStart(this.current().kind)) {
        const variable = this.parseVariable({ allowSpacedNumericName: true })
        items.push({ type: 'InputTarget', variable, lineInput: false, span: variable.span })
        needsSeparator = true
        continue
      }

      if (this.isNonVariableExpressionStart(this.current().kind)) {
        const expression = this.parseExpression()
        items.push({ type: 'InputExpression', expression, span: expression.span })
        needsSeparator = true
        continue
      }

      throw this.error(`Expected an INPUT item but found ${this.describeCurrent()}.`, 'input item')
    }

    if (items.length === 0) {
      throw this.error(`Expected an INPUT item or separator but found ${this.describeCurrent()}.`, 'input item')
    }

    return {
      type: 'InputStatement',
      items,
      span: spanThroughChildren(command.span, items),
    }
  }

  private parseZx81Input(): InputStatementNode {
    const command = this.expect('INPUT')
    const variable = this.parseVariable({ allowSpacedNumericName: true })
    const item = { type: 'InputTarget', variable, lineInput: false, span: variable.span } satisfies InputItemNode
    return {
      type: 'InputStatement',
      items: [item],
      span: joinSpans(command.span, variable.span),
    }
  }

  private parsePlot(): PlotStatementNode {
    const command = this.advance()
    const controls = this.parsePlotControls()
    const operands: ExpressionNode[] = [this.parseExpression()]
    this.expectExpressionType(operands[0], 'numeric')
    this.expect('COMMA')
    operands.push(this.parseExpression())
    this.expectExpressionType(operands[operands.length - 1], 'numeric')

    if (command.kind === 'CIRCLE') {
      this.expect('COMMA')
      operands.push(this.parseExpression())
      this.expectExpressionType(operands[operands.length - 1], 'numeric')
    } else if (command.kind === 'DRAW' && this.match('COMMA')) {
      operands.push(this.parseExpression())
      this.expectExpressionType(operands[operands.length - 1], 'numeric')
    }

    return {
      type: 'PlotStatement',
      command: command.kind as 'PLOT' | 'CIRCLE' | 'DRAW' | 'UNPLOT',
      controls,
      operands,
      span: spanThroughChildren(command.span, operands),
    }
  }

  private parsePlotControls(): PrintControlNode[] {
    const controls: PrintControlNode[] = []

    while (attributeControls.has(this.current().kind)) {
      const control = this.parsePrintControl()
      controls.push(control)
      this.expectPlotControlSeparator()
    }

    return controls
  }

  private expectPlotControlSeparator(): void {
    if (this.match('SEMICOLON', 'COMMA')) {
      return
    }

    throw this.error(`Expected ";" or "," after plot control but found ${this.describeCurrent()}.`, ['SEMICOLON', 'COMMA'])
  }

  private parseTape(): TapeStatementNode {
    const command = this.advance()
    const fileExpression = this.parseExpression()
    this.expectExpressionType(fileExpression, 'string')

    let extra : FileSpecExtraNode | null;

    if (this.dialect === 'zx81') {
      if (!this.atStatementBoundary()) {
        throw new ZxBasicSyntaxError('ZX81 LOAD and SAVE accept only a string file name.', this.current(), 'end of line')
      }
      extra = null;
    } else {
      extra = this.parseFileSpecExtra(command.kind as 'VERIFY' | 'LOAD' | 'SAVE')
    }

    return {
      type: 'TapeStatement',
      command: command.kind as 'VERIFY' | 'LOAD' | 'SAVE',
      fileExpression,
      extra,
      span: extra ? joinSpans(command.span, extra.span) : joinSpans(command.span, fileExpression.span),
    }
  }

  private parseFileSpecExtra(command: 'VERIFY' | 'LOAD' | 'SAVE'): FileSpecExtraNode | null {
    if (this.match('DATA')) {
      const start = this.previous()
      const variable = this.expectVariableName()
      this.expect('BEGINPAR')
      const end = this.expect('ENDPAR')
      return {
        type: 'DataFileSpec',
        variable: stringValue(variable),
        span: joinSpans(start.span, end.span),
      }
    }

    if (this.match('CODE')) {
      const start = this.previous()
      let address: ExpressionNode | null = null
      let length: ExpressionNode | null = null

      if (command === 'SAVE') {
        address = this.parseExpression()
        this.expectExpressionType(address, 'numeric')
        this.expect('COMMA')
        length = this.parseExpression()
        this.expectExpressionType(length, 'numeric')
      } else if (this.canStartExpression(this.current().kind)) {
        address = this.parseExpression()
        this.expectExpressionType(address, 'numeric')
        length = this.match('COMMA') ? this.parseExpression() : null
        if (length) {
          this.expectExpressionType(length, 'numeric')
        }
      }

      return {
        type: 'CodeFileSpec',
        address,
        length,
        span: length ? joinSpans(start.span, length.span) : address ? joinSpans(start.span, address.span) : start.span,
      }
    }

    if (this.match('SCREEN')) {
      return { type: 'ScreenFileSpec', span: this.previous().span }
    }

    if (this.match('LINE')) {
      const start = this.previous()
      if (command !== 'SAVE') {
        throw new ZxBasicSyntaxError(`${command} does not support LINE file specifiers.`, start, 'SAVE ... LINE')
      }
      const line = this.parseExpression()
      this.expectExpressionType(line, 'numeric')
      return { type: 'LineFileSpec', line, span: joinSpans(start.span, line.span) }
    }

    return null
  }

  private parseDim(): DimStatementNode {
    const start = this.expect('DIM')
    const variable = this.expectVariableName()
    const dimensions = this.parseDimensionList()

    return {
      type: 'DimStatement',
      variable: stringValue(variable),
      dimensions,
      span: spanThroughChildren(joinSpans(start.span, variable.span), dimensions),
    }
  }

  private parseDimensionList(): ExpressionNode[] {
    this.expect('BEGINPAR')
    const dimensions = [this.parseExpression()]
    this.expectExpressionType(dimensions[0], 'numeric')
    while (this.match('COMMA')) {
      dimensions.push(this.parseExpression())
      this.expectExpressionType(dimensions[dimensions.length - 1], 'numeric')
    }
    this.expect('ENDPAR')
    return dimensions
  }

  private parseLet(): LetStatementNode {
    const start = this.expect('LET')
    const target = this.parseVariable({ allowSpacedNumericName: true })
    this.expect('EQUAL')
    const value = this.parseExpression()
    this.expectExpressionType(value, this.variableValueType(target))

    return {
      type: 'LetStatement',
      target,
      value,
      span: joinSpans(start.span, value.span),
    }
  }

  private parseRead(): ReadStatementNode {
    const start = this.expect('READ')
    const targets = [this.parseVariable({ allowSpacedNumericName: true })]

    while (this.match('COMMA')) {
      targets.push(this.parseVariable({ allowSpacedNumericName: true }))
    }

    return {
      type: 'ReadStatement',
      targets,
      span: spanThroughChildren(start.span, targets),
    }
  }

  private parseFor(): ForStatementNode {
    const start = this.expect('FOR')
    const variable = this.expectVariableName()
    if (stringValue(variable).endsWith('$')) {
      throw new ZxBasicSyntaxError('FOR variable must be numeric.', variable, 'numeric variable')
    }
    this.expect('EQUAL')
    const from = this.parseExpression()
    this.expectExpressionType(from, 'numeric')
    this.expect('TO')
    const to = this.parseExpression()
    this.expectExpressionType(to, 'numeric')
    const step = this.match('STEP') ? this.parseExpression() : null
    if (step) {
      this.expectExpressionType(step, 'numeric')
    }

    return {
      type: 'ForStatement',
      variable: stringValue(variable),
      from,
      to,
      step,
      span: joinSpans(start.span, (step ?? to).span),
    }
  }

  private parseNext(): NextStatementNode {
    const start = this.expect('NEXT')
    const variable = this.expectVariableName()
    return {
      type: 'NextStatement',
      variable: stringValue(variable),
      span: joinSpans(start.span, variable.span),
    }
  }

  private parseIf(): IfStatementNode {
    const start = this.expect('IF')
    const condition = this.parseExpression()
    this.expectExpressionType(condition, 'numeric')
    this.expect('THEN')
    const thenStatements = this.parseStatementSequence(new Set<TokenKind>(['ENDOFLINE', 'EOF']))

    return {
      type: 'IfStatement',
      condition,
      thenStatements,
      span: thenStatements.length > 0 ? spanThroughChildren(start.span, thenStatements) : joinSpans(start.span, condition.span),
    }
  }

  private parseDefFn(): DefFnStatementNode {
    const start = this.expect('DEFFN')
    const name = this.expectVariableName()
    this.expect('BEGINPAR')
    const parameters: string[] = []
    if (this.isVariableNameStart(this.current().kind)) {
      parameters.push(this.expectDefFnParameterName())
      while (this.match('COMMA')) {
        parameters.push(this.expectDefFnParameterName())
      }
    }
    this.expect('ENDPAR')
    this.expect('EQUAL')
    const value = this.parseExpression()
    this.expectExpressionType(value, stringValue(name).endsWith('$') ? 'string' : 'numeric')

    return {
      type: 'DefFnStatement',
      name: stringValue(name),
      parameters,
      value,
      span: joinSpans(start.span, value.span),
    }
  }

  private parseData(): DataStatementNode {
    const start = this.expect('DATA')
    const values = [this.parseExpression()]

    while (this.match('COMMA')) {
      values.push(this.parseExpression())
    }

    return {
      type: 'DataStatement',
      values,
      span: spanThroughChildren(start.span, values),
    }
  }

  private parseDelete(): DeleteStatementNode {
    const start = this.expect('DELETE')
    let from: ExpressionNode | null = null
    let to: ExpressionNode | null = null

    if (!this.at('COMMA')) {
      from = this.parseExpression()
      this.expectExpressionType(from, 'numeric')
    }
    this.expect('COMMA')
    if (!this.atStatementBoundary()) {
      to = this.parseExpression()
      this.expectExpressionType(to, 'numeric')
    }

    return {
      type: 'DeleteStatement',
      from,
      to,
      span: to ? joinSpans(start.span, to.span) : from ? joinSpans(start.span, from.span) : start.span,
    }
  }

  private parseOnErr(): OnErrStatementNode {
    const start = this.expect('ONERR')

    if (this.match('GOTO')) {
      const line = this.parseExpression()
      this.expectExpressionType(line, 'numeric')
      return {
        type: 'OnErrStatement',
        action: 'GOTO',
        line,
        span: joinSpans(start.span, line.span),
      }
    }

    if (this.match('CONTINUE')) {
      return {
        type: 'OnErrStatement',
        action: 'CONTINUE',
        line: null,
        span: joinSpans(start.span, this.previous().span),
      }
    }

    if (this.match('RESET')) {
      return {
        type: 'OnErrStatement',
        action: 'RESET',
        line: null,
        span: joinSpans(start.span, this.previous().span),
      }
    }

    throw this.error(`Expected GOTO, CONT or RESET after ON ERR but found ${this.describeCurrent()}.`, ['GOTO', 'CONTINUE', 'RESET'])
  }

  private parseSound(): SoundStatementNode {
    const start = this.expect('SOUND')
    const pairs: SoundRegisterPairNode[] = [this.parseSoundRegisterPair()]

    while (this.match('SEMICOLON')) {
      if (this.atStatementBoundary()) {
        throw this.error('Expected SOUND register pair after semicolon.', 'expression')
      }
      pairs.push(this.parseSoundRegisterPair())
    }

    return {
      type: 'SoundStatement',
      pairs,
      span: spanThroughChildren(start.span, pairs),
    }
  }

  private parseSoundRegisterPair(): SoundRegisterPairNode {
    const register = this.parseExpression()
    this.expectExpressionType(register, 'numeric')
    this.expect('COMMA')
    const value = this.parseExpression()
    this.expectExpressionType(value, 'numeric')
    return {
      register,
      value,
      span: joinSpans(register.span, value.span),
    }
  }

  private parseStorage(): StorageStatementNode {
    if (this.dialect === 'ts2068') {
      const ts2068Storage = this.tryParseTs2068Storage()
      if (ts2068Storage) {
        return ts2068Storage
      }
      throw this.error(`Expected two string operands for TS2068 ${this.current().kind}.`, 'string expression, string expression')
    }

    const command = this.advance()
    const items: StorageItemNode[] = []

    if (command.kind === 'FORMAT' || command.kind === 'ERASE') {
      items.push(this.parseStorageExpression('string'))
    } else if (command.kind === 'MOVE') {
      items.push(this.parseStorageExpression('string'))
      const separator = this.expect('COMMA')
      items.push({ type: 'StorageSeparator', separator: separator.kind, span: separator.span })
      items.push(this.parseStorageExpression('string'))
    }

    return {
      type: 'StorageStatement',
      command: command.kind as 'CAT' | 'ERASE' | 'FORMAT' | 'MOVE',
      items,
      span: spanThroughChildren(command.span, items),
    }
  }

  private tryParseTs2068Storage(): StorageStatementNode | null {
    const startCursor = this.cursor

    try {
      const command = this.advance()
      const first = this.parseStorageExpression('string')
      const separator = this.expect('COMMA')
      const second = this.parseStorageExpression('string')
      const items: StorageItemNode[] = [first, { type: 'StorageSeparator', separator: separator.kind, span: separator.span }, second]

      return {
        type: 'StorageStatement',
        command: command.kind as 'CAT' | 'ERASE' | 'FORMAT' | 'MOVE',
        items,
        span: spanThroughChildren(command.span, items),
      }
    } catch (error) {
      this.cursor = startCursor
      if (error instanceof ZxBasicSyntaxError) {
        return null
      }
      throw error
    }
  }

  private parseStorageExpression(expectedType: ExpressionValueType): StorageItemNode {
    const expression = this.parseExpression()
    this.expectExpressionType(expression, expectedType)
    return { type: 'StorageExpression', expression, span: expression.span }
  }

  private parseSpectranet(): SpectranetStatementNode {
    const command = this.advance()
    const items: SpectranetItemNode[] = []

    switch (command.kind) {
      case 'SN_IFCONFIG':
      case 'SN_FSCONFIG':
      case 'SN_RECLAIM':
        break
      case 'SN_MOUNT':
        items.push(this.parseSpectranetExpression('numeric'))
        items.push(this.parseSpectranetSeparator('COMMA'))
        items.push(this.parseSpectranetExpression('string'))
        break
      case 'SN_UMOUNT':
      case 'SN_FS':
      case 'SN_ONEOF':
        items.push(this.parseSpectranetExpression('numeric'))
        break
      case 'SN_CAT':
        if (!this.atStatementBoundary()) {
          items.push(this.parseSpectranetExpression('string'))
        }
        break
      case 'SN_CD':
      case 'SN_INFO':
      case 'SN_RM':
      case 'SN_MKDIR':
      case 'SN_RMDIR':
      case 'SN_TAPEIN':
      case 'SN_LOADSNAP':
        items.push(this.parseSpectranetExpression('string'))
        break
      case 'SN_MV':
      case 'SN_CP':
        items.push(this.parseSpectranetExpression('string'))
        items.push(this.parseSpectranetSeparator('COMMA'))
        items.push(this.parseSpectranetExpression('string'))
        break
      case 'SN_LOAD':
        items.push(this.parseSpectranetExpression('string'))
        if (this.match('CODE')) {
          items.push(this.spectranetTokenItem(this.previous()))
        }
        break
      case 'SN_SAVE':
        items.push(this.parseSpectranetExpression('string'))
        if (this.match('CODE')) {
          items.push(this.spectranetTokenItem(this.previous()))
          items.push(this.parseSpectranetExpression('numeric'))
          items.push(this.parseSpectranetSeparator('COMMA'))
          items.push(this.parseSpectranetExpression('numeric'))
        } else if (this.match('SCREEN')) {
          items.push(this.spectranetTokenItem(this.previous()))
        } else if (this.match('LINE')) {
          items.push(this.spectranetTokenItem(this.previous()))
          items.push(this.parseSpectranetExpression('numeric'))
        }
        break
      case 'SN_ALOAD':
      case 'SN_ASAVE':
        items.push(this.parseSpectranetExpression('string'))
        items.push(this.spectranetTokenItem(this.expect('CODE')))
        items.push(this.parseSpectranetExpression('numeric'))
        if (command.kind === 'SN_ASAVE') {
          items.push(this.parseSpectranetSeparator('COMMA'))
          items.push(this.parseSpectranetExpression('numeric'))
        }
        break
      case 'SN_FOPEN':
      case 'SN_OPEN':
        items.push(this.parseSpectranetStream())
        items.push(this.parseSpectranetSeparator('COMMA'))
        items.push(this.parseSpectranetExpression('string'))
        items.push(this.parseSpectranetSeparator('COMMA'))
        items.push(this.parseSpectranetExpression('string'))
        break
      case 'SN_OPENDIR':
        items.push(this.parseSpectranetStream())
        items.push(this.parseSpectranetSeparator('COMMA'))
        items.push(this.parseSpectranetExpression('string'))
        break
      case 'SN_CLOSE':
      case 'SN_CONTROL':
        items.push(this.parseSpectranetStream())
        break
      case 'SN_CONNECT':
        items.push(this.parseSpectranetStream())
        items.push(this.parseSpectranetSeparator('COMMA'))
        items.push(this.parseSpectranetExpression('string'))
        items.push(this.parseSpectranetSeparator('COMMA'))
        items.push(this.parseSpectranetExpression('numeric'))
        break
      case 'SN_LISTEN':
        items.push(this.parseSpectranetStream())
        items.push(this.parseSpectranetSeparator('COMMA'))
        items.push(this.parseSpectranetExpression('numeric'))
        break
      case 'SN_ACCEPT':
        items.push(this.parseSpectranetStream())
        items.push(this.parseSpectranetSeparator('COMMA'))
        items.push(this.parseSpectranetExpression('numeric'))
        break
      default:
        throw this.error(`Unsupported Spectranet statement ${tokenKindDisplayName(command.kind)}.`, 'Spectranet statement')
    }

    return {
      type: 'SpectranetStatement',
      command: command.kind,
      items,
      span: spanThroughChildren(command.span, items),
    }
  }

  private parseSpectranetStream(): SpectranetItemNode {
    const stream = this.expect('STREAM')
    const expression = this.parseExpression()
    this.expectExpressionType(expression, 'numeric')
    return {
      type: 'SpectranetExpression',
      expression,
      span: joinSpans(stream.span, expression.span),
    }
  }

  private parseSpectranetExpression(expectedType?: ExpressionValueType): SpectranetItemNode {
    const expression = this.parseExpression()
    if (expectedType) {
      this.expectExpressionType(expression, expectedType)
    }
    return {
      type: 'SpectranetExpression',
      expression,
      span: expression.span,
    }
  }

  private parseSpectranetSeparator(separator: 'COMMA'): SpectranetItemNode {
    return this.spectranetTokenItem(this.expect(separator))
  }

  private spectranetTokenItem(token: Token): SpectranetItemNode {
    return {
      type: 'SpectranetSeparator',
      separator: token.kind,
      span: token.span,
    }
  }

  private parsePrintControl(): PrintControlNode {
    if (attributeControls.has(this.current().kind)) {
      const command = this.advance()
      const value = this.parseExpression()
      this.expectExpressionType(value, 'numeric')
      return {
        type: 'AttributeControl',
        command: command.kind,
        value,
        span: joinSpans(command.span, value.span),
      }
    }

    if (this.match('AT')) {
      const start = this.previous()
      const row = this.parseExpression()
      this.expectExpressionType(row, 'numeric')
      this.expect('COMMA')
      const column = this.parseExpression()
      this.expectExpressionType(column, 'numeric')
      return {
        type: 'AtControl',
        row,
        column,
        span: joinSpans(start.span, column.span),
      }
    }

    if (this.match('TAB')) {
      const start = this.previous()
      const value = this.parseExpression()
      this.expectExpressionType(value, 'numeric')
      return {
        type: 'TabControl',
        value,
        span: joinSpans(start.span, value.span),
      }
    }

    if (this.match('STREAM')) {
      const start = this.previous()
      const value = this.parseExpression()
      this.expectExpressionType(value, 'numeric')
      return {
        type: 'StreamControl',
        value,
        span: joinSpans(start.span, value.span),
      }
    }

    throw this.error(`Expected a print control but found ${this.describeCurrent()}.`, 'print control')
  }

  private parseExpression(minPrecedence = 1): ExpressionNode {
    let left = this.parseHighPrecedenceExpression()

    while (binaryOperators.has(this.current().kind)) {
      const operator = this.current()
      const precedence = operatorPrecedence(operator.kind)
      if (precedence < minPrecedence) {
        break
      }
      this.advance()
      const rightPrecedence = operator.kind === 'EXPON' ? precedence : precedence + 1
      const right = this.parseExpression(rightPrecedence)
      this.expectBinaryOperandTypes(operator, left, right)
      left = {
        type: 'BinaryExpression',
        operator: operator.kind,
        left,
        right,
        span: joinSpans(left.span, right.span),
      }
    }

    return left
  }

  private parseHighPrecedenceExpression(): ExpressionNode {
    if (this.match('PLUS', 'MINUS')) {
      const operator = this.previous()
      const operand = this.parseHighPrecedenceExpression()
      if (operator.kind === 'MINUS') {
        this.expectExpressionType(operand, 'numeric')
      }
      return {
        type: 'UnaryExpression',
        operator: operator.kind,
        operand,
        span: joinSpans(operator.span, operand.span),
      }
    }

    if (this.at('FN')) {
      return this.parseUserFunctionCall()
    }

    if (this.shouldParseSystemFunctionCall()) {
      return this.parseSystemFunctionCall()
    }

    if (this.isUnsupportedExpressionKeyword(this.current().kind)) {
      throw this.error(`${tokenKindDisplayName(this.current().kind)} is not supported by the ${this.dialectLabel()} dialect.`, 'expression')
    }

    if (this.at('NUMLIT')) {
      const token = this.advance()
      return {
        type: 'NumberLiteral',
        value: numberValue(token),
        raw: token.lexeme,
        span: token.span,
      }
    }

    if (this.at('STRINGLIT')) {
      const token = this.advance()
      const indexes = this.parseOptionalStringIndexGroups()
      return {
        type: 'StringLiteral',
        value: stringValue(token),
        indexes,
        span: indexes.length > 0 ? joinSpans(token.span, indexes[indexes.length - 1].span) : token.span,
      } satisfies StringLiteralNode
    }

    if (this.isVariableNameStart(this.current().kind)) {
      return this.parseVariable({ allowSpacedNumericName: true })
    }

    if (this.match('BEGINPAR')) {
      const start = this.previous()
      const expression = this.parseExpression()
      const end = this.expect('ENDPAR')
      const indexes = this.parseGroupedExpressionIndexGroups(expression)
      return {
        type: 'GroupedExpression',
        expression,
        indexes,
        span: indexes.length > 0 ? joinSpans(start.span, indexes[indexes.length - 1].span) : joinSpans(start.span, end.span),
      } satisfies GroupedExpressionNode
    }

    throw this.error(`Expected an expression but found ${this.describeCurrent()}.`, 'expression')
  }

  private parseVariable(options: ParseVariableOptions = {}): VariableNode {
    const name = this.expectVariableName()
    let variableName = stringValue(name)
    let endSpan = name.span
    let hasSpacedNumericNameParts = false

    while (this.shouldConsumeSpacedNumericVariablePart(variableName, options)) {
      const nextName = this.advance()
      variableName += stringValue(nextName)
      endSpan = nextName.span
      hasSpacedNumericNameParts = true
    }

    const indexes = hasSpacedNumericNameParts ? [] : this.parseVariableIndexGroups(variableName)
    return {
      type: 'Variable',
      name: variableName,
      indexes,
      span: indexes.length > 0 ? joinSpans(name.span, indexes[indexes.length - 1].span) : joinSpans(name.span, endSpan),
    }
  }

  private shouldConsumeSpacedNumericVariablePart(variableName: string, options: ParseVariableOptions): boolean {
    if (!options.allowSpacedNumericName || variableName.endsWith('$') || !this.at('VARNAME')) {
      return false
    }

    return !String(this.current().value ?? this.current().lexeme).endsWith('$')
  }

  private parseUserFunctionCall(): UserFunctionCallNode {
    const start = this.expect('FN')
    const name = this.expectVariableName()
    this.expect('BEGINPAR')
    const args: ExpressionNode[] = []
    if (this.canStartExpression(this.current().kind)) {
      args.push(this.parseExpression())
      while (this.match('COMMA')) {
        args.push(this.parseExpression())
      }
    }
    const end = this.expect('ENDPAR')

    return {
      type: 'UserFunctionCall',
      name: stringValue(name),
      args,
      span: joinSpans(start.span, end.span),
    }
  }

  private parseSystemFunctionCall(): SystemFunctionCallNode {
    const start = this.advance()
    const args: ExpressionNode[] = []

    if (this.isNoArgumentFunction(start.kind)) {
      return { type: 'SystemFunctionCall', functionName: start.kind, args, span: start.span }
    }

    if (this.dialect !== 'zx81' && start.kind === 'BIN') {
      const literal = this.expect('NUMLIT')
      if (!/^[01]+$/.test(literal.lexeme)) {
        throw new ZxBasicSyntaxError(`Invalid BIN literal "${literal.lexeme}". BIN literals can only contain 0 and 1.`, literal, 'binary literal')
      }
      const arg = {
        type: 'NumberLiteral',
        value: Number.parseInt(literal.lexeme, 2),
        raw: literal.lexeme,
        span: literal.span,
      } satisfies ExpressionNode
      return { type: 'SystemFunctionCall', functionName: start.kind, args: [arg], span: joinSpans(start.span, literal.span) }
    }

    if (this.isTwoArgumentSystemFunction(start.kind)) {
      this.expect('BEGINPAR')
      args.push(this.parseExpression())
      this.expectExpressionType(args[0], 'numeric')
      this.expect('COMMA')
      args.push(this.parseExpression())
      this.expectExpressionType(args[1], 'numeric')
      const end = this.expect('ENDPAR')
      return { type: 'SystemFunctionCall', functionName: start.kind, args, span: joinSpans(start.span, end.span) }
    }

    if (this.isUnarySystemFunction(start.kind)) {
      const arg = this.parseHighPrecedenceExpression()
      this.expectSystemFunctionOperandType(start, arg)
      return { type: 'SystemFunctionCall', functionName: start.kind, args: [arg], span: joinSpans(start.span, arg.span) }
    }

    throw this.error(`Unsupported function ${start.lexeme}.`, 'system function')
  }

  private parseVariableIndexGroups(variableName: string): IndexGroupNode[] {
    if (!this.at('BEGINPAR')) {
      return []
    }

    if (variableName.endsWith('$')) {
      return this.parseStringVariableIndexGroups()
    }

    return this.parseNumericVariableIndexGroups()
  }

  private parseNumericVariableIndexGroups(): IndexGroupNode[] {
    const group = this.parseIndexGroup('numericVariable')
    if (this.at('BEGINPAR')) {
      throw this.error('Numeric arrays cannot have chained index groups.', 'end of numeric array index')
    }
    return [group]
  }

  private parseStringVariableIndexGroups(): IndexGroupNode[] {
    const first = this.parseIndexGroup('stringVariable')
    const groups = [first]
    groups.push(...this.parseOptionalStringIndexGroups())
    return groups
  }

  private parseGroupedExpressionIndexGroups(expression: ExpressionNode): IndexGroupNode[] {
    if (!this.at('BEGINPAR')) {
      return []
    }

    if (this.expressionValueType(expression) !== 'string') {
      throw this.error('Only string expressions can have string indexes or slices.', 'string expression')
    }

    return this.parseOptionalStringIndexGroups()
  }

  private parseOptionalStringIndexGroups(): IndexGroupNode[] {
    const groups: IndexGroupNode[] = []
    while (this.at('BEGINPAR')) {
      groups.push(this.parseIndexGroup('stringSlicer'))
    }
    return groups
  }

  private parseIndexGroup(kind: IndexGroupKind): IndexGroupNode {
    const start = this.expect('BEGINPAR')
    const indexes: IndexNode[] = []

    if (!this.at('ENDPAR')) {
      if (kind === 'numericVariable') {
        indexes.push(this.parseIndex(false))
        this.expectNumericArraySubscript(indexes[indexes.length - 1])
        while (this.match('COMMA')) {
          indexes.push(this.parseIndex(false))
          this.expectNumericArraySubscript(indexes[indexes.length - 1])
        }
      } else if (kind === 'stringVariable') {
        indexes.push(this.parseIndex(false))
        while (this.match('COMMA')) {
          this.expectStringArraySubscript(indexes[indexes.length - 1])
          indexes.push(this.parseIndex(true))
        }
      } else {
        indexes.push(this.parseIndex(true))
      }
    } else if (kind === 'numericVariable') {
      throw this.error('Numeric array indexes cannot be empty.', 'numeric array subscript')
    }

    const end = this.expect('ENDPAR')
    return {
      type: 'IndexGroup',
      indexes,
      span: joinSpans(start.span, end.span),
    }
  }

  private parseIndex(allowEmpty: boolean): IndexNode {
    const start = this.current()
    let from: ExpressionNode | null = null
    let to: ExpressionNode | null = null
    let isSlice = false

    if (this.match('TO')) {
      isSlice = true
      if (this.canStartExpression(this.current().kind)) {
        to = this.parseExpression()
        this.expectExpressionType(to, 'numeric')
      }
      return {
        type: 'Index',
        from,
        to,
        isSlice,
        span: to ? joinSpans(start.span, to.span) : start.span,
      }
    }

    if (this.canStartExpression(this.current().kind)) {
      from = this.parseExpression()
      this.expectExpressionType(from, 'numeric')
    }

    if (this.match('TO')) {
      isSlice = true
      if (this.canStartExpression(this.current().kind)) {
        to = this.parseExpression()
        this.expectExpressionType(to, 'numeric')
      }
    }

    if (!allowEmpty && !from && !isSlice) {
      throw this.error(`Expected an index or slice but found ${this.describeCurrent()}.`, 'index or slice')
    }

    return {
      type: 'Index',
      from,
      to,
      isSlice,
      span: to ? joinSpans(start.span, to.span) : from ? from.span : start.span,
    }
  }

  private expectNumericArraySubscript(index: IndexNode): void {
    if (!index.from || index.isSlice) {
      throw this.error('Numeric array subscripts must be scalar expressions.', 'numeric array subscript')
    }
  }

  private expectStringArraySubscript(index: IndexNode): void {
    if (!index.from || index.isSlice) {
      throw this.error('String array subscripts before a comma must be scalar expressions.', 'string array subscript')
    }
  }

  private expectBinaryOperandTypes(operator: Token, left: ExpressionNode, right: ExpressionNode): void {
    const leftType = this.expressionValueType(left)
    const rightType = this.expressionValueType(right)

    if (operator.kind === 'PLUS') {
      if (leftType !== rightType) {
        throw new ZxBasicSyntaxError('PLUS operands must both be numeric or both be string expressions.', operator, `${leftType} expression`)
      }
      return
    }

    if (comparisonOperators.has(operator.kind)) {
      if (leftType !== rightType) {
        throw new ZxBasicSyntaxError('Comparison operands must both be numeric or both be string expressions.', operator, `${leftType} expression`)
      }
      return
    }

    if (operator.kind === 'AND' && leftType === 'string' && rightType === 'numeric') {
      return
    }

    this.expectExpressionType(left, 'numeric')
    this.expectExpressionType(right, 'numeric')
  }

  private expectSystemFunctionOperandType(functionToken: Token, arg: ExpressionNode): void {
    if (stringOperandFunctions.has(functionToken.kind)) {
      this.expectExpressionType(arg, 'string')
    } else if (numericOperandFunctions.has(functionToken.kind)) {
      this.expectExpressionType(arg, 'numeric')
    }
  }

  private expectExpressionType(expression: ExpressionNode, expected: ExpressionValueType): void {
    const actual = this.expressionValueType(expression)
    if (actual !== expected) {
      throw new ZxBasicSyntaxError(`Expected a ${expected} expression but found a ${actual} expression.`, this.current(), `${expected} expression`)
    }
  }

  private expressionValueType(expression: ExpressionNode): ExpressionValueType {
    switch (expression.type) {
      case 'StringLiteral':
        return 'string'
      case 'Variable':
        return this.variableValueType(expression)
      case 'GroupedExpression':
        return expression.indexes.length > 0 ? 'string' : this.expressionValueType(expression.expression)
      case 'BinaryExpression':
        return this.binaryExpressionValueType(expression)
      case 'SystemFunctionCall':
        return stringSystemFunctions.has(expression.functionName) ? 'string' : 'numeric'
      case 'UserFunctionCall':
        return expression.name.endsWith('$') ? 'string' : 'numeric'
      case 'NumberLiteral':
        return 'numeric'
      case 'UnaryExpression':
        return expression.operator === 'PLUS' ? this.expressionValueType(expression.operand) : 'numeric'
    }
  }

  private binaryExpressionValueType(expression: BinaryExpressionNode): ExpressionValueType {
    const leftType = this.expressionValueType(expression.left)
    const rightType = this.expressionValueType(expression.right)
    if (expression.operator === 'PLUS' && leftType === 'string' && rightType === 'string') {
      return 'string'
    }
    if (expression.operator === 'AND' && leftType === 'string' && rightType === 'numeric') {
      return 'string'
    }
    return 'numeric'
  }

  private variableValueType(variable: VariableNode): ExpressionValueType {
    return isStringVariable(variable) ? 'string' : 'numeric'
  }

  private canStartExpression(kind: TokenKind): boolean {
    return expressionStarters.has(kind) || this.isContextualExpressionVariableStart(kind)
  }

  private isNonVariableExpressionStart(kind: TokenKind): boolean {
    return nonVariableExpressionStarters.has(kind)
  }

  private isVariableNameStart(kind: TokenKind): boolean {
    return kind === 'VARNAME' || contextualVariableNameKinds.has(kind)
  }

  private isContextualExpressionVariableStart(kind: TokenKind): boolean {
    return contextualVariableNameKinds.has(kind) && !this.isExpressionKeywordMeaning(kind)
  }

  private shouldParseSystemFunctionCall(): boolean {
    const kind = this.current().kind
    const nextKind = this.peek().kind

    if (this.isNoArgumentFunction(kind)) {
      return true
    }

    if (this.dialect !== 'zx81' && kind === 'BIN') {
      return nextKind === 'NUMLIT'
    }

    if (this.isTwoArgumentSystemFunction(kind)) {
      return nextKind === 'BEGINPAR'
    }

    if (this.isUnarySystemFunction(kind)) {
      if (kind === 'NOT') {
        return this.canStartNotOperand(nextKind)
      }
      return this.canStartSystemFunctionOperand(nextKind)
    }

    return false
  }

  private isStatementSupported(kind: TokenKind): boolean {
    if (spectranetStatementKinds.has(kind)) {
      return isSpectranetEnabled(this.dialect, this.extensions)
    }

    if (this.dialect === 'zx81') {
      return zx81StatementKinds.has(kind)
    }

    if (this.dialect === 'spectrum') {
      return !zx81OnlyStatementKinds.has(kind) && !ts2068OnlyStatementKinds.has(kind)
    }

    return !zx81OnlyStatementKinds.has(kind)
  }

  private isExpressionKeywordMeaning(kind: TokenKind): boolean {
    if (this.dialect === 'zx81') {
      return zx81ExpressionKeywordMeanings.has(kind)
    }

    if (this.dialect === 'spectrum') {
      return expressionKeywordMeanings.has(kind) && !ts2068OnlyExpressionKeywordKinds.has(kind)
    }

    return expressionKeywordMeanings.has(kind)
  }

  private isNoArgumentFunction(kind: TokenKind): boolean {
    if (!noArgumentFunctions.has(kind)) {
      return false
    }

    return kind === 'FREE' ? this.dialect === 'ts2068' : true
  }

  private isUnarySystemFunction(kind: TokenKind): boolean {
    if (!unarySystemFunctions.has(kind)) {
      return false
    }

    if (this.dialect === 'zx81' && kind === 'VAL_STR') {
      return false
    }

    return this.dialect !== 'zx81' || zx81ExpressionKeywordMeanings.has(kind)
  }

  private isTwoArgumentSystemFunction(kind: TokenKind): boolean {
    if (!isSpectrumFamilyDialect(this.dialect)) {
      return false
    }

    return kind === 'POINT' || kind === 'ATTR' || kind === 'SCREEN' || (kind === 'STICK' && this.dialect === 'ts2068')
  }

  private isUnsupportedExpressionKeyword(kind: TokenKind): boolean {
    if (this.dialect === 'zx81') {
      return expressionKeywordMeanings.has(kind) && !zx81ExpressionKeywordMeanings.has(kind)
    }

    return this.dialect === 'spectrum' && ts2068OnlyExpressionKeywordKinds.has(kind)
  }

  private dialectLabel(): string {
    return dialectLabel(this.dialect)
  }

  private canStartSystemFunctionOperand(kind: TokenKind): boolean {
    if (systemFunctionOperandStoppers.has(kind)) {
      return false
    }

    if (kind !== 'PLUS' && kind !== 'MINUS' && binaryOperators.has(kind)) {
      return false
    }

    return (
      this.isNonVariableExpressionStart(kind) ||
      kind === 'VARNAME' ||
      this.isContextualExpressionVariableStart(kind)
    )
  }

  private canStartNotOperand(kind: TokenKind): boolean {
    if (systemFunctionOperandStoppers.has(kind)) {
      return false
    }

    return this.isNonVariableExpressionStart(kind) || this.isVariableNameStart(kind)
  }

  private expectVariableName(): Token {
    if (!this.isVariableNameStart(this.current().kind)) {
      throw this.error(`Expected ${tokenKindDisplayName('VARNAME')} but found ${this.describeCurrent()}.`, ['VARNAME'])
    }

    return this.advance()
  }

  private expectDefFnParameterName(): string {
    const token = this.expectVariableName()
    const name = stringValue(token)
    if (name.endsWith('$')) {
      throw new ZxBasicSyntaxError('DEF FN parameters must be numeric variables.', token, 'numeric variable')
    }
    return name
  }

  private isPrintSeparator(kind: TokenKind): boolean {
    return kind === 'COMMA' || kind === 'APOSTROPHE' || kind === 'SEMICOLON'
  }

  private isPrintControlStart(kind: TokenKind): boolean {
    return attributeControls.has(kind) || kind === 'AT' || kind === 'TAB' || kind === 'STREAM'
  }

  private atStatementBoundary(): boolean {
    return this.at('ENDOFSTAT') || this.at('ENDOFLINE') || this.at('EOF')
  }

  private consumeRawDisplayControlSequences(): void {
    while (this.at('RAWBYTE')) {
      this.consumeRawDisplayControlSequence()
    }
  }

  private consumeRawDisplayControlSequence(): void {
    const control = this.advance()
    const value = rawByteValue(control)

    if (value === 0x06) {
      return
    }

    if (value === 0x10 || value === 0x11) {
      this.expectRawByteParameter(control, (parameter) => parameter <= 9, 'INK/PAPER control parameter from 0 to 9')
      return
    }

    if (value >= 0x12 && value <= 0x15) {
      this.expectRawByteParameter(control, (parameter) => parameter <= 1, 'FLASH/BRIGHT/INVERSE/OVER control parameter 0 or 1')
      return
    }

    if (value === 0x16) {
      this.expectRawByteParameter(control, (parameter) => parameter <= 23, 'AT row parameter from 0 to 23')
      this.expectRawByteParameter(control, (parameter) => parameter <= 31, 'AT column parameter from 0 to 31')
      return
    }

    if (value === 0x17) {
      this.expectRawByteParameter(control, (parameter) => parameter <= 31, 'TAB parameter from 0 to 31')
      return
    }

    throw new ZxBasicSyntaxError(`Raw byte escape ${control.lexeme} is not a supported display-control byte outside strings or REM.`, control, 'display control byte')
  }

  private expectRawByteParameter(control: Token, isValid: (parameter: number) => boolean, expected: string): void {
    if (!this.at('RAWBYTE')) {
      throw new ZxBasicSyntaxError(`Raw display-control byte ${control.lexeme} is missing a parameter.`, control, expected)
    }

    const parameter = this.advance()
    if (!isValid(rawByteValue(parameter))) {
      throw new ZxBasicSyntaxError(`Raw byte escape ${parameter.lexeme} is not a valid ${expected}.`, parameter, expected)
    }
  }

  private at(kind: TokenKind): boolean {
    return this.current().kind === kind
  }

  private atAny(kinds: ReadonlySet<TokenKind>): boolean {
    return kinds.has(this.current().kind)
  }

  private match(...kinds: readonly TokenKind[]): boolean {
    if (!kinds.includes(this.current().kind)) {
      return false
    }
    this.advance()
    return true
  }

  private expect(kind: TokenKind): Token {
    if (!this.at(kind)) {
      throw this.error(`Expected ${tokenKindDisplayName(kind)} but found ${this.describeCurrent()}.`, [kind])
    }
    return this.advance()
  }

  private advance(): Token {
    const token = this.current()
    if (!this.at('EOF')) {
      this.cursor += 1
    }
    return token
  }

  private current(): Token {
    this.skipTransparentRawBytes()
    return this.tokens[this.cursor]
  }

  private peek(offset = 1): Token {
    let index = this.cursor
    for (let count = 0; count < offset; count += 1) {
      index = Math.min(index + 1, this.tokens.length - 1)
      while (this.shouldSkipTransparentRawByte(index)) {
        index = Math.min(index + 1, this.tokens.length - 1)
      }
    }
    return this.tokens[index]
  }

  private previous(): Token {
    return this.tokens[Math.max(0, this.cursor - 1)]
  }

  private describeCurrent(): string {
    return describeToken(this.current())
  }

  private error(message: string, expected?: readonly TokenKind[] | string): ZxBasicSyntaxError {
    return new ZxBasicSyntaxError(message, this.current(), expected)
  }

  private skipTransparentRawBytes(): void {
    while (this.shouldSkipTransparentRawByte(this.cursor)) {
      this.cursor += 1
    }
  }

  private shouldSkipTransparentRawByte(index: number): boolean {
    return this.tokens[index]?.kind === 'RAWBYTE' && index > 0 && this.tokens[index - 1]?.kind !== 'ENDOFLINE'
  }
}

function rawByteValue(token: Token): number {
  return Number(token.value) & 0xff
}

function operatorPrecedence(kind: TokenKind): number {
  switch (kind) {
    case 'OR':
      return 1
    case 'AND':
      return 2
    case 'EQUAL':
    case 'GREAT':
    case 'LESS':
    case 'GREATEQ':
    case 'LESSEQ':
    case 'NOTEQ':
      return 3
    case 'PLUS':
    case 'MINUS':
      return 4
    case 'MULT':
    case 'DIV':
      return 5
    case 'EXPON':
      return 6
    default:
      return 0
  }
}

function isStringVariable(variable: VariableNode): boolean {
  return variable.name.endsWith('$')
}

function numberValue(token: Token): number {
  return typeof token.value === 'number' ? token.value : Number(token.lexeme)
}

function stringValue(token: Token): string {
  return typeof token.value === 'string' ? token.value : token.lexeme
}

function joinSpans(left: SourceSpan, right: SourceSpan): SourceSpan {
  return { start: left.start, end: right.end }
}

function spanThroughChildren<T extends { readonly span: SourceSpan }>(start: SourceSpan, children: readonly T[]): SourceSpan {
  if (children.length === 0) {
    return start
  }
  return joinSpans(start, children[children.length - 1].span)
}
