import type {
  AercoFd68Extension,
  AercoFd68FieldNode,
  AercoFd68StatementNode,
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
  LarkenLkdosStatementNode,
  LineNode,
  NextStatementNode,
  NumberLiteralNode,
  OnErrStatementNode,
  OligerSafeItemNode,
  OligerSafeStatementNode,
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
  aercoFd68StatementKinds,
  defaultDialect,
  dialectLabel,
  isAercoFd68Enabled,
  isLarkenLkdosEnabled,
  isOligerSafeEnabled,
  isSpectranetEnabled,
  isSpectrumFamilyDialect,
  larkenLkdosStatementKinds,
  oligerSafeSlashStatementKinds,
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
const oligerSafeDoubleSlashCommands = new Set<TokenKind>(['SAVE', 'OUT', 'LOAD', 'IN', 'MERGE', 'RUN'])
const oligerSafeBareCommands = new Set<TokenKind>(['LOAD', 'CAT', 'NEXT'])
const oligerSafeFileTypeKinds = new Set<TokenKind>(['CODE', 'SCREEN', 'DATA', 'ABS', 'VAL'])
const aercoFd68Extensions = new Set<AercoFd68Extension>(['BAS', 'DAT', 'CHR', 'BIN', 'SCR', 'ARO', 'LRO', 'BUT', 'VAR'])
const aercoFd68ExtensionDisplayList = '.BAS, .DAT, .CHR, .BIN, .SCR, .ARO, .LRO, .BUT, or .VAR'
const aercoFd68CatNoParameterExtensions = new Set<AercoFd68Extension>(['SCR', 'ARO', 'LRO', 'VAR'])
const aercoFd68MoveNoParameterExtensions = new Set<AercoFd68Extension>(['SCR', 'ARO', 'BUT', 'VAR'])
const larkenLkdosOpenDevices = new Set(['W0', 'W1', 'W2', 'LP', 'DD'])
const larkenLkdosInputOperandNames = ['window', 'top', 'left', 'right', 'bottom'] as const
const larkenLkdosInputSignature = 'window, top, left, right, bottom'
type LarkenLkdosFileTypePrefix = 'A' | 'B' | 'C'
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
  'ENDOFBASIC',
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
    const statements = this.parseStatementSequence(new Set<TokenKind>(['ENDOFLINE', 'ENDOFBASIC', 'EOF']))
    this.match('ENDOFBASIC')
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
    let larkenDispatch: LarkenLkdosStatementNode['dispatch'] | null = null

    while (!this.atAny(stopKinds) && !this.at('EOF')) {
      if (this.dialect === 'zx81' && this.at('ENDOFSTAT')) {
        throw this.error('ZX81 BASIC does not support ":" statement separators.', ['ENDOFLINE'])
      }

      if (this.match('ENDOFSTAT')) {
        larkenDispatch = null
        statements.push({ type: 'EmptyStatement', span: this.previous().span })
        continue
      }

      if (this.at('RAWBYTE')) {
        this.consumeRawDisplayControlSequences()
        continue
      }

      const isOligerSafeStatement = this.isOligerSafeStatementStart()
      if (!statementStarters.has(this.current().kind) && !isOligerSafeStatement) {
        throw this.error(`Expected a statement but found ${this.describeCurrent()}.`, 'statement')
      }

      if (!isOligerSafeStatement && !this.isStatementSupported(this.current().kind)) {
        throw this.error(`${tokenKindDisplayName(this.current().kind)} is not supported by the ${this.dialectLabel()} dialect.`, 'statement')
      }

      const statement = larkenDispatch && larkenLkdosStatementKinds.has(this.current().kind)
        ? this.parseLarkenLkdos(larkenDispatch)
        : this.parseStatement()
      larkenDispatch = null
      statements.push(statement)
      this.consumeRawDisplayControlSequences()

      if (this.dialect === 'zx81' && this.at('ENDOFSTAT')) {
        throw this.error('ZX81 BASIC does not support ":" statement separators.', ['ENDOFLINE'])
      }

      if (this.at('ENDOFSTAT')) {
        this.advance()
        larkenDispatch = this.larkenDispatchFor(statement)
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

    if (this.isOligerSafeStatementStart()) {
      return this.parseOligerSafe()
    }

    if (this.isAercoFd68StatementStart()) {
      const nativeStorage = this.tryParseCompleteTs2068Storage()
      if (nativeStorage) {
        return nativeStorage
      }
      return this.parseAercoFd68()
    }

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
    const thenStatements = this.parseStatementSequence(new Set<TokenKind>(['ENDOFLINE', 'ENDOFBASIC', 'EOF']))

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
      const command = this.current().kind
      const ts2068Storage = this.tryParseTs2068Storage()
      if (ts2068Storage) {
        return ts2068Storage
      }
      if (isAercoFd68Enabled(this.dialect, this.extensions) && aercoFd68StatementKinds.has(command)) {
        throw this.error(`Expected AERCO FD-68 ${command} with a quoted field and trailing comma, or two string operands for native TS2068 ${command}.`, 'AERCO FD-68 field or two string expressions')
      }
      throw this.error(`Expected two string operands for TS2068 ${command}.`, 'string expression, string expression')
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

  private parseLarkenLkdos(dispatch: LarkenLkdosStatementNode['dispatch']): LarkenLkdosStatementNode {
    const command = this.current()
    let statement: Exclude<StatementNode, LarkenLkdosStatementNode>

    switch (command.kind) {
      case 'SAVE':
      case 'LOAD':
        statement = this.parseTape()
        break
      case 'MERGE':
      case 'GOTO':
      case 'CLOSE':
      case 'CLEAR':
      case 'INK':
      case 'PAPER':
        statement = this.parseExpressionCommand(false)
        break
      case 'POKE':
      case 'OPEN':
        statement = this.parseBinaryExpressionCommand()
        break
      case 'PRINT':
      case 'LPRINT':
        statement = this.parseLarkenFilePrint()
        break
      case 'INPUT':
        statement = this.parseLarkenInput()
        break
      case 'DRAW':
      case 'CIRCLE':
        statement = this.parsePlot()
        if (statement.operands.length !== 3) {
          throw this.error(`Larken LKDOS ${command.kind} requires exactly three numeric operands.`, 'three numeric expressions')
        }
        break
      case 'DATA':
        statement = this.parseData()
        break
      case 'CAT':
      case 'ERASE':
      case 'MOVE':
        statement = this.parseLarkenStorage()
        break
      case 'NEW':
      case 'VERIFY':
      case 'FORMAT': {
        const bare = this.advance()
        statement = { type: 'BareCommandStatement', command: bare.kind, span: bare.span }
        break
      }
      default:
        throw this.error(`Unsupported Larken LKDOS command ${this.describeCurrent()}.`, 'LKDOS command')
    }

    if (!this.atStatementBoundary()) {
      throw this.error(`Expected ":" or end of line after Larken LKDOS ${command.kind} but found ${this.describeCurrent()}.`, ['ENDOFSTAT', 'ENDOFLINE'])
    }

    this.validateLarkenStatement(statement)
    return {
      type: 'LarkenLkdosStatement',
      dispatch,
      command: command.kind,
      statement,
      span: statement.span,
    }
  }

  private parseLarkenFilePrint(): PrintStatementNode {
    const command = this.advance()
    const expression = this.parseExpression()
    this.expectExpressionType(expression, 'string')
    return {
      type: 'PrintStatement',
      command: command.kind === 'LPRINT' ? 'LPRINT' : 'PRINT',
      items: [{ type: 'PrintExpression', expression, span: expression.span }],
      span: joinSpans(command.span, expression.span),
    }
  }

  private parseLarkenInput(): InputStatementNode {
    const command = this.expect('INPUT')
    if (!this.match('STREAM')) {
      throw this.error(
        `Larken LKDOS INPUT requires "#" followed by five numeric operands (${larkenLkdosInputSignature}).`,
        ['STREAM'],
      )
    }
    const stream = this.previous()
    const values: ExpressionNode[] = []
    const separators: Token[] = []

    for (const [index, operandName] of larkenLkdosInputOperandNames.entries()) {
      if (index > 0) {
        if (this.atStatementBoundary()) this.throwLarkenInputMissingOperand(operandName)
        if (!this.match('COMMA')) {
          throw this.error(`Larken LKDOS INPUT # expected "," before ${operandName}.`, ['COMMA'])
        }
        separators.push(this.previous())
      }

      if (this.atStatementBoundary()) this.throwLarkenInputMissingOperand(operandName)
      const operandToken = this.current()
      const value = this.parseExpression()
      if (this.expressionValueType(value) !== 'numeric') {
        throw new ZxBasicSyntaxError(`Larken LKDOS INPUT # ${operandName} operand must be numeric.`, operandToken, 'numeric expression')
      }
      values.push(value)
    }

    if (!this.atStatementBoundary()) {
      throw this.error(
        `Larken LKDOS INPUT # accepts exactly five numeric operands (${larkenLkdosInputSignature}); found extra input after bottom.`,
        ['ENDOFSTAT', 'ENDOFLINE'],
      )
    }

    const control: PrintControlNode = {
      type: 'StreamControl',
      value: values[0],
      span: joinSpans(stream.span, values[0].span),
    }
    const items: InputItemNode[] = [{ type: 'InputControl', control, span: control.span }]
    for (const [index, value] of values.slice(1).entries()) {
      const separator = separators[index]
      items.push({ type: 'InputSeparator', separator: separator.kind, span: separator.span })
      items.push({ type: 'InputExpression', expression: value, span: value.span })
    }
    return { type: 'InputStatement', items, span: joinSpans(command.span, values[4].span) }
  }

  private throwLarkenInputMissingOperand(operandName: typeof larkenLkdosInputOperandNames[number]): never {
    throw this.error(
      `Larken LKDOS INPUT # requires five numeric operands (${larkenLkdosInputSignature}); missing ${operandName}.`,
      'numeric expression',
    )
  }

  private parseLarkenStorage(): StorageStatementNode {
    const command = this.advance()
    const items: StorageItemNode[] = []
    if (command.kind === 'CAT' || command.kind === 'ERASE') {
      items.push(this.parseStorageExpression('string'))
      const separator = this.expect('COMMA')
      items.push({ type: 'StorageSeparator', separator: separator.kind, span: separator.span })
    } else {
      items.push(this.parseStorageExpression('string'))
      const separator = this.expect('COMMA')
      items.push({ type: 'StorageSeparator', separator: separator.kind, span: separator.span })
      items.push(this.parseStorageExpression('string'))
    }
    return {
      type: 'StorageStatement',
      command: command.kind as 'CAT' | 'ERASE' | 'MOVE',
      items,
      span: spanThroughChildren(command.span, items),
    }
  }

  private validateLarkenStatement(statement: Exclude<StatementNode, LarkenLkdosStatementNode>): void {
    if (statement.type === 'TapeStatement') {
      const expectedPrefix = statement.extra?.type === 'DataFileSpec'
        ? 'A'
        : statement.extra?.type === 'CodeFileSpec' || statement.extra?.type === 'ScreenFileSpec'
          ? 'C'
          : 'B'
      this.validateLarkenTypedDiskFilename(statement.fileExpression, statement.command, expectedPrefix)
    }
    if (statement.type === 'ExpressionCommandStatement' && statement.expression) {
      const ranges: Partial<Record<TokenKind, readonly [number, number]>> = {
        GOTO: [0, 4], CLOSE: [2, 15], CLEAR: [0, 2], INK: [0, 7], PAPER: [0, 7],
      }
      const range = ranges[statement.command]
      if (range) this.expectLarkenLiteralRange(statement.expression, range[0], range[1], statement.command)
      if (statement.command === 'MERGE') {
        this.validateLarkenTypedDiskFilename(statement.expression, statement.command, 'B')
      }
    }
    if (statement.type === 'BinaryCommandStatement') {
      if (statement.command === 'OPEN') {
        this.expectLarkenLiteralRange(statement.left, 2, 15, 'OPEN # stream')
        this.validateLarkenOpenTarget(statement.right)
      } else if (statement.command === 'POKE') {
        this.expectLarkenLiteralRange(statement.left, 0, 65535, 'POKE address')
        this.expectLarkenLiteralRange(statement.right, 0, 65535, 'POKE value')
      }
    }
    if (statement.type === 'InputStatement') {
      this.validateLarkenInputGeometry(statement)
    }
    if (statement.type === 'PlotStatement' && (statement.command === 'DRAW' || statement.command === 'CIRCLE')) {
      this.expectLarkenLiteralRange(statement.operands[0], 0, 255, `${statement.command} ${statement.command === 'DRAW' ? 'width' : 'x'}`)
      this.expectLarkenLiteralRange(statement.operands[1], 0, statement.command === 'DRAW' ? 255 : 174, `${statement.command} ${statement.command === 'DRAW' ? 'height' : 'y'}`)
      this.expectLarkenLiteralRange(statement.operands[2], 0, 10, `${statement.command} pattern`)
    }
    if (statement.type === 'PrintStatement') {
      const item = statement.items[0]
      if (item?.type === 'PrintExpression') {
        this.validateLarkenDiskFilename(item.expression, statement.command)
      }
    }
    if (statement.type === 'StorageStatement' && statement.command !== 'CAT') {
      const expressions = statement.items.flatMap((item) => item.type === 'StorageExpression' ? [item.expression] : [])
      for (const [index, expression] of expressions.entries()) {
        const label = statement.command === 'MOVE'
          ? `MOVE ${index === 0 ? 'source' : 'destination'}`
          : statement.command
        this.validateLarkenDiskFilename(expression, label)
      }
    }
  }

  private validateLarkenInputGeometry(statement: InputStatementNode): void {
    const values: ExpressionNode[] = []
    for (const item of statement.items) {
      if (item.type === 'InputControl' && item.control.type === 'StreamControl') {
        values.push(item.control.value)
      } else if (item.type === 'InputExpression') {
        values.push(item.expression)
      }
    }
    const [window, top, left, right, bottom] = values
    if (!window || !top || !left || !right || !bottom) return

    this.expectLarkenLiteralRange(window, 0, 2, 'INPUT # window')
    this.expectLarkenLiteralRange(top, 0, 20, 'INPUT # top')
    this.expectLarkenLiteralRange(left, 0, 29, 'INPUT # left')
    this.expectLarkenLiteralRange(right, 1, 31, 'INPUT # right')
    this.expectLarkenLiteralRange(bottom, 1, 21, 'INPUT # bottom')
    this.expectLarkenLiteralOrdering(left, right, 'right', 'left')
    this.expectLarkenLiteralOrdering(top, bottom, 'bottom', 'top')
  }

  private expectLarkenLiteralOrdering(
    lowerExpression: ExpressionNode,
    upperExpression: ExpressionNode,
    upperName: string,
    lowerName: string,
  ): void {
    const lower = this.numericLiteralValue(lowerExpression)
    const upper = this.numericLiteralValue(upperExpression)
    if (lower !== null && upper !== null && upper <= lower) {
      throw new ZxBasicSyntaxError(
        `Larken LKDOS INPUT # ${upperName} literal must be greater than ${lowerName}.`,
        this.tokenForExpression(upperExpression),
        `${upperName} > ${lowerName}`,
      )
    }
  }

  private validateLarkenTypedDiskFilename(
    expression: ExpressionNode,
    command: string,
    expectedPrefix: LarkenLkdosFileTypePrefix,
  ): void {
    const actualPrefix = this.validateLarkenDiskFilename(expression, command)
    if (actualPrefix === null || actualPrefix === expectedPrefix) return

    const article = expectedPrefix === 'A' ? 'an' : 'a'
    throw new ZxBasicSyntaxError(
      `Larken LKDOS ${command} literal filename requires ${article} .${expectedPrefix}? extension for this file form.`,
      this.tokenForExpression(expression),
      `.${expectedPrefix}? filename`,
    )
  }

  private validateLarkenDiskFilename(expression: ExpressionNode, command: string): LarkenLkdosFileTypePrefix | null {
    const literal = this.larkenStringLiteralValue(expression)
    if (literal === null) return null

    const match = /^[^.]{1,6}\.([ABC]).$/.exec(literal)
    if (!match || literal.endsWith('^')) {
      throw new ZxBasicSyntaxError(
        `Larken LKDOS ${command} literal filename must have a 1 to 6 character name, a period, and a two-character extension beginning with uppercase A, B, or C; "^" cannot be the final extension character.`,
        this.tokenForExpression(expression),
        'LKDOS filename',
      )
    }
    return match[1] as LarkenLkdosFileTypePrefix
  }

  private validateLarkenOpenTarget(expression: ExpressionNode): void {
    const literal = this.larkenStringLiteralValue(expression)
    if (literal === null) return

    const normalized = literal.toUpperCase()
    if (larkenLkdosOpenDevices.has(normalized) || /^\S+ (?:IN|OUT)$/.test(normalized)) return

    throw new ZxBasicSyntaxError(
      'Larken LKDOS OPEN # literal must be w0, w1, w2, lp, dd, or a filename followed by exactly one space and IN or OUT.',
      this.tokenForExpression(expression),
      'LKDOS device or "filename IN|OUT"',
    )
  }

  private larkenStringLiteralValue(expression: ExpressionNode): string | null {
    if (expression.type === 'StringLiteral' && expression.indexes.length === 0) return expression.value
    if (expression.type === 'GroupedExpression' && expression.indexes.length === 0) {
      return this.larkenStringLiteralValue(expression.expression)
    }
    return null
  }

  private expectLarkenLiteralRange(expression: ExpressionNode, minimum: number, maximum: number, label: string): void {
    const value = this.numericLiteralValue(expression)
    if (value !== null && (value < minimum || value > maximum)) {
      throw new ZxBasicSyntaxError(
        `Larken LKDOS ${label} literal must be from ${minimum} to ${maximum}.`,
        this.tokenForExpression(expression),
        `${minimum}..${maximum}`,
      )
    }
  }

  private tokenForExpression(expression: ExpressionNode): Token {
    const startToken = this.tokens.find((token) => token.span.start.offset === expression.span.start.offset)
    return { ...(startToken ?? this.current()), span: expression.span }
  }

  private numericLiteralValue(expression: ExpressionNode): number | null {
    if (expression.type === 'NumberLiteral') return expression.value
    if (expression.type === 'GroupedExpression') return this.numericLiteralValue(expression.expression)
    if (expression.type === 'UnaryExpression') {
      const operand = this.numericLiteralValue(expression.operand)
      if (operand === null) return null
      return expression.operator === 'MINUS' ? -operand : operand
    }
    return null
  }

  private larkenDispatchFor(statement: StatementNode): LarkenLkdosStatementNode['dispatch'] | null {
    if (!isLarkenLkdosEnabled(this.dialect, this.extensions)) return null
    if (statement.type === 'ExpressionCommandStatement'
      && statement.command === 'RANDOMIZE'
      && statement.expression?.type === 'SystemFunctionCall'
      && statement.expression.functionName === 'USR'
      && statement.expression.args.length === 1
      && statement.expression.args[0].type === 'NumberLiteral'
      && statement.expression.args[0].value === 100) {
      return 'usr-100'
    }
    if (statement.type === 'PrintStatement'
      && statement.command === 'PRINT'
      && statement.items.length === 1
      && statement.items[0].type === 'PrintControl'
      && statement.items[0].control.type === 'StreamControl'
      && statement.items[0].control.value.type === 'NumberLiteral'
      && statement.items[0].control.value.value === 4) {
      return 'stream-4'
    }
    return null
  }

  private tryParseCompleteTs2068Storage(): StorageStatementNode | null {
    const startCursor = this.cursor
    const statement = this.tryParseTs2068Storage()
    if (statement && this.atStatementBoundary()) {
      return statement
    }

    this.cursor = startCursor
    return null
  }

  private parseAercoFd68(): AercoFd68StatementNode {
    const command = this.advance()
    const aercoCommand = command.kind as AercoFd68StatementNode['command']
    const fieldToken = this.expect('STRINGLIT')
    const field = this.parseAercoFd68Field(fieldToken, aercoCommand)
    if (!this.at('COMMA')) {
      throw this.error(`AERCO FD-68 ${aercoCommand} requires a trailing comma after its quoted field; found ${this.describeCurrent()}.`, ['COMMA'])
    }
    const separator = this.advance()
    const parameters: NumberLiteralNode[] = []

    if (this.at('NUMLIT')) {
      parameters.push(this.parseAercoFd68Parameter())
      while (this.match('COMMA')) {
        parameters.push(this.parseAercoFd68Parameter())
      }
    }

    this.validateAercoFd68Statement(aercoCommand, field, parameters)

    if (!this.atStatementBoundary()) {
      throw this.error(`Expected ":" or end of line after AERCO FD-68 ${aercoCommand} but found ${this.describeCurrent()}.`, ['ENDOFSTAT', 'ENDOFLINE'])
    }

    return {
      type: 'AercoFd68Statement',
      command: aercoCommand,
      field,
      separatorSpan: separator.span,
      parameters,
      span: joinSpans(command.span, parameters.at(-1)?.span ?? separator.span),
    }
  }

  private parseAercoFd68Field(token: Token, command: AercoFd68StatementNode['command']): AercoFd68FieldNode {
    const value = stringValue(token)
    const upperValue = value.toUpperCase()

    if (value === '') {
      return { type: 'AercoFd68DirectoryField', value: '', span: token.span }
    }

    if (command === 'FORMAT') {
      throw new ZxBasicSyntaxError(`AERCO FD-68 FORMAT requires the empty quoted field ""; found ${JSON.stringify(value)}.`, token, 'FORMAT "",')
    }

    const diskCopy = /^([A-D]):=([A-D]):$/i.exec(value)
    if (diskCopy) {
      return {
        type: 'AercoFd68DiskCopyField',
        destinationDrive: diskCopy[1].toUpperCase(),
        sourceDrive: diskCopy[2].toUpperCase(),
        value,
        span: token.span,
      }
    }

    if (/^[A-D]:$/i.test(value)) {
      return { type: 'AercoFd68DriveField', drive: upperValue[0], value, span: token.span }
    }

    if (value === '!') {
      return { type: 'AercoFd68RepeatField', value: '!', span: token.span }
    }

    if (/^[A-Z]\$$/i.test(value)) {
      return { type: 'AercoFd68VariableField', variable: upperValue, value, span: token.span }
    }

    const specialBut = /^(?:([A-D]):)?\.BUT$/i.exec(value)
    if (specialBut) {
      return {
        type: 'AercoFd68FileField',
        drive: specialBut[1]?.toUpperCase() ?? null,
        name: '',
        extension: 'BUT',
        value,
        span: token.span,
      }
    }

    const file = /^(?:([A-D]):)?([^",.:=]{1,10})\.([A-Z]{3})$/i.exec(value)
    const extension = file?.[3].toUpperCase() as AercoFd68Extension | undefined
    if (!file || !extension) {
      this.throwAercoFd68FieldSyntaxError(token, value)
    }
    if (!aercoFd68Extensions.has(extension)) {
      throw new ZxBasicSyntaxError(`AERCO FD-68 does not recognize file extension ${JSON.stringify(`.${extension}`)}. Expected one of ${aercoFd68ExtensionDisplayList}.`, token, aercoFd68ExtensionDisplayList)
    }

    return {
      type: 'AercoFd68FileField',
      drive: file[1]?.toUpperCase() ?? null,
      name: file[2],
      extension,
      value,
      span: token.span,
    }
  }

  private throwAercoFd68FieldSyntaxError(token: Token, value: string): never {
    if (value.includes('=')) {
      throw new ZxBasicSyntaxError(`AERCO FD-68 disk-copy field must use "destination:=source:" with drives A through D, for example "A:=B:"; found ${JSON.stringify(value)}.`, token, '"A:=B:"')
    }

    if (value.endsWith('$')) {
      throw new ZxBasicSyntaxError(`AERCO FD-68 string-variable indirection must be one letter followed by $, for example "X$"; found ${JSON.stringify(value)}.`, token, 'one-letter string variable')
    }

    const drivePrefix = /^([A-Z]):/i.exec(value)
    if (drivePrefix && !/^[A-D]$/i.test(drivePrefix[1])) {
      throw new ZxBasicSyntaxError(`AERCO FD-68 drive must be A:, B:, C:, or D:; found ${JSON.stringify(`${drivePrefix[1]}:`)}.`, token, 'drive A: through D:')
    }

    const fileValue = /^[A-D]:/i.test(value) ? value.slice(2) : value
    if (/[",:=]/.test(fileValue)) {
      throw new ZxBasicSyntaxError(`AERCO FD-68 file names cannot contain quotes, commas, colons, or equals signs; found ${JSON.stringify(value)}.`, token, 'name.extension')
    }

    const firstDot = fileValue.indexOf('.')
    const lastDot = fileValue.lastIndexOf('.')
    if (firstDot < 0) {
      throw new ZxBasicSyntaxError(`AERCO FD-68 file field ${JSON.stringify(value)} must use name.extension with a three-letter extension, for example "FIRST.SCR".`, token, 'name.extension')
    }
    if (firstDot !== lastDot) {
      throw new ZxBasicSyntaxError(`AERCO FD-68 file field ${JSON.stringify(value)} must contain exactly one period between its name and extension.`, token, 'name.extension')
    }

    const name = fileValue.slice(0, firstDot)
    const extension = fileValue.slice(firstDot)
    if (name.length === 0) {
      throw new ZxBasicSyntaxError(`AERCO FD-68 file names must contain 1 to 10 characters before the extension; only the special ".BUT" catalog field may omit the name.`, token, '1 to 10 character file name')
    }
    if (name.length > 10) {
      throw new ZxBasicSyntaxError(`AERCO FD-68 file name ${JSON.stringify(name)} is ${name.length} characters; the name before the extension must be 1 to 10 characters.`, token, '1 to 10 character file name')
    }
    if (!/^\.[A-Z]{3}$/i.test(extension)) {
      throw new ZxBasicSyntaxError(`AERCO FD-68 file extension ${JSON.stringify(extension)} must contain exactly three letters. Expected one of ${aercoFd68ExtensionDisplayList}.`, token, aercoFd68ExtensionDisplayList)
    }

    throw new ZxBasicSyntaxError(`Invalid AERCO FD-68 field ${JSON.stringify(value)}. Expected a file, drive, one-letter string variable, "!", empty field, or disk-copy field.`, token, 'FD-68 field')
  }

  private parseAercoFd68Parameter(): NumberLiteralNode {
    const token = this.expect('NUMLIT')
    const value = numberValue(token)
    if (!/^\d+$/.test(token.lexeme) || !Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new ZxBasicSyntaxError(`AERCO FD-68 parameters must be unsigned decimal integers from 0 to 65535; found ${JSON.stringify(token.lexeme)}.`, token, 'unsigned decimal integer')
    }
    return { type: 'NumberLiteral', value, raw: token.lexeme, span: token.span }
  }

  private validateAercoFd68Statement(command: AercoFd68StatementNode['command'], field: AercoFd68FieldNode, parameters: readonly NumberLiteralNode[]): void {
    if (field.type === 'AercoFd68DirectoryField') {
      if ((command !== 'CAT' && command !== 'FORMAT') || parameters.length !== 0) {
        this.throwAercoFd68FormError(command, field, 'an empty directory field without parameters')
      }
      return
    }

    if (field.type === 'AercoFd68DriveField') {
      if (command !== 'CAT' || parameters.length !== 0) {
        this.throwAercoFd68FormError(command, field, 'a CAT drive field without parameters')
      }
      return
    }

    if (field.type === 'AercoFd68RepeatField') {
      if (command !== 'CAT' || parameters.length !== 0) {
        this.throwAercoFd68FormError(command, field, 'CAT "!",')
      }
      return
    }

    if (field.type === 'AercoFd68DiskCopyField') {
      if ((command !== 'CAT' && command !== 'MOVE') || parameters.length !== 0) {
        this.throwAercoFd68FormError(command, field, 'CAT or MOVE disk copy without parameters')
      }
      return
    }

    if (field.type === 'AercoFd68VariableField') {
      if (command === 'FORMAT' || parameters.length !== 0) {
        this.throwAercoFd68FormError(command, field, 'CAT, MOVE, or ERASE string-variable indirection without parameters')
      }
      return
    }

    this.validateAercoFd68FileStatement(command, field, parameters)
  }

  private validateAercoFd68FileStatement(command: AercoFd68StatementNode['command'], field: Extract<AercoFd68FieldNode, { readonly type: 'AercoFd68FileField' }>, parameters: readonly NumberLiteralNode[]): void {
    if (command === 'FORMAT') {
      this.throwAercoFd68FormError(command, field, 'FORMAT "",')
    }

    if (command === 'ERASE') {
      if (field.name.length === 0 || parameters.length !== 0) {
        this.throwAercoFd68FormError(command, field, 'a named recognized file without parameters')
      }
      return
    }

    const allowedWithoutParameters = command === 'CAT' ? aercoFd68CatNoParameterExtensions : aercoFd68MoveNoParameterExtensions

    if (field.extension === 'BUT' && command === 'CAT') {
      if (field.name.length !== 0 || parameters.length !== 0) {
        this.throwAercoFd68FormError(command, field, 'the special .BUT catalog field without parameters')
      }
      return
    }

    if (field.extension === 'BAS') {
      if (parameters.length > 1) {
        this.throwAercoFd68FormError(command, field, 'zero or one decimal line/address parameter')
      }
      return
    }

    if (field.extension === 'BIN') {
      if (command === 'CAT' && parameters.length <= 1) {
        return
      }
      if (command === 'MOVE' && parameters.length === 2 && parameters.every((parameter) => parameter.value !== 0)) {
        return
      }
      this.throwAercoFd68FormError(command, field, command === 'MOVE' ? 'exactly two non-zero decimal address/length parameters' : 'zero or one decimal relocation parameter')
    }

    if (allowedWithoutParameters.has(field.extension) && parameters.length === 0 && field.name.length > 0) {
      return
    }

    this.throwAercoFd68FormError(command, field, `a file type supported by ${command} with its required parameter count`)
  }

  private throwAercoFd68FormError(command: AercoFd68StatementNode['command'], field: AercoFd68FieldNode, expected: string): never {
    throw new ZxBasicSyntaxError(`AERCO FD-68 ${command} does not support field ${JSON.stringify(field.value)} with this parameter list; expected ${expected}.`, this.current(), expected)
  }

  private parseOligerSafe(): OligerSafeStatementNode {
    const command = this.advance()
    const items: OligerSafeItemNode[] = []

    if (oligerSafeBareCommands.has(command.kind) && this.atStatementBoundary()) {
      return {
        type: 'OligerSafeStatement',
        command: command.kind,
        doubleSlash: false,
        items,
        span: command.span,
      }
    }

    let endSpan = this.expect('DIV').span
    let doubleSlash = false
    if (oligerSafeDoubleSlashCommands.has(command.kind) && this.match('DIV')) {
      doubleSlash = true
      endSpan = this.previous().span
    }

    switch (command.kind) {
      case 'LET':
        this.parseOligerSafeLet(items)
        break
      case 'FORMAT':
        this.parseOligerSafeExpression(items, 'string')
        break
      case 'CAT':
        if (!this.atStatementBoundary()) {
          const width = this.parseOligerSafeExpression(items, 'numeric')
          this.expectOligerSafeLiteralRange(width, 0, 255, 'catalog width')
        }
        break
      case 'COPY':
      case 'GOSUB':
        break
      case 'FOR':
        this.parseOligerSafeFor(items)
        break
      case 'SAVE':
      case 'OUT':
      case 'LOAD':
      case 'IN':
      case 'MERGE':
      case 'RUN':
        this.parseOligerSafeTransfer(command.kind, items)
        break
      case 'MOVE':
      case 'RESTORE':
      case 'ERASE':
      case 'VERIFY':
        this.parseOligerSafeManagement(command.kind, items)
        break
      default:
        throw this.error(`Unsupported JLO SAFE statement ${tokenKindDisplayName(command.kind)}.`, 'JLO SAFE statement')
    }

    if (!this.atStatementBoundary()) {
      throw this.error(`Expected ":" or end of line after JLO SAFE ${tokenKindDisplayName(command.kind)} but found ${this.describeCurrent()}.`, ['ENDOFSTAT', 'ENDOFLINE'])
    }

    if (items.length > 0) {
      endSpan = items[items.length - 1].span
    }

    return {
      type: 'OligerSafeStatement',
      command: command.kind,
      doubleSlash,
      items,
      span: joinSpans(command.span, endSpan),
    }
  }

  private parseOligerSafeLet(items: OligerSafeItemNode[]): void {
    const selector = this.expectOligerSafeLetter(['S', 'T', 'D', 'H', 'P'], 'SAFE setting')
    items.push(this.oligerSafeTokenItem(selector))
    items.push(this.oligerSafeTokenItem(this.expect('EQUAL')))

    if (stringValue(selector).toUpperCase() !== 'P') {
      const value = this.parseOligerSafeExpression(items, 'numeric')
      const setting = stringValue(selector).toUpperCase()
      const [minimum, maximum] = setting === 'S' ? [1, 2] : setting === 'T' ? [2, 255] : [0, 3]
      this.expectOligerSafeLiteralRange(value, minimum, maximum, `${setting} setting`)
      return
    }

    items.push(this.oligerSafeTokenItem(this.expectOligerSafeLetter(['T', 'O'], 'printer selection')))
    if (this.match('DIV')) {
      items.push(this.oligerSafeTokenItem(this.previous()))
      items.push(this.oligerSafeTokenItem(this.expectOligerSafeLetter(['A', 'O', 'L', 'G', 'B'], 'copy protocol')))
    }
  }

  private parseOligerSafeFor(items: OligerSafeItemNode[]): void {
    this.parseOligerSafeExpression(items, 'numeric')
    if (this.match('TO')) {
      items.push(this.oligerSafeTokenItem(this.previous()))
      this.parseOligerSafeExpression(items, 'numeric')
    }
  }

  private parseOligerSafeTransfer(command: TokenKind, items: OligerSafeItemNode[]): void {
    const expression = this.parseExpression()
    const valueType = this.expressionValueType(expression)
    items.push({ type: 'OligerSafeExpression', expression, span: expression.span })

    if (valueType === 'numeric') {
      if (command === 'MERGE') {
        throw new ZxBasicSyntaxError('JLO SAFE MERGE requires a string file name.', this.current(), 'string expression')
      }
      if (command === 'SAVE' || command === 'OUT') {
        this.expectOligerSafeLiteralRange(expression, 0, 0, 'file-zero save value')
      } else {
        this.expectOligerSafeLiteralRange(expression, 0, 255, 'legacy load value')
      }
      return
    }

    if (command === 'MERGE') {
      return
    }

    if (command === 'RUN') {
      items.push(this.oligerSafeTokenItem(this.expect('CODE')))
      return
    }

    const isSave = command === 'SAVE' || command === 'OUT'
    this.parseOligerSafeTransferSuffix(isSave, items)
  }

  private parseOligerSafeTransferSuffix(isSave: boolean, items: OligerSafeItemNode[]): void {
    if (this.match('LINE')) {
      if (!isSave) {
        throw new ZxBasicSyntaxError('JLO SAFE LOAD and IN do not accept LINE.', this.previous(), 'load file type')
      }
      items.push(this.oligerSafeTokenItem(this.previous()))
      const line = this.parseOligerSafeExpression(items, 'numeric')
      this.expectOligerSafeLiteralRange(line, 0, 9999, 'auto-run line')
      return
    }

    if (this.match('CODE')) {
      items.push(this.oligerSafeTokenItem(this.previous()))
      if (isSave || this.canStartExpression(this.current().kind)) {
        this.parseOligerSafeExpression(items, 'numeric')
        if (this.match('COMMA')) {
          items.push(this.oligerSafeTokenItem(this.previous()))
          this.parseOligerSafeExpression(items, 'numeric')
        } else if (isSave) {
          throw this.error('JLO SAFE SAVE and OUT CODE require address and length.', ['COMMA'])
        }
      }
      return
    }

    if (this.match('DATA')) {
      items.push(this.oligerSafeTokenItem(this.previous()))
      this.parseOligerSafeArrayDesignator(items)
      return
    }

    if (this.match('SCREEN', 'VAL', 'ABS')) {
      items.push(this.oligerSafeTokenItem(this.previous()))
    }
  }

  private parseOligerSafeArrayDesignator(items: OligerSafeItemNode[]): void {
    const variable = this.expectVariableName()
    this.expect('BEGINPAR')
    const end = this.expect('ENDPAR')
    items.push({
      type: 'OligerSafeVariable',
      name: stringValue(variable),
      span: joinSpans(variable.span, end.span),
    })
  }

  private parseOligerSafeManagement(command: TokenKind, items: OligerSafeItemNode[]): void {
    if (command === 'MOVE' && this.atStatementBoundary()) {
      return
    }

    if (command === 'RESTORE' && this.isBareOligerSafeResetSelector()) {
      items.push(this.oligerSafeTokenItem(this.advance()))
      return
    }

    this.parseOligerSafeExpression(items, 'string')
    const hasFileType = this.parseOptionalOligerSafeFileType(items)

    if (command === 'RESTORE') {
      if (this.atStatementBoundary() && !hasFileType) {
        return
      }
      items.push(this.oligerSafeTokenItem(this.expect('TO')))
      this.parseOligerSafeExpression(items, 'string')
      return
    }

    if (command === 'MOVE' && this.match('TO')) {
      items.push(this.oligerSafeTokenItem(this.previous()))
      const drive = this.parseOligerSafeExpression(items, 'numeric')
      this.expectOligerSafeLiteralRange(drive, 0, 3, 'destination drive')
    }
  }

  private parseOptionalOligerSafeFileType(items: OligerSafeItemNode[]): boolean {
    if (!oligerSafeFileTypeKinds.has(this.current().kind)) {
      return false
    }

    const type = this.advance()
    items.push(this.oligerSafeTokenItem(type))
    if (type.kind === 'DATA' && this.match('DOLLAR')) {
      items.push(this.oligerSafeTokenItem(this.previous()))
    }
    return true
  }

  private parseOligerSafeExpression(items: OligerSafeItemNode[], expectedType: ExpressionValueType): ExpressionNode {
    const expression = this.parseExpression()
    this.expectExpressionType(expression, expectedType)
    items.push({ type: 'OligerSafeExpression', expression, span: expression.span })
    return expression
  }

  private expectOligerSafeLiteralRange(expression: ExpressionNode, minimum: number, maximum: number, description: string): void {
    const value = this.oligerSafeNumericLiteralValue(expression)
    if (value === null || (value >= minimum && value <= maximum)) {
      return
    }

    const range = minimum === maximum ? String(minimum) : `${minimum} to ${maximum}`
    throw new ZxBasicSyntaxError(`JLO SAFE ${description} must be ${range}; found ${value}.`, this.current(), range)
  }

  private oligerSafeNumericLiteralValue(expression: ExpressionNode): number | null {
    if (expression.type === 'NumberLiteral') {
      return expression.value
    }

    if (expression.type === 'GroupedExpression' && expression.indexes.length === 0) {
      return this.oligerSafeNumericLiteralValue(expression.expression)
    }

    if (expression.type === 'UnaryExpression' && (expression.operator === 'PLUS' || expression.operator === 'MINUS')) {
      const operand = this.oligerSafeNumericLiteralValue(expression.operand)
      if (operand !== null) {
        return expression.operator === 'MINUS' ? -operand : operand
      }
    }

    return null
  }

  private expectOligerSafeLetter(allowed: readonly string[], description: string): Token {
    const token = this.expectVariableName()
    if (!allowed.includes(stringValue(token).toUpperCase())) {
      throw new ZxBasicSyntaxError(`Expected ${description} ${allowed.join(', ')} but found ${JSON.stringify(token.lexeme)}.`, token, description)
    }
    return token
  }

  private isBareOligerSafeResetSelector(): boolean {
    return this.at('VARNAME') && stringValue(this.current()).toUpperCase() === 'S' && this.isStatementBoundaryKind(this.peek().kind)
  }

  private oligerSafeTokenItem(token: Token): OligerSafeItemNode {
    return { type: 'OligerSafeToken', token: token.kind, lexeme: token.lexeme, span: token.span }
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
      return this.parseSystemFunctionOrLowercaseVariable()
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
        storedNumber: token.storedNumber,
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

  private parseSystemFunctionOrLowercaseVariable(): ExpressionNode {
    const start = this.current()
    const startCursor = this.cursor

    try {
      return this.parseSystemFunctionCall()
    } catch (error) {
      if (!(error instanceof ZxBasicSyntaxError) || !this.isLowercaseContextualVariableToken(start)) {
        throw error
      }

      this.cursor = startCursor
      return this.parseVariable({ allowSpacedNumericName: true })
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
        storedNumber: literal.storedNumber,
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

  private isOligerSafeStatementStart(): boolean {
    if (!isOligerSafeEnabled(this.dialect, this.extensions)) {
      return false
    }

    const kind = this.current().kind
    if (oligerSafeSlashStatementKinds.has(kind) && this.peek().kind === 'DIV') {
      return true
    }

    return oligerSafeBareCommands.has(kind) && this.isStatementBoundaryKind(this.peek().kind)
  }

  private isAercoFd68StatementStart(): boolean {
    const field = this.peek()
    return isAercoFd68Enabled(this.dialect, this.extensions)
      && aercoFd68StatementKinds.has(this.current().kind)
      && field.kind === 'STRINGLIT'
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

  private isLowercaseContextualVariableToken(token: Token): boolean {
    return this.isVariableNameStart(token.kind) && /[a-z]/.test(token.lexeme)
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
    return this.isStatementBoundaryKind(this.current().kind)
  }

  private isStatementBoundaryKind(kind: TokenKind): boolean {
    return kind === 'ENDOFSTAT' || kind === 'ENDOFLINE' || kind === 'ENDOFBASIC' || kind === 'EOF'
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
