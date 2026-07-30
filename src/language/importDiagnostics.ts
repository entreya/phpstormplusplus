import * as vscode from 'vscode';
import { PhpIndex } from '../core/phpIndex';
import { findUnusedImports } from '../refactor/importManager';

export const UNUSED_IMPORT_CODE = 'unused-import';

export interface ImportDiagnostics {
  collection: vscode.DiagnosticCollection;
  refresh: (document: vscode.TextDocument) => void;
}

export function createImportDiagnostics(index: PhpIndex): ImportDiagnostics {
  const collection = vscode.languages.createDiagnosticCollection('phpstormpp-imports');

  function refresh(document: vscode.TextDocument): void {
    if (document.languageId !== 'php') return;
    const file = index.getFile(document.uri);
    if (!file) {
      collection.delete(document.uri);
      return;
    }
    const unused = findUnusedImports(file, document);
    const diagnostics = unused.map((u) => {
      const d = new vscode.Diagnostic(u.itemRange, `Unused import: ${u.fqcn}`, vscode.DiagnosticSeverity.Hint);
      d.tags = [vscode.DiagnosticTag.Unnecessary];
      d.code = UNUSED_IMPORT_CODE;
      d.source = 'phpstormpp';
      return d;
    });
    collection.set(document.uri, diagnostics);
  }

  return { collection, refresh };
}
