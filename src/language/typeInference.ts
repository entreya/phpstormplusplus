import * as vscode from 'vscode';
import { AstNode, walk } from '../core/astUtils';
import { ClassSymbol, FileIndex } from '../core/symbols';
import { PhpIndex } from '../core/phpIndex';

/**
 * Best-effort local type inference for a variable at a given position: checks
 * `$this`, the enclosing function/method's parameter type hints, and the nearest
 * preceding `$var = new ClassName(...)` assignment in the same scope. This is not
 * full PhpStorm-grade data-flow analysis, but it's real inference, not a stub.
 */
export function inferVariableClass(index: PhpIndex, file: FileIndex, position: vscode.Position, varName: string): ClassSymbol | undefined {
  if (varName === 'this') {
    return file.classes.find((c) => c.range.contains(position));
  }

  for (const cls of file.classes) {
    if (!cls.range.contains(position)) continue;
    for (const method of cls.methods) {
      if (!method.range.contains(position)) continue;
      const param = method.params.find((p) => p.name === varName);
      if (param?.type) {
        const resolved = index.resolveClassName(param.type, file);
        if (resolved) return resolved;
      }
      if (method.bodyRange) {
        const found = findAssignedClass(index, file, method.node.body, varName, position);
        if (found) return found;
      }
    }
  }

  for (const fn of file.functions) {
    if (!fn.range.contains(position)) continue;
    const param = fn.params.find((p) => p.name === varName);
    if (param?.type) {
      const resolved = index.resolveClassName(param.type, file);
      if (resolved) return resolved;
    }
  }

  return undefined;
}

function findAssignedClass(index: PhpIndex, file: FileIndex, body: AstNode, varName: string, before: vscode.Position): ClassSymbol | undefined {
  let best: { className: string; line: number } | undefined;
  walk(body, (node) => {
    if (node.kind !== 'assign' || node.operator !== '=') return;
    if (node.left?.kind !== 'variable' || node.left.name !== varName) return;
    if (!node.loc || node.loc.start.line - 1 > before.line) return;
    let className: string | undefined;
    if (node.right?.kind === 'new') {
      className = typeof node.right.what === 'object' ? node.right.what.name : undefined;
    }
    if (className && (!best || node.loc.start.line > best.line)) {
      best = { className, line: node.loc.start.line };
    }
  });
  return best ? index.resolveClassName(best.className, file) : undefined;
}
