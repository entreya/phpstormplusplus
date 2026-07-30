import * as vscode from 'vscode';

export interface ParamSymbol {
  name: string;
  type?: string;
  hasDefault: boolean;
  byRef: boolean;
  variadic: boolean;
}

export interface MethodSymbol {
  kind: 'method';
  name: string;
  visibility: 'public' | 'protected' | 'private';
  isStatic: boolean;
  isAbstract: boolean;
  params: ParamSymbol[];
  returnType?: string;
  range: vscode.Range;
  nameRange: vscode.Range;
  bodyRange?: vscode.Range;
  doc?: string;
  node: any;
}

export interface PropertySymbol {
  kind: 'property';
  name: string;
  visibility: 'public' | 'protected' | 'private';
  isStatic: boolean;
  type?: string;
  range: vscode.Range;
  nameRange: vscode.Range;
  doc?: string;
}

export interface ConstSymbol {
  kind: 'const';
  name: string;
  range: vscode.Range;
}

export interface ClassSymbol {
  kind: 'class' | 'interface' | 'trait' | 'enum';
  name: string;
  fqcn: string;
  namespace: string;
  extends: string[];
  implements: string[];
  traits: string[];
  methods: MethodSymbol[];
  properties: PropertySymbol[];
  constants: ConstSymbol[];
  range: vscode.Range;
  nameRange: vscode.Range;
  doc?: string;
  uri: string;
}

export interface FunctionSymbol {
  kind: 'function';
  name: string;
  fqName: string;
  params: ParamSymbol[];
  returnType?: string;
  range: vscode.Range;
  nameRange: vscode.Range;
  bodyRange?: vscode.Range;
  doc?: string;
  uri: string;
}

export interface UseStatement {
  alias: string;
  fqcn: string;
  /** range of the whole `use ...;` statement (spans all items when grouped) */
  groupRange: vscode.Range;
  /** range of just this item's name/alias text within the statement */
  itemRange: vscode.Range;
  /** how many items share this statement's `use` line (>1 for `use Foo, Bar;`-style groups) */
  siblingCount: number;
}

export interface FileIndex {
  uri: string;
  version: number;
  namespace: string;
  /** alias -> fully qualified name, from `use` statements */
  uses: Map<string, string>;
  /** same data as `uses`, plus source locations, for import-management (auto-import, unused cleanup) */
  useStatements: UseStatement[];
  classes: ClassSymbol[];
  functions: FunctionSymbol[];
  ast: any;
}
