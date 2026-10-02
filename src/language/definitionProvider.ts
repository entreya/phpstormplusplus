import * as vscode from 'vscode';
import { PhpIndex } from '../core/phpIndex';
import { resolveAt } from './positionResolver';
import { findEnclosingClass } from './hoverProvider';

export class PhpDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private index: PhpIndex) {}

  async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Definition | undefined> {
    // Index the file being navigated from on demand if it isn't already — e.g.
    // a freshly-created file the background scan/watcher hasn't reached yet.
    let file = this.index.getFile(document.uri);
    if (!file) {
      this.index.indexDocument(document);
      file = this.index.getFile(document.uri);
    }
    if (!file) return;
    const ref = resolveAt(file.ast, position);
    if (!ref) return;

    if (ref.type === 'class') {
      let cls = this.index.resolveClassName(ref.name, file);
      if (!cls) {
        // The target class may be a brand-new file the index hasn't seen yet.
        // Locate + index it by its PSR-4 file name, then resolve once more.
        await this.index.ensureClassIndexed(ref.name);
        cls = this.index.resolveClassName(ref.name, file);
      }
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
