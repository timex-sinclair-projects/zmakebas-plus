import type { SourceSpan, TokenKind } from './tokens'

export type NodeBase = {
  readonly type: string
  readonly span: SourceSpan
}

export type ProgramNode = NodeBase & {
  readonly type: 'Program'
  readonly lines: readonly LineNode[]
}

export type LineNode = NodeBase & {
  readonly type: 'Line'
  readonly lineNumber: number
  readonly statements: readonly StatementNode[]
}

export type StatementNode =
  | EmptyStatementNode
  | BareCommandStatementNode
  | RemStatementNode
  | ExpressionCommandStatementNode
  | BinaryCommandStatementNode
  | PrintStatementNode
  | InputStatementNode
  | PlotStatementNode
  | TapeStatementNode
  | DimStatementNode
  | LetStatementNode
  | ReadStatementNode
  | ForStatementNode
  | NextStatementNode
  | IfStatementNode
  | DefFnStatementNode
  | DataStatementNode
  | DeleteStatementNode
  | OnErrStatementNode
  | SoundStatementNode
  | StorageStatementNode
  | SpectranetStatementNode

export type EmptyStatementNode = NodeBase & {
  readonly type: 'EmptyStatement'
}

export type BareCommandStatementNode = NodeBase & {
  readonly type: 'BareCommandStatement'
  readonly command: TokenKind
}

export type ExpressionCommandStatementNode = NodeBase & {
  readonly type: 'ExpressionCommandStatement'
  readonly command: TokenKind
  readonly expression: ExpressionNode | null
}

export type BinaryCommandStatementNode = NodeBase & {
  readonly type: 'BinaryCommandStatement'
  readonly command: TokenKind
  readonly left: ExpressionNode
  readonly right: ExpressionNode
}

export type RemStatementNode = NodeBase & {
  readonly type: 'RemStatement'
  readonly comment: string
}

export type PrintStatementNode = NodeBase & {
  readonly type: 'PrintStatement'
  readonly command: 'PRINT' | 'LPRINT'
  readonly items: readonly PrintItemNode[]
}

export type PrintItemNode =
  | { readonly type: 'PrintExpression'; readonly expression: ExpressionNode; readonly span: SourceSpan }
  | { readonly type: 'PrintSeparator'; readonly separator: TokenKind; readonly span: SourceSpan }
  | { readonly type: 'PrintControl'; readonly control: PrintControlNode; readonly span: SourceSpan }

export type InputStatementNode = NodeBase & {
  readonly type: 'InputStatement'
  readonly items: readonly InputItemNode[]
}

export type InputItemNode =
  | { readonly type: 'InputExpression'; readonly expression: ExpressionNode; readonly span: SourceSpan }
  | { readonly type: 'InputTarget'; readonly variable: VariableNode; readonly lineInput: boolean; readonly span: SourceSpan }
  | { readonly type: 'InputSeparator'; readonly separator: TokenKind; readonly span: SourceSpan }
  | { readonly type: 'InputControl'; readonly control: PrintControlNode; readonly span: SourceSpan }

export type PrintControlNode =
  | { readonly type: 'AttributeControl'; readonly command: TokenKind; readonly value: ExpressionNode; readonly span: SourceSpan }
  | { readonly type: 'AtControl'; readonly row: ExpressionNode; readonly column: ExpressionNode; readonly span: SourceSpan }
  | { readonly type: 'TabControl'; readonly value: ExpressionNode; readonly span: SourceSpan }
  | { readonly type: 'StreamControl'; readonly value: ExpressionNode; readonly span: SourceSpan }

export type PlotStatementNode = NodeBase & {
  readonly type: 'PlotStatement'
  readonly command: 'PLOT' | 'CIRCLE' | 'DRAW' | 'UNPLOT'
  readonly controls: readonly PrintControlNode[]
  readonly operands: readonly ExpressionNode[]
}

export type TapeStatementNode = NodeBase & {
  readonly type: 'TapeStatement'
  readonly command: 'VERIFY' | 'LOAD' | 'SAVE'
  readonly fileExpression: ExpressionNode
  readonly extra: FileSpecExtraNode | null
}

export type FileSpecExtraNode =
  | { readonly type: 'DataFileSpec'; readonly variable: string; readonly span: SourceSpan }
  | { readonly type: 'CodeFileSpec'; readonly address: ExpressionNode | null; readonly length: ExpressionNode | null; readonly span: SourceSpan }
  | { readonly type: 'ScreenFileSpec'; readonly span: SourceSpan }
  | { readonly type: 'LineFileSpec'; readonly line: ExpressionNode; readonly span: SourceSpan }

export type DimStatementNode = NodeBase & {
  readonly type: 'DimStatement'
  readonly variable: string
  readonly dimensions: readonly ExpressionNode[]
}

export type LetStatementNode = NodeBase & {
  readonly type: 'LetStatement'
  readonly target: VariableNode
  readonly value: ExpressionNode
}

export type ReadStatementNode = NodeBase & {
  readonly type: 'ReadStatement'
  readonly targets: readonly VariableNode[]
}

export type ForStatementNode = NodeBase & {
  readonly type: 'ForStatement'
  readonly variable: string
  readonly from: ExpressionNode
  readonly to: ExpressionNode
  readonly step: ExpressionNode | null
}

export type NextStatementNode = NodeBase & {
  readonly type: 'NextStatement'
  readonly variable: string
}

export type IfStatementNode = NodeBase & {
  readonly type: 'IfStatement'
  readonly condition: ExpressionNode
  readonly thenStatements: readonly StatementNode[]
}

export type DefFnStatementNode = NodeBase & {
  readonly type: 'DefFnStatement'
  readonly name: string
  readonly parameters: readonly string[]
  readonly value: ExpressionNode
}

export type DataStatementNode = NodeBase & {
  readonly type: 'DataStatement'
  readonly values: readonly ExpressionNode[]
}

export type DeleteStatementNode = NodeBase & {
  readonly type: 'DeleteStatement'
  readonly from: ExpressionNode | null
  readonly to: ExpressionNode | null
}

export type OnErrStatementNode = NodeBase & {
  readonly type: 'OnErrStatement'
  readonly action: 'GOTO' | 'CONTINUE' | 'RESET'
  readonly line: ExpressionNode | null
}

export type SoundStatementNode = NodeBase & {
  readonly type: 'SoundStatement'
  readonly pairs: readonly SoundRegisterPairNode[]
}

export type SoundRegisterPairNode = {
  readonly register: ExpressionNode
  readonly value: ExpressionNode
  readonly span: SourceSpan
}

export type StorageStatementNode = NodeBase & {
  readonly type: 'StorageStatement'
  readonly command: 'CAT' | 'ERASE' | 'FORMAT' | 'MOVE'
  readonly items: readonly StorageItemNode[]
}

export type StorageItemNode =
  | { readonly type: 'StorageExpression'; readonly expression: ExpressionNode; readonly span: SourceSpan }
  | { readonly type: 'StorageSeparator'; readonly separator: TokenKind; readonly span: SourceSpan }

export type SpectranetStatementNode = NodeBase & {
  readonly type: 'SpectranetStatement'
  readonly command: TokenKind
  readonly items: readonly SpectranetItemNode[]
}

export type SpectranetItemNode =
  | { readonly type: 'SpectranetExpression'; readonly expression: ExpressionNode; readonly span: SourceSpan }
  | { readonly type: 'SpectranetSeparator'; readonly separator: TokenKind; readonly span: SourceSpan }

export type ExpressionNode =
  | NumberLiteralNode
  | StringLiteralNode
  | VariableNode
  | GroupedExpressionNode
  | UnaryExpressionNode
  | BinaryExpressionNode
  | SystemFunctionCallNode
  | UserFunctionCallNode

export type NumberLiteralNode = NodeBase & {
  readonly type: 'NumberLiteral'
  readonly value: number
  readonly raw: string
}

export type StringLiteralNode = NodeBase & {
  readonly type: 'StringLiteral'
  readonly value: string
  readonly indexes: readonly IndexGroupNode[]
}

export type VariableNode = NodeBase & {
  readonly type: 'Variable'
  readonly name: string
  readonly indexes: readonly IndexGroupNode[]
}

export type GroupedExpressionNode = NodeBase & {
  readonly type: 'GroupedExpression'
  readonly expression: ExpressionNode
  readonly indexes: readonly IndexGroupNode[]
}

export type UnaryExpressionNode = NodeBase & {
  readonly type: 'UnaryExpression'
  readonly operator: TokenKind
  readonly operand: ExpressionNode
}

export type BinaryExpressionNode = NodeBase & {
  readonly type: 'BinaryExpression'
  readonly operator: TokenKind
  readonly left: ExpressionNode
  readonly right: ExpressionNode
}

export type SystemFunctionCallNode = NodeBase & {
  readonly type: 'SystemFunctionCall'
  readonly functionName: TokenKind
  readonly args: readonly ExpressionNode[]
}

export type UserFunctionCallNode = NodeBase & {
  readonly type: 'UserFunctionCall'
  readonly name: string
  readonly args: readonly ExpressionNode[]
}

export type IndexGroupNode = NodeBase & {
  readonly type: 'IndexGroup'
  readonly indexes: readonly IndexNode[]
}

export type IndexNode = NodeBase & {
  readonly type: 'Index'
  readonly from: ExpressionNode | null
  readonly to: ExpressionNode | null
  readonly isSlice: boolean
}
