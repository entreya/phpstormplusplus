import * as vscode from 'vscode';
import { PhpIndex } from '../core/phpIndex';
import { resolveAt } from './positionResolver';
import { locToRange, walk } from '../core/astUtils';
import { FileIndex } from '../core/symbols';

export class PhpReferenceProvider implements vscode.ReferenceProvider {
  constructor(private index: PhpIndex) {}

  provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext
  ): vscode.ProviderResult<vscode.Location[]> {
    const file = this.index.getFile(document.uri);
    if (!file) return [];
    const ref = resolveAt(file.ast, position);
    if (!ref) return [];
    return findReferences(this.index, file, ref, context.includeDeclaration);
  }
}

export function findReferences(
  index: PhpIndex,
  file: FileIndex,
  ref: ReturnType<typeof resolveAt>,
  includeDeclaration: boolean
): vscode.Location[] {
  if (!ref) return [];
  const locations: vscode.Location[] = [];

  if (ref.type === 'variable') {
    const enclosing = enclosingScopeRange(file, ref.range.start);
    walk(file.ast, (node) => {
      if (node.kind === 'variable' && node.name === ref.name && node.loc) {
        const r = locToRange(node.loc);
        if (!enclosing || enclosing.contains(r)) locations.push(new vscode.Location(vscode.Uri.parse(file.uri), r));
      }
    });
    return locations;
  }

  if (ref.type === 'class') {
    const cls = index.resolveClassName(ref.name, file);
    const targetFqcn = cls?.fqcn ?? ref.name;
    if (includeDeclaration && cls) {
      locations.push(new vscode.Location(vscode.Uri.parse(cls.uri), cls.nameRange));
    }
    for (const f of index.allFiles()) {
      walk(f.ast, (node) => {
        if (node.kind === 'name' && node.loc) {
          const resolved = index.resolveClassName(node.name, f);
          if (resolved && resolved.fqcn === targetFqcn) {
            locations.push(new vscode.Location(vscode.Uri.parse(f.uri), locToRange(node.loc)));
          }
        }
      });
    }
    return locations;
  }

  if (ref.type === 'functionCall') {
    const fns = index.findFunctionsByName(ref.name);
    if (includeDeclaration) {
      for (const fn of fns) locations.push(new vscode.Location(vscode.Uri.parse(fn.uri), fn.nameRange));
    }
    for (const f of index.allFiles()) {
      walk(f.ast, (node, parent) => {
        if (node.kind === 'name' && parent?.kind === 'call' && parent.what === node && node.name.toLowerCase() === ref.name.toLowerCase()) {
          locations.push(new vscode.Location(vscode.Uri.parse(f.uri), locToRange(node.loc)));
        }
      });
    }
    return locations;
  }

  // methodCall / propertyAccess / staticMember: name-based match across the class hierarchy's
  // declaring file plus a workspace-wide name scan. Without full type inference this can include
  // same-named members from unrelated classes — a known, documented limitation.
  const name = ref.name;
  if (includeDeclaration) {
    for (const cls of index.allClasses()) {
      const member = ref.type === 'propertyAccess' ? cls.properties.find((p) => p.name === name) : cls.methods.find((m) => m.name === name);
      if (member) locations.push(new vscode.Location(vscode.Uri.parse(cls.uri), member.nameRange));
    }
  }
  const wantKind = ref.type === 'propertyAccess' ? 'propertylookup' : ref.type === 'methodCall' ? 'propertylookup' : 'staticlookup';
  for (const f of index.allFiles()) {
    walk(f.ast, (node) => {
      if (node.kind === wantKind && node.offset && node.loc) {
        const offsetName = typeof node.offset === 'object' ? node.offset.name : node.offset;
        if (offsetName === name && node.offset.loc) {
          locations.push(new vscode.Location(vscode.Uri.parse(f.uri), locToRange(node.offset.loc)));
        }
      }
    });
  }
  return locations;
}

function enclosingScopeRange(file: FileIndex, position: vscode.Position): vscode.Range | undefined {
  for (const cls of file.classes) {
    for (const method of cls.methods) {
      if (method.bodyRange?.contains(position)) return method.bodyRange;
    }
  }
  for (const fn of file.functions) {
    if (fn.bodyRange?.contains(position)) return fn.bodyRange;
  }
  return undefined;
}
