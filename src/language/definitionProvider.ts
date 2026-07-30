import * as vscode from 'vscode';
import { PhpIndex } from '../core/phpIndex';
import { resolveAt } from './positionResolver';
import { findEnclosingClass } from './hoverProvider';

export class PhpDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private index: PhpIndex) {}

  provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Definition> {
    const file = this.index.getFile(document.uri);
    if (!file) return;
    const ref = resolveAt(file.ast, position);
    if (!ref) return;

    if (ref.type === 'class') {
      const cls = this.index.resolveClassName(ref.name, file);
      if (cls) return new vscode.Location(vscode.Uri.parse(cls.uri), cls.nameRange);
      return;
    }

    if (ref.type === 'functionCall') {
      const fns = this.index.findFunctionsByName(ref.name);
      if (fns.length) return new vscode.Location(vscode.Uri.parse(fns[0].uri), fns[0].nameRange);
      return;
    }

    if (ref.type === 'methodCall' || ref.type === 'propertyAccess' || ref.type === 'staticMember') {
      const enclosing = findEnclosingClass(file, position);
      const searchClasses = enclosing ? this.index.classHierarchy(enclosing) : this.index.allClasses();
      for (const cls of searchClasses) {
        if (ref.type === 'propertyAccess') {
          const prop = cls.properties.find((p) => p.name === ref.name);
          if (prop) return new vscode.Location(vscode.Uri.parse(cls.uri), prop.nameRange);
        } else {
          const method = cls.methods.find((m) => m.name === ref.name);
          if (method) return new vscode.Location(vscode.Uri.parse(cls.uri), method.nameRange);
        }
      }
    }

    return undefined;
  }
}
