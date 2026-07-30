import * as vscode from 'vscode';

/** php-parser nodes are loosely typed upstream; we treat them as `any` and
 * narrow defensively at the edges instead of fighting the library's types. */
export type AstNode = any;

export function nodeName(n: AstNode): string | undefined {
  if (!n) return undefined;
  if (typeof n === 'string') return n;
  if (typeof n.name === 'string') return n.name;
  if (n.name && typeof n.name.name === 'string') return n.name.name;
  return undefined;
}

/** php-parser lines are 1-based, columns 0-based; VS Code Positions are both 0-based. */
export function locToRange(loc: any): vscode.Range {
  if (!loc) return new vscode.Range(0, 0, 0, 0);
  return new vscode.Range(
    Math.max(0, loc.start.line - 1),
    loc.start.column,
    Math.max(0, loc.end.line - 1),
    loc.end.column
  );
}

export function nameRange(n: AstNode): vscode.Range {
  if (!n) return new vscode.Range(0, 0, 0, 0);
  if (typeof n.name === 'object' && n.name?.loc) return locToRange(n.name.loc);
  return locToRange(n.loc);
}

export function docText(n: AstNode): string | undefined {
  const comments = n?.leadingComments;
  if (!comments || !comments.length) return undefined;
  const block = comments.filter((c: AstNode) => c.kind === 'commentblock').pop();
  return block?.value;
}

/** Depth-first walk over every node in a php-parser AST, invoking `visit` for each. */
export function walk(node: AstNode, visit: (n: AstNode, parent: AstNode | null) => void, parent: AstNode | null = null): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, parent);
    return;
  }
  if (typeof node.kind === 'string') {
    visit(node, parent);
  }
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    const value = node[key];
    if (value && typeof value === 'object') {
      walk(value, visit, node);
    }
  }
}

export function typeToString(t: AstNode): string | undefined {
  if (!t) return undefined;
  if (typeof t === 'string') return t;
  if (t.kind === 'nullkeyword') return 'null';
  if (t.kind === 'uniontype' || t.kind === 'intersectiontype') {
    const sep = t.kind === 'uniontype' ? '|' : '&';
    return (t.types || []).map(typeToString).join(sep);
  }
  return t.name ?? nodeName(t);
}
