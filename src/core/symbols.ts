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

export interface FileIndex {
  uri: string;
  version: number;
  namespace: string;
  /** alias -> fully qualified name, from `use` statements */
  uses: Map<string, string>;
  classes: ClassSymbol[];
  functions: FunctionSymbol[];
  ast: any;
}
