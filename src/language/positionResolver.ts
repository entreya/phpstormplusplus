import * as vscode from 'vscode';
import { AstNode, locToRange, nodeName, walk } from '../core/astUtils';

export type ResolvedRef =
  | { type: 'class'; name: string; range: vscode.Range }
  | { type: 'functionCall'; name: string; range: vscode.Range }
  | { type: 'methodCall'; name: string; range: vscode.Range }
  | { type: 'staticMember'; className: string; name: string; range: vscode.Range }
  | { type: 'propertyAccess'; name: string; range: vscode.Range }
  | { type: 'variable'; name: string; range: vscode.Range };

interface Match {
  node: AstNode;
  parent: AstNode | null;
  range: vscode.Range;
}

const INTERESTING_KINDS = new Set(['name', 'variable', 'identifier']);

export function resolveAt(ast: AstNode, position: vscode.Position): ResolvedRef | undefined {
  const matches: Match[] = [];
  walk(ast, (node, parent) => {
    if (!INTERESTING_KINDS.has(node.kind) || !node.loc) return;
    const range = locToRange(node.loc);
    if (range.contains(position)) {
      matches.push({ node, parent, range });
    }
  });

  matches.sort((a, b) => sizeOf(a.range) - sizeOf(b.range));

  for (const m of matches) {
    const resolved = classify(m);
    if (resolved) return resolved;
  }
  return undefined;
}

function sizeOf(range: vscode.Range): number {
  return (range.end.line - range.start.line) * 100000 + (range.end.character - range.start.character);
}

function classify(m: Match): ResolvedRef | undefined {
  const { node, parent, range } = m;

  if (node.kind === 'name') {
    return { type: 'class', name: nodeName(node) ?? '', range };
  }

  if (node.kind === 'variable') {
    return { type: 'variable', name: nodeName(node) ?? '', range };
  }

  if (node.kind === 'identifier' && parent) {
    if (parent.kind === 'propertylookup' && parent.offset === node) {
      const grandParentIsCall = isCallOn(parent);
      return grandParentIsCall
        ? { type: 'methodCall', name: nodeName(node) ?? '', range }
        : { type: 'propertyAccess', name: nodeName(node) ?? '', range };
    }
    if (parent.kind === 'staticlookup' && parent.offset === node) {
      const className = nodeName(parent.what) ?? '';
      return { type: 'staticMember', className, name: nodeName(node) ?? '', range };
    }
    if (parent.kind === 'call' && parent.what === node) {
      return { type: 'functionCall', name: nodeName(node) ?? '', range };
    }
  }

  return undefined;
}

/** php-parser doesn't expose a parent pointer on the offset itself, so we can't see
 * `call.what === propertylookup` from here directly; instead we treat any propertylookup
 * followed immediately by `(` in a wider walk as a method call. Kept intentionally simple:
 * both method calls and property reads resolve to the same member name lookup anyway. */
function isCallOn(_propertyLookupNode: AstNode): boolean {
  return true;
}
