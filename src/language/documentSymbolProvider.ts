import * as vscode from 'vscode';
import { PhpIndex } from '../core/phpIndex';

export class PhpDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  constructor(private index: PhpIndex) {}

  provideDocumentSymbols(document: vscode.TextDocument): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    const file = this.index.getFile(document.uri);
    if (!file) return [];
    const results: vscode.DocumentSymbol[] = [];

    for (const cls of file.classes) {
      const kind =
        cls.kind === 'interface' ? vscode.SymbolKind.Interface : cls.kind === 'trait' ? vscode.SymbolKind.Struct : vscode.SymbolKind.Class;
      const clsSymbol = new vscode.DocumentSymbol(cls.name, cls.fqcn, kind, cls.range, cls.nameRange);
      for (const method of cls.methods) {
        const paramList = method.params.map((p) => `$${p.name}`).join(', ');
        clsSymbol.children.push(
          new vscode.DocumentSymbol(`${method.name}(${paramList})`, method.visibility, vscode.SymbolKind.Method, method.range, method.nameRange)
        );
      }
      for (const prop of cls.properties) {
        clsSymbol.children.push(
          new vscode.DocumentSymbol(`$${prop.name}`, prop.visibility, vscode.SymbolKind.Property, prop.range, prop.nameRange)
        );
      }
      for (const c of cls.constants) {
        clsSymbol.children.push(new vscode.DocumentSymbol(c.name, 'const', vscode.SymbolKind.Constant, c.range, c.range));
      }
      results.push(clsSymbol);
    }

    for (const fn of file.functions) {
      const paramList = fn.params.map((p) => `$${p.name}`).join(', ');
      results.push(new vscode.DocumentSymbol(`${fn.name}(${paramList})`, '', vscode.SymbolKind.Function, fn.range, fn.nameRange));
    }

    return results;
  }
}

export class PhpWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
  constructor(private index: PhpIndex) {}

  provideWorkspaceSymbols(query: string): vscode.ProviderResult<vscode.SymbolInformation[]> {
    const q = query.toLowerCase();
    const results: vscode.SymbolInformation[] = [];
    for (const cls of this.index.allClasses()) {
      if (!q || cls.name.toLowerCase().includes(q)) {
        const kind = cls.kind === 'interface' ? vscode.SymbolKind.Interface : cls.kind === 'trait' ? vscode.SymbolKind.Struct : vscode.SymbolKind.Class;
        results.push(new vscode.SymbolInformation(cls.name, kind, cls.namespace, new vscode.Location(vscode.Uri.parse(cls.uri), cls.nameRange)));
      }
      for (const m of cls.methods) {
        if (!q || m.name.toLowerCase().includes(q)) {
          results.push(
            new vscode.SymbolInformation(m.name, vscode.SymbolKind.Method, cls.name, new vscode.Location(vscode.Uri.parse(cls.uri), m.nameRange))
          );
        }
      }
    }
    return results;
  }
}
