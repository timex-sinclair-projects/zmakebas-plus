import { autocompletion, completionStatus, startCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { lex, type BasicDialect, type BasicExtension, type Token, type TokenKind } from '../parser'
import { spectrumTokenDefinitions, ts2068ExtensionTokenDefinitions, type BasicTokenDefinition, zx81TokenDefinitions } from '../parser/basicTokens'
import { isSpectranetEnabled, spectranetStatementKinds, ts2068OnlyExpressionKeywordKinds, ts2068OnlyKeywordKinds, zx81OnlyStatementKinds } from '../parser/dialects'
import { basicKeywordAliases } from '../parser/keywordAliases'
import { expressionStarters, statementStarters } from '../parser/tokens'

type KeywordSpec = {
  readonly text: string
  readonly kind: TokenKind
  readonly consumesRestOfLine?: boolean
}

type ZxBasicHighlightState = {
  inComment: boolean
}

type CompletionGroup = 'expression' | 'expressionOperator' | 'goSuffix' | 'ifThen' | 'inputControl' | 'onErrAction' | 'printControl' | 'statement' | 'forControl'

type KeywordCompletionRequest = {
  readonly from: number
  readonly hasTrailingWhitespace: boolean
  readonly text: string
  readonly groups: readonly CompletionGroup[]
}

const keywordSpecs = (
  [
    { text: '%LISTEN', kind: 'SN_LISTEN' },
    { text: '%ACCEPT', kind: 'SN_ACCEPT' },
    { text: '%CLOSE', kind: 'SN_CLOSE' },
    { text: '%FOPEN', kind: 'SN_FOPEN' },
    { text: '%OPEN', kind: 'SN_OPEN' },
    { text: '%ONEOF', kind: 'SN_ONEOF' },
    { text: '%MOUNT', kind: 'SN_MOUNT' },
    { text: '%UMOUNT', kind: 'SN_UMOUNT' },
    { text: '%CAT', kind: 'SN_CAT' },
    { text: '%CD', kind: 'SN_CD' },
    { text: '%INFO', kind: 'SN_INFO' },
    { text: '%FS', kind: 'SN_FS' },
    { text: '%LOADSNAP', kind: 'SN_LOADSNAP' },
    { text: '%LOAD', kind: 'SN_LOAD' },
    { text: '%SAVE', kind: 'SN_SAVE' },
    { text: '%ALOAD', kind: 'SN_ALOAD' },
    { text: '%ASAVE', kind: 'SN_ASAVE' },
    { text: '%TAPEIN', kind: 'SN_TAPEIN' },
    { text: '%MKDIR', kind: 'SN_MKDIR' },
    { text: '%RMDIR', kind: 'SN_RMDIR' },
    { text: '%MV', kind: 'SN_MV' },
    { text: '%RM', kind: 'SN_RM' },
    { text: '%CP', kind: 'SN_CP' },
    { text: '%CONNECT', kind: 'SN_CONNECT' },
    { text: '%OPENDIR', kind: 'SN_OPENDIR' },
    { text: '%RECLAIM', kind: 'SN_RECLAIM' },
    { text: '%CONTROL', kind: 'SN_CONTROL' },
    { text: '%IFCONFIG', kind: 'SN_IFCONFIG' },
    { text: '%FSCONFIG', kind: 'SN_FSCONFIG' },
    ...basicKeywordAliases,
    ...keywordSpecsFromBasicTokens([...spectrumTokenDefinitions, ...ts2068ExtensionTokenDefinitions, ...zx81TokenDefinitions]),
    { text: 'ONERR', kind: 'ONERR' },
    { text: 'OPEN#', kind: 'OPEN' },
    { text: 'CLOSE#', kind: 'CLOSE' },
  ] satisfies KeywordSpec[]
)
  .filter(uniqueKeywordSpec())
  .sort((left, right) => right.text.length - left.text.length)

function keywordSpecsFromBasicTokens(definitions: readonly BasicTokenDefinition[]): KeywordSpec[] {
  return definitions.filter((definition) => /^[A-Z]/.test(definition.text)).map(keywordSpecFromBasicToken)
}

function keywordSpecFromBasicToken(definition: BasicTokenDefinition): KeywordSpec {
  const spec: KeywordSpec = {
    kind: definition.kind,
    text: definition.text,
  }

  return definition.kind === 'REM' ? { ...spec, consumesRestOfLine: true } : spec
}

function uniqueKeywordSpec(): (spec: KeywordSpec) => boolean {
  const seen = new Set<string>()
  return (spec) => {
    const key = `${spec.kind}\0${spec.text}\0${spec.consumesRestOfLine ? 'rest' : ''}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  }
}

const zx81ExpressionKeywordKinds = new Set<TokenKind>([
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

const sharedContextKeywordKinds = new Set<TokenKind>(['AND', 'OR', 'TO', 'THEN', 'STEP', 'AT', 'TAB', 'LINE'])
const printControlKinds = new Set<TokenKind>(['AT', 'TAB'])
const inputControlKinds = new Set<TokenKind>(['AT', 'TAB', 'LINE'])
const spectrumPrintControlKinds = new Set<TokenKind>(['INK', 'PAPER', 'FLASH', 'BRIGHT', 'INVERSE', 'OVER'])
const expressionOperatorKinds = new Set<TokenKind>(['AND', 'OR'])
const forControlKinds = new Set<TokenKind>(['TO', 'STEP'])
const expressionOperandKinds = new Set<TokenKind>(['NUMLIT', 'STRINGLIT', 'VARNAME', 'RND', 'INKEY', 'PI', 'FREE'])
const expressionCommandKinds = new Set<TokenKind>([
  'BEEP',
  'BORDER',
  'BRIGHT',
  'CLEAR',
  'CLOSE',
  'FLASH',
  'GOSUB',
  'GOTO',
  'INK',
  'INVERSE',
  'LIST',
  'LLIST',
  'MERGE',
  'OPEN',
  'OUT',
  'OVER',
  'PAPER',
  'PAUSE',
  'POKE',
  'RANDOMIZE',
  'RESTORE',
  'RUN',
])
const pairedOperators = ['<=', '>=', '<>', '**'] as const
const simpleOperators = new Set(['+', '-', '*', '/', '^', '=', '<', '>'])
const punctuation = new Set(['(', ')', ',', ';', ':', "'", '#'])
const completionFragmentPattern = /%?[A-Za-z][A-Za-z0-9$#]*$/
const labelPrefixPattern = /^\s*@[A-Za-z_][A-Za-z0-9_]*:\s*/

function createZxBasicStreamParser(dialect: BasicDialect, extensions: readonly BasicExtension[]): StreamParser<ZxBasicHighlightState> {
  return {
    name: 'zx-basic',
    startState: () => ({ inComment: false }),
    token(stream, state) {
      if (stream.sol()) {
        state.inComment = false
      }

      if (stream.sol() && stream.match(/^\s*\d+\b/)) {
        return 'lineNumber'
      }

      if (state.inComment) {
        stream.skipToEnd()
        return 'comment'
      }

      if (stream.eatSpace()) {
        return null
      }

      if (stream.peek() === '"') {
        readString(stream)
        return 'string'
      }

      if (stream.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?/)) {
        return 'number'
      }

      const pairedOperator = pairedOperators.find((operator) => stream.match(operator, false))
      if (pairedOperator) {
        stream.match(pairedOperator)
        return 'operator'
      }

      const char = stream.peek() ?? ''
      if (simpleOperators.has(char)) {
        stream.next()
        return 'operator'
      }

      if (punctuation.has(char)) {
        stream.next()
        return 'punctuation'
      }

      const keyword = matchKeyword(stream.string, stream.pos, dialect, extensions)
      if (keyword) {
        if (keyword.consumesRestOfLine) {
          stream.match(keyword.text, true, true)
          state.inComment = true
          return 'keyword'
        }

        stream.match(keyword.text, true, true)
        return 'keyword'
      }

      if (stream.match(/^[A-Za-z][A-Za-z0-9]*\$?/)) {
        return 'variableName'
      }

      stream.next()
      return null
    },
    tokenTable: {
      lineNumber: tags.labelName,
    },
  }
}

const zxBasicHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#075985', fontWeight: '600' },
  { tag: tags.labelName, color: '#7c2d12', fontWeight: '600' },
  { tag: tags.number, color: '#b45309', fontWeight: '500' },
  { tag: tags.string, color: '#9f1239' },
  { tag: tags.comment, color: '#66736b', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#26322b' },
  { tag: tags.operator, color: '#334155' },
  { tag: tags.punctuation, color: '#64748b' },
])

export function createZxBasicLanguageExtensions(dialect: BasicDialect, extensions: readonly BasicExtension[] = []): readonly Extension[] {
  return [
    StreamLanguage.define(createZxBasicStreamParser(dialect, extensions)),
    syntaxHighlighting(zxBasicHighlightStyle),
    autocompletion({
      activateOnTyping: true,
      activateOnTypingDelay: 50,
      override: [zxBasicKeywordCompletionSource(dialect, extensions)],
      filterStrict: true,
    }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged || completionStatus(update.state) !== null) {
        return
      }

      const selection = update.state.selection.main
      if (!selection.empty) {
        return
      }

      const line = update.state.doc.lineAt(selection.head)
      const linePrefix = line.text.slice(0, selection.head - line.from)
      const completionRequest = getKeywordCompletionRequest(linePrefix, dialect, extensions)
      if (!completionRequest || !shouldAutoStartCompletion(completionRequest)) {
        return
      }

      startCompletion(update.view)
    }),
  ]
}

function zxBasicKeywordCompletionSource(dialect: BasicDialect, extensions: readonly BasicExtension[]): (context: CompletionContext) => CompletionResult | null {
  return (context) => {
    const line = context.state.doc.lineAt(context.pos)
    const linePrefix = line.text.slice(0, context.pos - line.from)
    const completionRequest = getKeywordCompletionRequest(linePrefix, dialect, extensions)
    const completionText = completionRequest?.text ?? ''

    if (!context.explicit && completionText.trim().length === 0 && (!completionRequest || !shouldAutoStartCompletion(completionRequest))) {
      return null
    }

    const options = completionRequest ? completionOptionsForGroups(completionRequest.groups, dialect, extensions) : completionOptionsForGroups(['statement'], dialect, extensions)
    if (options.length === 0) {
      return null
    }

    const from = completionRequest ? line.from + completionRequest.from : context.pos
    return {
      from,
      options,
      validFor: /^%?[A-Za-z][A-Za-z0-9$#]*(?:\s+[A-Za-z#][A-Za-z0-9$#]*)?\s*$/,
    }
  }
}

function shouldAutoStartCompletion(request: KeywordCompletionRequest): boolean {
  if (request.text.length > 0) {
    return true
  }

  return request.groups.some((group) => group === 'goSuffix' || (group === 'ifThen' && request.hasTrailingWhitespace) || group === 'inputControl' || group === 'onErrAction' || group === 'printControl')
}

function getKeywordCompletionRequest(linePrefix: string, dialect: BasicDialect, extensions: readonly BasicExtension[]): KeywordCompletionRequest | null {
  if (isInsideStringOrComment(linePrefix)) {
    return null
  }

  const fragmentMatch = completionFragmentPattern.exec(linePrefix)
  const text = fragmentMatch?.[0] ?? ''
  const from = fragmentMatch ? fragmentMatch.index : linePrefix.length
  const contextText = linePrefix.slice(0, from)
  const tokens = tokenizeCompletionContext(contextText, dialect, extensions)
  const groups = classifyCompletionGroups(contextText, tokens)

  return groups.length > 0 ? { from, hasTrailingWhitespace: /\s$/.test(linePrefix), text, groups } : null
}

function classifyCompletionGroups(contextText: string, tokens: readonly Token[]): readonly CompletionGroup[] {
  const statementTokens = statementTokensBeforeCursor(tokens)
  const lastToken = lastSignificantToken(statementTokens)
  const firstStatementToken = firstSignificantToken(statementTokens)

  if (isAfterGoPrefix(contextText, statementTokens)) {
    return ['goSuffix']
  }

  if (isAfterOnErrPrefix(statementTokens)) {
    return ['onErrAction']
  }

  if (statementTokens.length === 0 || lastToken?.kind === 'ENDOFSTAT' || lastToken?.kind === 'THEN') {
    return ['statement']
  }

  if (firstStatementToken?.kind === 'PRINT' || firstStatementToken?.kind === 'LPRINT') {
    return groupsForPrintLikeStatement(statementTokens, 'PRINT')
  }

  if (firstStatementToken?.kind === 'INPUT') {
    return groupsForPrintLikeStatement(statementTokens, 'INPUT')
  }

  if (firstStatementToken?.kind === 'IF') {
    return statementTokens.some((token) => token.kind === 'THEN') ? ['statement'] : groupsAfterExpressionTokens(statementTokens)
  }

  if (firstStatementToken?.kind === 'FOR') {
    if (lastToken?.kind === 'TO' || lastToken?.kind === 'STEP' || lastToken?.kind === 'EQUAL') {
      return ['expression']
    }
    return expressionLikeToken(lastToken) ? ['forControl', 'expressionOperator'] : []
  }

  if (firstStatementToken?.kind === 'ONERR') {
    return ['onErrAction']
  }

  if (lastToken?.kind === 'EQUAL' || lastToken?.kind === 'BEGINPAR' || lastToken?.kind === 'COMMA' || binaryOperatorToken(lastToken)) {
    return ['expression']
  }

  if (expressionCommandKinds.has(firstStatementToken?.kind ?? 'EOF')) {
    return groupsAfterExpressionTokens(statementTokens)
  }

  return []
}

function groupsForPrintLikeStatement(statementTokens: readonly Token[], statementKind: 'INPUT' | 'PRINT'): readonly CompletionGroup[] {
  const lastToken = lastSignificantToken(statementTokens)
  if (!lastToken || lastToken.kind === statementKind || lastToken.kind === 'LPRINT' || lastToken.kind === 'COMMA' || lastToken.kind === 'SEMICOLON' || lastToken.kind === 'APOSTROPHE') {
    return statementKind === 'INPUT' ? ['inputControl', 'expression'] : ['printControl', 'expression']
  }

  if (lastToken.kind === 'AT' || lastToken.kind === 'TAB' || lastToken.kind === 'LINE' || binaryOperatorToken(lastToken)) {
    return ['expression']
  }

  return expressionLikeToken(lastToken) ? ['expressionOperator'] : []
}

function groupsAfterExpressionTokens(tokens: readonly Token[]): readonly CompletionGroup[] {
  const lastToken = lastSignificantToken(tokens)
  if (!lastToken || lastToken.kind === 'EQUAL' || lastToken.kind === 'BEGINPAR' || lastToken.kind === 'COMMA' || binaryOperatorToken(lastToken)) {
    return ['expression']
  }
  return expressionLikeToken(lastToken) ? ['expressionOperator', 'ifThen'] : []
}

function statementTokensBeforeCursor(tokens: readonly Token[]): readonly Token[] {
  const significantTokens = tokens.filter((token) => token.kind !== 'LINENUMBER' && token.kind !== 'ENDOFLINE' && token.kind !== 'EOF')
  let boundaryIndex = -1

  for (let index = 0; index < significantTokens.length; index += 1) {
    if (significantTokens[index].kind === 'ENDOFSTAT' || significantTokens[index].kind === 'THEN') {
      boundaryIndex = index
    }
  }

  return significantTokens.slice(boundaryIndex + 1)
}

function tokenizeCompletionContext(contextText: string, dialect: BasicDialect, extensions: readonly BasicExtension[]): readonly Token[] {
  const source = prepareCompletionContextForLexer(contextText)
  try {
    return lex(source, { dialect, extensions })
  } catch {
    return []
  }
}

function prepareCompletionContextForLexer(contextText: string): string {
  const sourceWithoutLabel = contextText.replace(labelPrefixPattern, '')
  return /^\s*\d+\b/.test(sourceWithoutLabel) ? sourceWithoutLabel : `10 ${sourceWithoutLabel}`
}

function completionOptionsForGroups(groups: readonly CompletionGroup[], dialect: BasicDialect, extensions: readonly BasicExtension[]): readonly Completion[] {
  const seen = new Set<string>()
  const options: Completion[] = []

  for (const group of groups) {
    for (const completion of completionOptionsForGroup(group, dialect, extensions)) {
      if (seen.has(completion.label)) {
        continue
      }
      seen.add(completion.label)
      options.push(completion)
    }
  }

  return options.sort((left, right) => {
    if (groups.includes('ifThen')) {
      if (left.label === 'THEN') {
        return -1
      }
      if (right.label === 'THEN') {
        return 1
      }
    }

    return left.label.localeCompare(right.label)
  })
}

function completionOptionsForGroup(group: CompletionGroup, dialect: BasicDialect, extensions: readonly BasicExtension[]): readonly Completion[] {
  switch (group) {
    case 'expression':
      return keywordCompletionsForKinds(expressionCompletionKinds(dialect), dialect, extensions, 'function')
    case 'expressionOperator':
      return keywordCompletionsForKinds(expressionOperatorKinds, dialect, extensions, 'keyword')
    case 'forControl':
      return keywordCompletionsForKinds(forControlKinds, dialect, extensions, 'keyword')
    case 'goSuffix':
      return dialect !== 'zx81' ? [makeCompletion('SUB', 'keyword'), makeCompletion('TO', 'keyword')] : []
    case 'ifThen':
      return [makeCompletion('THEN', 'keyword', 100)]
    case 'inputControl':
      return keywordCompletionsForKinds(inputControlCompletionKinds(dialect), dialect, extensions, 'keyword')
    case 'onErrAction':
      return dialect === 'ts2068' ? [makeCompletion('CONTINUE', 'keyword'), makeCompletion('GO TO', 'keyword'), makeCompletion('RESET', 'keyword')] : []
    case 'printControl':
      return keywordCompletionsForKinds(printControlCompletionKinds(dialect), dialect, extensions, 'keyword')
    case 'statement':
      return keywordCompletionsForKinds(statementStarters, dialect, extensions, 'keyword')
  }
}

function keywordCompletionsForKinds(kinds: ReadonlySet<TokenKind>, dialect: BasicDialect, extensions: readonly BasicExtension[], fallbackType: string): readonly Completion[] {
  return keywordSpecs
    .filter((keyword) => kinds.has(keyword.kind) && isKeywordCompletionSupported(keyword, dialect, extensions))
    .map((keyword) => makeCompletion(keyword.text, keyword.kind === 'PI' ? 'constant' : expressionStarters.has(keyword.kind) ? 'function' : fallbackType))
}

function makeCompletion(label: string, type: string, boost?: number): Completion {
  return {
    label,
    type,
    apply: label,
    boost,
  }
}

function expressionCompletionKinds(dialect: BasicDialect): ReadonlySet<TokenKind> {
  if (dialect === 'zx81') {
    return zx81ExpressionKeywordKinds
  }

  return new Set(
    [...expressionStarters].filter((kind) => keywordSpecs.some((keyword) => keyword.kind === kind) && (dialect === 'ts2068' || !ts2068OnlyExpressionKeywordKinds.has(kind))),
  )
}

function printControlCompletionKinds(dialect: BasicDialect): ReadonlySet<TokenKind> {
  return dialect !== 'zx81' ? new Set([...printControlKinds, ...spectrumPrintControlKinds]) : printControlKinds
}

function inputControlCompletionKinds(dialect: BasicDialect): ReadonlySet<TokenKind> {
  return dialect !== 'zx81' ? new Set([...inputControlKinds, ...spectrumPrintControlKinds]) : inputControlKinds
}

function isKeywordCompletionSupported(keyword: KeywordSpec, dialect: BasicDialect, extensions: readonly BasicExtension[]): boolean {
  if (!isKeywordSupportedByDialect(keyword.kind, dialect, extensions)) {
    return false
  }

  if (keyword.kind === 'GOTO' || keyword.kind === 'GOSUB') {
    return dialect !== 'zx81' ? keyword.text.includes(' ') : !keyword.text.includes(' ')
  }

  return true
}

function isKeywordSupportedByDialect(kind: TokenKind, dialect: BasicDialect, extensions: readonly BasicExtension[]): boolean {
  if (spectranetStatementKinds.has(kind)) {
    return isSpectranetEnabled(dialect, extensions)
  }

  if (dialect === 'zx81') {
    return zx81StatementKinds.has(kind) || zx81ExpressionKeywordKinds.has(kind) || sharedContextKeywordKinds.has(kind)
  }

  if (dialect === 'spectrum') {
    return !zx81OnlyStatementKinds.has(kind) && !ts2068OnlyKeywordKinds.has(kind)
  }

  return !zx81OnlyStatementKinds.has(kind)
}

function firstSignificantToken(tokens: readonly Token[]): Token | null {
  return tokens[0] ?? null
}

function lastSignificantToken(tokens: readonly Token[]): Token | null {
  return tokens[tokens.length - 1] ?? null
}

function isAfterGoPrefix(contextText: string, statementTokens: readonly Token[]): boolean {
  if (!/\bGO\s+$/i.test(contextText)) {
    return false
  }

  return statementTokens.length <= 1 && statementTokens[0]?.kind === 'VARNAME' && statementTokens[0].lexeme.toUpperCase() === 'GO'
}

function isAfterOnErrPrefix(statementTokens: readonly Token[]): boolean {
  return statementTokens.length === 1 && statementTokens[0].kind === 'ONERR'
}

function binaryOperatorToken(token: Token | null): boolean {
  if (!token) {
    return false
  }

  return (
    token.kind === 'AND' ||
    token.kind === 'DIV' ||
    token.kind === 'EQUAL' ||
    token.kind === 'EXPON' ||
    token.kind === 'GREAT' ||
    token.kind === 'GREATEQ' ||
    token.kind === 'LESS' ||
    token.kind === 'LESSEQ' ||
    token.kind === 'MINUS' ||
    token.kind === 'MULT' ||
    token.kind === 'NOTEQ' ||
    token.kind === 'OR' ||
    token.kind === 'PLUS'
  )
}

function expressionLikeToken(token: Token | null): boolean {
  if (!token) {
    return false
  }

  return (
    expressionOperandKinds.has(token.kind) ||
    token.kind === 'ENDPAR' ||
    (expressionStarters.has(token.kind) && !binaryOperatorToken(token) && token.kind !== 'PLUS' && token.kind !== 'MINUS' && token.kind !== 'BEGINPAR')
  )
}

function readString(stream: Parameters<NonNullable<StreamParser<ZxBasicHighlightState>['token']>>[0]): void {
  stream.next()

  while (!stream.eol()) {
    const char = stream.next()
    if (char === '"') {
      if (stream.peek() === '"') {
        stream.next()
        continue
      }
      return
    }
  }
}

function isInsideStringOrComment(linePrefix: string): boolean {
  let inString = false
  let index = 0

  while (index < linePrefix.length) {
    const char = linePrefix[index]

    if (char === '"') {
      if (inString && linePrefix[index + 1] === '"') {
        index += 2
        continue
      }

      inString = !inString
      index += 1
      continue
    }

    if (!inString && isRemKeywordAt(linePrefix, index)) {
      return linePrefix.length > index + 3
    }

    index += 1
  }

  return inString
}

function isRemKeywordAt(text: string, index: number): boolean {
  if (!text.toUpperCase().startsWith('REM', index)) {
    return false
  }

  const previous = index === 0 ? '' : text[index - 1]
  const next = text[index + 3] ?? ''
  return !isIdentifierPart(previous) && previous !== '$' && !isIdentifierPart(next) && next !== '$'
}

function matchKeyword(lineText: string, index: number, dialect: BasicDialect, extensions: readonly BasicExtension[]): KeywordSpec | null {
  const upperText = lineText.toUpperCase()

  for (const keyword of keywordSpecs) {
    if (!isKeywordSupportedByDialect(keyword.kind, dialect, extensions)) {
      continue
    }

    if (!upperText.startsWith(keyword.text, index)) {
      continue
    }

    const previous = index === 0 ? '' : lineText[index - 1]
    const next = lineText[index + keyword.text.length] ?? ''
    if (isIdentifierPart(previous) || previous === '$') {
      continue
    }
    if (requiresRightBoundary(keyword.text) && (isIdentifierPart(next) || next === '$')) {
      continue
    }

    return keyword
  }

  return null
}

function requiresRightBoundary(text: string): boolean {
  if (text.endsWith('#')) {
    return false
  }

  const last = text[text.length - 1]
  return /[A-Z0-9$#]/.test(last)
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9]/.test(char)
}
